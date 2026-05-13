import { describe, it, expect } from 'vitest';
import { atr } from '../indicators';

describe('ATR Indicator', () => {
  it('should return an array of zeros if candles length is <= period', () => {
    const candles = [
      { high: 10, low: 5, close: 8 },
      { high: 12, low: 6, close: 10 },
    ];
    const period = 5;
    const result = atr(candles, period);
    expect(result).toEqual([0, 0]);
  });

  it('should calculate ATR correctly for a basic series', () => {
    const candles = [
      { high: 10, low: 5, close: 8 }, // TR: 5 (10-5)
      { high: 12, low: 7, close: 11 }, // TR: Math.max(12-7=5, |12-8|=4, |7-8|=1) => 5
      { high: 15, low: 10, close: 14 }, // TR: Math.max(15-10=5, |15-11|=4, |10-11|=1) => 5
      { high: 16, low: 14, close: 15 }, // TR: Math.max(16-14=2, |16-14|=2, |14-14|=0) => 2
    ];
    // period = 2
    // TR array: [5, 5, 5, 2]
    // sum(tr[1..2]) = tr[1]+tr[2] = 5 + 5 = 10
    // result[2] = 10 / 2 = 5
    // result[3] = (result[2] * 1 + tr[3]) / 2 = (5 + 2) / 2 = 3.5

    const period = 2;
    const result = atr(candles, period);
    expect(result.length).toBe(4);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(5);
    expect(result[3]).toBe(3.5);
  });

  it('should handle zero volatility / flat candles', () => {
    const candles = [
      { high: 10, low: 10, close: 10 },
      { high: 10, low: 10, close: 10 },
      { high: 10, low: 10, close: 10 },
    ];
    const period = 2;
    const result = atr(candles, period);
    expect(result.length).toBe(3);

    // EPSILON is 1e-9 from colorSpace.ts, so small TR will be close to 1e-9
    expect(result[2]).toBeCloseTo(1e-9, 5);
  });

  it('should calculate correctly using different combinations of TR max logic', () => {
    const candles = [
      { high: 100, low: 90, close: 95 }, // base
      { high: 120, low: 110, close: 115 }, // gap up, high-prev_close = 120-95=25, TR=25
      { high: 80, low: 70, close: 75 }, // gap down, prev_close-low = 115-70=45, TR=45
      { high: 80, low: 75, close: 78 } // normal, high-low = 5, TR=5
    ];

    const period = 2;
    const result = atr(candles, period);

    // TR: [10, 25, 45, 5]
    // result[2] = (25 + 45) / 2 = 35
    // result[3] = (35 * 1 + 5) / 2 = 20
    expect(result[2]).toBe(35);
    expect(result[3]).toBe(20);
  });
});
