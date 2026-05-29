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

export type TechniqueLibraryFunction = (ohlc: NumericOHLC[], cache: IndicatorCache) => LibraryResult;

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

  'hammer': (ohlc, cache) => {
    const res = isHammer(ohlc);
    if (res.match) {
      return { vote: 'BULL', score: res.score, bullPoints: 1.5, bearPoints: 0, reason: `Bullish Hammer reversal (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Hammer formed' };
  },

  'shootingstar': (ohlc, cache) => {
    const res = isShootingStar(ohlc);
    if (res.match) {
      return { vote: 'BEAR', score: res.score, bullPoints: 0, bearPoints: 1.5, reason: `Bearish Shooting Star reversal (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Shooting Star formed' };
  },

  'engulfing': (ohlc, cache) => {
    const res = isEngulfing(ohlc);
    if (res.bullish) {
      return { vote: 'BULL', score: res.score, bullPoints: 1.75, bearPoints: 0, reason: `Bullish Engulfing pattern formed (score=${res.score.toFixed(2)})` };
    } else if (res.bearish) {
      return { vote: 'BEAR', score: res.score, bullPoints: 0, bearPoints: 1.75, reason: `Bearish Engulfing pattern formed (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Engulfing pattern formed' };
  },

  'morningstar': (ohlc, cache) => {
    const res = isMorningStar(ohlc);
    if (res.match) {
      return { vote: 'BULL', score: res.score, bullPoints: 1.75, bearPoints: 0, reason: `Bullish Morning Star reversal (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Morning Star formed' };
  },

  'eveningstar': (ohlc, cache) => {
    const res = isEveningStar(ohlc);
    if (res.match) {
      return { vote: 'BEAR', score: res.score, bullPoints: 0, bearPoints: 1.75, reason: `Bearish Evening Star reversal (score=${res.score.toFixed(2)})` };
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

  'pinbar': (ohlc, cache) => {
    const res = isPinBar(ohlc);
    if (res.bull) {
      return { vote: 'BULL', score: res.score, bullPoints: 1.5, bearPoints: 0, reason: `Bullish Pinbar rejection (score=${res.score.toFixed(2)})` };
    } else if (res.bear) {
      return { vote: 'BEAR', score: res.score, bullPoints: 0, bearPoints: 1.5, reason: `Bearish Pinbar rejection (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Pinbar formed' };
  },

  'harami': (ohlc, cache) => {
    const res = isHarami(ohlc);
    if (res.bullish) {
      return { vote: 'BULL', score: res.score, bullPoints: 1.25, bearPoints: 0, reason: `Bullish Harami (score=${res.score.toFixed(2)})` };
    } else if (res.bearish) {
      return { vote: 'BEAR', score: res.score, bullPoints: 0, bearPoints: 1.25, reason: `Bearish Harami (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Harami formed' };
  },

  'tweezertop': (ohlc, cache) => {
    const res = isTweezerTop(ohlc);
    if (res.match) {
      return { vote: 'BEAR', score: res.score, bullPoints: 0, bearPoints: 1.5, reason: `Bearish Tweezer Top rejection (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Tweezer Top formed' };
  },

  'tweezerbottom': (ohlc, cache) => {
    const res = isTweezerBottom(ohlc);
    if (res.match) {
      return { vote: 'BULL', score: res.score, bullPoints: 1.5, bearPoints: 0, reason: `Bullish Tweezer Bottom rejection (score=${res.score.toFixed(2)})` };
    }
    return { vote: 'NEUTRAL', score: 0, bullPoints: 0, bearPoints: 0, reason: 'No Tweezer Bottom formed' };
  }
};
