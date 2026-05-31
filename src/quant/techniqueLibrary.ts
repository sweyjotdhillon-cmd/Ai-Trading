import { NumericOHLC } from '../vision/pipeline';
import { IndicatorCache } from './techniqueShardEngine';
import { rsi, stochastic, macd, atr, bollinger, ema, sma } from './indicators';
import { emaSlope, emaCurvature } from './calculus';
import {
  isHammer,
  isShootingStar,
  isDoji,
  isEngulfing,
  isMorningStar,
  isEveningStar,
  isMarubozu,
  isPiercingLine,
  isDarkCloudCover,
  isThreeWhiteSoldiers,
  isThreeBlackCrows,
  isInsideBar,
  isPinBar,
  isHarami,
  isTweezerTop,
  isTweezerBottom,
  isOutsideBar,
  isHigherHighs,
  isLowerLows
} from './candleGeometry';

export interface LibraryResult {
  vote: 'BULL' | 'BEAR' | 'NEUTRAL' | 'SKIP';
  score: number;
  bullPoints: number;
  bearPoints: number;
  reason: string;
}

// Helper to fill the cache if missing
export function ensureIndicators(ohlc: NumericOHLC[], cache: IndicatorCache) {
  const closes = cache.closes || (cache.closes = ohlc.map(c => c.close));
  if (!cache.rsiVals) cache.rsiVals = rsi(closes, 14);
  if (!cache.stochVals) {
    cache.stochVals = ohlc.length >= 14 ? stochastic(ohlc, 14, 3) : { k: Array(ohlc.length).fill(null), d: Array(ohlc.length).fill(null) };
  }
  if (!cache.macdVals) {
    const rawMacd = macd(closes, 12, 26, 9);
    cache.macdVals = {
      macd: rawMacd.macd || (rawMacd as any).line || [],
      signal: rawMacd.signal || [],
      hist: rawMacd.hist || (rawMacd as any).histogram || []
    };
  }
  if (!cache.emaSlope) cache.emaSlope = emaSlope(closes, 9);
  if (!cache.emaCurvature) cache.emaCurvature = emaCurvature(closes, 9);
  if (!cache.atrVals) cache.atrVals = atr(ohlc, 14);
  if (!cache.bollVals) {
    const rawBoll = bollinger(closes, 20, 2);
    cache.bollVals = {
      upper: rawBoll.upper || [],
      lower: rawBoll.lower || [],
      middle: rawBoll.middle || []
    };
  }
}

export type TechniqueLibraryFunction = (
  ohlc: NumericOHLC[],
  cache: IndicatorCache,
  context?: { trendState?: string; yPercent?: number }
) => LibraryResult;

function checkTwoCandlePatternConfirmation(ohlc: NumericOHLC[], direction: 'BULL' | 'BEAR'): boolean {
  if (ohlc.length < 3) return false;
  const current = ohlc[ohlc.length - 1];
  const patternCandle1 = ohlc[ohlc.length - 2];
  const patternCandle2 = ohlc[ohlc.length - 3];

  const body = Math.abs(current.close - current.open);
  const range = current.high - current.low || 1e-9;
  const solidBody = (body / range) >= 0.35;

  if (direction === 'BULL') {
    const patternHigh = Math.max(patternCandle1.high, patternCandle2.high);
    const isGreen = current.close > current.open;
    return isGreen && current.close > patternHigh && solidBody;
  } else {
    const patternLow = Math.min(patternCandle1.low, patternCandle2.low);
    const isRed = current.close < current.open;
    return isRed && current.close < patternLow && solidBody;
  }
}

function checkThreeCandlePatternConfirmation(ohlc: NumericOHLC[], direction: 'BULL' | 'BEAR'): boolean {
  if (ohlc.length < 1) return false;
  const current = ohlc[ohlc.length - 1];
  if (direction === 'BULL') {
    return current.close > current.open;
  } else {
    return current.close < current.open;
  }
}

function applyContextAndConfirmationGates(
  result: LibraryResult,
  ohlc: NumericOHLC[],
  contextValues: { trendState?: string; yPercent?: number } | undefined,
  direction: 'BULL' | 'BEAR',
  candlePatternType: 'SINGLE' | 'TWO_CANDLE' | 'THREE_CANDLE'
): LibraryResult {
  if (result.vote === 'SKIP' || result.vote === 'NEUTRAL') {
    return result;
  }

  let finalScore = result.score;
  let finalBullPoints = result.bullPoints;
  let finalBearPoints = result.bearPoints;
  let suffix = '';

  // A. Setup Context Gate (BUG #9)
  if (contextValues && contextValues.trendState !== undefined && contextValues.yPercent !== undefined) {
    const { trendState, yPercent } = contextValues;
    if (direction === 'BULL') {
      const isPerfect = trendState === 'DOWNTREND' && yPercent <= 30;
      const isValid = (trendState === 'RANGING' && yPercent <= 35) || yPercent <= 20;
      if (isPerfect) {
        finalScore = Math.min(1.0, finalScore * 1.25);
        if (result.vote === 'BULL') finalBullPoints *= 1.20;
        else finalBearPoints *= 1.20;
        suffix += ' [Perfect Reversal Setup]';
      } else if (!isValid) {
        finalScore *= 0.25;
        if (result.vote === 'BULL') finalBullPoints *= 0.25;
        else finalBearPoints *= 0.25;
        suffix += ' [Weak Context Neutered]';
      }
    } else if (direction === 'BEAR') {
      const isPerfect = trendState === 'UPTREND' && yPercent >= 70;
      const isValid = (trendState === 'RANGING' && yPercent >= 65) || yPercent >= 80;
      if (isPerfect) {
        finalScore = Math.min(1.0, finalScore * 1.25);
        if (result.vote === 'BULL') finalBullPoints *= 1.20;
        else finalBearPoints *= 1.20;
        suffix += ' [Perfect Reversal Setup]';
      } else if (!isValid) {
        finalScore *= 0.25;
        if (result.vote === 'BULL') finalBullPoints *= 0.25;
        else finalBearPoints *= 0.25;
        suffix += ' [Weak Context Neutered]';
      }
    }
  }

  // B. Confirmation Check (BUG #10)
  if (candlePatternType === 'TWO_CANDLE') {
    const isConfirmed = checkTwoCandlePatternConfirmation(ohlc, direction);
    if (!isConfirmed) {
      if (result.vote === 'BULL') finalBullPoints *= 0.60;
      else finalBearPoints *= 0.60;
      suffix += ' [Awaiting confirmation]';
    }
  } else if (candlePatternType === 'THREE_CANDLE') {
    const isConfirmed = checkThreeCandlePatternConfirmation(ohlc, direction);
    if (!isConfirmed) {
      if (result.vote === 'BULL') finalBullPoints *= 0.70;
      else finalBearPoints *= 0.70;
      suffix += ' [Awaiting confirmation]';
    }
  } else if (candlePatternType === 'SINGLE') {
    suffix += ' [Exposing recommendation: awaitsConfirmation=true]';
  }

  return {
    vote: result.vote,
    score: parseFloat(finalScore.toFixed(3)),
    bullPoints: parseFloat(finalBullPoints.toFixed(3)),
    bearPoints: parseFloat(finalBearPoints.toFixed(3)),
    reason: result.reason + suffix
  };
}

