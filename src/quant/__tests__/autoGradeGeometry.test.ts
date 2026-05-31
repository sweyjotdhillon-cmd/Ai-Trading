import { describe, it, expect } from 'vitest';
import { buildAutoGradeGeometry } from '../autoGradeGeometry';

describe('AutoGradeGeometry', () => {
  it('T1: calculates correct coordinates for synthetic right-slice OHLC', () => {
    // [{open:100, high:105, low:99, close:104}, {open:104, high:106, low:102, close:103}]
    // entryClose = 100
    const ohlc = [
      { low: 99, high: 105, close: 104, open: 100, xCenter: 0, isBull: true },
      { low: 102, high: 106, close: 103, open: 104, xCenter: 0, isBull: false }
    ];
    const centersX = [0.1, 0.5];
    const entryClose = 100;
    
    // yMin = Math.min(...) -> 99. entryClose = 100 -> min is 99
    // yMax = Math.max(...) -> 106. entryClose = 100 -> max is 106
    // range = 7
    // entryY = (106 - 100) / 7 = 6/7 = 0.857...
    // exitClose = 104 (first candle)
    // exitY = (106 - 104) / 7 = 2/7 = 0.285...
    
    const geom = buildAutoGradeGeometry(ohlc, centersX, entryClose);
    expect(geom.valid).toBe(true);
    expect(geom.entryY).toBeCloseTo(6/7, 4);
    expect(geom.exitY).toBeCloseTo(2/7, 4);
    expect(geom.exitCandleIndex).toBe(0);
    expect(geom.exitX).toBe(0.1);
  });

  it('T2: Flat-price right slice', () => {
    const ohlc = [
      { low: 100, high: 100, close: 100, open: 100, xCenter: 0, isBull: false }
    ];
    const geom = buildAutoGradeGeometry(ohlc, [0.5], 100);
    expect(geom.valid).toBe(false);
    expect(geom.invalidReason).toBe('PRICE_FLAT');
  });

  it('T3: Empty right-slice OHLC', () => {
    const geom = buildAutoGradeGeometry([], [], 100);
    expect(geom.valid).toBe(false);
    expect(geom.invalidReason).toBe('NO_RIGHT_SLICE_OHLC');
  });

  it('T4: No clamping for entryClose far above right-slice high', () => {
    const ohlc = [
      { low: 10, high: 20, close: 15, open: 10, xCenter: 0, isBull: true }
    ];
    const entryClose = 50; // Way above
    const geom = buildAutoGradeGeometry(ohlc, [0.5], entryClose);
    // yMax should be 50. yMin should be 10.
    // range = 40. entryY = (50 - 50) / 40 = 0
    expect(geom.valid).toBe(true);
    expect(geom.entryY).toBe(0);
  });

  it('T5: Determinism', () => {
    const ohlc = [
      { low: 100, high: 120, close: 110, open: 100, xCenter: 0, isBull: true }
    ];
    const geom1 = buildAutoGradeGeometry(ohlc, [0.2], 105);
    const geom2 = buildAutoGradeGeometry(ohlc, [0.2], 105);
    expect(geom1).toEqual(geom2);
  });
});
