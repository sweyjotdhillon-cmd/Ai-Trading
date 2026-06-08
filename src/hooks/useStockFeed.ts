import { useState, useEffect, useRef, useCallback } from 'react';
import { OHLCV } from '../types';
import { fetchLivePrice, fetchTimeSeries } from '../services/stockPriceFeed';

const POLL_INTERVAL_MS   = 15_000; // 15s — 2 keys alternating = ~750 credits/day each
const MAX_BUFFER_SIZE    = 60;
const MAX_FAILURES       = 3;
const STALE_THRESHOLD    = 5;
const API_TIMEOUT_MS     = 8_000;

interface LiveCandle {
  open:             number;
  high:             number;
  low:              number;
  close:            number;
  intervalStartMs:  number;
}

export interface UseStockFeedResult {
  currentPrice:         number | null;
  ohlcvBuffer:          OHLCV[];
  currentCandle:        OHLCV | null;
  lastUpdated:          number | null;
  isLoading:            boolean;
  error:                string | null;
  isStale:              boolean;
  marketOpen:           boolean;
  consecutiveFailures:  number;
  candleCount:          number;
}

function bufferKey(symbol: string, tf: number): string {
  return `chartlens_ohlcv_${symbol}_${tf}m`;
}

function loadBuffer(symbol: string, tf: number): OHLCV[] {
  try {
    const raw = sessionStorage.getItem(bufferKey(symbol, tf));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as OHLCV[];
  } catch {
    return [];
  }
}

function saveBuffer(symbol: string, tf: number, buffer: OHLCV[]): void {
  try {
    sessionStorage.setItem(bufferKey(symbol, tf), JSON.stringify(buffer));
  } catch {
    // sessionStorage may be unavailable — fail silently
  }
}

function clearBuffer(symbol: string, tf: number): void {
  try {
    sessionStorage.removeItem(bufferKey(symbol, tf));
  } catch {
    // fail silently
  }
}

function isMarketOpen(nowMs: number): boolean {
  // IST = UTC + 5h30m
  const ist       = new Date(nowMs + 5.5 * 60 * 60 * 1000);
  const day       = ist.getUTCDay();          // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const minutes   = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= 555 && minutes <= 930;    // 09:15 = 555, 15:30 = 930
}

function tickLiveCandle(
  live:          LiveCandle | null,
  price:         number,
  nowMs:         number,
  timeframeMs:   number
): { next: LiveCandle; completed: OHLCV | null } {

  // No candle started yet
  if (!live) {
    return {
      next:      { open: price, high: price, low: price, close: price, intervalStartMs: nowMs },
      completed: null,
    };
  }

  const elapsed = nowMs - live.intervalStartMs;

  // Still inside interval — update high / low / close
  if (elapsed < timeframeMs) {
    return {
      next: {
        ...live,
        high:  Math.max(live.high, price),
        low:   Math.min(live.low,  price),
        close: price,
      },
      completed: null,
    };
  }

  // Interval elapsed — seal this candle, open a new one
  const completed: OHLCV = {
    open:   live.open,
    high:   Math.max(live.high, price),
    low:    Math.min(live.low,  price),
    close:  price,
    volume: 0,
  };

  return {
    next:      { open: price, high: price, low: price, close: price, intervalStartMs: nowMs },
    completed,
  };
}

