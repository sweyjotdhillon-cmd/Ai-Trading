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
  const logs: string[] = [];

  const log = (msg: string) => {
    const timestampStr = new Date().toISOString().split('T')[1].slice(0, 8);
    logs.push(`[${timestampStr}] ${msg}`);
  };

  log(`[INIT] Starting Backtest for ${config.symbol} | Max Trades/Day: ${config.maxTradesPerDay} | Margin Thresh: ${config.marginThreshold}`);
  log(`[INIT] Total Candles: ${candles.length} | Warmup: ${config.warmupCandles}`);

  let currentDayKey = '';
  let tradesToday = 0;
  let i = config.warmupCandles;

  while (i < candles.length - 1) {
    const signalCandle = candles[i];
    const dayKey = getISTDateString(signalCandle.timestamp ?? 0);
    const candleTimeStr = signalCandle.timestamp ? new Date(signalCandle.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : `Idx:${i}`;

    if (dayKey !== currentDayKey) {
      if (currentDayKey !== '') log(`\n--- NEW TRADING DAY: ${dayKey} ---`);
      currentDayKey = dayKey;
      tradesToday = 0;
    }

    if (tradesToday >= config.maxTradesPerDay) {
      // Don't spam skipping logs for every single candle, maybe just once per day
      // let's do it quietly
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
    
    // Log signals that are reasonably strong even if they don't meet the margin
    if (decision.margin > 1.0 || qualifies) {
      log(`[${candleTimeStr}] EVAL ${decision.winner} | Bull: ${decision.bullScore.toFixed(2)} Bear: ${decision.bearScore.toFixed(2)} Margin: ${decision.margin.toFixed(2)} -> ${qualifies ? 'QUALIFIED ✨' : 'REJECTED'}`);
    }

    if (!qualifies) {
      i++;
      continue;
    }

    const entryCandle = candles[i + 1];
    if (!entryCandle) {
      log(`[${candleTimeStr}] No next candle available for entry. Ending.`);
      break;
    }

    const entryDayKey = getISTDateString(entryCandle.timestamp ?? 0);
    if (entryDayKey !== dayKey) {
      log(`[${candleTimeStr}] Signal on last candle of day. Cannot enter same day. Skipping.`);
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
      log(`[${candleTimeStr}] Invalid SL (${sl}) or Risk/Share (${riskPerShare}). Skipping.`);
      i++;
      continue;
    }

    const exits = buildExitPlan(entry, sl, ctx);
    if (!exits) {
      log(`[${candleTimeStr}] Failed to build exit plan. Skipping.`);
      i++;
      continue;
    }
    const tp1 = exits.tp1;
    const tp2 = exits.tp2;
    const breakEvenPrice = exits.breakEvenAfter === exits.tp1 ? entry : exits.breakEvenAfter;

    const capitalRupees = config.scalpConfig.capitalRupees ?? 100000;
    const riskPerTradePct = config.scalpConfig.riskPerTradePct ?? 1.0;
    const maxPositionPctCapital = config.scalpConfig.maxPositionPctCapital ?? 30;
    const lotSize = config.scalpConfig.lotSize ?? 1;

    // Target rupee risk for this trade (fixed % of capital)
    const targetRiskRupees = capitalRupees * (riskPerTradePct / 100);

    // Shares needed to risk exactly targetRiskRupees at this trade's SL distance
    const riskBasedSize = Math.floor(targetRiskRupees / riskPerShare);

    // Cap notional so one trade can't exceed maxPositionPctCapital of capital
    const maxNotional = capitalRupees * (maxPositionPctCapital / 100);
    const notionalCappedSize = Math.floor(maxNotional / entry);

    let positionSize = Math.min(riskBasedSize, notionalCappedSize);
    if (lotSize > 1) {
      positionSize = Math.floor(positionSize / lotSize) * lotSize;
    }
    if (positionSize <= 0) positionSize = lotSize === 1 ? 1 : lotSize;

    const actualRiskRupees = positionSize * riskPerShare;
    log(`[SIZING] TargetRisk: ₹${targetRiskRupees.toFixed(0)} | Risk/Share: ₹${riskPerShare.toFixed(2)} | Qty: ${positionSize} | ActualRisk: ₹${actualRiskRupees.toFixed(0)} | NotionalCapQty: ${notionalCappedSize}`);

    const entryTimeStr = new Date(entryCandle.timestamp ?? 0).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    log(`[ENTER] ${entryTimeStr} | Price: ₹${entry.toFixed(2)} | Qty: ${positionSize} | SL: ₹${sl.toFixed(2)} | TP2: ₹${tp2.toFixed(2)} | Risk/Share: ₹${riskPerShare.toFixed(2)}`);

    let tp1Hit = false;
    let tp1Qty = Math.floor(positionSize / 2);
    let remainderQty = positionSize - tp1Qty;
    let tp1ExitPrice = 0;
    let currentStop = sl;

    let exitIdx = -1;
    let exitPrice = entry;
    let outcome: 'SL_HIT' | 'TP2_HIT' | 'TIME_EXIT' | 'BREAK_EVEN' = 'TIME_EXIT';

    let k = i + 1;
    while (k < candles.length) {
      const c = candles[k];
      const cDayKey = getISTDateString(c.timestamp ?? 0);
      if (cDayKey !== dayKey) {
        log(`  -> Reached end of day boundary. Forcing TIME_EXIT.`);
        break; 
      }

      const cTimeStr = new Date(c.timestamp ?? 0).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
      log(`  -> [${cTimeStr}] Tick: H=${c.high.toFixed(2)} L=${c.low.toFixed(2)} C=${c.close.toFixed(2)}`);

      // Pessimistic: current stop (original SL, or breakeven once TP1 booked) checked first
      if (c.low <= currentStop) {
        outcome = tp1Hit ? 'BREAK_EVEN' : 'SL_HIT';
        exitPrice = currentStop;
        exitIdx = k;
        log(tp1Hit
          ? `  -> BREAKEVEN STOP HIT at ${currentStop.toFixed(2)} on remainder (Candle Low: ${c.low.toFixed(2)})`
          : `  -> SL HIT at ${currentStop.toFixed(2)} (Candle Low: ${c.low.toFixed(2)})`);
        break;
      }

      // TP1 check (only before it's been booked). Not retroactive — breakeven stop
      // only becomes active from the NEXT candle onward, never this same candle.
      if (!tp1Hit && c.high >= tp1) {
        tp1Hit = true;
        tp1ExitPrice = tp1;
        currentStop = breakEvenPrice;
        log(`  -> TP1 HIT at ${tp1.toFixed(2)} (Candle High: ${c.high.toFixed(2)}) | Booked ${tp1Qty} shares | Stop moved to breakeven ${breakEvenPrice.toFixed(2)} for remaining ${remainderQty}`);
      }

      if (c.high >= tp2) {
        outcome = 'TP2_HIT';
        exitPrice = tp2;
        exitIdx = k;
        log(`  -> TP2 HIT at ${tp2.toFixed(2)} (Candle High: ${c.high.toFixed(2)})`);
        break;
      }

      const next = candles[k + 1];
      const isLastOfDay = !next || getISTDateString(next.timestamp ?? 0) !== dayKey;
      if (isLastOfDay) {
        outcome = 'TIME_EXIT';
        exitPrice = c.close;
        exitIdx = k;
        log(`  -> Last candle of day reached. TIME_EXIT at ${c.close.toFixed(2)}`);
        break;
      }
      k++;
    }

    if (exitIdx === -1) {
      const lastC = candles[candles.length - 1];
      outcome = 'TIME_EXIT';
      exitPrice = lastC.close;
      exitIdx = candles.length - 1;
      log(`  -> Data ended abruptly. TIME_EXIT at ${exitPrice.toFixed(2)}`);
    }

    const exitCandle = candles[exitIdx];

    let netPnL: number;
    let totalCharges: number;

    if (tp1Hit) {
      const leg1Charges = computeRoundTripCharges(entry, tp1ExitPrice, tp1Qty, config.scalpConfig.instrument).total;
      const leg2Charges = computeRoundTripCharges(entry, exitPrice, remainderQty, config.scalpConfig.instrument).total;
      const leg1PnL = (tp1ExitPrice - entry) * tp1Qty - leg1Charges;
      const leg2PnL = (exitPrice - entry) * remainderQty - leg2Charges;
      netPnL = leg1PnL + leg2PnL;
      totalCharges = leg1Charges + leg2Charges;
      log(`  -> Leg1 (TP1): Qty ${tp1Qty} @ ${tp1ExitPrice.toFixed(2)} | PnL ₹${leg1PnL.toFixed(2)} | Leg2 (${outcome}): Qty ${remainderQty} @ ${exitPrice.toFixed(2)} | PnL ₹${leg2PnL.toFixed(2)}`);
    } else {
      totalCharges = computeRoundTripCharges(entry, exitPrice, positionSize, config.scalpConfig.instrument).total;
      netPnL = (exitPrice - entry) * positionSize - totalCharges;
    }

    const rMultiple = riskPerShare > 0 ? netPnL / (riskPerShare * positionSize) : 0;
    const durationMinutes = ((exitCandle.timestamp ?? 0) - (entryCandle.timestamp ?? 0)) / 60000;

    log(`[EXIT]  Outcome: ${outcome} | TP1Hit: ${tp1Hit} | ExitPrice: ₹${exitPrice.toFixed(2)} | NetPnL: ₹${netPnL.toFixed(2)} | R-Mult: ${rMultiple.toFixed(2)} | Charges: ₹${totalCharges.toFixed(2)} | Duration: ${durationMinutes}m\n`);

    trades.push({
      id: `bt_${entryCandle.timestamp ?? i}_${i}`,
      entryTime: entryCandle.timestamp ?? 0,
      exitTime: exitCandle.timestamp ?? null,
      entryPrice: entry,
      exitPrice,
      outcome,
      tp1Hit,
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

  log(`[DONE] Backtest completed. Total trades taken: ${trades.length}`);
  return computeBacktestStats(candles, config, trades, logs);
}

function computeBacktestStats(
  candles: OHLCV[],
  config: BacktestConfig,
  trades: BacktestTrade[],
  logs: string[]
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
    logs,
  };
}
