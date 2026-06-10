import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { BotTradeRecord } from '../hooks/useBotLoop';
import { TradeOutcome } from '../types';
import { loadTodayTrades, writeTrade_Close } from './botTradeService';
import { setVirtualBalanceValue } from './virtualBalanceService';
import { parseSymbol } from './stockPriceFeed';

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
  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?interval=1d&range=5d&includePrePost=false`;

  for (const proxy of PROXY_CHAIN) {
    try {
      const proxyUrl = proxy.wrap(targetUrl);
      const res = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(12000),
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        continue;
      }

      const text = await proxy.extract(res);
      if (!text) {
        continue;
      }

      const json = JSON.parse(text);
      const result = json?.chart?.result?.[0];
      if (!result) {
        continue;
      }

      const timestamps: number[] = result.timestamp ?? [];
      const quote = result.indicators?.quote?.[0];

      if (quote && timestamps.length > 0) {
        const opens = quote.open as (number | null)[];
        const highs = quote.high as (number | null)[];
        const lows = quote.low as (number | null)[];
        const closes = quote.close as (number | null)[];

        const dateMatches = (ts: number) =>
          new Date((ts * 1000) + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10) === dateIST;

        for (let j = 0; j < timestamps.length; j++) {
          const o = opens[j];
          const h = highs[j];
          const l = lows[j];
          const c = closes[j];

          if (o == null || h == null || l == null || c == null) {
            continue;
          }
          if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) {
            continue;
          }
          if (o <= 0 || h <= 0 || l <= 0 || c <= 0) {
            continue;
          }

          if (dateMatches(timestamps[j])) {
            return {
              open: Number(o.toFixed(2)),
              high: Number(h.toFixed(2)),
              low: Number(l.toFixed(2)),
              close: Number(c.toFixed(2)),
            };
          }
        }
      }

      // Meta fallback — only if no candle matched but it IS today's date AND isAfterMarketClose()
      if (result.meta && dateIST === todayIST() && isAfterMarketClose()) {
        const meta = result.meta;
        const h = Number(meta.regularMarketDayHigh);
        const l = Number(meta.regularMarketDayLow);
        const o = Number(meta.chartPreviousClose);
        const c = Number(meta.regularMarketPrice);
        if (isFinite(h) && isFinite(l) && isFinite(o) && isFinite(c) && h > 0 && l > 0 && o > 0 && c > 0) {
          return { open: o, high: h, low: l, close: c };
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function determineEODOutcome(
  trade: BotTradeRecord,
  ohlc: { open: number; high: number; low: number; close: number }
): { exitPrice: number; outcome: TradeOutcome; isAmbiguous: boolean } {
  const tp = trade.plan.takeProfit2;
  const sl = trade.plan.stopLoss;
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
}> {
  const todayStr = todayIST();
  const lockKey = `eod_settled_${uid}_${todayStr}`;
  try {
    if (sessionStorage.getItem(lockKey)) {
      return { settled: 0, skipped: 0, totalNetPnL: 0, errors: ['Already settled this session'], ambiguous: 0 };
    }
  } catch {
    // sessionStorage unavailable — proceed
  }

  const allTodayTrades = await loadTodayTrades(uid);
  const openTrades = allTodayTrades.filter(t => t.exitPrice === null);
  if (openTrades.length === 0) {
    return { settled: 0, skipped: 0, totalNetPnL: 0, errors: [], ambiguous: 0 };
  }

  let netPnLSum = 0;
  let settled = 0;
  let skipped = 0;
  let ambiguous = 0;
  const errors: string[] = [];

  for (const trade of openTrades) {
    try {
      const ohlc = await fetchDailyOHLC(trade.symbol, todayStr);
      if (!ohlc) {
        errors.push(`${trade.symbol}: OHLC fetch failed`);
        skipped++;
        continue;
      }

      const { exitPrice, outcome, isAmbiguous } = determineEODOutcome(trade, ohlc);
      if (isAmbiguous) {
        ambiguous++;
      }

      const closedTrade: BotTradeRecord = {
        ...trade,
        outcome,
        exitPrice,
        closedAt: Date.now(),
      };

      const result = await writeTrade_Close(
        uid,
        closedTrade,
        exitPrice,
        trade.plan.investmentRupees ?? (trade.plan.positionSize * trade.entryPrice)
      );

      netPnLSum += result.realizedPnL;
      settled++;
    } catch (err: any) {
      errors.push(`${trade.symbol}: ${err?.message ?? 'Unknown error'}`);
      skipped++;
    }
  }

  if (settled > 0) {
    try {
      const balSnap = await getDoc(doc(db, 'tradeBot', uid, 'balance', 'current'));
      const currentBalance = balSnap.exists() ? (balSnap.data().balance ?? 100000) : 100000;
      const newBalance = parseFloat((currentBalance + netPnLSum).toFixed(2));
      await setVirtualBalanceValue(uid, newBalance);
    } catch (err: any) {
      errors.push(`Balance update failed: ${err?.message ?? 'Unknown'}`);
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
  };
}
