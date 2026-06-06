import { useState, useEffect, useRef, useCallback } from 'react';
import { useStockFeed }               from './useStockFeed';
import { useScalpPositionWatcher }    from './useScalpPositionWatcher';
import { ohlcvToDataUrl }             from '../utils/chartRenderer';
import { runSingleAnalysis }          from '../utils/singleAnalysis';
import { evaluateScalpSignal }         from '../quant/scalpingEngine';
import { checkRiskCaps, onTradeClosed } from '../quant/riskGuard';
import { loadRiskState, saveRiskState } from '../quant/riskGuard';
import { loadScalpConfig }            from '../quant/scalpingEngine';
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
  phase:              BotPhase;
  currentPrice:       number | null;
  ohlcvBuffer:        OHLCV[];
  activePlan:         ScalpingPlan | null;
  activeTrade:        BotTradeRecord | null;
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

export function useBotLoop(
  symbol:            string | null,
  timeframeMinutes:  number,
  capital:           number,           // ₹ total capital for position sizing
  minConfidence:     number,           // 0–100, user-set threshold
  config:            ScalpConfig,
): UseBotLoopResult {
  // State (drives UI re-renders)
  const [phase,           setPhase]           = useState<BotPhase>('IDLE');
  const [activePlan,      setActivePlan]      = useState<ScalpingPlan | null>(null);
  const [activeTrade,     setActiveTrade]     = useState<BotTradeRecord | null>(null);
  const [tradeHistory,    setTradeHistory]    = useState<BotTradeRecord[]>([]);
  const [sessionStats,    setSessionStats]    = useState<BotSessionStats>(emptyStats());
  const [stabilityCount,  setStabilityCount]  = useState(0);
  const [lastSignal,      setLastSignal]      = useState<string | null>(null);
  const [lastConfidence,  setLastConfidence]  = useState(0);
  const [lastBlockReason, setLastBlockReason] = useState<string | null>(null);

  // Refs (do not trigger re-renders)
  const botEnabledRef     = useRef(false);    // true when bot is running
  const analyzingRef      = useRef(false);    // true while runSingleAnalysis is in progress
  const lastCandleCountRef = useRef(0);       // detect new candle arrival
  const abortRef          = useRef<AbortController | null>(null);
  const stabilityRef      = useRef(0);        // mirrors stabilityCount for use inside callbacks
  const riskStateRef      = useRef<RiskState>(loadRiskState());

  const feed = useStockFeed(
    symbol,
    timeframeMinutes,
    botEnabledRef.current && phase !== 'IDLE'
  );

  const watcher = useScalpPositionWatcher(
    phase === 'IN_TRADE' ? activePlan : null,
    feed.currentPrice,
    activeTrade?.openedAt ?? null   // passes trade open timestamp
  );

  const startBot = useCallback(() => {
    if (!symbol) return;
    botEnabledRef.current = true;
    stabilityRef.current  = 0;
    setStabilityCount(0);
    setLastBlockReason(null);
    setPhase('SCANNING');
  }, [symbol]);

  const stopBot = useCallback(() => {
    botEnabledRef.current = false;
    abortRef.current?.abort();
    setPhase('IDLE');
    setActivePlan(null);
    stabilityRef.current = 0;
    setStabilityCount(0);
  }, []);

  const pauseBot = useCallback(() => {
    // Suspend analysis but keep position watcher alive
    botEnabledRef.current = false;
    if (phase !== 'IN_TRADE') setPhase('IDLE');
  }, [phase]);

  const closeActiveTrade = useCallback((
    exitPrice: number,
    outcome:   TradeOutcome
  ) => {
    setActiveTrade(prev => {
      if (!prev) return null;

      const grossPnL       = (exitPrice - prev.entryPrice) * (prev.plan.positionSizeShares ?? 1);
      const brokerCharges  = prev.plan.brokerChargesEstimate ?? 0;
      const realizedPnL    = grossPnL - brokerCharges;
      const realizedPnLPct = (realizedPnL / capital) * 100;
      const rMultiple      = prev.plan.riskAmount > 0
        ? realizedPnL / prev.plan.riskAmount
        : 0;
      const durationMinutes = Math.round((Date.now() - prev.openedAt) / 60000);

      const closed: BotTradeRecord = {
        ...prev,
        exitPrice,
        outcome,
        realizedPnL,
        realizedPnLPct,
        rMultiple,
        closedAt: Date.now(),
        durationMinutes,
      };

      // Update history
      setTradeHistory(h => [closed, ...h]);

      // Update session stats
      setSessionStats(s => updateStats(s, closed));

      // Update risk state
      riskStateRef.current = loadRiskState();
      const nextRisk = onTradeClosed(riskStateRef.current, realizedPnL, config.risk);
      riskStateRef.current = nextRisk;
      saveRiskState(nextRisk);

      return null; // clear active trade
    });

    setActivePlan(null);
    setPhase('SCANNING');

  }, [capital, config]);

  const forceExit = useCallback(() => {
    if (phase !== 'IN_TRADE' || !activeTrade || !feed.currentPrice) return;
    closeActiveTrade(feed.currentPrice, 'MANUAL_EXIT');
  }, [phase, activeTrade, feed.currentPrice, closeActiveTrade]);

  const runAnalysisCycle = useCallback(async () => {
    if (!symbol || feed.ohlcvBuffer.length < 10) return;

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

      // Step 2 — Run full analysis pipeline (vision → indicators → judges)
      const result = await runSingleAnalysis({
        imageDataUrl:     dataUrl,
        stock:            symbol,
        graphTimeframe:   `${timeframeMinutes}m`,
        holdingMinutes:   `${timeframeMinutes}m`,
        investmentAmount: String(capital),
        techniquesList:   [],            // load from config if available
        signal:           abortRef.current.signal,
      });

      if (!result) return;

      const winner     = result.winner;      // 'BULL' | 'BEAR' | 'NO_TRADE'
      const confidence = result.finalConfidence ?? 0;
      const direction  = winner === 'BULL' ? 'LONG' : 'NO_TRADE';

      setLastSignal(direction);
      setLastConfidence(confidence);

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
      if (confidence < minConfidence) {
        stabilityRef.current = 0;
        setStabilityCount(0);
        setLastBlockReason(`CONFIDENCE: ${confidence.toFixed(1)}% < threshold ${minConfidence}%`);
        setPhase('SCANNING');
        return;
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
      if (!feed.marketOpen) {
        setLastBlockReason('MARKET_CLOSED: outside 09:15–15:30 IST');
        setPhase('SCANNING');
        return;
      }

      // Step 7 — All gates passed — build scalping plan
      const entryPrice = feed.currentPrice;
      if (!entryPrice) return;

      const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      const mm = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      const ohlc = feed.ohlcvBuffer.map((c, i) => ({
        open: c.open, high: c.high, low: c.low, close: c.close,
        xCenter: i, isBull: c.close >= c.open
      }));
      const ctx = {
        config,
        riskState: riskStateRef.current,
        pivots: [],
        atr14: ohlc.map(() => entryPrice * 0.001),
        vwapProxy: ohlc.map(() => entryPrice),
        nowMsEpoch: Date.now(),
        nowISTMinutesSinceMidnight: mm,
        currentBarIndex: ohlc.length - 1
      };

      const decision = evaluateScalpSignal(ohlc, { winner: result.winner || 'NO_TRADE' }, ctx as any);
      const plan = decision.plan;
      if (!plan) {
        setLastBlockReason('PLAN_FAIL: evaluateScalpSignal returned no plan');
        stabilityRef.current = 0;
        setStabilityCount(0);
        setPhase('SCANNING');
        return;
      }

      // Step 8 — ARM the trade
      setActivePlan(plan);
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
      setActiveTrade(trade);
      setPhase('IN_TRADE');

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setLastBlockReason(`ANALYSIS_ERROR: ${err.message}`);
    } finally {
      analyzingRef.current = false;
    }
  }, [symbol, timeframeMinutes, capital, minConfidence, config, feed]);

  useEffect(() => {
    // Guard: only run if a new candle actually arrived
    if (feed.candleCount === lastCandleCountRef.current) return;
    lastCandleCountRef.current = feed.candleCount;

    // Guard: do not run if bot is off, already analyzing, or in trade
    if (!botEnabledRef.current) return;
    if (analyzingRef.current) return;
    if (phase === 'IN_TRADE') return;
    if (phase === 'IDLE') return;
    if (feed.ohlcvBuffer.length < 10) return; // need minimum candles

    // Guard: stale data — do not analyze on frozen prices
    if (feed.isStale) {
      setLastBlockReason('STALE_DATA: price feed frozen, skipping analysis');
      return;
    }

    runAnalysisCycle();
  }, [feed.candleCount, feed.isStale, phase, feed.ohlcvBuffer.length, runAnalysisCycle]);

  useEffect(() => {
    if (phase !== 'IN_TRADE') return;
    if (!watcher.outcome) return;

    const exitAt = feed.currentPrice ?? activeTrade?.plan.entry ?? activePlan?.entry ?? 0;
    closeActiveTrade(exitAt, watcher.outcome);
  }, [watcher.outcome, phase, feed.currentPrice, closeActiveTrade, activeTrade, activePlan]);

  // Auto-halt if feed goes dead
  useEffect(() => {
    if (!botEnabledRef.current) return;
    if (feed.consecutiveFailures >= 3 && phase !== 'IN_TRADE') {
      setPhase('HALTED');
      setLastBlockReason(`FEED_DEAD: ${feed.consecutiveFailures} consecutive API failures`);
    }
  }, [feed.consecutiveFailures, phase]);

  // Auto-halt if market closes mid-session
  useEffect(() => {
    if (!botEnabledRef.current) return;
    if (!feed.marketOpen && phase === 'SCANNING') {
      setPhase('HALTED');
      setLastBlockReason('MARKET_CLOSED');
    }
    if (feed.marketOpen && phase === 'HALTED' &&
        lastBlockReason === 'MARKET_CLOSED') {
      setPhase('SCANNING'); // auto-resume when market reopens
    }
  }, [feed.marketOpen, phase, lastBlockReason]);

  return {
    phase,
    currentPrice:    feed.currentPrice,
    ohlcvBuffer:     feed.ohlcvBuffer,
    activePlan,
    activeTrade,
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
    trailSL:          watcher.trailSL,
    tp1Hit:           watcher.tp1Hit,
    unrealizedPnL:    watcher.unrealizedPnL,
    unrealizedPnLPct: watcher.unrealizedPnLPct,
    timeRemainingMs:  watcher.timeRemainingMs,
  };
}
