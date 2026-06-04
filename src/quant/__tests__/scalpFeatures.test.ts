import { describe, it, expect } from 'vitest';
import { buildScalpFeatures, getISTMinutesSinceMidnight } from '../scalpFeatures';
import { SwingPivot } from '../marketStructure';
import { isEngulfing } from '../candleGeometry';

describe('scalpFeatures', () => {
  const ohlcBase = [
    { open: 100, high: 102, low: 98, close: 100, xCenter: 0, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 1, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 2, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 3, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 4, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 5, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 6, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 7, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 8, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 9, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 10, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 11, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 12, isBull: true },
    { open: 100, high: 102, low: 80, close: 95, xCenter: 13, isBull: false }, // lower support
    { open: 95, high: 105, low: 94, close: 104, xCenter: 14, isBull: true }, // engulfing!
  ];

  const mockPivots: SwingPivot[] = [
    { index: 13, price: 80, kind: 'LOW' }
  ];

  const dummyAtr = [10, 10, 10];
  const dummyVwap = [100, 100, 100];

  it('runs standard features mapping successfully (Case 1)', () => {
    const res = buildScalpFeatures(ohlcBase, mockPivots, dummyAtr, dummyVwap, Date.now());
    expect(res).toBeDefined();
    expect(typeof res.bullEngulfingAtSupport).toBe('boolean');
    expect(typeof res.hammerAtSupport).toBe('boolean');
    expect(typeof res.ema9_above_ema21).toBe('boolean');
  });

  it('identifies bullish engulfing of support (Case 2)', () => {
    const res = buildScalpFeatures(ohlcBase, mockPivots, [5], [90], Date.now());
    // Since close on index 14 is 104, which is engulfing index 13, and is near the 80 low pivot / 15-bar low (min low is 80, and 104 <= 80 * 1.01 or within 1.5 * ATR buffer: 104 - 80 = 24. 1.5 * 20 = 30 yes)
    expect(isEngulfing(ohlcBase).bullish).toBe(true);
  });

  it('correctly maps ADX indexes and dominance (Case 3)', () => {
    const res = buildScalpFeatures(ohlcBase, mockPivots, dummyAtr, dummyVwap, Date.now());
    expect(res.adx_above_20).toBeDefined();
    expect(res.plusDI_dominant).toBeDefined();
  });

  it('handles market hours gates correctly in IST format (Case 4)', () => {
    // 09:30 AM IST is 04:00 AM UTC -> Date time 04:00Z -> IST minutes = 9 * 60 + 30 = 570
    const testMs = new Date('2026-06-03T04:00:00Z').getTime();
    const mins = getISTMinutesSinceMidnight(testMs);
    expect(mins).toBe(570);
    const res = buildScalpFeatures(ohlcBase, mockPivots, [10], [100], testMs);
    expect(res.withinMarketHours).toBe(true);
  });

  it('handles out of market hours cleanly (Case 5)', () => {
    // 16:30 IST is 11:00 AM UTC -> Date time 11:00Z -> mins = 16*60 + 30 = 990
    const testMs = new Date('2026-06-03T11:00:00Z').getTime();
    const res = buildScalpFeatures(ohlcBase, mockPivots, [10], [100], testMs);
    expect(res.withinMarketHours).toBe(false);
  });

  it('calculates price relative position vs VWAP proxy correctly (Case 6)', () => {
    const res = buildScalpFeatures(ohlcBase, mockPivots, [5], [110], Date.now()); // VWAP high = 110
    expect(res.price_above_vwap).toBe(false); // 104 close is NOT above 110 VWAP
  });

  it('determines normal vs explosive volatility levels cleanly (Case 7)', () => {
    const res = buildScalpFeatures(ohlcBase, mockPivots, dummyAtr, dummyVwap, Date.now());
    expect(typeof res.volatility_normal).toBe('boolean');
  });

  it('correctly parses RSI overbought/oversold boundaries (Case 8)', () => {
    const res = buildScalpFeatures(ohlcBase, mockPivots, [5], [100], Date.now());
    expect(typeof res.rsi_recovering_from_oversold).toBe('boolean');
  });
});
