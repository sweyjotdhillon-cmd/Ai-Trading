import { useState, useEffect, useRef, useCallback } from 'react';
import { OHLCV } from '../types';

const POLL_INTERVAL_MS   = 10_000;
const MAX_BUFFER_SIZE    = 60;
const MAX_FAILURES       = 3;
const STALE_THRESHOLD    = 5;
const API_TIMEOUT_MS     = 8_000;
const BASE_URL           = 'https://military-jobye-haiqstudios-14f59639.koyeb.app';

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

async function fetchCurrentPrice(symbol: string): Promise<number> {
  const url = `${BASE_URL}/stock?symbol=${encodeURIComponent(symbol)}&res=num`;
  const res = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const price = Number(data.current_price);
  if (!isFinite(price) || price <= 0) throw new Error('Invalid price');
  return price;
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
    if (stored.length > 0) {
      setOhlcvBuffer(stored);
      setIsLoading(false);
    }
  }, [symbol, timeframeMinutes]);

  // ── Core tick handler ──────────────────────────────────────────────────────
  const tick = useCallback(async () => {
    if (!symbol) return;

    const nowMs = Date.now();
    setMarketOpen(isMarketOpen(nowMs));

    try {
      const price = await fetchCurrentPrice(symbol);

      // Staleness check — only during market hours
      if (isMarketOpen(nowMs)) {
        if (price === lastPriceRef.current) {
          staleTicks.current += 1;
          if (staleTicks.current >= STALE_THRESHOLD) setIsStale(true);
        } else {
          staleTicks.current = 0;
          setIsStale(false);
        }
      }
      lastPriceRef.current = price;

      // Reset failure state
      failureCount.current = 0;
      setConsecutiveFailures(0);
      setError(null);
      setIsLoading(false);
      setCurrentPrice(price);
      setLastUpdated(nowMs);

      // Candle building
      const { next, completed } = tickLiveCandle(
        liveCandleRef.current,
        price,
        nowMs,
        timeframeMs
      );
      liveCandleRef.current = next;

      // Expose current forming candle for UI
      setCurrentCandle({
        open:   next.open,
        high:   next.high,
        low:    next.low,
        close:  next.close,
        volume: 0,
      });

      // If a candle completed, push to buffer
      if (completed) {
        setOhlcvBuffer(prev => {
          const updated = [...prev, completed];
          const capped  = updated.length > MAX_BUFFER_SIZE
            ? updated.slice(updated.length - MAX_BUFFER_SIZE)
            : updated;
          saveBuffer(symbol, timeframeMinutes, capped);
          return capped;
        });
      }

    } catch (err: any) {
      failureCount.current += 1;
      setConsecutiveFailures(failureCount.current);
      if (failureCount.current >= MAX_FAILURES) {
        setError(`Feed unavailable (${failureCount.current} failures): ${err.message}`);
      }
      // Do NOT clear currentPrice — position watcher must keep running
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
