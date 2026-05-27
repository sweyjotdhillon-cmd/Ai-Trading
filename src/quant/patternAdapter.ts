import { NumericOHLC } from '../vision/pipeline';

export interface PatternEvidence {
  pattern: string;
  confidence: number;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  index: number;
  source: 'candlestick';
}

export function extractCandlestickPatterns(series: NumericOHLC[]): PatternEvidence[] {
  const evidence: PatternEvidence[] = [];

  if (!series || series.length < 2) return evidence;

  const lastIndex = series.length - 1;
  const c3 = series[lastIndex];       // current candle
  const c2 = series[lastIndex - 1];   // previous candle

  const isC2Bear = c2.close < c2.open;
  const isC2Bull = c2.close > c2.open;
  const isC3Bear = c3.close < c3.open;
  const isC3Bull = c3.close > c3.open;

  // Local, safe, zero-dependency pattern matchers
  // 1. Bullish Engulfing
  if (isC2Bear && isC3Bull && c3.close >= c2.open && c3.open <= c2.close) {
    evidence.push({
      pattern: 'Bullish Engulfing',
      confidence: 1.0,
      direction: 'BULL',
      index: lastIndex,
      source: 'candlestick'
    });
  }

  // 2. Bearish Engulfing
  if (isC2Bull && isC3Bear && c3.close <= c2.open && c3.open >= c2.close) {
    evidence.push({
      pattern: 'Bearish Engulfing',
      confidence: 1.0,
      direction: 'BEAR',
      index: lastIndex,
      source: 'candlestick'
    });
  }

  return evidence;
}