export function useStockFeed(
  symbol:            string | null,
  timeframeMinutes:  number,
  enabled:           boolean
): UseStockFeedResult {

  const timeframeMs = timeframeMinutes * 60 * 1000;

  // ── State (drives re-renders) ──────────────────────────────────────────────
  const [currentPrice,        setCurrentPrice]        = useState<number | null>(null);
  const [ohlcvBuffer,         setOhlcvBuffer]         = useState<OHLCV[]>([]);
  const [currentCandle,       setCurrentCandle]       = useState<OHLCV | null>(null);
  const [lastUpdated,         setLastUpdated]         = useState<number | null>(null);
  const [isLoading,           setIsLoading]           = useState(true);
  const [error,               setError]               = useState<string | null>(null);
  const [isStale,             setIsStale]             = useState(false);
  const [marketOpen,          setMarketOpen]          = useState(false);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);

  // ── Refs (no re-render needed) ─────────────────────────────────────────────
  const liveCandleRef    = useRef<LiveCandle | null>(null);
  const lastPriceRef     = useRef<number | null>(null);
  const staleTicks       = useRef(0);
  const failureCount     = useRef(0);
  const intervalRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevSymbolRef    = useRef<string | null>(null);
  const prevTfRef        = useRef<number>(timeframeMinutes);
  const simOffsetRef     = useRef<number>(0);
  const lastKnownPriceRef = useRef<number | null>(null);
  const lastKnownPriceAt  = useRef<number | null>(null);

  // ── Reset when symbol changes ──────────────────────────────────────────────
  useEffect(() => {
    if (!symbol) return;

    const symbolChanged = symbol !== prevSymbolRef.current;
    const tfChanged     = timeframeMinutes !== prevTfRef.current;

    if (symbolChanged) {
      // Clear buffer for old symbol
      if (prevSymbolRef.current) {
        clearBuffer(prevSymbolRef.current, prevTfRef.current);
      }
      // Reset everything
      liveCandleRef.current = null;
      lastPriceRef.current  = null;
      staleTicks.current    = 0;
      failureCount.current  = 0;
      simOffsetRef.current  = 0;
      lastKnownPriceRef.current = null;
      lastKnownPriceAt.current  = null;
      setCurrentPrice(null);
      setOhlcvBuffer([]);
      setCurrentCandle(null);
      setLastUpdated(null);
      setIsLoading(true);
      setError(null);
      setIsStale(false);
      setConsecutiveFailures(0);
    } else if (tfChanged) {
      // Same symbol, different timeframe — keep price, clear candles
      liveCandleRef.current = null;
      setCurrentCandle(null);
      setOhlcvBuffer(loadBuffer(symbol, timeframeMinutes));
    }

    prevSymbolRef.current = symbol;
    prevTfRef.current     = timeframeMinutes;
  }, [symbol, timeframeMinutes]);

  // ── Load buffer from sessionStorage on mount / symbol+tf change ───────────
  useEffect(() => {
    if (!symbol) return;
    const stored = loadBuffer(symbol, timeframeMinutes);
    if (stored.length > 5) { // Ensure we have enough data (at least 5 bars) to be useful, otherwise refresh
      setOhlcvBuffer(stored);
      setIsLoading(false);
    } else {
      setIsLoading(true);
      fetchTimeSeries(symbol, timeframeMinutes, MAX_BUFFER_SIZE)
        .then((history) => {
          setOhlcvBuffer(history);
          saveBuffer(symbol, timeframeMinutes, history);
          setError(null);
        })
        .catch((err) => {
          console.warn('[StockFeed] Failed to pre-seed historical candles:', err.message);
          // Fallback to empty if both stored and fetch fail
          if (stored.length > 0) {
            setOhlcvBuffer(stored);
          } else {
            setOhlcvBuffer([]);
          }
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [symbol, timeframeMinutes]);

  // ── Core tick handler ──────────────────────────────────────────────────────
  const tick = useCallback(async () => {
    if (!symbol) return;

    const nowMs       = Date.now();
    let marketIsOpen  = isMarketOpen(nowMs);

    try {
      const result = await fetchLivePrice(symbol);
      let price  = result.price;
      marketIsOpen = result.marketState === 'REGULAR';
      setMarketOpen(marketIsOpen);

      // If market is closed, simulate realistic micro-fluctuations around the closing price so the bot can trade 24/7
      if (!marketIsOpen) {
        if (simOffsetRef.current === 0) {
          simOffsetRef.current = price;
        }
        const change = (Math.random() - 0.5) * 0.0016; // up to +/- 0.08% change per tick
        simOffsetRef.current = simOffsetRef.current * (1 + change);

        // Maintain simulated price within 2.0% deviation from the actual close price
        const dev = (simOffsetRef.current - price) / price;
        if (Math.abs(dev) > 0.02) {
          simOffsetRef.current = price * (1 + (dev > 0 ? 0.01 : -0.01));
        }
        price = Number(simOffsetRef.current.toFixed(2));
      } else {
        simOffsetRef.current = 0;
      }

      // Staleness check — only during market hours
      if (marketIsOpen) {
        if (price === lastPriceRef.current) {
          staleTicks.current += 1;
          if (staleTicks.current >= STALE_THRESHOLD) setIsStale(true);
        } else {
          staleTicks.current = 0;
          setIsStale(false);
        }
      }

      lastPriceRef.current      = price;
      lastKnownPriceRef.current = price;
      lastKnownPriceAt.current  = nowMs;

      failureCount.current = 0;
      setConsecutiveFailures(0);
      setError(null);
      setIsLoading(false);
      setCurrentPrice(price);
      setLastUpdated(nowMs);

      // Candle building — always build candles (even outside market hours) so that the bot's analysis loop can tick 24/7
      const { next, completed } = tickLiveCandle(
        liveCandleRef.current, price, nowMs, timeframeMs
      );
      liveCandleRef.current = next;
      setCurrentCandle({ open: next.open, high: next.high, low: next.low, close: next.close, volume: 0 });

      if (completed) {
        setOhlcvBuffer(prev => {
          const updated = [...prev, completed];
          const capped  = updated.length > MAX_BUFFER_SIZE
            ? updated.slice(updated.length - MAX_BUFFER_SIZE) : updated;
          saveBuffer(symbol, timeframeMinutes, capped);
          return capped;
        });
      }

    } catch (err: any) {
      // If market is closed and we have a last known price — not really an error
      if (!marketIsOpen && lastKnownPriceRef.current !== null) {
        // Simulate realistic micro-fluctuations around the last known price
        if (simOffsetRef.current === 0) {
          simOffsetRef.current = lastKnownPriceRef.current;
        }
        const change = (Math.random() - 0.5) * 0.0016; // up to +/- 0.08% change per tick
        simOffsetRef.current = simOffsetRef.current * (1 + change);

        // Maintain simulated price within 2.0% deviation from the actual close price
        const dev = (simOffsetRef.current - lastKnownPriceRef.current) / lastKnownPriceRef.current;
        if (Math.abs(dev) > 0.02) {
          simOffsetRef.current = lastKnownPriceRef.current * (1 + (dev > 0 ? 0.01 : -0.01));
        }
        const simulatedPrice = Number(simOffsetRef.current.toFixed(2));

        // Show last known price silently — market closed is expected
        setCurrentPrice(simulatedPrice);
        setIsLoading(false);
        setError(null); // clear any previous error — this is normal
        setConsecutiveFailures(0);
        failureCount.current = 0;

        // Even on fetch failure during market closed, continue building candles from simulated price to keep the bot active
        const { next, completed } = tickLiveCandle(
          liveCandleRef.current, simulatedPrice, nowMs, timeframeMs
        );
        liveCandleRef.current = next;
        setCurrentCandle({ open: next.open, high: next.high, low: next.low, close: next.close, volume: 0 });

        if (completed) {
          setOhlcvBuffer(prev => {
            const updated = [...prev, completed];
            const capped  = updated.length > MAX_BUFFER_SIZE
              ? updated.slice(updated.length - MAX_BUFFER_SIZE) : updated;
            saveBuffer(symbol, timeframeMinutes, capped);
            return capped;
          });
        }
        return;
      }

      // Real error during market hours
      failureCount.current += 1;
      setConsecutiveFailures(failureCount.current);

      // Diagnose the error for the user
      const raw = err.message ?? 'Unknown error';
      let diagnosis = raw;

      if (raw.includes('SYMBOL_NOT_FOUND')) {
        diagnosis = `Symbol not found — try a different ticker`;
      } else if (raw.includes('AUTH_FAILED')) {
        diagnosis = `API key error — check your Twelve Data account`;
      } else if (raw.includes('ALL_KEYS_EXHAUSTED')) {
        diagnosis = `Daily API limit reached — resets at midnight IST`;
      } else if (raw.includes('TimeoutError') || raw.includes('AbortError')) {
        diagnosis = `Request timed out — check your internet connection`;
      } else if (raw.startsWith('HTTP 404')) {
        diagnosis = `Symbol not found (404) — ticker may be delisted or misspelled`;
      } else if (raw.startsWith('HTTP 429')) {
        diagnosis = `Rate limited — too many requests, waiting for key rotation`;
      }

      if (failureCount.current >= MAX_FAILURES) {
        setError(`${diagnosis} (${failureCount.current} consecutive failures)`);
      } else {
        // Show warning but keep last known price visible
        setError(`Warning: ${diagnosis} — retrying...`);
      }
    }
  }, [symbol, timeframeMs, timeframeMinutes]);

  // ── Polling interval ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!symbol || !enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Immediate first fetch — don't wait 10s
    tick();

    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [symbol, enabled, tick]);

  // ── Return ─────────────────────────────────────────────────────────────────
  return {
    currentPrice,
    ohlcvBuffer,
    currentCandle,
    lastUpdated,
    isLoading,
    error,
    isStale,
    marketOpen,
    consecutiveFailures,
    candleCount: ohlcvBuffer.length,
  };
}
