import { describe, it, expect } from 'vitest';
import { sma } from '../indicators';

describe('Indicators - SMA (Simple Moving Average)', () => {
  it('should calculate SMA correctly for a typical series of numbers', () => {
    const values = [10, 20, 30, 40, 50, 60];
    const period = 3;
    const result = sma(values, period);

    // SMA should be 0 for index 0 and 1, and the average of the last 3 for index 2 onwards
    // [0, 0, (10+20+30)/3, (20+30+40)/3, (30+40+50)/3, (40+50+60)/3]
    // [0, 0, 20, 30, 40, 50]
    expect(result).toEqual([0, 0, 20, 30, 40, 50]);
  });

  it('should handle period larger than array length gracefully', () => {
    const values = [10, 20];
    const period = 5;
    const result = sma(values, period);

    // As per the code logic: if period > values.length, no element gets (i >= period - 1) true
    // Thus it should return an array of 0s
    expect(result).toEqual([0, 0]);
  });

  it('should handle an empty array', () => {
    const values: number[] = [];
    const period = 3;
    const result = sma(values, period);

    expect(result).toEqual([]);
  });

  it('should calculate SMA correctly with negative numbers', () => {
    const values = [-10, -20, -30, -40, -50];
    const period = 3;
    const result = sma(values, period);

    // [0, 0, (-10-20-30)/3, (-20-30-40)/3, (-30-40-50)/3]
    // [0, 0, -20, -30, -40]
    expect(result).toEqual([0, 0, -20, -30, -40]);
  });

  it('should calculate SMA correctly with a mix of positive and negative numbers', () => {
    const values = [10, -10, 10, -10, 10];
    const period = 2;
    const result = sma(values, period);

    // [0, 0/2, 0/2, 0/2, 0/2] = [0, 0, 0, 0, 0]
    expect(result).toEqual([0, 0, 0, 0, 0]);
  });

  it('should calculate SMA correctly when period is 1', () => {
    const values = [1, 2, 3, 4, 5];
    const period = 1;
    const result = sma(values, period);

    // SMA with period 1 should just return the values themselves
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });
});
