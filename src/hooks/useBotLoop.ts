import { useState, useEffect, useRef, useCallback } from 'react';
import { useStockFeed }               from './useStockFeed';
import { useWakeLock }                from './useWakeLock';
import { ohlcvToDataUrl }             from '../utils/chartRenderer';
import { vwapProxy }                  from '../quant/vwapProxy';
import { runSingleAnalysis }          from '../utils/singleAnalysis';
import { evaluateScalpSignal }         from '../quant/scalpingEngine';
import { checkRiskCaps, onTradeClosed } from '../quant/riskGuard';
import { loadRiskState, saveRiskState } from '../quant/riskGuard';
import { loadScalpConfig }            from '../quant/scalpingEngine';
import { atr } from '../quant/indicators';
import { findSwingPivots } from '../quant/marketStructure';
import {
  writeTrade_Open,
  writeTrade_Close,
  writeStats_Update,
  loadStats,
  loadOpenTrades,
  loadTodayTrades,
} from '../services/botTradeService';
import { initVirtualBalance, updateVirtualBalance } from '../services/virtualBalanceService';
import { auth } from '../services/firebase';
import {
  OHLCV, ScalpingPlan, ScalpConfig, RiskState, TradeOutcome
} from '../types';

export type BotPhase =
  | 'IDLE'             // bot not started
  | 'SCANNING'         // running, no signal yet
  | 'SIGNAL_FORMING'   // stability filter 1/3 or 2/3
  | 'ARMED'            // all gates passed, plan ready, watching for price confirmation
  | 'IN_TRADE'         // position watcher active, SL/TP live
  | 'COOLDOWN'         // after trade close, risk guard cooldown active
  | 'HALTED';          // daily cap hit / API dead / market closed

export interface BotTradeRecord {
  id:               string;           // Date.now().toString()
  symbol:           string;
  entryPrice:       number;
  exitPrice:        number | null;    // null while open
  outcome:          TradeOutcome | null;
  realizedPnL:      number | null;    // ₹ after broker charges
  realizedPnLPct:   number | null;    // % of capital risked
  rMultiple:        number | null;    // realizedPnL / riskAmount
  openedAt:         number;           // Date.now()
  closedAt:         number | null;
  durationMinutes:  number | null;
  plan:             ScalpingPlan;
}

export interface BotSessionStats {
  totalTrades:    number;
  totalWins:      number;
  totalLosses:    number;
  winRate:        number;             // 0–1
  totalPnL:       number;             // ₹ cumulative this session
  avgRMultiple:   number;
  bestTrade:      number;             // highest realizedPnL ₹
  worstTrade:     number;             // lowest realizedPnL ₹
  currentStreak:  number;             // positive = wins, negative = losses
}

export interface UseBotLoopResult {
  // State
  symbol:             string | null;
  phase:              BotPhase;
  currentPrice:       number | null;
  ohlcvBuffer:        OHLCV[];
  activePlan:         ScalpingPlan | null;
  activeTrade:        BotTradeRecord | null;
  activePlans:        ScalpingPlan[];
  activeTrades:       BotTradeRecord[];
  virtualBalance:     number;
  tradeHistory:       BotTradeRecord[];
  sessionStats:       BotSessionStats;
  stabilityCount:     number;         // 0 | 1 | 2 | 3
  lastSignal:         string | null;  // 'LONG' | 'NO_TRADE'
  lastConfidence:     number;         // 0–100
  lastBlockReason:    string | null;  // why last signal was blocked
  marketOpen:         boolean;
  feedError:          string | null;
  isStale:            boolean;
  candleCount:        number;
  lastChartUrl:      string | null;    // base64 PNG of last analyzed chart
  lastAnalyzedAt:    number | null;    // timestamp of last analysis
  isAnalyzing:       boolean;          // true while runSingleAnalysis is running
  cooldownRemainsMs: number | null;    // ms until cooldown ends, null if not cooling
  techniqueCount:    number;           // how many techniques are active
  lastAnalysisResult: any | null;

  // Actions
  startBot:   () => void;
  stopBot:    () => void;
  pauseBot:   () => void;
  forceExit:  () => void;             // manual exit current trade

