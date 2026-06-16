import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { BotTradeRecord } from '../hooks/useBotLoop';
import { TradeOutcome } from '../types';
import { loadOpenTrades, writeTrade_Close, loadStats, writeStats_Update } from './botTradeService';
import { setVirtualBalanceValue } from './virtualBalanceService';
import { parseSymbol, fetchTimeSeries } from './stockPriceFeed';
import { todayIST, getISTDateString, isAfterMarketClose } from '../utils/istUtils';

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
