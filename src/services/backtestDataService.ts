import { OHLCV } from '../types';
import { parseSymbol } from './stockPriceFeed';
import { getISTMinutes } from '../utils/istUtils';

const MARKET_OPEN_IST_MINUTES  = 9 * 60 + 15;  // 555
const MARKET_CLOSE_IST_MINUTES = 15 * 60 + 30; // 930

/**
 * Fetches 5-minute candle history for a symbol from bundled static JSON files
 * under public/backtest-data/, for backtesting purposes only. Data freshness
 * depends on when those static files were last refreshed.
 *
 * Unlike fetchTimeSeries in stockPriceFeed.ts, this function:
 *  - Reads the full historical range statically packaged with the app.
 *  - NEVER falls back to simulated/fake candles or live fetching. If the file
 *    is missing, it throws a clear error.
 *  - Filters the result down to NSE/BSE market hours (09:15–15:30 IST)
 *    before returning, since pre/post-market candles are not tradeable
 *    signal windows for this strategy.
 */
export async function fetchBacktestHistory(symbol: string): Promise<OHLCV[]> {
  const { ticker } = parseSymbol(symbol);

  const response = await fetch(`/backtest-data/${ticker}.json`);
  if (!response.ok) {
    throw new Error(`No bundled historical data found for ${ticker}. Static backtest data is only available for the 10 locked tickers. If this ticker should have data, add public/backtest-data/${ticker}.json.`);
  }

  const text = await response.text();
  const json = JSON.parse(text);
  const result = json?.chart?.result?.[0];
  if (!result) {
    throw new Error(`No chart result found for ${ticker}`);
  }

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) {
    throw new Error(`Empty quote data for ${ticker}`);
  }

  const opens   = quote.open   as (number | null)[];
  const highs   = quote.high   as (number | null)[];
  const lows    = quote.low    as (number | null)[];
  const closes  = quote.close  as (number | null)[];
  const volumes = quote.volume as (number | null)[];

  const candles: OHLCV[] = [];
  for (let j = 0; j < timestamps.length; j++) {
    const o = opens[j], h = highs[j], l = lows[j], c = closes[j];
    if (o == null || h == null || l == null || c == null) continue;
    if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    if (c <= 0) continue;

    const timestampMs = timestamps[j] * 1000;
    const istMinutes = getISTMinutes(timestampMs);
    if (istMinutes < MARKET_OPEN_IST_MINUTES || istMinutes > MARKET_CLOSE_IST_MINUTES) {
      continue;
    }

    candles.push({
      open:   Number(o.toFixed(2)),
      high:   Number(h.toFixed(2)),
      low:    Number(l.toFixed(2)),
      close:  Number(c.toFixed(2)),
      volume: Number(volumes?.[j] ?? 0),
      timestamp: timestampMs,
    });
  }

  if (candles.length === 0) {
    throw new Error(`Bundled data for ${ticker} contained zero valid market-hours candles after filtering.`);
  }

  candles.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  return candles;
}