  // Position watcher live data — null when not in trade
  trailSL:          number;
  tp1Hit:           boolean;
  unrealizedPnL:    number | null;
  unrealizedPnLPct: number | null;
  timeRemainingMs:  number | null;
}

function updateStats(prev: BotSessionStats, trade: BotTradeRecord): BotSessionStats {
  const isWin     = (trade.realizedPnL ?? 0) > 0;
  const pnl       = trade.realizedPnL ?? 0;
  const rMult     = trade.rMultiple   ?? 0;
  const total     = prev.totalTrades + 1;
  const wins      = prev.totalWins  + (isWin ? 1 : 0);
  const losses    = prev.totalLosses + (isWin ? 0 : 1);
  const streak    = isWin
    ? (prev.currentStreak >= 0 ? prev.currentStreak + 1 : 1)
    : (prev.currentStreak <= 0 ? prev.currentStreak - 1 : -1);

  return {
    totalTrades:   total,
    totalWins:     wins,
    totalLosses:   losses,
    winRate:       wins / total,
    totalPnL:      prev.totalPnL + pnl,
    avgRMultiple:  (prev.avgRMultiple * prev.totalTrades + rMult) / total,
    bestTrade:     Math.max(prev.bestTrade, pnl),
    worstTrade:    Math.min(prev.worstTrade, pnl),
    currentStreak: streak,
  };
}

function emptyStats(): BotSessionStats {
  return {
    totalTrades: 0, totalWins: 0, totalLosses: 0,
    winRate: 0, totalPnL: 0, avgRMultiple: 0,
    bestTrade: 0, worstTrade: 0, currentStreak: 0,
  };
}

