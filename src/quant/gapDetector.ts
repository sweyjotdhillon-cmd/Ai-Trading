import { NumericOHLC } from "../vision/pipeline";

export type GapType = 'GAP_UP' | 'GAP_DOWN' | 'PARTIAL_GAP_UP' | 'PARTIAL_GAP_DOWN';

export interface GapEvidence {
  type: GapType;
  direction: 'BULL' | 'BEAR';
  strength: number;
  index: number;
}

export function detectLatestGap(ohlcSeries: NumericOHLC[], partialThreshold = 0.5): GapEvidence | null {
  if (ohlcSeries.length < 2) return null;
  const prev = ohlcSeries[ohlcSeries.length - 2];
  const curr = ohlcSeries[ohlcSeries.length - 1];

  if (curr.low > prev.high) {
    const span = Math.max(1e-12, curr.high - curr.low);
    return { type: 'GAP_UP', direction: 'BULL', strength: Math.min(1, (curr.low - prev.high) / span), index: ohlcSeries.length - 1 };
  }

  if (curr.high < prev.low) {
    const span = Math.max(1e-12, curr.high - curr.low);
    return { type: 'GAP_DOWN', direction: 'BEAR', strength: Math.min(1, (prev.low - curr.high) / span), index: ohlcSeries.length - 1 };
  }

  const upGapRatio = (curr.open - prev.high) / Math.max(1e-12, prev.high - prev.low);
  if (curr.open > prev.high && upGapRatio >= partialThreshold) {
    return { type: 'PARTIAL_GAP_UP', direction: 'BULL', strength: Math.min(1, upGapRatio), index: ohlcSeries.length - 1 };
  }

  const downGapRatio = (prev.low - curr.open) / Math.max(1e-12, prev.high - prev.low);
  if (curr.open < prev.low && downGapRatio >= partialThreshold) {
    return { type: 'PARTIAL_GAP_DOWN', direction: 'BEAR', strength: Math.min(1, downGapRatio), index: ohlcSeries.length - 1 };
  }

  return null;
}
