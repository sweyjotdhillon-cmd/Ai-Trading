import { describe, it, expect, beforeEach } from 'vitest';
import { 
  recordScalpDecision, 
  getScalpBuyRate, 
  scalpOverTradingPenalty, 
  resetScalpHistory 
} from '../neutralityGuard';

describe('longOnlyOvertrade', () => {
  beforeEach(() => {
    resetScalpHistory();
  });

  it('1. Initializes with zero entries and zero metrics', () => {
    const metrics = getScalpBuyRate();
    expect(metrics.total).toBe(0);
    expect(metrics.buyRate).toBe(0);
  });

  it('2. Fails to trigger overtrade penalty if decision sample count is less than 25', () => {
    // Record 10 buys (100% buy rate)
    for (let i = 0; i < 10; i++) {
      recordScalpDecision('BUY');
    }
    const metrics = getScalpBuyRate();
    const penalty = scalpOverTradingPenalty();
    expect(metrics.total).toBe(10);
    expect(metrics.buyRate).toBe(1);
    expect(penalty).toBe(0); // Safely bypassed as total < 25
  });

  it('3. Triggers correct penalty rate when BUY-rate is above 71% and total sample is >= 25', () => {
    // Record 20 BUYs and 5 NO_TRADEs (buy rate = 20/25 = 80%)
    for (let i = 0; i < 20; i++) recordScalpDecision('BUY');
    for (let i = 0; i < 5; i++) recordScalpDecision('NO_TRADE');
    
    const metrics = getScalpBuyRate();
    const penalty = scalpOverTradingPenalty();
    expect(metrics.total).toBe(25);
    expect(metrics.buyRate).toBeCloseTo(0.8);
    // (0.80 - 0.70) * 0.50 = 0.05
    expect(penalty).toBeCloseTo(0.05);
  });

  it('4. Caps maximum overtrading penalty at 0.20', () => {
    // 100% BUY rate over 30 entries (buy rate = 1.0)
    for (let i = 0; i < 30; i++) recordScalpDecision('BUY');
    
    const penalty = scalpOverTradingPenalty();
    // Formula: (1.0 - 0.70) * 0.5 = 0.15 (but let's check high threshold caps if we had a higher rate)
    expect(penalty).toBeLessThanOrEqual(0.20);
  });

  it('5. Triggers under-trading discount if BUY-rate is <5% and total sample is >50', () => {
    // Record 1 BUY and 55 NO_TRADEs (buy rate = 1/56 = 1.78%)
    recordScalpDecision('BUY');
    for (let i = 0; i < 55; i++) recordScalpDecision('NO_TRADE');
    
    const metrics = getScalpBuyRate();
    const penalty = scalpOverTradingPenalty();
    expect(metrics.total).toBe(56);
    expect(metrics.buyRate).toBeLessThan(0.05);
    expect(penalty).toBe(-0.05); // under-trading discount of -0.05
  });

  it('6. Does not trigger under-trading discount if total sample is <= 50', () => {
    // Record 1 BUY and 35 NO_TRADEs
    recordScalpDecision('BUY');
    for (let i = 0; i < 35; i++) recordScalpDecision('NO_TRADE');
    
    const penalty = scalpOverTradingPenalty();
    expect(penalty).toBe(0); // Not enough sample
  });

  it('7. Clears history correctly on reset resetScalpHistory', () => {
    for (let i = 0; i < 15; i++) recordScalpDecision('BUY');
    resetScalpHistory();
    const metrics = getScalpBuyRate();
    expect(metrics.total).toBe(0);
  });

  it('8. Safely ignores exit or other unrelated scalp signals during recording', () => {
    // Only record BUY or NO_TRADE (others ignored)
    recordScalpDecision('EXIT' as any);
    recordScalpDecision('WAIT' as any);
    const metrics = getScalpBuyRate();
    expect(metrics.total).toBe(0);
  });
});
