import { describe, it, expect } from 'vitest';
import { macd } from '../indicators';

describe('macd', () => {
  it('handles input shorter than slowWindow gracefully', () => {
    // slowWindow default is 26
    const closes = new Array(20).fill(100);
    const result = macd(closes);

    expect(result.macd.length).toBe(20);
    expect(result.signal.length).toBe(20);
    expect(result.hist.length).toBe(20);

    // Should be filled with 0s or expected values where it can't compute slow EMA.
    // Since fastWindow is 12 and slowWindow is 26:
    // Fast EMA is populated for indices 11-19, but slow EMA is entirely 0s.
    // MACD = fastEma - slowEma, so for indices 11-19, MACD = 100 - 0 = 100.
    for (let i = 0; i < 11; i++) {
      expect(result.macd[i]).toBe(0);
    }
    for (let i = 11; i < 20; i++) {
      expect(result.macd[i]).toBe(100);
    }
  });

  it('produces 0s for constant values', () => {
    const closes = new Array(150).fill(100);
    const result = macd(closes);

    // After the initial windows, MACD should settle to 0
    // slowWindow is 26, signalWindow is 9, let's check the end of the array
    const lastIdx = closes.length - 1;

    // Allow small floating point differences
    expect(result.macd[lastIdx]).toBeCloseTo(0, 5);
    expect(result.signal[lastIdx]).toBeCloseTo(0, 5);
    expect(result.hist[lastIdx]).toBeCloseTo(0, 5);
  });

  it('produces positive MACD for uptrending values', () => {
    const closes = [];
    let price = 10;
    for (let i = 0; i < 50; i++) {
      closes.push(price);
      price += 1;
    }
    const result = macd(closes);

    // In a steady uptrend, fast EMA > slow EMA, so MACD should be positive
    const lastIdx = closes.length - 1;
    expect(result.macd[lastIdx]).toBeGreaterThan(0);
  });

  it('produces negative MACD for downtrending values', () => {
    const closes = [];
    let price = 100;
    for (let i = 0; i < 50; i++) {
      closes.push(price);
      price -= 1;
    }
    const result = macd(closes);

    // In a steady downtrend, fast EMA < slow EMA, so MACD should be negative
    const lastIdx = closes.length - 1;
    expect(result.macd[lastIdx]).toBeLessThan(0);
  });
});
