import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStockFeed }               from './useStockFeed';
import { useWakeLock }                from './useWakeLock';
import { ohlcvToDataUrl }             from '../utils/chartRenderer';
import { vwapProxy }                  from '../quant/vwapProxy';
import { runSingleAnalysis }          from '../utils/singleAnalysis';
import { evaluateScalpSignal, shouldMoveToBreakeven, computeBreakevenSL } from '../quant/scalpingEngine';
import * as import_riskGuard from '../quant/riskGuard';
import { checkRiskCaps, onTradeClosed, reconcileDailyPnL } from '../quant/riskGuard';
import { loadRiskState, saveRiskState } from '../quant/riskGuard';
import { loadScalpConfig } from '../config/scalpConfig';
import { atr } from '../quant/indicators';
import { findSwingPivots } from '../quant/marketStructure';
import { resetDecisionHistory, resetScalpHistory } from '../quant/neutralityGuard';
import {
  writeTrade_Open,
  writeTrade_Close,
  writeStats_Update,
  loadStats,
  loadOpenTrades,
  loadAllTrades,
} from '../services/botTradeService';
import { initVirtualBalance, setVirtualBalanceValue } from '../services/virtualBalanceService';
import { computeRoundTripCharges } from '../quant/brokerCharges';
import { auth } from '../services/firebase';
import { fetchLivePrice } from '../services/stockPriceFeed';
import {
  OHLCV, ScalpingPlan, ScalpConfig, RiskState, TradeOutcome, ScalpInstrument
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
  balanceSnapshot?: number;
  netPnL?:          number | null;
  chargesActual?:   number | null;
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
  ohlcQuality:        'REAL_PRICE' | 'NORMALIZED_FALLBACK';
  stabilityCount:     number;         // 0 | 1 | 2 | 3
  lastSignal:         string | null;  // 'LONG' | 'NO_TRADE'
  lastConfidence:     number;         // 0-100
  lastBlockReason:    string | null;
  lastBlockers:       string[];
  lastAntiHallucination: any;
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
  techniqueWarning:  string | null;

  // Actions
  startBot:   () => void;
  stopBot:    () => void;
  pauseBot:   () => void;
  forceExit:  (tradeId?: string) => void;             // manual exit trade
  manualBuy:  (isForced?: boolean) => Promise<void>;
  reEvaluate: () => Promise<void>;   // manual force re-analyze current candle

  // Position watcher live data — null when not in trade
  trailSL:          number;
  tp1Hit:           boolean;
  unrealizedPnL:    number | null;
  unrealizedPnLPct: number | null;
  timeRemainingMs:  number | null;
  riskWarnings?: string[];
  haltCode?: string;
  riskSummary?: any;
  activeConfig?: any;
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
  const [virtualBalance,  setVirtualBalance]  = useState<number>(() => {
    try {
      const stored = localStorage.getItem('user_virtual_balance');
      return stored ? parseFloat(stored) : 100000;
    } catch {
      return 100000;
    }
  });

  const virtualBalanceRef = useRef<number>(virtualBalance);
  const sessionStartBalanceRef = useRef<number | null>(null);

  useEffect(() => {
    if (sessionStartBalanceRef.current === null) {
      sessionStartBalanceRef.current = virtualBalance;
    }
  }, [virtualBalance]);
  const [ohlcQuality, setOhlcQuality] = useState<'REAL_PRICE' | 'NORMALIZED_FALLBACK'>('REAL_PRICE');
  const [tradeHistory,    setTradeHistory]    = useState<BotTradeRecord[]>([]);
  const [sessionStats,    setSessionStats]    = useState<BotSessionStats>(emptyStats());
  const [stabilityCount,  setStabilityCount]  = useState(0);
  const [lastSignal,      setLastSignal]      = useState<string | null>(null);
  const [lastConfidence,  setLastConfidence]  = useState(0);
  const [lastBlockReason, setLastBlockReason] = useState<string | null>(null);
  const [lastBlockers, setLastBlockers] = useState<string[]>([]);
  const [lastAntiHallucination, setLastAntiHallucination] = useState<any>(null);
  const [lastChartUrl,     setLastChartUrl]     = useState<string | null>(null);
  const [lastAnalyzedAt,   setLastAnalyzedAt]   = useState<number | null>(null);
  const [isAnalyzing,      setIsAnalyzing]      = useState(false);
  const [cooldownRemainsMs,setCooldownRemainsMs] = useState<number | null>(null);
  const [riskWarnings, setRiskWarnings] = useState<string[]>([]);
  const [haltCode, setHaltCode] = useState<string | undefined>(undefined);
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

  const lastAnalyzedCandleTimeRef = useRef<number | null>(null);
  const [isInTrade, setIsInTrade] = useState<boolean>(false);
  const isInTradeRef = useRef<boolean>(false);

  const [userId, setUserId] = useState<string | null>(auth.currentUser?.uid ?? null);
  const uidRef = useRef<string | null>(auth.currentUser?.uid ?? null);
  const hasHydratedRef = useRef<boolean>(false);

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

  // Automatically clear transient visual analysis, signal state, and bull/bear points when switching stocks
  useEffect(() => {
    setLastAnalysisResult(null);
    setLastSignal(null);
    setLastConfidence(0);
    setLastBlockReason(null);
    setLastBlockers([]);
    setLastAntiHallucination(null);
    setLastChartUrl(null);
    setLastAnalyzedAt(null);
    setIsAnalyzing(false);
    setStabilityCount(0);
    setOhlcQuality('REAL_PRICE');

    // Reset loop & initiation refs so analysis starts freshly on symbol change
    lastAnalyzedCandleTimeRef.current = null;
    lastValidPriceRef.current = null;
    lastCandleCountRef.current = 0;
    initialAnalysisFiredRef.current = false;
    noTechWarnedRef.current = false;
    stabilityRef.current = 0;
    analysisErrorCount.current = 0;
  }, [symbol]);

  const activeConfig = useMemo(() => {
    const baseBalance = sessionStartBalanceRef.current ?? virtualBalanceRef.current;
    return {
      ...config,
      capitalRupees: virtualBalance,
      risk: {
        ...config.risk,
        dailyLossCapRupees: baseBalance * (config.riskPerTradePct * 0.01 || 0.01),
      }
    };
  }, [config, virtualBalance]);

  const activeTradesRef = useRef<BotTradeRecord[]>([]);
  useEffect(() => {
    activeTradesRef.current = activeTrades;
    const active = activeTrades.some(t => t.symbol === symbol);
    isInTradeRef.current = active;
    setIsInTrade(active);
  }, [activeTrades, symbol]);

  const tradeHistoryRef = useRef<BotTradeRecord[]>([]);
  useEffect(() => {
    tradeHistoryRef.current = tradeHistory;
  }, [tradeHistory]);

  const closeTradeById = useCallback(async (
    tradeId:   string,
    exitPrice: number,
    outcome:   TradeOutcome
  ) => {
    const trade = activeTradesRef.current.find(t => t.id === tradeId);
    if (!trade) return;

    // 1. Calculate trade results locally and immediately (no network block)
    const posSize       = trade.plan.positionSize ?? 1;
    const instrument    = (trade.plan.instrument ?? 'EQUITY_INTRADAY') as ScalpInstrument;
    const actualCharges = computeRoundTripCharges(trade.entryPrice, exitPrice, posSize, instrument).total;
    const grossPnL      = (exitPrice - trade.entryPrice) * posSize;
    const realizedPnL   = parseFloat(grossPnL.toFixed(2)); // gross realized PnL
    const netPnL        = parseFloat((grossPnL - actualCharges).toFixed(2)); // net PnL after actual broker charges
    const chargesActual = parseFloat(actualCharges.toFixed(2)); // actual round-trip charges computed at close
    const invested      = trade.plan.investmentRupees ?? (posSize * trade.entryPrice);
    const realizedPnLPct = invested > 0 ? (netPnL / invested) * 100 : 0;
    const rMultiple     = trade.plan.riskRupees > 0 ? netPnL / trade.plan.riskRupees : 0;

    const closed: BotTradeRecord = {
      ...trade,
      exitPrice,
      outcome,
      realizedPnL, // gross realized PnL
      netPnL, // net PnL after broker charges (FIX 10)
      chargesActual, // actual charges computed at close (FIX 10)
      realizedPnLPct,
      rMultiple,
      closedAt:        Date.now(),
      durationMinutes: Math.round((Date.now() - trade.openedAt) / 60_000),
    };

    // creditBack = what we return to the balance: invested + net PnL (FIX 1)
    const creditBack = parseFloat((invested + netPnL).toFixed(2));

    // Optimistic local update — do this immediately (synchronous)
    const newBalance = parseFloat((virtualBalanceRef.current + creditBack).toFixed(2));
    setVirtualBalance(newBalance);
    virtualBalanceRef.current = newBalance; // inline alignment (FIX 8)
    setTradeHistory(h => [closed, ...h]);

    // Atom 8 Fix — Extract filter logic outside updater, sync plans sequentially
    const nextTrades = activeTradesRef.current.filter(t => t.id !== tradeId);
    const nextPlans = nextTrades.map(t => t.plan).filter(p => !!p) as ScalpingPlan[];
    
    setActiveTrades(nextTrades);
    setActivePlans(nextPlans);

    const activeSymbolTrades = nextTrades.filter(t => t.symbol === symbol);
    if (activeSymbolTrades.length === 0 && trade.symbol === symbol) {
      setPhase('COOLDOWN');
    }

    // 3. Update session stats locally first (and write stats async)
    setSessionStats(prev => {
      const next = updateStats(prev, closed);
      if (uidRef.current) {
        const todayPnL = [closed, ...tradeHistoryRef.current]
          .filter(t => {
            const effTime = t.closedAt ?? t.openedAt;
            const tDate = new Date(effTime + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const today = new Date(Date.now()  + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
            return tDate === today;
          })
          .reduce((sum, t) => sum + (t.netPnL ?? t.realizedPnL ?? 0), 0);

         writeStats_Update(uidRef.current, next, todayPnL).catch(e =>
          console.error('[BotLoop] writeStats_Update fail:', e)
        );
      }
      return next;
    });

    // 4. Update risk guard state
    const nextRisk = onTradeClosed(riskStateRef.current, netPnL, activeConfig.risk, Date.now(), virtualBalanceRef.current, symbol || undefined);
    riskStateRef.current = nextRisk;

    // 5. Save trade details & synch balance to Firestore in the background — use ABSOLUTE balance write, NOT delta
    if (uidRef.current) {
      writeTrade_Close(uidRef.current, closed, exitPrice, invested, netPnL, chargesActual)
        .then(async () => {
          // Write ABSOLUTE balance from captured synchronous state
          await setVirtualBalanceValue(uidRef.current!, newBalance);
          // DO NOT call setVirtualBalance here again — local state is already correct
        })
        .catch(err => {
          console.error('[BotLoop] Background writeTrade_Close fail:', err);
        });
    }

  }, [activeConfig, symbol]);

  const startBot = useCallback(() => {
    if (!symbol) return;
    sessionStartBalanceRef.current = virtualBalanceRef.current;
    resetDecisionHistory();
    resetScalpHistory();
    initialAnalysisFiredRef.current = false;
    botEnabledRef.current = true;
    setBotActive(true);
    stabilityRef.current  = 0;
    noTechWarnedRef.current = false;
    setStabilityCount(0);
    setLastBlockReason(null);
    setPhase(activeTradesRef.current.some(t => t.symbol === symbol) ? 'IN_TRADE' : 'SCANNING');
    requestLock(); // prevent screen sleep during bot operation
  }, [symbol, requestLock]);

  const stopBot = useCallback(() => {
    botEnabledRef.current = false;
    setBotActive(false);
    abortRef.current?.abort();

    releaseLock();
    setPhase('IDLE');
    stabilityRef.current = 0;
    setStabilityCount(0);
    analysisErrorCount.current = 0;
  }, [releaseLock]);

  const pauseBot = useCallback(() => {
    botEnabledRef.current = false;
    setBotActive(false);
    const hasActiveSymbolTrade = activeTradesRef.current.some(t => t.symbol === symbol);
    if (!hasActiveSymbolTrade) setPhase('IDLE');
  }, [symbol]);

  const forceExit = useCallback(async (tradeId?: string) => {
    const trades = activeTradesRef.current;
    if (trades.length === 0) return;

    if (tradeId && typeof tradeId === 'string') {
      const trade = trades.find(t => t.id === tradeId);
      if (!trade) return;
      let price = feed.currentPrice;
      if (trade.symbol !== symbol) {
        try {
          const res = await fetchLivePrice(trade.symbol);
          price = res.price;
        } catch {
          price = trade.entryPrice; // reasonable backup
        }
      }
      if (price) {
        await closeTradeById(trade.id, price, 'MANUAL_EXIT');
      }
    } else {
      const currentPrice = feed.currentPrice;
      if (!currentPrice) {
        console.warn('[BotLoop] cannot forceExit: no currentPrice for symbol', symbol);
        return;
      }
      const listToClose = trades.filter(t => t.symbol === symbol);
      for (const t of listToClose) {
        await closeTradeById(t.id, currentPrice, 'MANUAL_EXIT');
      }
    }
  }, [symbol, feed.currentPrice, closeTradeById]);

  const manualBuy = useCallback(async (isForcedInput?: boolean | any) => {
    const isForced = isForcedInput === true;
    if (!symbol || !feed.currentPrice) return;
    if (isInTradeRef.current) {
      setLastBlockReason('IN_TRADE: cannot perform manual buy while already in trade');
      return;
    }
    if (!isForced && activeTradesRef.current.length >= (activeConfig.maxConcurrentTrades ?? 1)) {
      setLastBlockReason('MAX_TRADES: reached maximum concurrent trades limit');
      return;
    }
    if (!isForced && virtualBalanceRef.current < (activeConfig.investmentPerTrade ?? 10000)) {
      setLastBlockReason(`INSUFFICIENT_BALANCE: ₹${virtualBalanceRef.current.toFixed(0)} available, ₹${(activeConfig.investmentPerTrade ?? 10000).toFixed(0)} required`);
      return;
    }
    if (feed.ohlcvBuffer.length < 15) {
      setLastBlockReason('WARMUP: need at least 15 candles to evaluate entry bounds');
      return;
    }

    const entryPrice = feed.currentPrice;
    const highs  = feed.ohlcvBuffer.map(c => c.high);
    const lows   = feed.ohlcvBuffer.map(c => c.low);
    const atr14Arr = atr(feed.ohlcvBuffer, 14);
    const pivotArr = findSwingPivots(highs, lows, 2);
    const vwapArr  = vwapProxy(feed.ohlcvBuffer, { mode: 'ANCHORED' });
    const ohlc = feed.ohlcvBuffer.map((c, i) => ({
      open: c.open, high: c.high, low: c.low, close: c.close,
      xCenter: i, isBull: c.close >= c.open
    }));

    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const mm = ist.getUTCHours() * 60 + ist.getUTCMinutes();

    const ctx = {
      config: activeConfig,
      riskState: riskStateRef.current,
      pivots: pivotArr,
      atr14: atr14Arr,
      vwapProxy: vwapArr,
      nowMsEpoch: Date.now(),
      nowISTMinutesSinceMidnight: mm,
      currentBarIndex: ohlc.length - 1,
      currentPrice: entryPrice,
    };

    const decision = evaluateScalpSignal(
      ohlc,
      { winner: 'BULL' },   // force BULL for manual buy
      ctx as any,
      isForced
    );

    const plan = decision.plan;
    if (!plan) {
      setLastBlockReason(`MANUAL_BUY_FAIL: ${decision.blockers?.join(', ') || 'No plan returned'}`);
      return;
    }

    const invested = plan.investmentRupees ?? (entryPrice * plan.positionSize);
    const estCharges = plan.brokerCharges ?? 0;
    const totalDeduct = parseFloat((invested + estCharges).toFixed(2));

    if (virtualBalanceRef.current < totalDeduct) {
      setLastBlockReason(`INSUFFICIENT_BALANCE: ₹${virtualBalanceRef.current.toFixed(0)} available, ` +
        `₹${totalDeduct.toFixed(0)} required (inclusive of brokerage ₹${estCharges.toFixed(0)})`
      );
      return;
    }

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
      balanceSnapshot: virtualBalanceRef.current,
    };

    setActiveTrades(prev => [...prev, trade]);
    setActivePlans(prev => [...prev, plan]);
    setPhase('IN_TRADE');

    const newBal = Math.max(0, parseFloat((virtualBalanceRef.current - totalDeduct).toFixed(2)));
    setVirtualBalance(newBal);
    virtualBalanceRef.current = newBal; // inline alignment (FIX 8)

    if (uidRef.current) {
      writeTrade_Open(uidRef.current, trade).catch(err => {
        console.warn('[BotLoop] manualBuy writeTrade_Open failed:', err);
        setLastBlockReason('Cloud Ledger Sync Offline (Paper Trading Active)');
      });
      setVirtualBalanceValue(uidRef.current, newBal).catch(err =>
        console.error('[BotLoop] Failed to decrease virtual balance on manual open:', err)
      );
    }
  }, [symbol, feed.currentPrice, feed.ohlcvBuffer, activeConfig]);

  const runAnalysisCycle = useCallback(async (isForced: boolean = false) => {
    if (!symbol) return;
    
    // Need at least 15 candles: 14 for ATR14 + 1 current
    if (feed.ohlcvBuffer.length < 15) {
      setLastBlockReason(`WARMUP: ${feed.ohlcvBuffer.length}/15 candles loaded. Waiting...`);
      return;
    }

    const newestCandle = feed.ohlcvBuffer[feed.ohlcvBuffer.length - 1];
    const newestCandleTime = newestCandle?.timestamp ?? null;
    if (!isForced && newestCandleTime !== null && newestCandleTime === lastAnalyzedCandleTimeRef.current) {
      setLastBlockReason('SKIP: Newest candle already analyzed, waiting for next candle close.');
      return;
    }

    // Warn if no techniques — analysis still runs but J4 will score zero
    if (techniquesList.length === 0 && !noTechWarnedRef.current) {
      noTechWarnedRef.current = true;
      setLastBlockReason('NO_TECHNIQUES: Upload a technique file in Bot Setup for better signal quality. Continuing with J1/J2/J3 only.');
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      analyzingRef.current = true;
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

      const directOhlcv: import('../vision/pipeline').NumericOHLC[] = feed.ohlcvBuffer.map((c, i) => ({
        open:    c.open,
        high:    c.high,
        low:     c.low,
        close:   c.close,
        xCenter: i,
        isBull:  c.close >= c.open
      }));

      // Step 2 — Run full analysis pipeline (vision → indicators → judges)
      const result = await runSingleAnalysis({
        imageDataUrl:     dataUrl,
        directOhlcv,
        stock:            symbol,
        graphTimeframe:   `${timeframeMinutes}m`,
        holdingMinutes:   `${timeframeMinutes}m`,
        investmentAmount: String(activeConfig.investmentPerTrade ?? 10000),
        techniquesList,
        signal:           abortRef.current.signal,
        minConfidence,
      });

      if (!result) return;
      
      if (result.ohlcQuality === 'NORMALIZED_FALLBACK') {
        setOhlcQuality('NORMALIZED_FALLBACK');
        setLastBlockReason('AXIS_FALLBACK: Price axis unreadable — analysis running on normalized prices. Results unreliable.');
      } else {
        setOhlcQuality('REAL_PRICE');
      }

      if (newestCandleTime !== null) {
        lastAnalyzedCandleTimeRef.current = newestCandleTime;
      }

      analysisErrorCount.current = 0; // reset circuit breaker on success

      const winner     = result.analysis?.judge?.winner ?? 'NO_TRADE';
      const confidence = result.analysis?.judge?.finalConfidence ?? result.confidence ?? 0;
      const direction: 'LONG' | 'NO_TRADE' = winner === 'BULL' ? 'LONG' : 'NO_TRADE';

      setLastSignal(direction);
      setLastConfidence(confidence);
      setLastAnalysisResult(result.analysis);

      // IN_TRADE Auto-Exit Check
      if (isInTradeRef.current) {
        if (winner === 'BEAR' && confidence >= minConfidence) {
          const tId = activeTradesRef.current[0]?.id;
          if (tId && feed.currentPrice) {
            await closeTradeById(tId, feed.currentPrice, 'BEAR_SIGNAL_EXIT');
            setLastBlockReason(`CLOSED: strong BEAR signal detected (${confidence.toFixed(1)}% confidence)`);
          }
        } else {
          setLastBlockReason('IN_TRADE: actively managing open scalp position (last candle analyzed)');
        }
        return; // Always return so we do not attempt to open a duplicate trade!
      }

      // Step 3 — Stability filter (REMOVED - enter immediately on first LONG signal)
      if (direction !== 'LONG') {
        stabilityRef.current = 0;
        setStabilityCount(0);
        setPhase('SCANNING');
        setLastBlockReason('NO_TRADE: bear/neutral signal — scanning for next setup');
        return;
      }

      stabilityRef.current = 1;
      setStabilityCount(1);

      // Step 4 — Confidence gate
      if (activeConfig.useConfidenceThreshold !== false) {
        if (confidence < minConfidence) {
          stabilityRef.current = 0;
          setStabilityCount(0);
          setLastBlockReason(`CONFIDENCE: ${confidence.toFixed(1)}% < threshold ${minConfidence}%`);
          setPhase('SCANNING');
          return;
        }
      }

      // Step 5 — Risk guard gate
      const capCheck = checkRiskCaps(riskStateRef.current, activeConfig.risk, Date.now(), virtualBalanceRef.current);
      if (!capCheck.allow) {
        stabilityRef.current = 0;
        setStabilityCount(0);
        setLastBlockReason(`RISK_CAP: ${capCheck.reason}`);
        setPhase(capCheck.code === 'COOLDOWN' ? 'COOLDOWN' : 'HALTED');
        setHaltCode(capCheck.code);
        return;
      }
      
      const warnings = import_riskGuard.checkRiskWarnings(riskStateRef.current, activeConfig.risk, virtualBalanceRef.current);
      setRiskWarnings(warnings.warning ? warnings.reasons : []);

      // Step 6 — Market hours gate
      if (activeConfig.enableMarketHoursGate && !feed.marketOpen) {
        setLastBlockReason('MARKET_CLOSED: outside 09:15–15:30 IST');
        setPhase('SCANNING');
        return;
      }

      // Pre-close gate — no new entries in last 15 minutes of session
      if (activeConfig.enableMarketHoursGate && isPreClose(Date.now())) {
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
        config:                     activeConfig,
        riskState:                  riskStateRef.current,
        pivots:                     pivotArr,
        atr14:                      atr14Arr,
        vwapProxy:                  vwapArr,
        nowMsEpoch:                 Date.now(),
        nowISTMinutesSinceMidnight: mm,
        currentBarIndex:            ohlc.length - 1,
        currentPrice:               entryPrice,
        indicatorCache:             result.analysis?.techCache,
      };

      const isAiConfident = result.analysis?.judge?.winner === 'BULL';
      const decision = evaluateScalpSignal(ohlc, { winner: result.analysis?.judge?.winner || 'NO_TRADE' }, ctx as any, isAiConfident, capCheck);
      setLastBlockers(decision.blockers || []);
      setLastAntiHallucination(decision.plan?.antiHallucination || null);
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
         plan.rrRatio     >= (activeConfig.minRR ?? 1.5) &&
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
      const invested = plan.investmentRupees ?? (entryPrice * plan.positionSize);
      const estCharges = plan.brokerCharges ?? 0;
      const totalDeduct = parseFloat((invested + estCharges).toFixed(2));

      if (virtualBalanceRef.current < totalDeduct) {
        setLastBlockReason(
          `INSUFFICIENT_BALANCE: ₹${virtualBalanceRef.current.toFixed(0)} available, ` +
          `₹${totalDeduct.toFixed(0)} required (inclusive of brokerage ₹${estCharges.toFixed(0)})`
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
        balanceSnapshot: virtualBalanceRef.current,
      };
      
      setActiveTrades(prev => [...prev, trade]);
      setActivePlans(prev => [...prev, plan]);
      setPhase('IN_TRADE');

      const newBal = Math.max(0, parseFloat((virtualBalanceRef.current - totalDeduct).toFixed(2)));
      setVirtualBalance(newBal);
      virtualBalanceRef.current = newBal; // inline alignment (FIX 8)

      // Write OPEN trade to Firestore
      if (uidRef.current) {
        writeTrade_Open(uidRef.current, trade).catch(err => {
          console.warn('[BotLoop] writeTrade_Open failed:', err);
          setLastBlockReason('Cloud Ledger Sync Offline (Paper Trading Active)');
        });
        setVirtualBalanceValue(uidRef.current, newBal).catch(err =>
          console.error('[BotLoop] Failed to decrease virtual balance on auto open:', err)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframeMinutes, minConfidence, activeConfig, feed, techniquesList, virtualBalance]);

  const reEvaluate = useCallback(async () => {
    lastAnalyzedCandleTimeRef.current = null;
    setLastBlockReason('RE-EVALUATING: Forcing fresh scan of current market price and patterns...');
    await runAnalysisCycle(true);
  }, [runAnalysisCycle]);

  useEffect(() => {
    // Guard: only run if a new candle actually arrived
    if (feed.candleCount === lastCandleCountRef.current) return;
    lastCandleCountRef.current = feed.candleCount;

    // Guard: do not run if bot is off, already analyzing, or in trade
    if (!botEnabledRef.current) return;
    if (analyzingRef.current) return;
    const activeSymbolTradesCount = activeTrades.filter(t => t.symbol === symbol).length;
    if (activeSymbolTradesCount >= (activeConfig.maxConcurrentTrades ?? 1)) return;
    if (phase === 'IDLE') return;
    // Need at least 15 candles: 14 for ATR14 + 1 current
    if (feed.ohlcvBuffer.length < 15) {
      setLastBlockReason(`WARMUP: ${feed.ohlcvBuffer.length}/15 candles loaded. Waiting...`);
      return;
    }

    // Guard: stale data — do not analyze on frozen prices (removed to prevent cached proxy values or flat prices from locking up scanner)

    runAnalysisCycle();
  }, [feed.candleCount, feed.isStale, phase, activeTrades, symbol, activeConfig.maxConcurrentTrades, feed.ohlcvBuffer.length, runAnalysisCycle]);

  // Trigger analysis once immediately when the initial candle buffer first loads
  // (covers market-closed scenario where no new candles will ever close)
  useEffect(() => {
    if (!botEnabledRef.current) return;
    if (phase === 'IDLE') return;
    const activeSymbolTradesCount = activeTrades.filter(t => t.symbol === symbol).length;
    if (activeSymbolTradesCount >= (activeConfig.maxConcurrentTrades ?? 1)) return;
    if (analyzingRef.current) return;
    if (feed.ohlcvBuffer.length < 15) return;
    if (initialAnalysisFiredRef.current) return;

    // Fire once when buffer first reaches 15+ candles
    initialAnalysisFiredRef.current = true;
    runAnalysisCycle();
  }, [feed.ohlcvBuffer.length, phase, activeTrades, symbol, activeConfig.maxConcurrentTrades, runAnalysisCycle]);

  // Re-run analysis every 30 seconds even if no new candle closes (market-closed sim mode)
  useEffect(() => {
    const activeSymbolTradesCount = activeTrades.filter(t => t.symbol === symbol).length;
    if (phase === 'IDLE' || activeSymbolTradesCount >= (activeConfig.maxConcurrentTrades ?? 1) || phase === 'HALTED') return;
    if (feed.ohlcvBuffer.length < 15) return;

    const intervalId = setInterval(() => {
      if (!botEnabledRef.current) return;
      if (analyzingRef.current) return;
      const currentActiveSymbolTradesCount = activeTradesRef.current.filter(t => t.symbol === symbol).length;
      if (currentActiveSymbolTradesCount >= (activeConfig.maxConcurrentTrades ?? 1) || phase === 'IDLE') return;
      runAnalysisCycle();
    }, 30 * 1000); // every 30 seconds

    return () => clearInterval(intervalId);
  }, [phase, activeTrades, symbol, activeConfig.maxConcurrentTrades, feed.ohlcvBuffer.length, runAnalysisCycle]);

  const closeTradeByIdRef = useRef(closeTradeById);
  useEffect(() => {
    closeTradeByIdRef.current = closeTradeById;
  }, [closeTradeById]);

  useEffect(() => {
    if (!feed.currentPrice) return;
    const price = feed.currentPrice;
    const trades = activeTradesRef.current;
    if (trades.length === 0) return;

    trades.forEach(trade => {
      if (!trade.plan) return;
      if (trade.symbol !== symbol) return;

      // ── Spike guard for SL/TP watcher ──────────────────────────────────────
      // Reject price if it's more than 10% from entry — proxies can return bad ticks
      if (trade.entryPrice > 0) {
        const pctFromEntry = Math.abs(price - trade.entryPrice) / trade.entryPrice;
        if (pctFromEntry > 0.10) {
          console.warn(
            `[BotLoop] SL/TP SPIKE GUARD: price ${price} is ${(pctFromEntry * 100).toFixed(1)}% ` +
            `from entry ${trade.entryPrice} — ignoring tick to prevent phantom exit.`
          );
          return; // skip this trade's SL/TP check for this tick
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      // SL check
      if (price <= trade.plan.stopLoss) {
        closeTradeByIdRef.current(trade.id, price, 'SL_HIT');
        return;
      }

      // Breakeven check
      if (shouldMoveToBreakeven(trade.plan, price)) {
        // Need to update SL in state/DB. For now, since mutate is hard, we adjust local ref visually if needed
        // But wait, the standard way is update loop
        trade.plan.stopLoss = computeBreakevenSL(trade.plan, activeConfig.risk.slippageTicks || 1, 0.05);
      }

      // TP check
      if (price >= trade.plan.takeProfit2) {
        closeTradeByIdRef.current(trade.id, price, 'TP2_HIT');
        return;
      }

      // Optional time expiration based check
      const elapsedMin = (Date.now() - trade.openedAt) / 60_000;
      const maxHold = trade.plan.maxHoldingMinutes ?? 15;
      if (elapsedMin >= maxHold) {
        closeTradeByIdRef.current(trade.id, price, 'TIME_EXIT');
        return;
      }

      // Auto-close 15 minutes before market close (15:15 IST)
      const istTime = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      const istHours = istTime.getUTCHours();
      const istMinutes = istTime.getUTCMinutes();
      if (istHours > 15 || (istHours === 15 && istMinutes >= 15)) {
        closeTradeByIdRef.current(trade.id, price, 'TIME_EXIT');
        return;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.currentPrice, symbol]);

  // Auto-halt if feed goes dead
  useEffect(() => {
    if (!botEnabledRef.current) return;
    const hasActiveSymbolTrade = activeTrades.some(t => t.symbol === symbol);
    if (feed.consecutiveFailures >= 3 && !hasActiveSymbolTrade) {
      setPhase('HALTED');
      setLastBlockReason(`FEED_DEAD: ${feed.consecutiveFailures} consecutive API failures`);
    }
  }, [feed.consecutiveFailures, activeTrades, symbol]);

  // Cooldown countdown ticker
  useEffect(() => {
    if (phase !== 'COOLDOWN') {
      setCooldownRemainsMs(null);
      return;
    }
    const tick = () => {
      const remaining = riskStateRef.current.cooldownUntil > 0
        ? Math.max(0, riskStateRef.current.cooldownUntil - Date.now())
        : null;
      setCooldownRemainsMs(remaining);
      
      if (remaining === 0) {
        setCooldownRemainsMs(null);
        const postCooldownCheck = checkRiskCaps(riskStateRef.current, activeConfig.risk, Date.now(), virtualBalanceRef.current);
        if (postCooldownCheck.allow) {
          setPhase('SCANNING');
        } else if (postCooldownCheck.code !== 'COOLDOWN') {
          setPhase('HALTED');
          setHaltCode(postCooldownCheck.code);
          setLastBlockReason(postCooldownCheck.reason ?? 'RISK_CAP_ACTIVE');
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const isIdle = phase === 'IDLE';

  // Session Recovery & Firebase Syncing
  const syncFromCloud = useCallback(async () => {
    if (!userId) return;
    try {
      const [stats, trades, openTrades] = await Promise.all([
        loadStats(userId),
        loadAllTrades(userId),
        loadOpenTrades(userId)
      ]);

      if (stats) setSessionStats(stats);
      if (trades) {
        setTradeHistory(trades);
        const todayTrades = trades.filter(t => {
          const effTime = t.closedAt ?? t.openedAt;
          const tDate = new Date(effTime + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const today = new Date(Date.now()  + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
          return tDate === today && t.realizedPnL !== null;
        });
        const reconciledDailyPnL = reconcileDailyPnL(todayTrades.map(t => ({ pnl: t.realizedPnL! + (t.plan.brokerCharges ?? 0), brokerCharges: t.plan.brokerCharges ?? 0 })));
        if (Math.abs(reconciledDailyPnL - riskStateRef.current.dailyPnL) > 10) {
          console.log(`[BotLoop] Reconciled daily PnL: ${riskStateRef.current.dailyPnL} -> ${reconciledDailyPnL}`);
          riskStateRef.current.dailyPnL = reconciledDailyPnL;
          import_riskGuard.saveRiskState(riskStateRef.current);
        }
      }
      
      const isBotActiveCurrently = botEnabledRef.current || botActive;
      if (openTrades && openTrades.length > 0) {
        setActiveTrades(openTrades);
        setActivePlans(openTrades.map(t => t.plan));
        const hasSymbolActive = openTrades.some(t => t.symbol === symbol);
        setPhase(hasSymbolActive ? 'IN_TRADE' : (isBotActiveCurrently ? 'SCANNING' : 'IDLE'));
        if (isBotActiveCurrently) {
          setBotActive(true);
          botEnabledRef.current = true;
        }
      } else {
        setActiveTrades([]);
        setActivePlans([]);
        setPhase(isBotActiveCurrently ? 'SCANNING' : 'IDLE');
      }

      const bal = await initVirtualBalance(userId);
      setVirtualBalance(bal);
      virtualBalanceRef.current = bal; // inline alignment (FIX 8)
      hasHydratedRef.current = true;
    } catch (err: any) {
      console.error('[BotLoop] syncFromCloud failed:', err);
      let fallbackBal = 100000;
      try {
        const stored = localStorage.getItem('user_virtual_balance');
        if (stored) {
          const parsed = parseFloat(stored);
          if (!isNaN(parsed)) {
            fallbackBal = parsed;
          }
        }
      } catch (e) {
        console.warn('[Sync] Local storage fallback failed:', e);
      }
      setVirtualBalance(fallbackBal);
      virtualBalanceRef.current = fallbackBal; // inline alignment (FIX 8)
      console.error(`[Sync] Failed to fetch balance from cloud, fallback to local cache: ${fallbackBal}`);
    }
  }, [userId, symbol, botActive]);

  useEffect(() => {
    if (!userId) {
      setSessionStats(emptyStats());
      setTradeHistory([]);
      setActivePlans([]);
      setActiveTrades([]);
      hasHydratedRef.current = false;
      return;
    }

    if (!hasHydratedRef.current) {
      syncFromCloud();
    }
  }, [userId, syncFromCloud]);

  useEffect(() => {
    const handleClearStats = () => {
      setSessionStats(emptyStats());
      setTradeHistory([]);
      setActiveTrades([]);
      setActivePlans([]);
      setVirtualBalance(100000);
      virtualBalanceRef.current = 100000; // inline alignment (FIX 8)
    };
    window.addEventListener('determinist:clearstats', handleClearStats);
    return () => {
      window.removeEventListener('determinist:clearstats', handleClearStats);
    };
  }, []);

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
    ohlcQuality,
    stabilityCount,
    lastSignal,
    lastConfidence,
    lastBlockReason,
    lastBlockers,
    lastAntiHallucination,
    marketOpen:      feed.marketOpen,
    feedError:       feed.error,
    isStale:         feed.isStale,
    candleCount:     feed.candleCount,
    startBot,
    stopBot,
    pauseBot,
    forceExit,
    manualBuy,
    reEvaluate,
    syncFromCloud,

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
    techniqueWarning: lastAnalysisResult?.deadTechniques?.length > 0 
      ? `⚠ ${lastAnalysisResult.deadTechniques.length} technique(s) have no conditions and are inactive: ${lastAnalysisResult.deadTechniques.join(', ')}`
      : null,
    cooldownRemainsMs,
    techniquesList,
    techniqueCount:    techniquesList.length,
    riskWarnings,
    haltCode,
    activeConfig,
    riskSummary: {
      dailyPnL: riskStateRef.current.dailyPnL,
      tradesToday: riskStateRef.current.tradesToday,
      consecutiveLosses: riskStateRef.current.consecutiveLosses,
      maxTradesPerDay: activeConfig.risk.maxTradesPerDay,
      dailyLossCapRupees: activeConfig.risk.dailyLossCapRupees,
      maxConsecutiveLosses: activeConfig.risk.maxConsecutiveLosses
    }
  };
}
