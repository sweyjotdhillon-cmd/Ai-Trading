import { describe, it, expect } from 'vitest';
import { emaSlope } from '../calculus';

describe('emaSlope', () => {
  it('should return empty array or zeros for empty input', () => {
    expect(emaSlope([])).toEqual([]);
    expect(emaSlope([1])).toEqual([0]);
  });

  it('should return zeros when input length is less than period', () => {
    // ema sets all values to 0 when length < period.
    // firstDerivative of [0, 0, 0] is [0, 0, 0]
    expect(emaSlope([1, 2, 3], 5)).toEqual([0, 0, 0]);
  });

  it('should eventually return 0 slope for a constant series', () => {
    const constSeries = new Array(20).fill(100);
    const slope = emaSlope(constSeries, 5);

    // Check the last few elements
    for (let i = 10; i < slope.length; i++) {
      expect(slope[i]).toBeCloseTo(0, 4);
    }
  });

  it('should return positive slope for linearly increasing series', () => {
    const incSeries = Array.from({ length: 20 }, (_, i) => i + 1);
    const slope = emaSlope(incSeries, 5);

    // Check the last few elements to ensure it stabilized
    for (let i = 10; i < slope.length; i++) {
      expect(slope[i]).toBeGreaterThan(0);
      expect(slope[i]).toBeCloseTo(1, 1); // For a linear series with slope 1, EMA slope approaches 1
    }
  });

  it('should return negative slope for linearly decreasing series', () => {
    const decSeries = Array.from({ length: 20 }, (_, i) => 20 - i);
    const slope = emaSlope(decSeries, 5);

    // Check the last few elements to ensure it stabilized
    for (let i = 10; i < slope.length; i++) {
      expect(slope[i]).toBeLessThan(0);
      expect(slope[i]).toBeCloseTo(-1, 1); // For a linear series with slope -1, EMA slope approaches -1
    }
  });
});
