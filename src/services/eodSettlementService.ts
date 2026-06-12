import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { BotTradeRecord } from '../hooks/useBotLoop';
import { TradeOutcome } from '../types';
import { loadOpenTrades, writeTrade_Close, loadStats, writeStats_Update, loadAllTrades } from './botTradeService';
import { setVirtualBalanceValue } from './virtualBalanceService';
import { parseSymbol } from './stockPriceFeed';

// Extract IST helper locally if not exported, but we need it.
function getISTDateString(ms: number): string {
  return new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface ProxyConfig {
  name: string;
  wrap: (url: string) => string;
  extract: (res: Response) => Promise<string>;
}

const PROXY_CHAIN: ProxyConfig[] = [
  {
    name: 'allorigins_raw',
    wrap: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    extract: (res) => res.text(),
  },
  {
    name: 'codetabs',
    wrap: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    extract: (res) => res.text(),
  },
  {
    name: 'allorigins_get',
    wrap: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    extract: async (res) => {
      const data = await res.json();
      return data.contents ?? '';
    },
  }
];

function todayIST(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isAfterMarketClose(): boolean {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() > 15 || (ist.getUTCHours() === 15 && ist.getUTCMinutes() >= 30);
}

export async function fetchDailyOHLC(
  symbol: string,
  dateIST: string
): Promise<{ open: number; high: number; low: number; close: number } | null> {
  const { yahoo } = parseSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=1d&range=5d`;

  let lastError = '';
  for (const proxy of PROXY_CHAIN) {
    try {
      const res = await fetch(proxy.wrap(url), { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const rawText = await proxy.extract(res);
      const data = JSON.parse(rawText);
      const result = data?.chart?.result?.[0];
      if (!result) continue;

      const timestamps = result.timestamp || [];
      const quote = result.indicators?.quote?.[0] || {};
      
      const dateMatches = (ts: number) =>
        new Date(ts * 1000 + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10) === dateIST;

      for (let i = timestamps.length - 1; i >= 0; i--) {
        if (dateMatches(timestamps[i])) {
          if (quote.close[i] != null) {
            return {
              open: quote.open[i] ?? quote.close[i],
              high: quote.high[i] ?? quote.close[i],
              low: quote.low[i] ?? quote.close[i],
              close: quote.close[i],
            };
          }
        }
      }
    } catch (err: any) {
      lastError = err.message;
    }
  }

  // Backup plan using fetchLivePrice for today's fallback
  if (dateIST === todayIST()) {
    try {
      const { fetchLivePrice } = await import('./stockPriceFeed');
      const live = await fetchLivePrice(symbol);
      if (live && live.price) {
         return {
           open: live.previousClose ?? live.price,
           high: live.dayHigh ?? live.price,
           low: live.dayLow ?? live.price,
           close: live.price
         };
      }
    } catch {}
  }

  return null;
}

export async function determineEODOutcome(
  trade: BotTradeRecord,
  ohlc: { open: number; high: number; low: number; close: number }
): Promise<{ exitPrice: number; outcome: TradeOutcome; isAmbiguous: boolean }> {
  const tp = trade.plan?.takeProfit2 ?? (trade.entryPrice * 1.01);
  const sl = trade.plan?.stopLoss ?? (trade.entryPrice * 0.99);

  // Best effort: Get 1m intraday data via backend
  try {
    const { fetchTimeSeries } = await import('./stockPriceFeed');
    const history = await fetchTimeSeries(trade.symbol, 1, 1500);

    if (Array.isArray(history) && history.length > 0) {
      let validSimulations = 0;
      for (const candle of history) {
        const tsMillis = candle.timestamp || Date.now();
        if (tsMillis + 60000 > trade.openedAt) {
          const o = candle.open;
          const h = candle.high;
          const l = candle.low;
          const c = candle.close;
          
          validSimulations++;
          
          const hitSL = l <= sl;
          const hitTP = h >= tp;

          if (hitSL && hitTP) {
            const distToSL = Math.abs(o - sl);
            const distToTP = Math.abs(tp - o);
            if (distToSL <= distToTP) {
               return { exitPrice: sl, outcome: 'SL_HIT', isAmbiguous: false };
            } else {
               return { exitPrice: tp, outcome: 'TP2_HIT', isAmbiguous: false };
            }
          } else if (hitSL) {
            return { exitPrice: sl, outcome: 'SL_HIT', isAmbiguous: false };
          } else if (hitTP) {
            return { exitPrice: tp, outcome: 'TP2_HIT', isAmbiguous: false };
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
      }

      if (validSimulations > 0) {
         return { exitPrice: ohlc.close, outcome: 'TIME_EXIT', isAmbiguous: false };
      }
    }
  } catch (err) {
    console.error("fetch intraday error:", err);
  }

  // Fallback to purely daily OHLC (isAmbiguous if both hit, because we don't know which came first without intraday)
  // BUT we also restrict the Daily High / Daily Low conceptually because we only care about AFTER order was placed.
  // Since we don't have intraday to prove it, we just use the daily OHLC as best-effort.
  const tpHit = ohlc.high >= tp;
  const slHit = ohlc.low <= sl;

  if (tpHit && slHit) {
    return { exitPrice: ohlc.close, outcome: 'TIME_EXIT', isAmbiguous: true };
  }
  if (tpHit) {
    return { exitPrice: tp, outcome: 'TP2_HIT', isAmbiguous: false };
  }
  if (slHit) {
    return { exitPrice: sl, outcome: 'SL_HIT', isAmbiguous: false };
  }
  return { exitPrice: ohlc.close, outcome: 'TIME_EXIT', isAmbiguous: false };
}

export async function settleEODTrades(uid: string): Promise<{
  settled: number;
  skipped: number;
  totalNetPnL: number;
  errors: string[];
  ambiguous: number;
  details: { symbol: string; pnl: number; outcome: string }[];
}> {
  const todayStr = todayIST();
  const lockKey = `eod_settled_${uid}_${todayStr}`;
  // For sandbox testing in this paper portfolio, we allow multiple manual settlements on the same calendar day.
  // This lets the user launch new bots and settle their trades repeatedly.
  
  const openTrades = await loadOpenTrades(uid);
  if (openTrades.length === 0) {
    return { settled: 0, skipped: 0, totalNetPnL: 0, errors: [], ambiguous: 0, details: [] };
  }

  let netPnLSum = 0;
  let returnedCapitalSum = 0;
  let settled = 0;
  let skipped = 0;
  let ambiguous = 0;
  const errors: string[] = [];
  const details: { symbol: string; pnl: number; outcome: string }[] = [];

  const settlePromises = openTrades.map(async (trade) => {
    try {
      const tradeDateStr = new Date(trade.openedAt + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const ohlc = await fetchDailyOHLC(trade.symbol, tradeDateStr);
      if (!ohlc) {
        return { success: false, error: `${trade.symbol}: OHLC fetch failed for date ${tradeDateStr}`, symbol: trade.symbol };
      }

      const { exitPrice, outcome, isAmbiguous } = await determineEODOutcome(trade, ohlc);

      const closedTrade: BotTradeRecord = {
        ...trade,
        outcome,
        exitPrice,
        closedAt: Date.now(),
      };

      const invested = trade.plan?.investmentRupees ?? ((trade.plan?.positionSize || 1) * trade.entryPrice);
      const estCharges = trade.plan?.brokerCharges ?? 0;
      const result = await writeTrade_Close(
        uid,
        closedTrade,
        exitPrice,
        invested
      );

      return { success: true, result, invested, estCharges, isAmbiguous, symbol: trade.symbol, outcome };
    } catch (err: any) {
      return { success: false, error: `${trade.symbol}: ${err?.message ?? 'Unknown error'}`, symbol: trade.symbol };
    }
  });

  const results = await Promise.all(settlePromises);

  for (const res of results) {
    if (res.success) {
      netPnLSum += res.result!.realizedPnL;
      returnedCapitalSum += (res.invested! + res.estCharges! + res.result!.realizedPnL);
      settled++;
      if (res.isAmbiguous) ambiguous++;
      details.push({ symbol: res.symbol!, pnl: res.result!.realizedPnL, outcome: res.outcome! });
    } else {
      errors.push(res.error!);
      skipped++;
    }
  }

  if (settled > 0) {
    try {
      const balSnap = await getDoc(doc(db, 'tradeBot', uid, 'balance', 'current'));
      const currentBalance = balSnap.exists() ? (balSnap.data().balance ?? 100000) : 100000;
      const newBalance = parseFloat((currentBalance + returnedCapitalSum).toFixed(2));
      await setVirtualBalanceValue(uid, newBalance);

      // Update global session stats
      let currentStats = await loadStats(uid) || {
        totalTrades: 0, totalWins: 0, totalLosses: 0,
        winRate: 0, totalPnL: 0, avgRMultiple: 0,
        bestTrade: 0, worstTrade: 0, currentStreak: 0,
      };

      for (const res of results) {
        if (res.success) {
          const pnl = res.result!.realizedPnL;
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
      }
      
      // Calculate daily PnL from trades
      const allTrades = await loadAllTrades(uid);
      const todayStr = getISTDateString(Date.now());
      const todayPnL = allTrades
        .filter(t => t.exitPrice != null && getISTDateString(t.closedAt ?? t.openedAt) === todayStr)
        .reduce((sum, t) => sum + (t.realizedPnL ?? 0), 0);

      await writeStats_Update(uid, currentStats, todayPnL);

    } catch (err: any) {
      errors.push(`Update failed: ${err?.message ?? 'Unknown'}`);
    }
  }

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
    details,
  };
}