function isPreClose(nowMs: number): boolean {
  const ist     = new Date(nowMs + 5.5 * 60 * 60 * 1000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  // 3:15 PM IST = 915 minutes. Block new entries from 915 onward.
  return minutes >= 915;
}

export function useBotLoop(
  symbol:            string | null,
  timeframeMinutes:  number,
  capital:           number,           // ₹ total capital for position sizing
  minConfidence:     number,           // 0–100, user-set threshold
  config:            ScalpConfig,
  techniquesList:    any[],            // ← ADD: from BotStartPayload, empty if no file
): UseBotLoopResult {
  // State (drives UI re-renders)
  const [phase,           setPhase]           = useState<BotPhase>('IDLE');
  const [activePlans,     setActivePlans]     = useState<ScalpingPlan[]>([]);
  const [activeTrades,    setActiveTrades]    = useState<BotTradeRecord[]>([]);
  const [virtualBalance,  setVirtualBalance]  = useState(100000);
  const [tradeHistory,    setTradeHistory]    = useState<BotTradeRecord[]>([]);
  const [sessionStats,    setSessionStats]    = useState<BotSessionStats>(emptyStats());
  const [stabilityCount,  setStabilityCount]  = useState(0);
  const [lastSignal,      setLastSignal]      = useState<string | null>(null);
  const [lastConfidence,  setLastConfidence]  = useState(0);
  const [lastBlockReason, setLastBlockReason] = useState<string | null>(null);
  const [lastChartUrl,     setLastChartUrl]     = useState<string | null>(null);
  const [lastAnalyzedAt,   setLastAnalyzedAt]   = useState<number | null>(null);
  const [isAnalyzing,      setIsAnalyzing]      = useState(false);
  const [cooldownRemainsMs,setCooldownRemainsMs] = useState<number | null>(null);
  const [botActive,        setBotActive]        = useState(false);
  const [lastAnalysisResult, setLastAnalysisResult] = useState<any | null>(null);

  const { requestLock, releaseLock } = useWakeLock();

  // Refs (do not trigger re-renders)
  const botEnabledRef     = useRef(false);    // true when bot is running
  const analyzingRef      = useRef(false);    // true while runSingleAnalysis is in progress
  const lastCandleCountRef = useRef(0);       // detect new candle arrival
  const abortRef          = useRef<AbortController | null>(null);
  const stabilityRef      = useRef(0);        // mirrors stabilityCount for use inside callbacks
  const riskStateRef      = useRef<RiskState>(loadRiskState());
  const analysisErrorCount = useRef(0);
  const ANALYSIS_CIRCUIT_LIMIT = 3;
  const noTechWarnedRef   = useRef(false);
  const initialAnalysisFiredRef = useRef(false);

  const lastValidPriceRef = useRef<number | null>(null);
  const SPIKE_THRESHOLD   = 0.05; // 5% single-tick change = anomalous

  const [userId, setUserId] = useState<string | null>(auth.currentUser?.uid ?? null);
  const uidRef = useRef<string | null>(auth.currentUser?.uid ?? null);

  // Release wake lock on unmount
  useEffect(() => {
    return () => {
      releaseLock();
    };
  }, [releaseLock]);

  // Keep uid in sync with Firebase Auth state
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      setUserId(user?.uid ?? null);
      uidRef.current = user?.uid ?? null;
    });
    return () => unsub();
  }, []);

  const feed = useStockFeed(
    symbol,
    timeframeMinutes,
    botActive && phase !== 'IDLE'
  );

  const activeTradesRef = useRef<BotTradeRecord[]>([]);
  useEffect(() => {
    activeTradesRef.current = activeTrades;
  }, [activeTrades]);

  const closeTradeById = useCallback(async (
    tradeId:   string,
    exitPrice: number,
    outcome:   TradeOutcome
  ) => {
    const trade = activeTradesRef.current.find(t => t.id === tradeId);
    if (!trade) return;

    // 1. Mark trade as closed in React local state immediately
    const tempClosedTrade = {
      ...trade,
      exitPrice,
      outcome,
    };

    // 2. Compute finalized stats in Firebase (handles broker charges & capital calc)
    let finalized = { realizedPnL: 0, realizedPnLPct: 0, rMultiple: 0, brokerCharges: 0 };
    if (uidRef.current) {
      try {
        finalized = await writeTrade_Close(uidRef.current, tempClosedTrade, exitPrice, capital);
        await updateVirtualBalance(uidRef.current, finalized.realizedPnL);
      } catch (err) {
        console.error('[BotLoop] writeTrade_Close fail, calculating locally...', err);
        // Fallback local calc
        const posSize      = trade.plan.positionSize ?? 1;
        const grossPnL     = (exitPrice - trade.entryPrice) * posSize;
        finalized.realizedPnL = grossPnL;
        finalized.realizedPnLPct = capital > 0 ? (grossPnL / capital) * 100 : 0;
        finalized.rMultiple = trade.plan.riskRupees > 0 ? grossPnL / trade.plan.riskRupees : 0;
      }
    } else {
      // Offline fallback
      const posSize      = trade.plan.positionSize ?? 1;
      const grossPnL     = (exitPrice - trade.entryPrice) * posSize;
      finalized.realizedPnL = grossPnL;
      finalized.realizedPnLPct = capital > 0 ? (grossPnL / capital) * 100 : 0;
      finalized.rMultiple = trade.plan.riskRupees > 0 ? grossPnL / trade.plan.riskRupees : 0;
    }

    setVirtualBalance(prev => parseFloat((prev + finalized.realizedPnL).toFixed(2)));

    const closed: BotTradeRecord = {
      ...trade,
      exitPrice,
      outcome,
      realizedPnL:     finalized.realizedPnL,
      realizedPnLPct:  finalized.realizedPnLPct,
      rMultiple:       finalized.rMultiple,
      closedAt:        Date.now(),
      durationMinutes: Math.round((Date.now() - trade.openedAt) / 60_000),
    };

    setTradeHistory(h => [closed, ...h]);

    // 3. Update session stats & write to Firestore
    setSessionStats(prev => {
      const next = updateStats(prev, closed);
      if (uidRef.current) {
        // Today's daily P&L (for tracking daily cap limits)
        const todayPnL = [closed, ...tradeHistory]
          .filter(t => {
            const tDate = new Date(t.openedAt + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const today = new Date(Date.now()  + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
            return tDate === today;
          })
          .reduce((sum, t) => sum + (t.realizedPnL ?? 0), 0);

        writeStats_Update(uidRef.current, next, todayPnL).catch(e =>
          console.error('[BotLoop] writeStats_Update fail:', e)
        );
      }
      return next;
    });

    // 4. Update risk guard state
    riskStateRef.current = loadRiskState();
    const nextRisk = onTradeClosed(riskStateRef.current, finalized.realizedPnL, config.risk);
    riskStateRef.current = nextRisk;
    saveRiskState(nextRisk);

    setActiveTrades(prev => {
      const filtered = prev.filter(t => t.id !== tradeId);
      if (filtered.length === 0) {
        setPhase('SCANNING');
      }
      return filtered;
    });

    setActivePlans(prev => {
      const idx = activeTradesRef.current.findIndex(t => t.id === tradeId);
      if (idx !== -1) {
        const nextPlans = [...prev];
        nextPlans.splice(idx, 1);
        return nextPlans;
      }
      return prev;
    });

  }, [capital, config, tradeHistory]);

  const startBot = useCallback(() => {
    if (!symbol) return;
    initialAnalysisFiredRef.current = false;
    botEnabledRef.current = true;
    setBotActive(true);
    stabilityRef.current  = 0;
    noTechWarnedRef.current = false;
    setStabilityCount(0);
    setLastBlockReason(null);
    setPhase('SCANNING');
    requestLock(); // prevent screen sleep during bot operation

    if (uidRef.current) {
      initVirtualBalance(uidRef.current).then(bal => setVirtualBalance(bal));
    }
  }, [symbol, requestLock]);

  const stopBot = useCallback(() => {
    botEnabledRef.current = false;
    setBotActive(false);
    abortRef.current?.abort();

    // Force-close all active trades at last known price before stopping
    if (feed.currentPrice) {
      activeTradesRef.current.forEach(t => {
        closeTradeById(t.id, feed.currentPrice!, 'MANUAL_EXIT');
      });
    }

    releaseLock();
    setPhase('IDLE');
    setActivePlans([]);
    setActiveTrades([]);
    stabilityRef.current = 0;
    setStabilityCount(0);
    analysisErrorCount.current = 0;
  }, [feed.currentPrice, closeTradeById, releaseLock]);

  const pauseBot = useCallback(() => {
    botEnabledRef.current = false;
    setBotActive(false);
    if (activeTradesRef.current.length === 0) setPhase('IDLE');
  }, []);

  const forceExit = useCallback(() => {
    if (activeTrades.length === 0 || !feed.currentPrice) return;
    activeTrades.forEach(t => {
      closeTradeById(t.id, feed.currentPrice!, 'MANUAL_EXIT');
    });
  }, [activeTrades, feed.currentPrice, closeTradeById]);

  const runAnalysisCycle = useCallback(async () => {
    if (!symbol) return;
    // Need at least 15 candles: 14 for ATR14 + 1 current
    if (feed.ohlcvBuffer.length < 15) {
      setLastBlockReason(`WARMUP: ${feed.ohlcvBuffer.length}/15 candles loaded. Waiting...`);
      return;
    }

    // Warn if no techniques — analysis still runs but J4 will score zero
    if (techniquesList.length === 0 && !noTechWarnedRef.current) {
      noTechWarnedRef.current = true;
      setLastBlockReason('NO_TECHNIQUES: Upload a technique file in Bot Setup for better signal quality. Continuing with J1/J2/J3 only.');
    }

    analyzingRef.current = true;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      // Step 1 — Render OHLCV buffer to chart image
      const dataUrl = ohlcvToDataUrl(feed.ohlcvBuffer);
      if (!dataUrl) {
        setLastBlockReason('RENDER_FAIL: chartRenderer returned null');
        return;
      }

      // Store chart image for live display
      setLastChartUrl(dataUrl);
      setLastAnalyzedAt(Date.now());
      setIsAnalyzing(true);

      // Step 2 — Run full analysis pipeline (vision → indicators → judges)
      const result = await runSingleAnalysis({
        imageDataUrl:     dataUrl,
        stock:            symbol,
        graphTimeframe:   `${timeframeMinutes}m`,
        holdingMinutes:   `${timeframeMinutes}m`,
        investmentAmount: String(capital),
        techniquesList,
        signal:           abortRef.current.signal,
      });

      if (!result) return;

      analysisErrorCount.current = 0; // reset circuit breaker on success

      const winner     = result.analysis?.judge?.winner ?? 'NO_TRADE';
      const confidence = result.analysis?.judge?.finalConfidence ?? result.confidence ?? 0;
      const direction: 'LONG' | 'NO_TRADE' = winner === 'BULL' ? 'LONG' : 'NO_TRADE';

      setLastSignal(direction);
      setLastConfidence(confidence);
      setLastAnalysisResult(result.analysis);

      // Step 3 — Stability filter (manual tracking since we own the loop)
      if (direction === 'LONG') {
        stabilityRef.current = Math.min(stabilityRef.current + 1, 3);
      } else {
        stabilityRef.current = 0; // reset on any non-LONG signal
      }
      setStabilityCount(stabilityRef.current);

      if (stabilityRef.current < 3) {
        setPhase('SIGNAL_FORMING');
        setLastBlockReason(`STABILITY: ${stabilityRef.current}/3 consecutive LONG signals`);
        return;
      }

      // Step 4 — Confidence gate
      if (config.useConfidenceThreshold !== false) {
        if (confidence < minConfidence) {
          stabilityRef.current = 0;
          setStabilityCount(0);
          setLastBlockReason(`CONFIDENCE: ${confidence.toFixed(1)}% < threshold ${minConfidence}%`);
          setPhase('SCANNING');
          return;
        }
      }

      // Step 5 — Risk guard gate
      riskStateRef.current = loadRiskState();
      const capCheck = checkRiskCaps(riskStateRef.current, config.risk);
      if (!capCheck.allow) {
        stabilityRef.current = 0;
        setStabilityCount(0);
        setLastBlockReason(`RISK_CAP: ${capCheck.reason}`);
        setPhase(capCheck.reason?.includes('cooldown') ? 'COOLDOWN' : 'HALTED');
        return;
      }

      // Step 6 — Market hours gate
      if (config.enableMarketHoursGate && !feed.marketOpen) {
        setLastBlockReason('MARKET_CLOSED: outside 09:15–15:30 IST');
        setPhase('SCANNING');
        return;
      }

      // Pre-close gate — no new entries in last 15 minutes of session
      if (config.enableMarketHoursGate && isPreClose(Date.now())) {
        setLastBlockReason('PRE_CLOSE: No new entries after 15:15 IST. Monitoring active trades only.');
        setPhase('SCANNING');
        return;
      }

      // Step 7 — All gates passed — build scalping plan
      const entryPrice = feed.currentPrice;
      if (!entryPrice) return;

      // Price spike detection — ignore ticks that jump >5% from last known good price
      if (lastValidPriceRef.current !== null) {
        const changePct = Math.abs(entryPrice - lastValidPriceRef.current) / lastValidPriceRef.current;
        if (changePct > SPIKE_THRESHOLD) {
          setLastBlockReason(
            `PRICE_SPIKE: ${(changePct * 100).toFixed(1)}% change in one tick ` +
            `(${lastValidPriceRef.current.toFixed(2)} → ${entryPrice.toFixed(2)}). Skipping.`
          );
          // Do not update lastValidPriceRef — keep the last known good price
          return;
        }
      }
      lastValidPriceRef.current = entryPrice;

      const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      const mm = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      const ohlc = feed.ohlcvBuffer.map((c, i) => ({
        open: c.open, high: c.high, low: c.low, close: c.close,
        xCenter: i, isBull: c.close >= c.open
      }));

      // Compute real ATR14 from OHLCV buffer
      const highs  = feed.ohlcvBuffer.map(c => c.high);
      const lows   = feed.ohlcvBuffer.map(c => c.low);
      const closes = feed.ohlcvBuffer.map(c => c.close);

      const atr14Arr   = atr(feed.ohlcvBuffer, 14);
      const pivotArr   = findSwingPivots(highs, lows, 2);

      // VWAP proxy — anchored
      const vwapArr = vwapProxy(feed.ohlcvBuffer, { mode: 'ANCHORED' });

      const lastAtr = atr14Arr[atr14Arr.length - 1];
      if (!lastAtr || lastAtr <= 0 || !isFinite(lastAtr)) {
        setLastBlockReason('ATR_INVALID: insufficient candle data for ATR14 (need 14+ candles)');
        return;
      }

      const ctx = {
        config,
        riskState:                  riskStateRef.current,
        pivots:                     pivotArr,
        atr14:                      atr14Arr,
        vwapProxy:                  vwapArr,
        nowMsEpoch:                 Date.now(),
        nowISTMinutesSinceMidnight: mm,
        currentBarIndex:            ohlc.length - 1,
      };

      const decision = evaluateScalpSignal(ohlc, { winner: result.analysis?.judge?.winner || 'NO_TRADE' }, ctx as any);
      const plan = decision.plan;
      if (!plan) {
        setLastBlockReason('PLAN_FAIL: evaluateScalpSignal returned no plan');
        stabilityRef.current = 0;
        setStabilityCount(0);
        setPhase('SCANNING');
        return;
      }

      // Sanity check — SL must be below entry, TP1 and TP2 must be above entry
      const planValid =
        plan.stopLoss   < plan.entry        &&
        plan.takeProfit1 > plan.entry       &&
        plan.takeProfit2 >= plan.takeProfit1 &&
        plan.rrRatio     >= (config.minRR ?? 1.5) &&
        plan.riskRupees  > 0                &&
        isFinite(plan.stopLoss)             &&
        isFinite(plan.takeProfit1)          &&
        isFinite(plan.takeProfit2);

      if (!planValid) {
        setLastBlockReason(
          `PLAN_INVALID: SL=${plan.stopLoss.toFixed(2)} ` +
          `Entry=${plan.entry.toFixed(2)} ` +
          `TP1=${plan.takeProfit1.toFixed(2)} ` +
          `TP2=${plan.takeProfit2.toFixed(2)} — geometry invalid, skipping.`
        );
        stabilityRef.current = 0;
        setStabilityCount(0);
        setPhase('SCANNING');
        return;
      }

      // CHANGE 7 — Insufficient balance gate
      const reqBal = config.investmentPerTrade ?? 10000;
      if (virtualBalance < reqBal) {
        setLastBlockReason(
          `INSUFFICIENT_BALANCE: ₹${virtualBalance.toFixed(0)} available, ` +
          `₹${reqBal} required per trade`
        );
        setPhase('HALTED');
        return;
      }

      // Step 8 — ARM the trade
      setPhase('ARMED');
      setLastBlockReason(null);
      stabilityRef.current = 0;
      setStabilityCount(0);

      // Step 9 — Open trade record
      const trade: BotTradeRecord = {
        id:              Date.now().toString(),
        symbol,
        entryPrice,
        exitPrice:       null,
        outcome:         null,
        realizedPnL:     null,
        realizedPnLPct:  null,
        rMultiple:       null,
        openedAt:        Date.now(),
        closedAt:        null,
        durationMinutes: null,
        plan,
      };
      
      setActiveTrades(prev => [...prev, trade]);
      setActivePlans(prev => [...prev, plan]);
      setPhase('IN_TRADE');

      // Write OPEN trade to Firestore
      if (uidRef.current) {
        writeTrade_Open(uidRef.current, trade).catch(err =>
          console.warn('[BotLoop] writeTrade_Open failed:', err)
        );
      }

    } catch (err: any) {
      if (err.name === 'AbortError') return;

      // Circuit breaker — halt analysis after 3 consecutive errors
      analysisErrorCount.current += 1;
      if (analysisErrorCount.current >= ANALYSIS_CIRCUIT_LIMIT) {
        setPhase('HALTED');
        setLastBlockReason(
          `CIRCUIT_BREAK: Analysis failed ${analysisErrorCount.current}× in a row. ` +
          `Last error: ${err.message}. Stop and restart bot.`
        );
        botEnabledRef.current = false;
      } else {
        setLastBlockReason(
          `ANALYSIS_ERROR (${analysisErrorCount.current}/${ANALYSIS_CIRCUIT_LIMIT}): ${err.message}`
        );
      }
    } finally {
      analyzingRef.current = false;
      setIsAnalyzing(false);
    }
  }, [symbol, timeframeMinutes, capital, minConfidence, config, feed, techniquesList, virtualBalance]);

  useEffect(() => {
    // Guard: only run if a new candle actually arrived
    if (feed.candleCount === lastCandleCountRef.current) return;
    lastCandleCountRef.current = feed.candleCount;

    // Guard: do not run if bot is off, already analyzing, or in trade
    if (!botEnabledRef.current) return;
    if (analyzingRef.current) return;
    if (activeTrades.length >= (config.maxConcurrentTrades ?? 1)) return;
    if (phase === 'IDLE') return;
    // Need at least 15 candles: 14 for ATR14 + 1 current
    if (feed.ohlcvBuffer.length < 15) {
      setLastBlockReason(`WARMUP: ${feed.ohlcvBuffer.length}/15 candles loaded. Waiting...`);
      return;
    }

    // Guard: stale data — do not analyze on frozen prices
    if (feed.isStale) {
      setLastBlockReason('STALE_DATA: price feed frozen, skipping analysis');
      return;
    }

    runAnalysisCycle();
  }, [feed.candleCount, feed.isStale, phase, activeTrades.length, config.maxConcurrentTrades, feed.ohlcvBuffer.length, runAnalysisCycle]);

  // Trigger analysis once immediately when the initial candle buffer first loads
  // (covers market-closed scenario where no new candles will ever close)
  useEffect(() => {
    if (!botEnabledRef.current) return;
    if (phase === 'IDLE') return;
    if (activeTrades.length >= (config.maxConcurrentTrades ?? 1)) return;
    if (analyzingRef.current) return;
    if (feed.ohlcvBuffer.length < 15) return;
    if (initialAnalysisFiredRef.current) return;

    // Fire once when buffer first reaches 15+ candles
    initialAnalysisFiredRef.current = true;
    runAnalysisCycle();
  }, [feed.ohlcvBuffer.length, phase, activeTrades.length, config.maxConcurrentTrades, runAnalysisCycle]);

  // Re-run analysis every 2 minutes even if no new candle closes (market-closed sim mode)
  useEffect(() => {
    if (phase === 'IDLE' || activeTrades.length >= (config.maxConcurrentTrades ?? 1) || phase === 'HALTED') return;
    if (feed.ohlcvBuffer.length < 15) return;

    const intervalId = setInterval(() => {
      if (!botEnabledRef.current) return;
      if (analyzingRef.current) return;
      if (activeTrades.length >= (config.maxConcurrentTrades ?? 1) || phase === 'IDLE') return;
      runAnalysisCycle();
    }, 2 * 60 * 1000); // every 2 minutes

    return () => clearInterval(intervalId);
  }, [phase, activeTrades.length, config.maxConcurrentTrades, feed.ohlcvBuffer.length, runAnalysisCycle]);

  useEffect(() => {
    if (activeTrades.length === 0 || !feed.currentPrice) return;
    const price = feed.currentPrice;

    activeTrades.forEach(trade => {
      if (!trade.plan) return;

      // SL check
      if (price <= trade.plan.stopLoss) {
        closeTradeById(trade.id, price, 'SL_HIT');
        return;
      }

      // TP check (TP1 and TP2 are equal per Change 2, so a single win exit is enforced)
      if (price >= trade.plan.takeProfit2) {
        closeTradeById(trade.id, price, 'TP2_HIT');
        return;
      }

      // Optional time expiration based check
      const elapsedMin = (Date.now() - trade.openedAt) / 60_000;
      const maxHold = trade.plan.maxHoldingMinutes ?? 15;
      if (elapsedMin >= maxHold) {
        closeTradeById(trade.id, price, 'TIME_EXPIRED');
        return;
      }
    });
  }, [feed.currentPrice, activeTrades, closeTradeById]);

  // Auto-halt if feed goes dead
  useEffect(() => {
    if (!botEnabledRef.current) return;
    if (feed.consecutiveFailures >= 3 && activeTrades.length === 0) {
      setPhase('HALTED');
      setLastBlockReason(`FEED_DEAD: ${feed.consecutiveFailures} consecutive API failures`);
    }
  }, [feed.consecutiveFailures, activeTrades.length]);

  // Auto-halt if market closes mid-session
  useEffect(() => {
    if (!botEnabledRef.current) return;
    if (config.enableMarketHoursGate && !feed.marketOpen && phase === 'SCANNING') {
      setPhase('HALTED');
      setLastBlockReason('MARKET_CLOSED');
    }
    if (feed.marketOpen && phase === 'HALTED' &&
        lastBlockReason === 'MARKET_CLOSED') {
      setPhase('SCANNING'); // auto-resume when market reopens
    }
  }, [feed.marketOpen, phase, lastBlockReason, config.enableMarketHoursGate]);

  // Cooldown countdown ticker
  useEffect(() => {
    if (phase !== 'COOLDOWN') {
      setCooldownRemainsMs(null);
      return;
    }
    const tick = () => {
      const state = loadRiskState();
      const remaining = state.cooldownUntil > 0
        ? Math.max(0, state.cooldownUntil - Date.now())
        : null;
      setCooldownRemainsMs(remaining);
      // Auto-exit cooldown when timer reaches zero
      if (remaining === 0) {
        setPhase('SCANNING');
        setCooldownRemainsMs(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const isIdle = phase === 'IDLE';

  // Session Recovery & Firebase Syncing
  useEffect(() => {
    if (!userId) {
      setSessionStats(emptyStats());
      setTradeHistory([]);
      setActivePlans([]);
      setActiveTrades([]);
      return;
    }
    const uid = userId;

    async function recoverSession() {
      try {
        const [stats, trades, openTrades] = await Promise.all([
          loadStats(uid),
          loadTodayTrades(uid),
          loadOpenTrades(uid)
        ]);

        if (stats)     setSessionStats(stats);
        if (trades)    setTradeHistory(trades);
        if (openTrades && openTrades.length > 0) {
          setActiveTrades(openTrades);
          setActivePlans(openTrades.map(t => t.plan));
          setPhase('IN_TRADE');
        }

        // Initialize virtual balance
        const bal = await initVirtualBalance(uid);
        setVirtualBalance(bal);
      } catch (err) {
        console.error('[BotLoop] Session recovery failed:', err);
      }
    }

    recoverSession();
  }, [isIdle, userId]); // runs when bot is toggled or user changes

  // Computed fields for backward compatibility and reactive UI elements
  const activePlan = activePlans[0] ?? null;
  const activeTrade = activeTrades[0] ?? null;

  const firstTrade = activeTrades[0];
  const unrealizedPnL = firstTrade && feed.currentPrice
    ? parseFloat(((feed.currentPrice - firstTrade.entryPrice) * firstTrade.plan.positionSize).toFixed(2))
    : null;
  const unrealizedPnLPct = firstTrade && unrealizedPnL
    ? parseFloat(((unrealizedPnL / (firstTrade.entryPrice * firstTrade.plan.positionSize)) * 100).toFixed(2))
    : null;
  const trailSL = firstTrade ? firstTrade.plan.stopLoss : 0;
  const tp1Hit = firstTrade ? false : false;
  const timeRemainingMs = firstTrade
    ? Math.max(0, (firstTrade.openedAt + (firstTrade.plan.maxHoldingMinutes ?? 15) * 60_000) - Date.now())
    : null;

  return {
    symbol,
    phase,
    currentPrice:    feed.currentPrice,
    ohlcvBuffer:     feed.ohlcvBuffer,
    activePlan,
    activeTrade,
    activePlans,
    activeTrades,
    virtualBalance,
    tradeHistory,
    sessionStats,
    stabilityCount,
    lastSignal,
    lastConfidence,
    lastBlockReason,
    marketOpen:      feed.marketOpen,
    feedError:       feed.error,
    isStale:         feed.isStale,
    candleCount:     feed.candleCount,
    startBot,
    stopBot,
    pauseBot,
    forceExit,

    // Position watcher live data — null when not in trade
    trailSL,
    tp1Hit,
    unrealizedPnL,
    unrealizedPnLPct,
    timeRemainingMs,
    lastChartUrl,
    lastAnalyzedAt,
    isAnalyzing,
    lastAnalysisResult,
    cooldownRemainsMs,
    techniqueCount:    techniquesList.length,
  };
}
