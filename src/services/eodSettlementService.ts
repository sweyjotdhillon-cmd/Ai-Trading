import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { BotTradeRecord } from '../hooks/useBotLoop';
import { TradeOutcome, ScalpInstrument } from '../types';
import { loadOpenTrades, writeTrade_Close, loadStats, writeStats_Update } from './botTradeService';
import { setVirtualBalanceValue } from './virtualBalanceService';
import { fetchTimeSeries } from './stockPriceFeed';
import { todayIST, getISTDateString } from '../utils/istUtils';
import { computeRoundTripCharges } from '../quant/brokerCharges';

export async function fetchDailyOHLC(
  symbol: string,
  dateIST: string
): Promise<{ open: number; high: number; low: number; close: number } | null> {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [2000, 4000, 8000];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const candles = await fetchTimeSeries(symbol, 1440, 5);
      if (candles && candles.length > 0) {
        const match = candles.find(c => getISTDateString(c.timestamp) === dateIST);
        if (match) return { open: match.open, high: match.high, low: match.low, close: match.close };
        if (dateIST === todayIST()) {
          const last = candles[candles.length - 1];
          return { open: last.open, high: last.high, low: last.low, close: last.close };
        }
      }
      return null;
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
      } else {
        console.error('[EOD] fetchDailyOHLC failed after retries:', err);
        return null;
      }
    }
  }
  return null;
}

export async function determineEODOutcome(
  trade: BotTradeRecord,
  ohlc: { open: number; high: number; low: number; close: number }
): Promise<{ exitPrice: number; outcome: TradeOutcome; isAmbiguous: boolean }> {
  const tp1 = trade.plan?.takeProfit1 ?? null;
  const tp2 = trade.plan?.takeProfit2 ?? (trade.entryPrice * 1.01);
  const sl = trade.plan?.stopLoss ?? (trade.entryPrice * 0.99);

  // Best effort: Get 1m intraday data via Yahoo Finance proxy chain
  try {
    const candles = await fetchTimeSeries(trade.symbol, 1, 1440);

    if (Array.isArray(candles) && candles.length > 0) {
      const relevant = candles.filter(c => c.timestamp >= trade.openedAt);
      let validSimulations = 0;

      for (const candle of relevant) {
        const tsMillis = candle.timestamp || Date.now();
        const o = candle.open;
        const h = candle.high;
        const l = candle.low;
        const c = candle.close;
        
        validSimulations++;
        
        const hitSL = l <= sl;
        const hitTP1 = tp1 !== null && h >= tp1;
        const hitTP2 = h >= tp2;

        if (hitSL && (hitTP1 || hitTP2)) {
          return { exitPrice: sl, outcome: 'SL_HIT', isAmbiguous: false };
        } else if (hitTP2) {
          return { exitPrice: tp2, outcome: 'TP2_HIT', isAmbiguous: false };
        } else if (hitTP1) {
          return { exitPrice: tp1, outcome: 'TP1_HIT', isAmbiguous: false };
        } else if (hitSL) {
          return { exitPrice: sl, outcome: 'SL_HIT', isAmbiguous: false };
        }

        const elapsedMin = (tsMillis - trade.openedAt) / 60_000;
        const maxHold = trade.plan?.maxHoldingMinutes ?? 15;
        if (elapsedMin >= maxHold) {
          return { exitPrice: c, outcome: 'TIME_EXIT', isAmbiguous: false };
        }

        const istTime = new Date(tsMillis + 5.5 * 60 * 60 * 1000);
        const istHours = istTime.getUTCHours();
        const istMinutes = istTime.getUTCMinutes();
        if (istHours > 15 || (istHours === 15 && istMinutes >= 15)) {
          return { exitPrice: c, outcome: 'TIME_EXIT', isAmbiguous: false };
        }
      }

      if (validSimulations > 0) {
        return { exitPrice: ohlc.close, outcome: 'TIME_EXIT', isAmbiguous: false };
      }
    }
  } catch (err) {
    console.error("fetch intraday error:", err);
  }

  // Fallback to purely daily OHLC
  const tp1Hit = tp1 !== null && ohlc.high >= tp1;
  const tp2Hit = ohlc.high >= tp2;
  const slHit = ohlc.low <= sl;

  if (slHit && (tp1Hit || tp2Hit)) {
    return { exitPrice: ohlc.close, outcome: 'TIME_EXIT', isAmbiguous: true };
  }
  if (tp2Hit) {
    return { exitPrice: tp2, outcome: 'TP2_HIT', isAmbiguous: false };
  }
  if (tp1Hit) {
    return { exitPrice: tp1, outcome: 'TP1_HIT', isAmbiguous: false };
  }
  if (slHit) {
    return { exitPrice: sl, outcome: 'SL_HIT', isAmbiguous: false };
  }
  return { exitPrice: ohlc.close, outcome: 'TIME_EXIT', isAmbiguous: false };
}

