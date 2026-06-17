import { OHLCV, RiskState } from '../types';
import { BacktestConfig, BacktestResult, BacktestTrade } from '../types/backtest';
import { NumericOHLC } from '../vision/pipeline';
import { HorizonContext } from './horizon';
import { evaluateSignal } from './ruleEngine';
import { atr } from './indicators';
import { findSwingPivots } from './marketStructure';
import { calculateStopLoss, buildExitPlan, ScalpContext } from './scalpingEngine';
import { computeRoundTripCharges } from './brokerCharges';
import { getISTDateString, getISTMinutes } from '../utils/istUtils';

const ANALYSIS_WINDOW_SIZE = 60; // matches live bot's MAX_BUFFER_SIZE in useStockFeed.ts

function toNumericWindow(window: OHLCV[]): NumericOHLC[] {
  return window.map((c, idx) => ({
    open:    c.open,
    high:    c.high,
    low:     c.low,
    close:   c.close,
    xCenter: idx,
    isBull:  c.close >= c.open,
  }));
}

function buildHorizonCtx(): HorizonContext {
  // Mirrors the live bot's formula when graphTimeframe === holdingMinutes === '5m':
  // hRatio = durationMinutes / tfMinutes = 1.0 -> horizonClass = 'NEAR_FULL'
  return {
    tfMinutes:       5,
    durationMinutes: 5,
    H:               1.0,
    horizonClass:    'NEAR_FULL',
    isTestMode:      false,
  };
}

function dummyRiskState(dateKey: string): RiskState {
  return {
    dailyPnL: 0,
    tradesToday: 0,
    consecutiveLosses: 0,
    lastTradeAt: 0,
    inCooldown: false,
    cooldownUntil: 0,
    dateKey,
  };
}

/**
 * Runs the real judges (evaluateSignal) candle-by-candle over historical
 * OHLCV data and simulates trade outcomes. No Firebase writes, no UI,
 * no EOD settlement involvement. Pure offline simulation.
 *
 * Rules (locked):
 *  - 5-minute candles only
 *  - First `config.warmupCandles` candles are skipped (no signals)
 *  - Signal qualifies only if winner === 'BULL' AND margin >= marginThreshold
 *  - Entry price = open of the candle AFTER the signal candle
 *  - Max `config.maxTradesPerDay` trades per IST calendar day
 *  - One trade open at a time
 *  - Per candle: SL checked before TP2 (pessimistic same-candle order)
 *  - If neither hit by the last candle of that IST day, TIME_EXIT at that
 *    candle's close
 *  - Trades never span across IST calendar days
 */
