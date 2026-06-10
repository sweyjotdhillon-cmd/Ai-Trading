import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { parseSymbol } from './stockPriceFeed';
import { BotTradeRecord, TradeOutcome } from '../hooks/useBotLoop';
import { loadOpenTrades, writeTrade_Close } from './botTradeService';
import { setVirtualBalanceValue } from './virtualBalanceService';

// ── Helpers ──────────────────────────────────────────────────────────────

function todayIST(): string {
  const offset = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + offset).toISOString().slice(0, 10);
}

function isTodayAndAfterMarketClose(dateIST: string): boolean {
  const now = Date.now();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now + istOffset);
  const currentTodayIST = istDate.toISOString().slice(0, 10);
  if (currentTodayIST !== dateIST) return false;

  const hours = istDate.getUTCHours(); // IST hour (since offset is added)
  const minutes = istDate.getUTCMinutes(); // IST minute

  if (hours > 15 || (hours === 15 && minutes >= 30)) {
    return true;
  }
  return false;
}

// ── CORS proxy chain ──────────────────────────────────────────────────────────

interface ProxyConfig {
  name:     string;
  wrap:     (url: string) => string;
  extract:  (res: Response) => Promise<string>;
}

const PROXY_CHAIN: ProxyConfig[] = [
  {
    name:    'allorigins',
    wrap:    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    extract: async (res) => res.text(),
  },
  {
    name:    'codetabs',
    wrap:    (url) => `https://api.allorigins.win/v1/proxy?quest=${encodeURIComponent(url)}`,
    extract: async (res) => res.text(),
  },
  {
    name:    'jsonp-afeld',
    wrap:    (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    extract: async (res) => {
      const json = await res.json();
      return json.contents ?? '';
    },
  },
];

// ── API Functions ────────────────────────────────────────────────────────────

/**
 * Fetches daily OHLC candle data for a symbol on a specific date in IST (YYYY-MM-DD).
 */
export async function fetchDailyOHLC(
  symbol: string,
  dateIST: string
): Promise<{ open: number; high: number; low: number; close: number } | null> {
  // Try 1: Local Server-Side Proxy history
  try {
    const res = await fetch('/api/stock/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, timeframeMinutes: 1440, outputsize: 5 }),
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const candles = await res.json();
      if (Array.isArray(candles)) {
        for (const candle of candles) {
          if (candle && candle.timestamp) {
            const timestampMs = candle.timestamp < 1e11 ? candle.timestamp * 1000 : candle.timestamp;
            const istStr = new Date(timestampMs + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
            if (istStr === dateIST) {
              return {
                open: Number(candle.open),
                high: Number(candle.high),
                low: Number(candle.low),
                close: Number(candle.close),
              };
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[eodSettlementService] fetchDailyOHLC local-server failed, fallback to Yahoo:', err.message);
  }

  // Try 2: Yahoo Finance directly via CORS Proxy Chain
  const { yahoo } = parseSymbol(symbol);
  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?interval=1d&range=5d&includePrePost=false`;

  for (const proxy of PROXY_CHAIN) {
    try {
      const proxyUrl = proxy.wrap(targetUrl);
      const res = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(12000),
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) continue;

      let text = await proxy.extract(res);
      const json = JSON.parse(text);
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const timestamps: number[] = result.timestamp ?? [];
      const quote = result.indicators?.quote?.[0];

      if (quote && timestamps.length > 0) {
        const opens = quote.open as (number | null)[];
        const highs = quote.high as (number | null)[];
        const lows = quote.low as (number | null)[];
        const closes = quote.close as (number | null)[];

        for (let j = 0; j < timestamps.length; j++) {
          const o = opens[j];
          const h = highs[j];
          const l = lows[j];
          const c = closes[j];

          if (o == null || h == null || l == null || c == null) continue;
          if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
          if (c <= 0) continue;

          const timestampMs = timestamps[j] * 1000;
          const istStr = new Date(timestampMs + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
          if (istStr === dateIST) {
            return {
              open: Number(o.toFixed(2)),
              high: Number(h.toFixed(2)),
              low: Number(l.toFixed(2)),
              close: Number(c.toFixed(2)),
            };
          }
        }
      }

      // Try 3: Failsafe / EOD Meta fallback
      if (result.meta && isTodayAndAfterMarketClose(dateIST)) {
        const meta = result.meta;
        const high = Number(meta.regularMarketDayHigh);
        const low = Number(meta.regularMarketDayLow);
        const open = Number(meta.chartPreviousClose ?? meta.previousClose);
        const close = Number(meta.regularMarketPrice);
        if (high > 0 && low > 0 && open > 0 && close > 0) {
          return { open, high, low, close };
        }
      }

    } catch (err: any) {
      console.warn(`[eodSettlementService] fetchDailyOHLC proxy (${proxy.name}) failed:`, err.message);
    }
  }

  return null;
}

/**
 * Pure function to determine EOD trade outcome and exit price.
 */
export function determineEODOutcome(
  trade: BotTradeRecord,
  ohlc: { open: number; high: number; low: number; close: number }
): { exitPrice: number; outcome: TradeOutcome; isAmbiguous: boolean } {
  const { high, low, close } = ohlc;
  const tp = trade.plan.takeProfit2;
  const sl = trade.plan.stopLoss;

  const tpHit = high >= tp;
  const slHit = low <= sl;

  if (tpHit && slHit) {
    // Ambiguous: both TP2 and SL were touched on the same day.
    // Failsafe is to exit at the daily close price with TIME_EXIT outcome.
    return { exitPrice: close, outcome: 'TIME_EXIT', isAmbiguous: true };
  }
  if (tpHit) {
    return { exitPrice: tp, outcome: 'TP2_HIT', isAmbiguous: false };
  }
  if (slHit) {
    return { exitPrice: sl, outcome: 'SL_HIT', isAmbiguous: false };
  }
  // Neither level hit; exit intraday position at market close price.
  return { exitPrice: close, outcome: 'TIME_EXIT', isAmbiguous: false };
}

/**
 * Main settlement pipeline. Processes all open trades opened today, determines outcomes,
 * updates firestore docs, and executes a single atomic session balance update.
 */
export async function settleEODTrades(uid: string): Promise<{
  settled: number;
  skipped: number;
  totalNetPnL: number;
  errors: string[];
  ambiguous: number;
}> {
  const errors: string[] = [];
  const todayStr = todayIST();

  // 1. Fetch current open trades
  let openTrades: BotTradeRecord[] = [];
  try {
    openTrades = await loadOpenTrades(uid);
  } catch (err: any) {
    errors.push(`Failed to load open trades: ${err?.message || err}`);
    return { settled: 0, skipped: 0, totalNetPnL: 0, errors, ambiguous: 0 };
  }

  // 2. Filter trades opened today (IST)
  const todayTrades = openTrades.filter(t => {
    const tDate = new Date(t.openedAt + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return tDate === todayStr;
  });

  if (todayTrades.length === 0) {
    return { settled: 0, skipped: 0, totalNetPnL: 0, errors, ambiguous: 0 };
  }

  // 3. Idempotency Lock Check
  const lockKey = `eod_settled_${uid}_${todayStr}`;
  if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(lockKey)) {
    return {
      settled: 0,
      skipped: 0,
      totalNetPnL: 0,
      errors: ['Already settled this session'],
      ambiguous: 0,
    };
  }

  let settledCount = 0;
  let skippedCount = 0;
  let ambiguousCount = 0;
  let netPnLSum = 0;

  // 4. Process each trade sequentially
  for (const trade of todayTrades) {
    try {
      const ohlc = await fetchDailyOHLC(trade.symbol, todayStr);
      if (!ohlc) {
        errors.push(`Could not fetch stock history/live price data for ${trade.symbol}`);
        skippedCount++;
        continue;
      }

      const { exitPrice, outcome, isAmbiguous } = determineEODOutcome(trade, ohlc);

      const closedTrade: BotTradeRecord = {
        ...trade,
        exitPrice,
        outcome,
        closedAt: Date.now(),
      };

      const result = await writeTrade_Close(
        uid,
        closedTrade,
        exitPrice,
        trade.plan.investmentRupees ?? trade.entryPrice * trade.plan.positionSize
      );

      netPnLSum += result.realizedPnL;
      settledCount++;
      if (isAmbiguous) {
        ambiguousCount++;
      }
    } catch (err: any) {
      errors.push(`Failed to close trade ${trade.id} (${trade.symbol}): ${err?.message || err}`);
      skippedCount++;
    }
  }

  // 5. Update Virtual Balance atomically in a single write operation if anything settled
  if (settledCount > 0) {
    try {
      const balanceDocRef = doc(db, 'tradeBot', uid, 'balance', 'current');
      const balanceSnap = await getDoc(balanceDocRef);
      const currentBalance = balanceSnap.exists()
        ? Number(balanceSnap.data()?.balance ?? 100000)
        : 100000;

      const newBalance = parseFloat((currentBalance + netPnLSum).toFixed(2));
      await setVirtualBalanceValue(uid, newBalance);
    } catch (err: any) {
      errors.push(`Failed to update virtual balance: ${err?.message || err}`);
    }
  }

  // 6. Set sessionStorage lock upon completion
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(lockKey, '1');
    } catch (err) {
      // Ignore sessionStorage blockages
    }
  }

  return {
    settled: settledCount,
    skipped: skippedCount,
    totalNetPnL: parseFloat(netPnLSum.toFixed(2)),
    errors,
    ambiguous: ambiguousCount,
  };
}
