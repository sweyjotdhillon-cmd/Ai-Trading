export interface HorizonContext {
  tfMinutes: number;
  durationMinutes: number;
  H: number;
  horizonClass: 'INTRA_CANDLE' | 'NEAR_FULL' | 'MULTI_CANDLE';
}

export function parseDurationToMinutes(s: string): number {
  if (!s || typeof s !== 'string') {
    console.warn(`parseDurationToMinutes: Invalid input "${s}", defaulting to 30`);
    return 30; // Default fallback
  }
  const match = s.trim().match(/^(\d+)(m|h|d)?$/i);
  if (!match) {
    console.warn(`parseDurationToMinutes: Failed to parse "${s}", defaulting to 5`);
    return 5;
  }
  const val = parseInt(match[1], 10);
  const unit = (match[2] || 'm').toLowerCase();
  if (unit === 'h') return val * 60;
  if (unit === 'd') return val * 1440;
  return val;
}

// R4: Per-pattern weight table depending on horizonClass.
// Rationale: Reversal patterns (Doji, Hammer) signal a change in the *next* full candle.
// For INTRA_CANDLE expiries, the current candle is still forming, making reversals less reliable.
// Continuation patterns (Engulfing, Marubozu) indicate strong immediate momentum, which is useful for INTRA_CANDLE.
// Reference: ATR-enhanced pattern recognition & candlestick reliability studies.
export const PATTERN_WEIGHTS_BY_HORIZON = {
  CONTINUATION: {
    INTRA_CANDLE: 0.7,
    NEAR_FULL: 0.7,
    MULTI_CANDLE: 0.5
  },
  REVERSAL: {
    INTRA_CANDLE: 0.25,
    NEAR_FULL: 0.25,
    MULTI_CANDLE: 0.5
  }
};

// R5: Hurst-flavored J1/J3 balancer using R/S method
// Reference: Macrosynergy Hurst study
export function rescaledRangeHurst(closes: number[]): number {
  if (closes.length < 16) return NaN;

  // Calculate log returns
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

  // Calculate mean adjusted series and cumulative deviate series
  let cumulative = 0;
  let maxDev = -Infinity;
  let minDev = Infinity;
  let sumSq = 0;

  for (let i = 0; i < returns.length; i++) {
    const dev = returns[i] - mean;
    sumSq += dev * dev;
    cumulative += dev;

    if (cumulative > maxDev) maxDev = cumulative;
    if (cumulative < minDev) minDev = cumulative;
  }

  const R = maxDev - minDev;
  const S = Math.sqrt(sumSq / returns.length);

  if (S === 0 || R === 0) return 0.5; // Neutral if no variance

  // R/S = c * N^H => log(R/S) = log(c) + H * log(N)
  // Simplified approximation for single period N
  const RS = R / S;
  const H = Math.log(RS) / Math.log(returns.length);

  return H;
}