export function runBacktest(candles: OHLCV[], config: BacktestConfig): BacktestResult {
  const trades: BacktestTrade[] = [];

  let currentDayKey = '';
  let tradesToday = 0;
  let i = config.warmupCandles;

  while (i < candles.length - 1) {
    const signalCandle = candles[i];
    const dayKey = getISTDateString(signalCandle.timestamp ?? 0);

    if (dayKey !== currentDayKey) {
      currentDayKey = dayKey;
      tradesToday = 0;
    }

    if (tradesToday >= config.maxTradesPerDay) {
      // Skip ahead to the first candle of the next IST day
      let j = i + 1;
      while (j < candles.length && getISTDateString(candles[j].timestamp ?? 0) === currentDayKey) j++;
      i = j;
      continue;
    }

    const windowStart = Math.max(0, i - ANALYSIS_WINDOW_SIZE + 1);
    const windowCandles = candles.slice(windowStart, i + 1);
    const numericWindow = toNumericWindow(windowCandles);
    const horizonCtx = buildHorizonCtx();

    const decision = evaluateSignal(
      numericWindow,
      config.techniquesList || [],
      horizonCtx,
      [],
      [],
      undefined,
      undefined
    );

    const qualifies = decision.winner === 'BULL' && decision.margin >= config.marginThreshold;
    if (!qualifies) {
      i++;
      continue;
    }

    const entryCandle = candles[i + 1];
    if (!entryCandle) break;

    const entryDayKey = getISTDateString(entryCandle.timestamp ?? 0);
    if (entryDayKey !== dayKey) {
      // Signal fired on the last candle of the day - no same-day entry possible
      i++;
      continue;
    }

    const entry = entryCandle.open;

    const highs = windowCandles.map(c => c.high);
    const lows  = windowCandles.map(c => c.low);
    const atr14Arr = atr(windowCandles, 14);
    const pivots = findSwingPivots(highs, lows, 2);

    const ctx: ScalpContext = {
      config: config.scalpConfig,
      riskState: dummyRiskState(dayKey),
      pivots,
      atr14: atr14Arr,
      vwapProxy: [],
      nowMsEpoch: entryCandle.timestamp ?? 0,
      nowISTMinutesSinceMidnight: getISTMinutes(entryCandle.timestamp ?? 0),
      currentBarIndex: windowCandles.length - 1,
      currentPrice: entry,
    };

    const sl = calculateStopLoss(entry, config.scalpConfig.slMode, ctx);
    const riskPerShare = entry - sl;
    if (!isFinite(riskPerShare) || riskPerShare <= 0) {
      i++;
      continue;
    }

    const exits = buildExitPlan(entry, sl, ctx);
    if (!exits) {
      i++;
      continue;
    }
    const tp2 = exits.tp2;

    const investmentPerTrade = config.scalpConfig.investmentPerTrade ?? 10000;
    const lotSize = config.scalpConfig.lotSize ?? 1;
    let positionSize: number;
    if (lotSize === 1) {
      positionSize = Math.floor(investmentPerTrade / entry);
    } else {
      positionSize = Math.floor((investmentPerTrade / entry) / lotSize) * lotSize;
    }
    if (positionSize <= 0) positionSize = lotSize === 1 ? 1 : lotSize;

    // Walk forward within the same IST day only
    let exitIdx = -1;
    let exitPrice = entry;
    let outcome: 'SL_HIT' | 'TP2_HIT' | 'TIME_EXIT' = 'TIME_EXIT';

    let k = i + 1;
    while (k < candles.length) {
      const c = candles[k];
      const cDayKey = getISTDateString(c.timestamp ?? 0);
      if (cDayKey !== dayKey) break; // never spill into next day

      if (c.low <= sl) {
        outcome = 'SL_HIT';
        exitPrice = sl;
        exitIdx = k;
        break;
      }
      if (c.high >= tp2) {
        outcome = 'TP2_HIT';
        exitPrice = tp2;
        exitIdx = k;
        break;
      }

      const next = candles[k + 1];
      const isLastOfDay = !next || getISTDateString(next.timestamp ?? 0) !== dayKey;
      if (isLastOfDay) {
        outcome = 'TIME_EXIT';
        exitPrice = c.close;
        exitIdx = k;
        break;
      }
      k++;
    }

    if (exitIdx === -1) {
      // Ran out of historical data entirely before resolving
      const lastC = candles[candles.length - 1];
      outcome = 'TIME_EXIT';
      exitPrice = lastC.close;
      exitIdx = candles.length - 1;
    }

    const exitCandle = candles[exitIdx];
    const charges = computeRoundTripCharges(
      entry,
      exitPrice,
      positionSize,
      config.scalpConfig.instrument
    ).total;
    const grossPnL = (exitPrice - entry) * positionSize;
    const netPnL = grossPnL - charges;
    const rMultiple = riskPerShare > 0 ? netPnL / (riskPerShare * positionSize) : 0;
    const durationMinutes = ((exitCandle.timestamp ?? 0) - (entryCandle.timestamp ?? 0)) / 60000;

    trades.push({
      id: `bt_${entryCandle.timestamp ?? i}_${i}`,
      entryTime: entryCandle.timestamp ?? 0,
      exitTime: exitCandle.timestamp ?? null,
      entryPrice: entry,
      exitPrice,
      outcome,
      pnl: netPnL,
      rMultiple,
      durationMinutes,
      bullScore: decision.bullScore,
      bearScore: decision.bearScore,
      margin: decision.margin,
    });

    tradesToday++;
    i = exitIdx + 1;
  }

  return computeBacktestStats(candles, config, trades);
}

function computeBacktestStats(
  candles: OHLCV[],
  config: BacktestConfig,
  trades: BacktestTrade[]
): BacktestResult {
  const wins = trades.filter(t => t.pnl > 0).length;
  const losses = trades.filter(t => t.pnl <= 0).length;
  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
  const winRate = trades.length > 0 ? wins / trades.length : 0;
  const avgRMultiple = trades.length > 0
    ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length
    : 0;
  const avgDurationMinutes = trades.length > 0
    ? trades.reduce((s, t) => s + t.durationMinutes, 0) / trades.length
    : 0;

  let cumPnL = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let consecLosses = 0;
  let maxConsecutiveLosses = 0;

  for (const t of trades) {
    cumPnL += t.pnl;
    if (cumPnL > peak) peak = cumPnL;
    const dd = peak - cumPnL;
    if (dd > maxDrawdown) maxDrawdown = dd;

    if (t.pnl <= 0) {
      consecLosses++;
      if (consecLosses > maxConsecutiveLosses) maxConsecutiveLosses = consecLosses;
    } else {
      consecLosses = 0;
    }
  }

  const stamped = candles.filter(c => c.timestamp != null);
  const startDate = stamped.length > 0 ? getISTDateString(stamped[0].timestamp!) : '';
  const endDate = stamped.length > 0 ? getISTDateString(stamped[stamped.length - 1].timestamp!) : '';

  return {
    symbol: config.symbol,
    timeframeMinutes: 5,
    totalCandlesUsed: candles.length,
    trades,
    totalTrades: trades.length,
    wins,
    losses,
    winRate,
    totalPnL,
    avgRMultiple,
    maxDrawdown,
    maxConsecutiveLosses,
    avgDurationMinutes,
    startDate,
    endDate,
  };
}
