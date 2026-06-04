import { describe, it, expect } from 'vitest';
import { vwapProxy } from '../vwapProxy';

describe('vwapProxy', () => {
  const mockOhlc = [
    { open: 100, high: 105, low: 95, close: 100 }, // TP = 100
    { open: 100, high: 110, low: 99, close: 106 }, // TP = 105
    { open: 106, high: 115, low: 105, close: 110 }, // TP = 110
    { open: 110, high: 120, low: 110, close: 115 }, // TP = 115
    { open: 115, high: 125, low: 115, close: 120 }, // TP = 120
    { open: 120, high: 130, low: 120, close: 125 }, // TP = 125
  ];

  it('calculates anchored proxy correctly (Case 1)', () => {
    const result = vwapProxy(mockOhlc, { mode: 'ANCHORED' });
    expect(result[0]).toBeCloseTo(100, 4);
    expect(result[1]).toBeCloseTo((100 + 105) / 2, 4);
    expect(result[2]).toBeCloseTo((100 + 105 + 110) / 3, 4);
  });

  it('calculates rolling proxy correctly with window 3 (Case 2)', () => {
    const result = vwapProxy(mockOhlc, { mode: 'ROLLING', window: 3 });
    expect(result[0]).toBeCloseTo(100, 4);
    expect(result[1]).toBeCloseTo((100 + 105) / 2, 4);
    expect(result[2]).toBeCloseTo((100 + 105 + 110) / 3, 4);
    expect(result[3]).toBeCloseTo((105 + 110 + 115) / 3, 4);
    expect(result[4]).toBeCloseTo((110 + 115 + 120) / 3, 4);
  });

  it('handles empty ohlc gracefully (Case 3)', () => {
    const result = vwapProxy([]);
    expect(result).toEqual([]);
  });

  it('handles single ohlc element (Case 4)', () => {
    const single = [{ open: 10, high: 12, low: 8, close: 10 }];
    const result = vwapProxy(single);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(10, 4);
  });

  it('defaults to ANCHORED if no options provided (Case 5)', () => {
    const result = vwapProxy(mockOhlc);
    expect(result).toHaveLength(6);
    expect(result[5]).toBeCloseTo((100 + 105 + 110 + 115 + 120 + 125) / 6, 4);
  });

  it('handles ROLLING mode window larger than array size (Case 6)', () => {
    const result = vwapProxy(mockOhlc, { mode: 'ROLLING', window: 10 });
    expect(result[5]).toBeCloseTo((100 + 105 + 110 + 115 + 120 + 125) / 6, 4);
  });

  it('respects ROLLING mode small window parameters like 2 (Case 7)', () => {
    const result = vwapProxy(mockOhlc, { mode: 'ROLLING', window: 2 });
    expect(result[0]).toBeCloseTo(100, 4);
    expect(result[1]).toBeCloseTo((100 + 105) / 2, 4);
    expect(result[5]).toBeCloseTo((120 + 125) / 2, 4);
  });

  it('anchored typical-price sequence produces expected progression (Case 8)', () => {
    const step = [{ open: 10, high: 10, low: 10, close: 10 }, { open: 20, high: 20, low: 20, close: 20 }];
    const result = vwapProxy(step, { mode: 'ANCHORED' });
    expect(result).toEqual([10, 15]);
  });
});
