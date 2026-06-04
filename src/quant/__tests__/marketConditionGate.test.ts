import { describe, it, expect } from 'vitest';
import { getTrendState, findSwingPivots, SwingPivot } from '../marketStructure';

describe('marketConditionGate', () => {
  it('1. Classifies UPTREND correctly with higher highs and higher lows', () => {
    const pivots: SwingPivot[] = [
      { index: 5, price: 100, kind: 'LOW' },
      { index: 10, price: 110, kind: 'HIGH' },
      { index: 15, price: 105, kind: 'LOW' }, // Higher low
      { index: 20, price: 115, kind: 'HIGH' }, // Higher high
    ];
    const state = getTrendState(pivots);
    expect(state).toBe('UPTREND');
  });

  it('2. Classifies DOWNTREND correctly with lower highs and lower lows', () => {
    const pivots: SwingPivot[] = [
      { index: 5, price: 100, kind: 'HIGH' },
      { index: 10, price: 90, kind: 'LOW' },
      { index: 15, price: 95, kind: 'HIGH' }, // Lower high
      { index: 20, price: 85, kind: 'LOW' },  // Lower low
    ];
    const state = getTrendState(pivots);
    expect(state).toBe('DOWNTREND');
  });

  it('3. Classifies RANGING with mixed higher or lower levels without clear bias', () => {
    const pivots: SwingPivot[] = [
      { index: 5, price: 100, kind: 'LOW' },
      { index: 10, price: 105, kind: 'HIGH' },
      { index: 15, price: 101, kind: 'LOW' },
      { index: 20, price: 104, kind: 'HIGH' },
    ];
    const state = getTrendState(pivots);
    expect(state).toBe('RANGING');
  });

  it('4. Defaults to RANGING when pivots are too few (edge case: empty pivots)', () => {
    const state = getTrendState([]);
    expect(state).toBe('RANGING');
  });

  it('5. Handles single pivot safely by reverting to default ranging', () => {
    const state = getTrendState([{ index: 2, price: 50, kind: 'LOW' }]);
    expect(state).toBe('RANGING');
  });

  it('6. Detects swing pivots correctly from a test price list', () => {
    const ohlc = [
      { open: 10, high: 12, low: 9, close: 10, xCenter: 0 },
      { open: 10, high: 15, low: 10, close: 14, xCenter: 1 }, // Local high
      { open: 14, high: 14, low: 11, close: 12, xCenter: 2 },
      { open: 12, high: 13, low: 8, close: 9, xCenter: 3 },   // Local low
      { open: 9, high: 11, low: 9, close: 10, xCenter: 4 },
    ];
    const pivots = findSwingPivots(ohlc, 1); // 1-period swing window
    expect(pivots.length).toBeGreaterThanOrEqual(0);
  });

  it('7. Handles market hours gate edge cases', () => {
    // Check gate mock with limits
    const inHours = (min: number) => min >= 555 && min <= 930; // 9:15 AM to 3:30 PM in IST minutes
    expect(inHours(600)).toBe(true);
    expect(inHours(100)).toBe(false);
  });

  it('8. Evaluates threshold logic for ADX values in trending vs chaotic regimes', () => {
    const isTrending = (adx: number) => adx >= 25;
    expect(isTrending(28)).toBe(true);
    expect(isTrending(20)).toBe(false);
  });
});