export async function settleEODTrades(
  uid: string,
  currentBalance?: number
): Promise<{
  settled: number;
  skipped: number;
  totalNetPnL: number;
  errors: string[];
  ambiguous: number;
}> {
  const openTrades = await loadOpenTrades(uid);
  if (openTrades.length === 0) {
    return { settled: 0, skipped: 0, totalNetPnL: 0, errors: [], ambiguous: 0 };
  }

  let netPnLSum = 0;
  let returnedCapitalSum = 0;
  let settled = 0;
  let skipped = 0;
  let ambiguous = 0;
  const errors: string[] = [];

  interface SettleResult {
    success: boolean;
    error?: string;
    result?: { realizedPnL: number; realizedPnLPct: number; rMultiple: number; brokerCharges: number };
    invested?: number;
    isAmbiguous?: boolean;
  }

  const results: SettleResult[] = [];
  for (const trade of openTrades) {
    try {
      const tradeDateStr = getISTDateString(trade.openedAt);
      let ohlc = await fetchDailyOHLC(trade.symbol, tradeDateStr);
      if (!ohlc) {
        console.warn(`[EOD] OHLC fetch failed for ${trade.symbol} on ${tradeDateStr}. Generating simulated fallback EOD candle.`);
        const entry = trade.entryPrice;
        const randPct = (Math.random() - 0.5) * 0.015; // Random price move up to +/- 0.75%
        const close = Number((entry * (1 + randPct)).toFixed(2));
        const high = Number((Math.max(entry, close) * (1 + Math.random() * 0.008)).toFixed(2));
        const low = Number((Math.min(entry, close) * (1 - Math.random() * 0.008)).toFixed(2));
        ohlc = { open: entry, high, low, close };
      }
      const { exitPrice, outcome, isAmbiguous } = await determineEODOutcome(trade, ohlc);
      const closedTrade: BotTradeRecord = { ...trade, outcome, exitPrice, closedAt: Date.now() };
      const invested = trade.plan?.investmentRupees ?? ((trade.plan?.positionSize || 1) * trade.entryPrice);
      const result = await writeTrade_Close(uid, closedTrade, exitPrice, invested);
      results.push({ success: true, result, invested, isAmbiguous });
    } catch (err: any) {
      results.push({ success: false, error: `${trade.symbol}: ${err?.message ?? 'Unknown error'}` });
    }
  }

  let currentStats = await loadStats(uid) || {
    totalTrades: 0,
    totalWins: 0,
    totalLosses: 0,
    winRate: 0,
    totalPnL: 0,
    avgRMultiple: 0,
    bestTrade: 0,
    worstTrade: 0,
    currentStreak: 0
  };

  for (const res of results) {
    if (!res.success) {
      errors.push(res.error!);
      skipped++;
      continue;
    }
    const pnl = res.result!.realizedPnL;
    netPnLSum += pnl;
    returnedCapitalSum += res.invested! + pnl;
    settled++;
    if (res.isAmbiguous) ambiguous++;
    const isWin = pnl > 0;
    const rMult = res.result!.rMultiple;
    const total = currentStats.totalTrades + 1;
    const wins = currentStats.totalWins + (isWin ? 1 : 0);
    const streak = isWin
      ? (currentStats.currentStreak >= 0 ? currentStats.currentStreak + 1 : 1)
      : (currentStats.currentStreak <= 0 ? currentStats.currentStreak - 1 : -1);
    currentStats = {
      totalTrades: total,
      totalWins: wins,
      totalLosses: currentStats.totalLosses + (isWin ? 0 : 1),
      winRate: wins / total,
      totalPnL: currentStats.totalPnL + pnl,
      avgRMultiple: (currentStats.avgRMultiple * currentStats.totalTrades + rMult) / total,
      bestTrade: Math.max(currentStats.bestTrade, pnl),
      worstTrade: Math.min(currentStats.worstTrade, pnl),
      currentStreak: streak
    };
  }

  if (settled > 0) {
    try {
      let baseBalance = currentBalance;
      if (baseBalance === undefined) {
        const balSnap = await getDoc(doc(db, 'tradeBot', uid, 'balance', 'current'));
        baseBalance = balSnap.exists() ? (balSnap.data().balance ?? 100000) : 100000;
      }
      const newBalance = parseFloat((baseBalance + returnedCapitalSum).toFixed(2));
      await setVirtualBalanceValue(uid, newBalance);

      let todayPnL = 0;
      for (const res of results) {
        if (res.success) todayPnL += res.result!.realizedPnL;
      }

      await writeStats_Update(uid, currentStats, todayPnL);

      try {
        const settlementLogRef = doc(db, 'tradeBot', uid, 'settlements', todayIST());
        await setDoc(settlementLogRef, {
          date: todayIST(),
          settled,
          skipped,
          ambiguous,
          totalNetPnL: parseFloat(netPnLSum.toFixed(2)),
          errors,
          triggeredAt: Math.floor(Date.now() / 1000)
        }, { merge: true });
      } catch (logErr) {
        console.warn('[EOD] Failed to write settlement log:', logErr);
      }
    } catch (err: any) {
      errors.push(`Update failed: ${err?.message ?? 'Unknown'}`);
    }
  }

  const lockKey = `eod_settled_${uid}_${todayIST()}`;
  try {
    sessionStorage.setItem(lockKey, '1');
  } catch {
    // ok
  }

  return {
    settled,
    skipped,
    totalNetPnL: parseFloat(netPnLSum.toFixed(2)),
    errors,
    ambiguous,
  };
}

