import { NumericOHLC } from '../vision/pipeline';
import * as candlestick from 'candlestick';

// Named constants for default pattern confidence levels (Fix 6)
const CONFIDENCE_ENGULFING = 0.80; // FIXED: default confidence for Engulfing pattern
const CONFIDENCE_DOJI = 0.70;      // FIXED: default confidence for Doji pattern

export interface PatternEvidence {
  pattern: string;
  confidence: number;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  index: number;
  source: 'candlestick';
}

export function extractCandlestickPatterns(series: NumericOHLC[]): PatternEvidence[] {
  const evidence: PatternEvidence[] = [];

  if (!series || series.length < 5) return evidence;

  const recent = series.slice(-5);
  const lastIndex = series.length - 1;

  if (recent.length >= 2) {
      const p = recent[recent.length - 2];
      const c = recent[recent.length - 1];

      try {
          if (candlestick.isBullishEngulfing(p, c)) {
              evidence.push({
                  pattern: 'Bullish Engulfing',
                  confidence: CONFIDENCE_ENGULFING, // FIXED: use default confidence constant
                  direction: 'BULL',
                  index: lastIndex,
                  source: 'candlestick'
              });
          }
      } catch { /* ignore */ }

      try {
          if (candlestick.isBearishEngulfing(p, c)) {
              evidence.push({
                  pattern: 'Bearish Engulfing',
                  confidence: CONFIDENCE_ENGULFING, // FIXED: use default confidence constant
                  direction: 'BEAR',
                  index: lastIndex,
                  source: 'candlestick'
              });
          }
      } catch { /* ignore */ }
  }

  if (recent.length >= 1) {
      const c = recent[recent.length - 1];
      try {
          if (candlestick.isDoji(c)) {
              evidence.push({
                  pattern: 'Doji',
                  confidence: CONFIDENCE_DOJI, // FIXED: use default confidence constant
                  direction: 'NEUTRAL',
                  index: lastIndex,
                  source: 'candlestick'
              });
          }
      } catch { /* ignore */ }
  }

  return evidence;
}
