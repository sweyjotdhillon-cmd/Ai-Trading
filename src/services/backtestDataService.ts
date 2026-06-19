import { OHLCV } from '../types';
import { parseSymbol } from './stockPriceFeed';
import { getISTMinutes } from '../utils/istUtils';

const MARKET_OPEN_IST_MINUTES  = 9 * 60 + 15;  // 555
const MARKET_CLOSE_IST_MINUTES = 15 * 60 + 30; // 930

/**
 * Fetches the maximum available 5-minute candle history for a symbol from
 * Yahoo Finance, for backtesting purposes only.
 *
 * Unlike fetchTimeSeries in stockPriceFeed.ts, this function:
 *  - Requests the full 60-day range Yahoo Finance allows for 5m candles
 *    (fetchTimeSeries hardcodes a 2-day range for 5m, which is too small
 *    for backtesting).
 *  - NEVER falls back to simulated/fake candles. If every proxy fails,
 *    it throws so the caller can show a clear error to the user.
 *  - Filters the result down to NSE/BSE market hours (09:15–15:30 IST)
 *    before returning, since pre/post-market candles are not tradeable
 *    signal windows for this strategy.
 */
export async function fetchBacktestHistory(symbol: string): Promise<OHLCV[]> {
  const { yahoo } = parseSymbol(symbol);

  const targetUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}` +
    `?interval=5m&range=60d&includePrePost=false`;

  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
  ];

  type ProxyDiagnostic = {
    index: number;
    proxyUrl: string;
    targetUrl: string;
    status: number | "no response";
    responseBody: string | null;
    error: string | null;
  };

  const proxyErrors: string[] = [];
  const diagnostics: ProxyDiagnostic[] = [];

  for (let i = 0; i < proxies.length; i++) {
    const diagnostic: ProxyDiagnostic = {
      index: i,
      proxyUrl: proxies[i],
      targetUrl,
      status: "no response",
      responseBody: null,
      error: null,
    };

    try {
      const res = await fetch(proxies[i], {
        signal: AbortSignal.timeout(20000),
        headers: { Accept: 'application/json' },
      });

      diagnostic.status = res.status;

      let text = '';
      try {
        text = await res.text();
        diagnostic.responseBody = text.substring(0, 500);
      } catch (textErr: any) {
        diagnostic.responseBody = `<failed to read body: ${textErr.message}>`;
      }

      if (!res.ok) {
        diagnostic.error = `HTTP Error ${res.status}`;
        diagnostics.push(diagnostic);
        proxyErrors.push(`proxy ${i} (${res.status})`);
        continue;
      }

      if (i === 2) {
        try {
          text = JSON.parse(text).contents ?? text;
        } catch (e: any) {
          diagnostic.error = `contents unwrap failed: ${e.message}`;
          diagnostics.push(diagnostic);
          proxyErrors.push(`proxy ${i} (contents unwrap failed)`);
          continue;
        }
      }

      const json   = JSON.parse(text);
      const result = json?.chart?.result?.[0];
      if (!result) {
        diagnostic.error = `no chart result`;
        diagnostics.push(diagnostic);
        proxyErrors.push(`proxy ${i} (no chart result)`);
        continue;
      }

      const timestamps: number[] = result.timestamp ?? [];
      const quote = result.indicators?.quote?.[0];
      if (!quote || timestamps.length === 0) {
        diagnostic.error = `empty quote data`;
        diagnostics.push(diagnostic);
        proxyErrors.push(`proxy ${i} (empty quote data)`);
        continue;
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
        diagnostic.error = `zero valid market-hours candles`;
        diagnostics.push(diagnostic);
        proxyErrors.push(`proxy ${i} (zero valid market-hours candles)`);
        continue;
      }

      candles.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      return candles;

    } catch (err: any) {
      diagnostic.error = err ? `${err.name || 'Error'}: ${err.message}` : String(err);
      diagnostics.push(diagnostic);
      proxyErrors.push(`proxy ${i} (${err.message})`);
    }
  }

  const diagnosticsStr = diagnostics.map(d => 
    `\n[Proxy ${d.index}]` +
    `\n  Proxy URL: ${d.proxyUrl}` +
    `\n  Target URL: ${d.targetUrl}` +
    `\n  Status: ${d.status}` +
    `\n  Error: ${d.error || 'None'}` +
    `\n  Response Body: ${d.responseBody ? d.responseBody.replace(/\r?\n|\r/g, '') : 'None'}`
  ).join('\n');

  throw new Error(
    `Failed to fetch backtest history for ${symbol} from Yahoo Finance. ` +
    `All proxies failed: ${proxyErrors.join('; ')}. ` +
    `No simulated data was generated — try again or pick a different symbol.\n\nDiagnostics Detail:${diagnosticsStr}`
  );
}