export const TECHNIQUE_LIBRARY: Record<string, TechniqueLibraryFunction> = {
  // ─── RSI TECHNIQUES ────────────────────────────────────────────────────────
  'rsioversold': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const rsiVals = cache.rsiVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 15 || last < 0 || rsiVals[last] === null) {
      return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'RSI window too short' };
    }
    const r = rsiVals[last];
    if (r < 30) {
      const score = Math.max(0, Math.min(1.0, (30 - r) / 30));
      const pt = r < 20 ? 2.0 : r < 25 ? 1.5 : 1.0;
      return { vote: 'BULL', score, bullPoints: pt, bearPoints: 0, reason: `RSI(14)=${r.toFixed(2)} < 30 oversold` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: `RSI(14)=${r.toFixed(2)} not oversold` };
  },

  'rsioverbought': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const rsiVals = cache.rsiVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 15 || last < 0 || rsiVals[last] === null) {
      return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'RSI window too short' };
    }
    const r = rsiVals[last];
    if (r > 70) {
      const score = Math.max(0, Math.min(1.0, (r - 70) / 30));
      const pt = r > 80 ? 2.0 : r > 75 ? 1.5 : 1.0;
      return { vote: 'BEAR', score, bullPoints: 0, bearPoints: pt, reason: `RSI(14)=${r.toFixed(2)} > 70 overbought` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: `RSI(14)=${r.toFixed(2)} not overbought` };
  },

  'rsiextremeoversold': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const rsiVals = cache.rsiVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 15 || last < 0) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Insufficient data' };
    const r = rsiVals[last];
    if (r < 20) {
      return { vote: 'BULL', score: 0.95, bullPoints: 2.0, bearPoints: 0, reason: `RSI(14)=${r.toFixed(2)} extreme oversold (< 20)` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'RSI not in extreme oversold' };
  },

  'rsiextremeoverbought': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const rsiVals = cache.rsiVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 15 || last < 0) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Insufficient data' };
    const r = rsiVals[last];
    if (r > 80) {
      return { vote: 'BEAR', score: 0.95, bullPoints: 0, bearPoints: 2.0, reason: `RSI(14)=${r.toFixed(2)} extreme overbought (> 80)` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'RSI not in extreme overbought' };
  },

  'rsibullishexit': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const r = cache.rsiVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 16) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Needs 16 candles' };
    if (r[last - 1] < 30 && r[last] >= 30) {
      return { vote: 'BULL', score: 0.75, bullPoints: 1.5, bearPoints: 0, reason: `RSI crossed up out of oversold zone at ${r[last].toFixed(1)}` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No RSI oversold crossover' };
  },

  'rsibearishexit': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const r = cache.rsiVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 16) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Needs 16 candles' };
    if (r[last - 1] > 70 && r[last] <= 70) {
      return { vote: 'BEAR', score: 0.75, bullPoints: 0, bearPoints: 1.5, reason: `RSI crossed down out of overbought zone at ${r[last].toFixed(1)}` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No RSI overbought crossover' };
  },

  'rsineutral': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const r = cache.rsiVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 15) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Insufficient data' };
    const val = r[last];
    if (val >= 35 && val <= 65) {
      return { vote: 'NEUTRAL', score: 1.0, bullPoints: 0, bearPoints: 0, reason: `RSI is neutral at ${val.toFixed(2)}` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'RSI is trending' };
  },

  // ─── STOCHASTIC TECHNIQUES ──────────────────────────────────────────────────
  'stochoversold': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const { k, d } = cache.stochVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 15 || last < 0 || k[last] === null || d[last] === null) {
      return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Stoch window too short' };
    }
    const kval = k[last];
    const dval = d[last];
    if (kval < 20 && dval < 20) {
      const score = Math.max(0, Math.min(1.0, (20 - kval) / 20));
      return { vote: 'BULL', score, bullPoints: 1.25, bearPoints: 0, reason: `Stoch K=${kval.toFixed(1)}, D=${dval.toFixed(1)} < 20 oversold` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Stoch not oversold' };
  },

  'stochoverbought': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const { k, d } = cache.stochVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 15 || last < 0 || k[last] === null || d[last] === null) {
      return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Stoch window too short' };
    }
    const kval = k[last];
    const dval = d[last];
    if (kval > 80 && dval > 80) {
      const score = Math.max(0, Math.min(1.0, (kval - 80) / 20));
      return { vote: 'BEAR', score, bullPoints: 0, bearPoints: 1.25, reason: `Stoch K=${kval.toFixed(1)}, D=${dval.toFixed(1)} > 80 overbought` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Stoch not overbought' };
  },

  'stochkcrossaboved': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const { k, d } = cache.stochVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 16) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Needs 16 candles' };
    if (k[last - 1] <= d[last - 1] && k[last] > d[last] && k[last] < 50) {
      return { vote: 'BULL', score: 0.8, bullPoints: 1.5, bearPoints: 0, reason: `Stoch K crossed above D at ${k[last].toFixed(1)}` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No bull Stochastic crossover' };
  },

  'stochkcrossbelowd': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const { k, d } = cache.stochVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 16) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Needs 16 candles' };
    if (k[last - 1] >= d[last - 1] && k[last] < d[last] && k[last] > 50) {
      return { vote: 'BEAR', score: 0.8, bullPoints: 0, bearPoints: 1.5, reason: `Stoch K crossed below D at ${k[last].toFixed(1)}` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No bear Stochastic crossover' };
  },

  'stochneutral': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const { k } = cache.stochVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 15) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Insufficient data' };
    const kval = k[last];
    if (kval >= 30 && kval <= 70) {
      return { vote: 'NEUTRAL', score: 1.0, bullPoints: 0, bearPoints: 0, reason: `Stoch is neutral at ${kval.toFixed(1)}` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Stoch in extremes' };
  },

  // ─── MACD TECHNIQUES ────────────────────────────────────────────────────────
  'macdbullcross': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const m = cache.macdVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 26) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'MACD window too short' };
    if (m.macd[last - 1] <= m.signal[last - 1] && m.macd[last] > m.signal[last] && m.macd[last] < 0) {
      return { vote: 'BULL', score: 0.85, bullPoints: 1.75, bearPoints: 0, reason: `MACD cross above Signal line under 0 (MACD=${m.macd[last].toFixed(3)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No MACD golden crossover' };
  },

  'macdbearcross': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const m = cache.macdVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 26) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'MACD window too short' };
    if (m.macd[last - 1] >= m.signal[last - 1] && m.macd[last] < m.signal[last] && m.macd[last] > 0) {
      return { vote: 'BEAR', score: 0.85, bullPoints: 0, bearPoints: 1.75, reason: `MACD cross below Signal line over 0 (MACD=${m.macd[last].toFixed(3)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No MACD death crossover' };
  },

  'macdhistogramaccelerationbull': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const m = cache.macdVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 26) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'MACD window too short' };
    const velocity = m.hist[last] - m.hist[last - 1];
    if (m.hist[last] > 0 && velocity > 0) {
      return { vote: 'BULL', score: 0.7, bullPoints: 1.0, bearPoints: 0, reason: `MACD Histogram positive & accelerating (val=${m.hist[last].toFixed(4)}, vel=${velocity.toFixed(4)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No bullish hist acceleration' };
  },

  'macdhistogramaccelerationbear': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const m = cache.macdVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 26) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'MACD window too short' };
    const velocity = m.hist[last] - m.hist[last - 1];
    if (m.hist[last] < 0 && velocity < 0) {
      return { vote: 'BEAR', score: 0.7, bullPoints: 0, bearPoints: 1.0, reason: `MACD Histogram negative & decelerating (val=${m.hist[last].toFixed(4)}, vel=${velocity.toFixed(4)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No bearish hist acceleration' };
  },

  // ─── BOLLINGER BANDS TECHNIQUES ─────────────────────────────────────────────
  'bollingerlowerbreak': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const b = cache.bollVals!;
    const last = ohlc.length - 1;
    const price = ohlc[last].close;
    if (ohlc.length < 20 || b.lower[last] === null) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'BB too short' };
    if (price < b.lower[last]) {
      const devRatio = Math.min(1.0, (b.lower[last] - price) / b.lower[last]);
      return { vote: 'BULL', score: 0.9, bullPoints: 1.75, bearPoints: 0, reason: `Close (${price.toFixed(2)}) broke below Bollinger Lower Band (${b.lower[last].toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Within Bollinger Bands' };
  },

  'bollingerupperbreak': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const b = cache.bollVals!;
    const last = ohlc.length - 1;
    const price = ohlc[last].close;
    if (ohlc.length < 20 || b.upper[last] === null) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'BB too short' };
    if (price > b.upper[last]) {
      const devRatio = Math.min(1.0, (price - b.upper[last]) / b.upper[last]);
      return { vote: 'BEAR', score: 0.9, bullPoints: 0, bearPoints: 1.75, reason: `Close (${price.toFixed(2)}) broke above Bollinger Upper Band (${b.upper[last].toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Within Bollinger Bands' };
  },

  'bollingernarrowbandsqueeze': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const b = cache.bollVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 30) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Insufficient data' };
    // Calculate rolling bandwidths
    const widths: number[] = [];
    for (let j = last - 15; j <= last; j++) {
      if (b.upper[j] && b.lower[j]) widths.push((b.upper[j] - b.lower[j]) / b.middle[j]);
    }
    const currentW = widths[widths.length - 1];
    const meanW = widths.slice(0, -1).reduce((sum, v) => sum + v, 0) / (widths.length - 1 || 1);
    if (currentW < meanW * 0.82) {
      return { vote: 'NEUTRAL', score: 0.8, bullPoints: 0, bearPoints: 0, reason: `Bollinger Band squeeze detected (current=${currentW.toFixed(4)} < average=${meanW.toFixed(4)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Bollinger Band Squeeze' };
  },

  'bollingerwidthexpansion': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const b = cache.bollVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 30) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Insufficient data' };
    const currentW = (b.upper[last] - b.lower[last]) / b.middle[last];
    const prevW = (b.upper[last - 3] - b.lower[last - 3]) / b.middle[last - 3];
    if (currentW > prevW * 1.5) {
      return { vote: 'NEUTRAL', score: 0.7, bullPoints: 0, bearPoints: 0, reason: `Volatility breakout: Bollinger Width expanded 1.5x from ${prevW.toFixed(4)} to ${currentW.toFixed(4)}` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Bollinger width standard' };
  },

  // ─── EMA TECHNIQUES ─────────────────────────────────────────────────────────
  'emagoldencross': (ohlc, cache) => {
    const closes = cache.closes || ohlc.map(c => c.close);
    const last = ohlc.length - 1;
    if (ohlc.length < 22) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Insufficient EMA lengths' };
    const e9 = ema(closes, 9);
    const e21 = ema(closes, 21);
    if (e9[last - 1] <= e21[last - 1] && e9[last] > e21[last]) {
      return { vote: 'BULL', score: 0.85, bullPoints: 1.5, bearPoints: 0, reason: `EMA 9 crossed above EMA 21 (golden cross)` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No EMA cross detected' };
  },

  'emadeathcross': (ohlc, cache) => {
    const closes = cache.closes || ohlc.map(c => c.close);
    const last = ohlc.length - 1;
    if (ohlc.length < 22) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Insufficient EMA lengths' };
    const e9 = ema(closes, 9);
    const e21 = ema(closes, 21);
    if (e9[last - 1] >= e21[last - 1] && e9[last] < e21[last]) {
      return { vote: 'BEAR', score: 0.85, bullPoints: 0, bearPoints: 1.5, reason: `EMA 9 crossed below EMA 21 (death cross)` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No EMA cross detected' };
  },

  'ema9aboveema21bull': (ohlc, cache) => {
    const closes = cache.closes || ohlc.map(c => c.close);
    const last = ohlc.length - 1;
    if (ohlc.length < 22) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'EMA window short' };
    const e9 = ema(closes, 9);
    const e21 = ema(closes, 21);
    if (e9[last] > e21[last]) {
      return { vote: 'BULL', score: 0.65, bullPoints: 1.0, bearPoints: 0, reason: `EMA 9 (${e9[last].toFixed(2)}) is above EMA 21 (${e21[last].toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'EMA 9 is below EMA 21' };
  },

  'ema9belowema21bear': (ohlc, cache) => {
    const closes = cache.closes || ohlc.map(c => c.close);
    const last = ohlc.length - 1;
    if (ohlc.length < 22) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'EMA window short' };
    const e9 = ema(closes, 9);
    const e21 = ema(closes, 21);
    if (e9[last] < e21[last]) {
      return { vote: 'BEAR', score: 0.65, bullPoints: 0, bearPoints: 1.0, reason: `EMA 9 (${e9[last].toFixed(2)}) is below EMA 21 (${e21[last].toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'EMA 9 is above EMA 21' };
  },

  'priceaboveema9bull': (ohlc, cache) => {
    const closes = cache.closes || ohlc.map(c => c.close);
    const last = ohlc.length - 1;
    if (ohlc.length < 10) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Short window' };
    const e9 = ema(closes, 9);
    const p = closes[last];
    if (p > e9[last]) {
      return { vote: 'BULL', score: 0.6, bullPoints: 0.75, bearPoints: 0, reason: `Price (${p.toFixed(2)}) is above EMA 9 (${e9[last].toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Price below EMA 9' };
  },

  'pricebelowema9bear': (ohlc, cache) => {
    const closes = cache.closes || ohlc.map(c => c.close);
    const last = ohlc.length - 1;
    if (ohlc.length < 10) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Short window' };
    const e9 = ema(closes, 9);
    const p = closes[last];
    if (p < e9[last]) {
      return { vote: 'BEAR', score: 0.6, bullPoints: 0, bearPoints: 0.75, reason: `Price (${p.toFixed(2)}) is below EMA 9 (${e9[last].toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Price above EMA 9' };
  },

  'priceaboveema21bull': (ohlc, cache) => {
    const closes = cache.closes || ohlc.map(c => c.close);
    const last = ohlc.length - 1;
    if (ohlc.length < 22) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Short window' };
    const e21 = ema(closes, 21);
    const p = closes[last];
    if (p > e21[last]) {
      return { vote: 'BULL', score: 0.6, bullPoints: 0.75, bearPoints: 0, reason: `Price (${p.toFixed(2)}) is above EMA 21 (${e21[last].toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Price below EMA 21' };
  },

  'pricebelowema21bear': (ohlc, cache) => {
    const closes = cache.closes || ohlc.map(c => c.close);
    const last = ohlc.length - 1;
    if (ohlc.length < 22) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Short window' };
    const e21 = ema(closes, 21);
    const p = closes[last];
    if (p < e21[last]) {
      return { vote: 'BEAR', score: 0.6, bullPoints: 0, bearPoints: 0.75, reason: `Price (${p.toFixed(2)}) is below EMA 21 (${e21[last].toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Price above EMA 21' };
  },

  // ─── TREND & VOLATILITY TECHNIQUES ──────────────────────────────────────────
  'highhighstrendbull': (ohlc, cache) => {
    const last = ohlc.length - 1;
    if (ohlc.length < 5) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Too short' };
    const res = isHigherHighs(ohlc);
    if (res.match) {
      return { vote: 'BULL', score: res.score, bullPoints: 1.0, bearPoints: 0, reason: `Higher highs identified (intensity=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No higher highs sequence' };
  },

  'lowlowstrendbear': (ohlc, cache) => {
    const last = ohlc.length - 1;
    if (ohlc.length < 5) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Too short' };
    const res = isLowerLows(ohlc);
    if (res.match) {
      return { vote: 'BEAR', score: res.score, bullPoints: 0, bearPoints: 1.0, reason: `Lower lows identified (intensity=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No lower lows sequence' };
  },

  'atrhighvolatility': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const atrVals = cache.atrVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 20) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Too short' };
    const currentAtr = atrVals[last];
    const prevAtrs = atrVals.slice(-15, -1);
    const meanAtr = prevAtrs.reduce((sum, v) => sum + v, 0) / prevAtrs.length;
    if (currentAtr > meanAtr * 1.35) {
      return { vote: 'NEUTRAL', score: 0.7, bullPoints: 0, bearPoints: 0, reason: `High ATR volatility (current=${currentAtr.toFixed(4)} > mean=${meanAtr.toFixed(4)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Atr volatility is normal' };
  },

  'atrlowvolatility': (ohlc, cache) => {
    ensureIndicators(ohlc, cache);
    const atrVals = cache.atrVals!;
    const last = ohlc.length - 1;
    if (ohlc.length < 20) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Too short' };
    const currentAtr = atrVals[last];
    const prevAtrs = atrVals.slice(-15, -1);
    const meanAtr = prevAtrs.reduce((sum, v) => sum + v, 0) / prevAtrs.length;
    if (currentAtr < meanAtr * 0.65) {
      return { vote: 'NEUTRAL', score: 0.75, bullPoints: 0, bearPoints: 0, reason: `Dead or sideways market detected through ATR (${currentAtr.toFixed(4)} < average=${meanAtr.toFixed(4)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'ATR activity acceptable' };
  },

  // ─── CANDLESTICK GEOMETRY TECHNIQUES ────────────────────────────────────────
  'doji': (ohlc, cache) => {
    const res = isDoji(ohlc);
    if (res.match) {
      return { vote: 'NEUTRAL', score: res.score, bullPoints: 0, bearPoints: 0, reason: `Doji balanced pattern (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Doji formed' };
  },

  'hammer': (ohlc, cache, context) => {
    const res = isHammer(ohlc);
    if (res.match) {
      const rawRes = { vote: 'BULL' as const, score: res.score, bullPoints: 1.5, bearPoints: 0, reason: `Bullish Hammer reversal (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BULL', 'SINGLE');
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Hammer formed' };
  },

  'shootingstar': (ohlc, cache, context) => {
    const res = isShootingStar(ohlc);
    if (res.match) {
      const rawRes = { vote: 'BEAR' as const, score: res.score, bullPoints: 0, bearPoints: 1.5, reason: `Bearish Shooting Star reversal (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BEAR', 'SINGLE');
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Shooting Star formed' };
  },

  'engulfing': (ohlc, cache, context) => {
    const res = isEngulfing(ohlc);
    if (res.bullish) {
      const rawRes = { vote: 'BULL' as const, score: res.score, bullPoints: 1.75, bearPoints: 0, reason: `Bullish Engulfing pattern formed (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BULL', 'TWO_CANDLE');
    } else if (res.bearish) {
      const rawRes = { vote: 'BEAR' as const, score: res.score, bullPoints: 0, bearPoints: 1.75, reason: `Bearish Engulfing pattern formed (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BEAR', 'TWO_CANDLE');
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Engulfing pattern formed' };
  },

  'morningstar': (ohlc, cache, context) => {
    const res = isMorningStar(ohlc);
    if (res.match) {
      const rawRes = { vote: 'BULL' as const, score: res.score, bullPoints: 1.75, bearPoints: 0, reason: `Bullish Morning Star reversal (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BULL', 'THREE_CANDLE');
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Morning Star formed' };
  },

  'eveningstar': (ohlc, cache, context) => {
    const res = isEveningStar(ohlc);
    if (res.match) {
      const rawRes = { vote: 'BEAR' as const, score: res.score, bullPoints: 0, bearPoints: 1.75, reason: `Bearish Evening Star reversal (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BEAR', 'THREE_CANDLE');
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Evening Star formed' };
  },

  'marubozu': (ohlc, cache) => {
    const res = isMarubozu(ohlc);
    if (res.bullish) {
      return { vote: 'BULL', score: res.score, bullPoints: 1.25, bearPoints: 0, reason: `Bullish Marubozu (score=${res.score.toFixed(2)})` };
    } else if (res.bearish) {
      return { vote: 'BEAR', score: res.score, bullPoints: 0, bearPoints: 1.25, reason: `Bearish Marubozu (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Marubozu formed' };
  },

  'threewhitesoldiers': (ohlc, cache) => {
    const res = isThreeWhiteSoldiers(ohlc);
    if (res.match) {
      return { vote: 'BULL', score: res.score, bullPoints: 1.75, bearPoints: 0, reason: `Three White Soldiers trend continuity (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Three White Soldiers formed' };
  },

  'threeblackcrows': (ohlc, cache) => {
    const res = isThreeBlackCrows(ohlc);
    if (res.match) {
      return { vote: 'BEAR', score: res.score, bullPoints: 0, bearPoints: 1.75, reason: `Three Black Crows trend decay (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Three Black Crows formed' };
  },

  'piercingline': (ohlc, cache) => {
    const res = isPiercingLine(ohlc);
    if (res.match) {
      return { vote: 'BULL', score: res.score, bullPoints: 1.5, bearPoints: 0, reason: `Bullish Piercing Line reversal (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Piercing Line formed' };
  },

  'darkcloudcover': (ohlc, cache) => {
    const res = isDarkCloudCover(ohlc);
    if (res.match) {
      return { vote: 'BEAR', score: res.score, bullPoints: 0, bearPoints: 1.5, reason: `Bearish Dark Cloud Cover reversal (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Dark Cloud Cover formed' };
  },

  'insidebar': (ohlc, cache) => {
    const res = isInsideBar(ohlc);
    if (res.match) {
      return { vote: 'NEUTRAL', score: res.score, bullPoints: 0, bearPoints: 0, reason: `Inside Bar coiling sequence (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Inside Bar formed' };
  },

  'outsidebar': (ohlc, cache) => {
    const res = isOutsideBar(ohlc);
    if (res.match) {
      return { vote: 'NEUTRAL', score: res.score, bullPoints: 0, bearPoints: 0, reason: `Outside Bar expansion sequence (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Outside Bar formed' };
  },

  'pinbar': (ohlc, cache, context) => {
    const res = isPinBar(ohlc);
    if (res.bull) {
      const rawRes = { vote: 'BULL' as const, score: res.score, bullPoints: 1.5, bearPoints: 0, reason: `Bullish Pinbar rejection (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BULL', 'SINGLE');
    } else if (res.bear) {
      const rawRes = { vote: 'BEAR' as const, score: res.score, bullPoints: 0, bearPoints: 1.5, reason: `Bearish Pinbar rejection (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BEAR', 'SINGLE');
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Pinbar formed' };
  },

  'harami': (ohlc, cache, context) => {
    const res = isHarami(ohlc);
    if (res.bullish) {
      const rawRes = { vote: 'BULL' as const, score: res.score, bullPoints: 1.25, bearPoints: 0, reason: `Bullish Harami (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BULL', 'TWO_CANDLE');
    } else if (res.bearish) {
      const rawRes = { vote: 'BEAR' as const, score: res.score, bullPoints: 0, bearPoints: 1.25, reason: `Bearish Harami (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BEAR', 'TWO_CANDLE');
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Harami formed' };
  },

  'tweezertop': (ohlc, cache, context) => {
    const res = isTweezerTop(ohlc);
    if (res.match) {
      const rawRes = { vote: 'BEAR' as const, score: res.score, bullPoints: 0, bearPoints: 1.5, reason: `Bearish Tweezer Top rejection (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BEAR', 'TWO_CANDLE');
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Tweezer Top formed' };
  },

  'tweezerbottom': (ohlc, cache, context) => {
    const res = isTweezerBottom(ohlc);
    if (res.match) {
      const rawRes = { vote: 'BULL' as const, score: res.score, bullPoints: 1.5, bearPoints: 0, reason: `Bullish Tweezer Bottom rejection (score=${res.score.toFixed(2)})` };
      return applyContextAndConfirmationGates(rawRes, ohlc, context, 'BULL', 'TWO_CANDLE');
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Tweezer Bottom formed' };
  },

  // ─── ALIASES for existing patterns ─────────────────────────────────────────
  'hangingman':       (ohlc, cache) => {
    const res = isShootingStar(ohlc);   // mirror geometry, opposite context
    if (res.match) return { vote: 'BEAR', score: res.score, bullPoints: 0,
      bearPoints: 1.25, reason: `Hanging Man bearish reversal` };
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No hanging man' };
  },
  'invertedhammer':   (ohlc) => {
    // body in lower third, long upper wick, in downtrend = bullish
    if (ohlc.length < 1) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Empty' };
    const c = ohlc[ohlc.length - 1];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Zero range' };
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (upperWick >= 2 * body && lowerWick <= body * 0.5 && body / range > 0.05) {
      const sc = Math.min(1.0, upperWick / (2.5 * (body || 0.001)));
      return { vote: 'BULL', score: sc, bullPoints: 1.25, bearPoints: 0,
        reason: `Inverted Hammer (uW=${upperWick.toFixed(4)}, body=${body.toFixed(4)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No inverted hammer' };
  },
  'spinningtop':      (ohlc) => {
    if (ohlc.length < 1) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Empty' };
    const c = ohlc[ohlc.length - 1];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Zero range' };
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (body / range < 0.35 && upperWick > body * 0.8 && lowerWick > body * 0.8) {
      return { vote: 'NEUTRAL', score: 0.7, bullPoints: 0.0, bearPoints: 0.0,
        reason: `Spinning Top indecision (body/range=${(body/range).toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No spinning top' };
  },
  'dragonflydoji':    (ohlc) => {
    if (ohlc.length < 1) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Empty' };
    const c = ohlc[ohlc.length - 1];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Zero range' };
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (body / range < 0.1 && lowerWick > range * 0.6 && upperWick < range * 0.1) {
      return { vote: 'BULL', score: 0.85, bullPoints: 1.5, bearPoints: 0,
        reason: `Dragonfly Doji bullish reversal` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No dragonfly doji' };
  },
  'gravestonedoji':   (ohlc) => {
    if (ohlc.length < 1) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Empty' };
    const c = ohlc[ohlc.length - 1];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Zero range' };
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (body / range < 0.1 && upperWick > range * 0.6 && lowerWick < range * 0.1) {
      return { vote: 'BEAR', score: 0.85, bullPoints: 0, bearPoints: 1.5,
        reason: `Gravestone Doji bearish reversal` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No gravestone doji' };
  },
  'longleggeddoji':   (ohlc) => {
    if (ohlc.length < 1) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Empty' };
    const c = ohlc[ohlc.length - 1];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Zero range' };
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (body / range < 0.1 && upperWick > range * 0.35 && lowerWick > range * 0.35) {
      return { vote: 'NEUTRAL', score: 0.7, bullPoints: 0, bearPoints: 0,
        reason: `Long-legged Doji indecision` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No long-legged doji' };
  },
  'belthold':         (ohlc) => {
    if (ohlc.length < 1) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Empty' };
    const c = ohlc[ohlc.length - 1];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Zero range' };
    // Bullish belt hold: open at low, big body
    if (c.close > c.open && Math.abs(c.open - c.low) / range < 0.05 && body / range > 0.7) {
      return { vote: 'BULL', score: 0.8, bullPoints: 1.25, bearPoints: 0,
        reason: `Bullish Belt Hold` };
    }
    // Bearish belt hold: open at high, big body
    if (c.close < c.open && Math.abs(c.open - c.high) / range < 0.05 && body / range > 0.7) {
      return { vote: 'BEAR', score: 0.8, bullPoints: 0, bearPoints: 1.25,
        reason: `Bearish Belt Hold` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No belt hold' };
  },
  'kicking':          (ohlc) => {
    if (ohlc.length < 2) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Need 2 candles' };
    const c1 = ohlc[ohlc.length - 2];
    const c2 = ohlc[ohlc.length - 1];
    const body1 = Math.abs(c1.close - c1.open);
    const body2 = Math.abs(c2.close - c2.open);
    const range1 = c1.high - c1.low;
    const range2 = c2.high - c2.low;
    if (range1 === 0 || range2 === 0) return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Zero range' };
    const isMaru1 = (c1.high - Math.max(c1.open, c1.close)) / range1 < 0.05 &&
                    (Math.min(c1.open, c1.close) - c1.low) / range1 < 0.05;
    const isMaru2 = (c2.high - Math.max(c2.open, c2.close)) / range2 < 0.05 &&
                    (Math.min(c2.open, c2.close) - c2.low) / range2 < 0.05;
    if (isMaru1 && isMaru2) {
      if (c1.close < c1.open && c2.close > c2.open && c2.low > c1.high) {
        return { vote: 'BULL', score: 0.9, bullPoints: 1.75, bearPoints: 0, reason: 'Bullish Kicking pattern' };
      }
      if (c1.close > c1.open && c2.close < c2.open && c2.high < c1.low) {
        return { vote: 'BEAR', score: 0.9, bullPoints: 0, bearPoints: 1.75, reason: 'Bearish Kicking pattern' };
      }
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No kicking' };
  },
  'abandonedbaby':    (ohlc) => {
    if (ohlc.length < 3) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Need 3 candles' };
    const c1 = ohlc[ohlc.length - 3];
    const c2 = ohlc[ohlc.length - 2];
    const c3 = ohlc[ohlc.length - 1];
    const isDojiC2 = Math.abs(c2.close - c2.open) / Math.max(c2.high - c2.low, 1e-9) < 0.1;
    if (!isDojiC2) return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Middle not doji' };
    if (c1.close < c1.open && c3.close > c3.open && c2.high < i1.high || c2.high < c1.low && c2.high < c3.low) { // wait let's use exact code from directive
      // wait, the directive has:
      // if (c1.close < c1.open && c3.close > c3.open && c2.high < c1.low && c2.high < c3.low) {
      // let's follow the directive precisely!
    }
    if (c1.close < c1.open && c3.close > c3.open && c2.high < c1.low && c2.high < c3.low) {
      return { vote: 'BULL', score: 0.95, bullPoints: 2.0, bearPoints: 0, reason: 'Bullish Abandoned Baby' };
    }
    if (c1.close > c1.open && c3.close < c3.open && c2.low > c1.high && c2.low > c3.high) {
      return { vote: 'BEAR', score: 0.95, bullPoints: 0, bearPoints: 2.0, reason: 'Bearish Abandoned Baby' };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No abandoned baby' };
  },
  'risingthreemethods':  (ohlc) => {
    if (ohlc.length < 5) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Need 5 candles' };
    const [c1, c2, c3, c4, c5] = ohlc.slice(-5);
    const isBullBig = (c: any) => c.close > c.open && (c.high - c.low) > 0;
    if (isBullBig(c1) && isBullBig(c5) && c5.close > c1.high) {
      const middleSmallBear = [c2, c3, c4].every(c => c.close < c.open &&
        Math.abs(c.close - c.open) < Math.abs(c1.close - c1.open) * 0.6 &&
        c.high <= c1.high && c.low >= c1.low);
      if (middleSmallBear) {
        return { vote: 'BULL', score: 0.9, bullPoints: 1.75, bearPoints: 0,
          reason: 'Rising Three Methods continuation' };
      }
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No rising three methods' };
  },
  'fallingthreemethods': (ohlc) => {
    if (ohlc.length < 5) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Need 5 candles' };
    const [c1, c2, c3, c4, c5] = ohlc.slice(-5);
    const isBearBig = (c: any) => c.close < c.open && (c.high - c.low) > 0;
    if (isBearBig(c1) && isBearBig(c5) && c5.close < c1.low) {
      const middleSmallBull = [c2, c3, c4].every(c => c.close > c.open &&
        Math.abs(c.close - c.open) < Math.abs(c1.close - c1.open) * 0.6 &&
        c.high <= c1.high && c.low >= c1.low);
      if (middleSmallBull) {
        return { vote: 'BEAR', score: 0.9, bullPoints: 0, bearPoints: 1.75,
          reason: 'Falling Three Methods continuation' };
      }
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No falling three methods' };
  },
  'threeinsideup':    (ohlc) => {
    if (ohlc.length < 3) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Need 3 candles' };
    const c1 = ohlc[ohlc.length - 3];
    const c2 = ohlc[ohlc.length - 2];
    const c3 = ohlc[ohlc.length - 1];
    // c1 bearish, c2 bullish harami inside c1, c3 bullish closing above c1.open
    if (c1.close < c1.open &&
        c2.close > c2.open &&
        Math.max(c2.open, c2.close) < Math.max(c1.open, c1.close) &&
        Math.min(c2.open, c2.close) > Math.min(c1.open, c1.close) &&
        c3.close > c1.open) {
      return { vote: 'BULL', score: 0.85, bullPoints: 1.5, bearPoints: 0, reason: 'Three Inside Up' };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No three inside up' };
  },
  'threeinsidedown':  (ohlc) => {
    if (ohlc.length < 3) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Need 3 candles' };
    const c1 = ohlc[ohlc.length - 3];
    const c2 = ohlc[ohlc.length - 2];
    const c3 = ohlc[ohlc.length - 1];
    if (c1.close > c1.open &&
        c2.close < c2.open &&
        Math.max(c2.open, c2.close) < Math.max(c1.open, c1.close) &&
        Math.min(c2.open, c2.close) > Math.min(c1.open, c1.close) &&
        c3.close < c1.open) {
      return { vote: 'BEAR', score: 0.85, bullPoints: 0, bearPoints: 1.5, reason: 'Three Inside Down' };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No three inside down' };
  },
  'threeoutsideup':   (ohlc) => {
    if (ohlc.length < 3) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Need 3 candles' };
    const c1 = ohlc[ohlc.length - 3];
    const c2 = ohlc[ohlc.length - 2];
    const c3 = ohlc[ohlc.length - 1];
    // Bullish engulfing c1→c2 then continuation c3
    const engulf = c1.close < c1.open && c2.close > c2.open &&
                   c2.open <= c1.close && c2.close >= c1.open;
    if (engulf && c3.close > c2.close) {
      return { vote: 'BULL', score: 0.9, bullPoints: 1.75, bearPoints: 0, reason: 'Three Outside Up' };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No three outside up' };
  },
  'threeoutsidedown': (ohlc) => {
    if (ohlc.length < 3) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Need 3 candles' };
    const c1 = ohlc[ohlc.length - 3];
    const c2 = ohlc[ohlc.length - 2];
    const c3 = ohlc[ohlc.length - 1];
    const engulf = c1.close > c1.open && c2.close < c2.open &&
                   c2.open >= c1.close && c2.close <= c1.open;
    if (engulf && c3.close < c2.close) {
      return { vote: 'BEAR', score: 0.9, bullPoints: 0, bearPoints: 1.75, reason: 'Three Outside Down' };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No three outside down' };
  },
  'doublebottom':     (ohlc) => {
    if (ohlc.length < 10) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Need 10 candles' };
    const recent = ohlc.slice(-10);
    let lows: { idx: number; val: number }[] = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i + 1].low) {
        lows.push({ idx: i, val: recent[i].low });
      }
    }
    if (lows.length >= 2) {
      const [a, b] = lows.slice(-2);
      const sim = Math.abs(a.val - b.val) / Math.max(a.val, 1e-9);
      if (sim < 0.005 && b.idx - a.idx >= 2) {
        return { vote: 'BULL', score: 0.85, bullPoints: 1.5, bearPoints: 0,
          reason: `Double Bottom near ${a.val.toFixed(2)} / ${b.val.toFixed(2)}` };
      }
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No double bottom' };
  },
  'doubletop':        (ohlc) => {
    if (ohlc.length < 10) return { vote: 'SKIP', score: 0, bullPoints: 0, bearPoints: 0, reason: 'Need 10 candles' };
    const recent = ohlc.slice(-10);
    let highs: { idx: number; val: number }[] = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i + 1].high) {
        highs.push({ idx: i, val: recent[i].high });
      }
    }
    if (highs.length >= 2) {
      const [a, b] = highs.slice(-2);
      const sim = Math.abs(a.val - b.val) / Math.max(a.val, 1e-9);
      if (sim < 0.005 && b.idx - a.idx >= 2) {
        return { vote: 'BEAR', score: 0.85, bullPoints: 0, bearPoints: 1.5,
          reason: `Double Top near ${a.val.toFixed(2)} / ${b.val.toFixed(2)}` };
      }
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No double top' };
  }
};

// ─── ALIAS TABLE ───────────────────────────────────────────────────────────
// Many users (and AI vibe-coding tools) spell patterns differently. This
// table maps normalized variants to the canonical library key.
const CANONICAL_ALIASES: Record<string, string> = {
  // RSI
  'rsibearishfade': 'rsioverbought',
  'rsibullishfade': 'rsioversold',
  'rsi30':          'rsioversold',
  'rsi70':          'rsioverbought',

  // Hammer family
  'bullishhammer':   'hammer',
  'hammercandle':    'hammer',
  'hammerpattern':   'hammer',
  'bearishhammer':   'hangingman',
  'hanging':         'hangingman',
  'hanger':          'hangingman',

  // Shooting Star / Inverted Hammer
  'bearishshootingstar': 'shootingstar',
  'shootingstarpattern': 'shootingstar',
  'invhammer':           'invertedhammer',

  // Doji family
  'standarddoji':       'doji',
  'normaldoji':         'doji',
  'dragonfly':          'dragonflydoji',
  'gravestone':         'gravestonedoji',
  'longleggeddo':       'longleggeddoji',
  'rickshawman':        'longleggeddoji',

  // Engulfing
  'bullishengulfing':   'engulfing',
  'bearishengulfing':   'engulfing',
  'engulfingpattern':   'engulfing',

  // Stars
  'bullishmorningstar': 'morningstar',
  'bearisheveningstar': 'eveningstar',
  'morning':            'morningstar',
  'evening':            'eveningstar',

  // Three soldiers/crows
  '3whitesoldiers':     'threewhitesoldiers',
  '3blackcrows':        'threeblackcrows',

  // Harami / Tweezer / Inside / Outside
  'bullishharami':      'harami',
  'bearishharami':      'harami',
  'tweezertopbear':     'tweezertop',
  'tweezerbottombull':  'tweezerbottom',
  'tweezer':            'tweezerbottom',
  'insidebarpattern':   'insidebar',
  'outsidebarpattern':  'outsidebar',
  'pinbarbull':         'pinbar',
  'pinbarbear':         'pinbar',

  // Marubozu
  'bullmarubozu':       'marubozu',
  'bearmarubozu':       'marubozu',

  // Continuation patterns
  'risingthree':        'risingthreemethods',
  'fallingthree':       'fallingthreemethods',
  'rising3':            'risingthreemethods',
  'falling3':           'fallingthreemethods',

  // Inside/Outside variants
  '3insideup':          'threeinsideup',
  '3insidedown':        'threeinsidedown',
  '3outsideup':         'threeoutsideup',
  '3outsidedown':       'threeoutsidedown',

  // Double pattern variants
  'doubletoppattern':    'doubletop',
  'doublebottompattern': 'doublebottom',

  // Belt hold / kicking
  'bullishbelthold':    'belthold',
  'bearishbelthold':    'belthold',
  'bullishkicking':     'kicking',
  'bearishkicking':     'kicking',

  // Spinning top
  'spinning':           'spinningtop',

  // Piercing / Dark cloud
  'piercing':           'piercingline',
  'darkcloud':          'darkcloudcover',
  'piercingpattern':    'piercingline',
};

// Exported helper for techniqueShardEngine to consult
export function resolveLibraryKey(rawName: string): string | null {
  const normalized = rawName.toLowerCase().replace(/[\s_\-.]/g, '');
  if (TECHNIQUE_LIBRARY[normalized])     return normalized;
  if (CANONICAL_ALIASES[normalized])     return CANONICAL_ALIASES[normalized];
  return null;
}
