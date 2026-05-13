import { describe, it, expect } from 'vitest';
import { rsi } from '../indicators';

describe('RSI Indicator', () => {
  it('should return an array of zeros if closes length is less than or equal to period', () => {
    const closes = [10, 20, 30];
    const result = rsi(closes, 14);
    expect(result).toEqual([0, 0, 0]);
  });

  it('should return 50 for a constant series', () => {
    const closes = new Array(20).fill(100);
    const result = rsi(closes, 14);

    // First 14 elements are 0, from index 14 onwards it should be 50
    expect(result.slice(0, 14)).toEqual(new Array(14).fill(0));
    result.slice(14).forEach(val => {
      expect(val).toBeCloseTo(50, 2);
    });
  });

  it('should approach 100 for a purely increasing series', () => {
    const closes = Array.from({ length: 20 }, (_, i) => i * 10);
    const result = rsi(closes, 14);

    // First 14 elements are 0
    expect(result.slice(0, 14)).toEqual(new Array(14).fill(0));

    // Since loss is 0, rs will be divided by EPSILON which is very small, making RSI very close to 100
    result.slice(14).forEach(val => {
      expect(val).toBeGreaterThan(99);
    });
  });

  it('should approach 0 for a purely decreasing series', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 200 - i * 10);
    const result = rsi(closes, 14);

    // First 14 elements are 0
    expect(result.slice(0, 14)).toEqual(new Array(14).fill(0));

    // Since gain is 0, rs is 0, RSI = 100 - (100 / 1) = 0
    result.slice(14).forEach(val => {
      expect(val).toBeCloseTo(0, 2);
    });
  });

  it('should correctly calculate RSI for a known oscillating series', () => {
    const period = 3;
    const closes = [10, 20, 10, 20, 10, 20, 10];
    const result = rsi(closes, period);

    // First 3 elements are 0
    expect(result.slice(0, 3)).toEqual([0, 0, 0]);

    // i=3 (after first period):
    // diffs: +10, -10, +10
    // avgGain = 20 / 3 = 6.666
    // avgLoss = 10 / 3 = 3.333
    // rs = 2 -> RSI = 100 - (100 / 3) = 66.666
    expect(result[3]).toBeCloseTo(66.666, 2);

    // i=4:
    // diff: -10
    // avgGain = (6.666 * 2 + 0) / 3 = 4.444
    // avgLoss = (3.333 * 2 + 10) / 3 = 5.555
    // rs = 4.444 / 5.555 = 0.8 -> RSI = 100 - (100 / 1.8) = 44.444
    expect(result[4]).toBeCloseTo(44.444, 2);
  });
});
