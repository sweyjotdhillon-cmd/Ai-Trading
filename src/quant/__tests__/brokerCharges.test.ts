import { describe, it, expect } from 'vitest';
import { computeRoundTripCharges } from '../brokerCharges';

describe('brokerCharges', () => {
  it('calculates EQUITY_INTRADAY charges correctly (Case 1)', () => {
    // 100 shares of stock bought at 1000 and sold at 1020
    const res = computeRoundTripCharges(1000, 1020, 100, 'EQUITY_INTRADAY');
    expect(res.brokerage).toBeCloseTo(20 * 2, 4); // max capped at 20 each side
    expect(res.stt).toBeCloseTo(102000 * 0.00025, 4); // 0.025% on sell
    expect(res.exchangeTxn).toBeCloseTo(202000 * 0.0000325, 4); // NSE active txn charges
    expect(res.sebi).toBeCloseTo(202000 * 0.000001, 2);
    expect(res.stampDuty).toBeCloseTo(100000 * 0.00003, 4); // 0.003% on buy
    expect(res.gst).toBeCloseTo((res.brokerage + res.exchangeTxn + res.sebi) * 0.18, 4);
    expect(res.total).toBeGreaterThan(0);
  });

  it('calculates EQUITY_DELIVERY charges correctly (Case 2)', () => {
    const res = computeRoundTripCharges(1000, 1020, 100, 'EQUITY_DELIVERY');
    expect(res.stt).toBeCloseTo(202000 * 0.001, 4); // 0.1% on buy + sell (total turnover)
  });

  it('calculates INDEX_FUT charges correctly (Case 3)', () => {
    const res = computeRoundTripCharges(1000, 1020, 100, 'INDEX_FUT');
    expect(res.stt).toBeCloseTo(102000 * 0.0002, 4); // 0.02% on sell turnover
  });

  it('calculates INDEX_OPT charges correctly (Case 4)', () => {
    const res = computeRoundTripCharges(100, 120, 100, 'INDEX_OPT');
    expect(res.stt).toBeCloseTo(12000 * 0.001, 4); // 0.1% on sell option premium
  });

  it('verifies brokerage capping at ₹20 per side works (Case 5)', () => {
    // Large trade 1 crore turnover
    const res = computeRoundTripCharges(10000, 10000, 10000, 'EQUITY_INTRADAY');
    expect(res.brokerage).toBe(40); // 20 * 2
  });

  it('verifies percentage brokerage for very small trades (Case 6)', () => {
    // 1 share of stock bought at ₹100
    const res = computeRoundTripCharges(100, 100, 1, 'EQUITY_INTRADAY');
    expect(res.brokerage).toBeCloseTo(0.06, 4); // 100 * 0.0003 * 2 = 0.06
  });

  it('handles zero shares correctly producing zero charges (Case 7)', () => {
    const res = computeRoundTripCharges(1000, 1000, 0, 'EQUITY_INTRADAY');
    expect(res.total).toBe(0);
  });

  it('verifies expected active GST calculation (Case 8)', () => {
    const res = computeRoundTripCharges(100, 100, 1, 'EQUITY_INTRADAY');
    const expectedBase = res.brokerage + res.exchangeTxn + res.sebi;
    expect(res.gst).toBeCloseTo(expectedBase * 0.18, 5);
  });
});
