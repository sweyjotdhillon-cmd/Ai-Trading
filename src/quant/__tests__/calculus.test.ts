import { describe, it, expect } from 'vitest';
import { firstDerivative } from '../calculus';

describe('Calculus Module', () => {
  describe('firstDerivative', () => {
    it('returns array of zeros for series of length < 2', () => {
      expect(firstDerivative([])).toEqual([]);
      expect(firstDerivative([5])).toEqual([0]);
    });

    it('calculates correct derivative for simple linear series', () => {
      // y = x (slope 1)
      const series = [1, 2, 3, 4, 5];
      const result = firstDerivative(series);

      // Expected:
      // dev[0] = (2 - 1) / 1 = 1
      // dev[1] = (3 - 1) / 2 = 1
      // dev[2] = (4 - 2) / 2 = 1
      // dev[3] = (5 - 3) / 2 = 1
      // dev[4] = (5 - 4) / 1 = 1
      expect(result).toEqual([1, 1, 1, 1, 1]);
    });

    it('handles negative slopes', () => {
      // y = -2x (slope -2)
      const series = [10, 8, 6, 4, 2];
      const result = firstDerivative(series);

      expect(result).toEqual([-2, -2, -2, -2, -2]);
    });

    it('calculates non-linear series derivatives', () => {
      // y = x^2 (approximate slopes)
      const series = [0, 1, 4, 9, 16];
      const result = firstDerivative(series);

      // dev[0] = (1 - 0) / 1 = 1
      // dev[1] = (4 - 0) / 2 = 2
      // dev[2] = (9 - 1) / 2 = 4
      // dev[3] = (16 - 4) / 2 = 6
      // dev[4] = (16 - 9) / 1 = 7
      expect(result).toEqual([1, 2, 4, 6, 7]);
    });

    it('respects h parameter', () => {
      const series = [1, 2, 3, 4, 5];
      const result = firstDerivative(series, 2); // h = 2

      // Since h=2, expected result is [0.5, 0.5, 0.5, 0.5, 0.5]
      expect(result).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    });
  });
});