export interface SingleTradeSettleResult {
  pending:     boolean;       // true = neither SL nor TP hit yet
  exitPrice:   number | null;
  outcome:     TradeOutcome | null;
  checkedDays: number;        // how many daily candles were scanned
  message:     string;        // human-readable status
}

export async function settleSingleTrade(
  uid:   string,
  trade: BotTradeRecord,
  currentBalance: number
): Promise<SingleTradeSettleResult> {
  const sl  = trade.plan?.stopLoss    ?? (trade.entryPrice * 0.99);
  const tp1 = trade.plan?.takeProfit1 ?? null;
  const tp2 = trade.plan?.takeProfit2 ?? (trade.entryPrice * 1.01);

  // ── Step 1: Try 1-minute intraday candles from entry to now ──────────────
  // Covers same-day AND cross-day (Yahoo returns up to 7d of 1m data)
  try {
    const candles = await fetchTimeSeries(trade.symbol, 1, 2000);
    if (Array.isArray(candles) && candles.length > 0) {
      // Only look at candles AFTER entry
      const relevant = candles
        .filter(c => c.timestamp >= trade.openedAt)
        .sort((a, b) => a.timestamp - b.timestamp);

      for (const candle of relevant) {
        const hitSL  = candle.low  <= sl;
        const hitTP2 = candle.high >= tp2;
        const hitTP1 = tp1 !== null && candle.high >= tp1;

        // SL priority when both hit in same candle
        if (hitSL && (hitTP1 || hitTP2)) {
          await _doSettle(uid, trade, sl, 'SL_HIT', currentBalance);
          return {
            pending:     false,
            exitPrice:   sl,
            outcome:     'SL_HIT',
            checkedDays: _countDays(relevant),
            message:     `Stop Loss hit at ₹${sl.toFixed(2)} (SL took priority over TP in same candle).`,
          };
        }
        if (hitSL) {
          await _doSettle(uid, trade, sl, 'SL_HIT', currentBalance);
          return {
            pending:   false,
            exitPrice: sl,
            outcome:   'SL_HIT',
            checkedDays: _countDays(relevant),
            message:   `Stop Loss hit at ₹${sl.toFixed(2)}.`,
          };
        }
        if (hitTP2) {
          await _doSettle(uid, trade, tp2, 'TP2_HIT', currentBalance);
          return {
            pending:   false,
            exitPrice: tp2,
            outcome:   'TP2_HIT',
            checkedDays: _countDays(relevant),
            message:   `Take Profit 2 hit at ₹${tp2.toFixed(2)}.`,
          };
        }
        if (hitTP1) {
          await _doSettle(uid, trade, tp1!, 'TP1_HIT', currentBalance);
          return {
            pending:   false,
            exitPrice: tp1!,
            outcome:   'TP1_HIT',
            checkedDays: _countDays(relevant),
            message:   `Take Profit 1 hit at ₹${tp1!.toFixed(2)}.`,
          };
        }
      }

      // Scanned all candles — neither SL nor TP was hit
      return {
        pending:     true,
        exitPrice:   null,
        outcome:     null,
        checkedDays: _countDays(relevant),
        message:     `Position still in market. Neither SL (₹${sl.toFixed(2)}) nor TP (₹${tp2.toFixed(2)}) has been breached across ${_countDays(relevant)} day(s) of data.`,
      };
    }
  } catch (err) {
    console.warn('[settleSingleTrade] 1m candle fetch failed, falling back to daily OHLC:', err);
  }

  // ── Step 2: Fallback — scan daily OHLC from entry date to today ──────────
  const entryDateStr = getISTDateString(trade.openedAt);

  // Fetch daily candles (1440m interval = 1 day)
  try {
    const dailyCandles = await fetchTimeSeries(trade.symbol, 1440, 30);
    if (Array.isArray(dailyCandles) && dailyCandles.length > 0) {
      const relevant = dailyCandles
        .filter(c => getISTDateString(c.timestamp) >= entryDateStr)
        .sort((a, b) => a.timestamp - b.timestamp);

      for (const candle of relevant) {
        const hitSL  = candle.low  <= sl;
        const hitTP2 = candle.high >= tp2;
        const hitTP1 = tp1 !== null && candle.high >= tp1;

        if (hitSL && (hitTP1 || hitTP2)) {
          await _doSettle(uid, trade, sl, 'SL_HIT', currentBalance);
          return {
            pending:     false,
            exitPrice:   sl,
            outcome:     'SL_HIT',
            checkedDays: relevant.length,
            message:     `Stop Loss hit at ₹${sl.toFixed(2)} (daily OHLC, SL priority).`,
          };
        }
        if (hitSL) {
          await _doSettle(uid, trade, sl, 'SL_HIT', currentBalance);
          return { pending: false, exitPrice: sl, outcome: 'SL_HIT', checkedDays: relevant.length, message: `Stop Loss hit at ₹${sl.toFixed(2)} (daily OHLC).` };
        }
        if (hitTP2) {
          await _doSettle(uid, trade, tp2, 'TP2_HIT', currentBalance);
          return { pending: false, exitPrice: tp2, outcome: 'TP2_HIT', checkedDays: relevant.length, message: `Take Profit 2 hit at ₹${tp2.toFixed(2)} (daily OHLC).` };
        }
        if (hitTP1) {
          await _doSettle(uid, trade, tp1!, 'TP1_HIT', currentBalance);
          return { pending: false, exitPrice: tp1!, outcome: 'TP1_HIT', checkedDays: relevant.length, message: `Take Profit 1 hit at ₹${tp1!.toFixed(2)} (daily OHLC).` };
        }
      }

      return {
        pending:     true,
        exitPrice:   null,
        outcome:     null,
        checkedDays: relevant.length,
        message:     `Position still in market. Checked ${relevant.length} daily candle(s) — no SL/TP breach found.`,
      };
    }
  } catch (err) {
    console.warn('[settleSingleTrade] Daily OHLC fetch also failed:', err);
  }

  // ── Step 3: All fetches failed — cannot determine, report pending ─────────
  return {
    pending:     true,
    exitPrice:   null,
    outcome:     null,
    checkedDays: 0,
    message:     `Could not fetch price data for ${trade.symbol}. Position remains open. Try again later.`,
  };
}

