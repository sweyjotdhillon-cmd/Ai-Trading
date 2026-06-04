import { describe, it, expect } from 'vitest';
import { sma } from '../indicators';

describe('Indicators - SMA (Simple Moving Average)', () => {
  it('should calculate SMA correctly for a typical series of numbers', () => {
    const values = [10, 20, 30, 40, 50, 60];
    const period = 3;
    const result = sma(values, period);

    // SMA should compute partial averages for the initial indices
    expect(result).toEqual([10, 15, 20, 30, 40, 50]);
  });

  it('should handle period larger than array length gracefully', () => {
    const values = [10, 20];
    const period = 5;
    const result = sma(values, period);

    // Should return the partial cumulative averages up to values length
    expect(result).toEqual([10, 15]);
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

    expect(result).toEqual([-10, -15, -20, -30, -40]);
  });

  it('should calculate SMA correctly with a mix of positive and negative numbers', () => {
    const values = [10, -10, 10, -10, 10];
    const period = 2;
    const result = sma(values, period);

    expect(result).toEqual([10, 0, 0, 0, 0]);
  });

  it('should calculate SMA correctly when period is 1', () => {
    const values = [1, 2, 3, 4, 5];
    const period = 1;
    const result = sma(values, period);

    // SMA with period 1 should just return the values themselves
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });
});
