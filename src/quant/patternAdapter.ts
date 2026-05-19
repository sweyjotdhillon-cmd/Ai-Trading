import { NumericOHLC } from '../vision/pipeline';
import * as candlestick from 'candlestick';

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

  // Helpers
  const addEvidence = (pattern: string, direction: 'BULL'|'BEAR'|'NEUTRAL') => {
      evidence.push({
          pattern,
          confidence: 1.0,
          direction,
          index: lastIndex,
          source: 'candlestick'
      });
  };

  // 1-Candle Patterns
  if (recent.length >= 1) {
      const c = recent[recent.length - 1];
      try { if (candlestick.isDoji(c)) addEvidence('Doji', 'NEUTRAL'); } catch { /* ignore */ }
      try { if (candlestick.isHammer(c)) addEvidence('Hammer', 'BULL'); } catch { /* ignore */ }
      try { if (candlestick.isInvertedHammer(c)) addEvidence('Inverted Hammer', 'BULL'); } catch { /* ignore */ }
      try { if (candlestick.isHangingMan(c)) addEvidence('Hanging Man', 'BEAR'); } catch { /* ignore */ }
      try { if (candlestick.isShootingStar(c)) addEvidence('Shooting Star', 'BEAR'); } catch { /* ignore */ }
      try { if (candlestick.isBullishMarubozu(c)) addEvidence('Bullish Marubozu', 'BULL'); } catch { /* ignore */ }
      try { if (candlestick.isBearishMarubozu(c)) addEvidence('Bearish Marubozu', 'BEAR'); } catch { /* ignore */ }
      try { if (candlestick.isSpinningTop(c)) addEvidence('Spinning Top', 'NEUTRAL'); } catch { /* ignore */ }
  }

  // 2-Candle Patterns
  if (recent.length >= 2) {
      const p = recent[recent.length - 2];
      const c = recent[recent.length - 1];

      try { if (candlestick.isBullishEngulfing(p, c)) addEvidence('Bullish Engulfing', 'BULL'); } catch { /* ignore */ }
      try { if (candlestick.isBearishEngulfing(p, c)) addEvidence('Bearish Engulfing', 'BEAR'); } catch { /* ignore */ }
      try { if (candlestick.isBullishHarami(p, c)) addEvidence('Bullish Harami', 'BULL'); } catch { /* ignore */ }
      try { if (candlestick.isBearishHarami(p, c)) addEvidence('Bearish Harami', 'BEAR'); } catch { /* ignore */ }
      try { if (candlestick.isBullishKicker(p, c)) addEvidence('Bullish Kicker', 'BULL'); } catch { /* ignore */ }
      try { if (candlestick.isBearishKicker(p, c)) addEvidence('Bearish Kicker', 'BEAR'); } catch { /* ignore */ }
      try { if (candlestick.isPiercingLine(p, c)) addEvidence('Piercing Line', 'BULL'); } catch { /* ignore */ }
      try { if (candlestick.isDarkCloudCover(p, c)) addEvidence('Dark Cloud Cover', 'BEAR'); } catch { /* ignore */ }
      try { if (candlestick.isTweezersTop(p, c)) addEvidence('Tweezers Top', 'BEAR'); } catch { /* ignore */ }
      try { if (candlestick.isTweezersBottom(p, c)) addEvidence('Tweezers Bottom', 'BULL'); } catch { /* ignore */ }
  }

  // 3-Candle Patterns
  if (recent.length >= 3) {
      const p2 = recent[recent.length - 3];
      const p1 = recent[recent.length - 2];
      const c = recent[recent.length - 1];

      try { if (candlestick.isMorningStar(p2, p1, c)) addEvidence('Morning Star', 'BULL'); } catch { /* ignore */ }
      try { if (candlestick.isEveningStar(p2, p1, c)) addEvidence('Evening Star', 'BEAR'); } catch { /* ignore */ }
      try { if (candlestick.isThreeWhiteSoldiers(p2, p1, c)) addEvidence('Three White Soldiers', 'BULL'); } catch { /* ignore */ }
      try { if (candlestick.isThreeBlackCrows(p2, p1, c)) addEvidence('Three Black Crows', 'BEAR'); } catch { /* ignore */ }
  }

  return evidence;
}