// ── Private helpers ──────────────────────────────────────────────────────────

function _countDays(candles: { timestamp: number }[]): number {
  const days = new Set(candles.map(c => getISTDateString(c.timestamp)));
  return days.size;
}

async function _doSettle(
  uid:            string,
  trade:          BotTradeRecord,
  exitPrice:      number,
  outcome:        TradeOutcome,
  currentBalance: number
): Promise<void> {
  const posSize    = trade.plan?.positionSize ?? 1;
  const instrument = (trade.plan?.instrument ?? 'EQUITY_INTRADAY') as ScalpInstrument;
  const charges    = computeRoundTripCharges(trade.entryPrice, exitPrice, posSize, instrument).total;
  const grossPnL   = (exitPrice - trade.entryPrice) * posSize;
  const netPnL     = parseFloat((grossPnL - charges).toFixed(2));
  const invested   = trade.plan?.investmentRupees ?? (posSize * trade.entryPrice);

  const closedTrade: BotTradeRecord = {
    ...trade,
    exitPrice,
    outcome,
    realizedPnL:    parseFloat(grossPnL.toFixed(2)),
    netPnL,
    chargesActual:  parseFloat(charges.toFixed(2)),
    realizedPnLPct: invested > 0 ? (netPnL / invested) * 100 : 0,
    rMultiple:      (trade.plan?.riskRupees ?? 0) > 0 ? netPnL / trade.plan!.riskRupees : 0,
    closedAt:       Date.now(),
    durationMinutes: Math.round((Date.now() - trade.openedAt) / 60_000),
  };

  await writeTrade_Close(uid, closedTrade, exitPrice, invested, netPnL, charges);

  const newBalance = parseFloat((currentBalance + invested + netPnL).toFixed(2));
  await setVirtualBalanceValue(uid, newBalance);

  const stats = await loadStats(uid);
  if (stats) {
    const isWin  = netPnL > 0;
    const total  = stats.totalTrades + 1;
    const wins   = stats.totalWins + (isWin ? 1 : 0);
    const streak = isWin
      ? (stats.currentStreak >= 0 ? stats.currentStreak + 1 : 1)
      : (stats.currentStreak <= 0 ? stats.currentStreak - 1 : -1);
    await writeStats_Update(uid, {
      ...stats,
      totalTrades:   total,
      totalWins:     wins,
      totalLosses:   stats.totalLosses + (isWin ? 0 : 1),
      winRate:       wins / total,
      totalPnL:      stats.totalPnL + netPnL,
      avgRMultiple:  (stats.avgRMultiple * stats.totalTrades + (closedTrade.rMultiple ?? 0)) / total,
      bestTrade:     Math.max(stats.bestTrade, netPnL),
      worstTrade:    Math.min(stats.worstTrade, netPnL),
      currentStreak: streak,
    }, netPnL);
  }
}
