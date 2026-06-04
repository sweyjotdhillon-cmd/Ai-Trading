import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadRiskState, saveRiskState, checkRiskCaps, onTradeClosed, resetRiskState } from '../riskGuard';
import { RiskConfig, RiskState } from '../../types';

describe('riskGuard', () => {
  const config: RiskConfig = {
    dailyLossCapRupees: 2000,
    maxTradesPerDay: 5,
    maxConsecutiveLosses: 3,
    cooldownMinutes: 10,
    slippageTicks: 1,
  };

  beforeEach(() => {
    if (typeof window !== 'undefined') {
      localStorage.clear();
    }
  });

  it('provisions a fresh state if none exists (Case 1)', () => {
    const state = loadRiskState();
    expect(state.dailyPnL).toBe(0);
    expect(state.tradesToday).toBe(0);
    expect(state.consecutiveLosses).toBe(0);
    expect(state.inCooldown).toBe(false);
  });

  it('allows trade when well within limits (Case 2)', () => {
    const s: RiskState = {
      dailyPnL: -100,
      tradesToday: 2,
      consecutiveLosses: 1,
      lastTradeAt: Date.now(),
      inCooldown: false,
      cooldownUntil: 0,
      dateKey: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
    };
    const check = checkRiskCaps(s, config);
    expect(check.allow).toBe(true);
  });

  it('blocks trading when daily loss cap is hit (Case 3)', () => {
    const s: RiskState = {
      dailyPnL: -2100,
      tradesToday: 3,
      consecutiveLosses: 2,
      lastTradeAt: Date.now(),
      inCooldown: false,
      cooldownUntil: 0,
      dateKey: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
    };
    const check = checkRiskCaps(s, config);
    expect(check.allow).toBe(false);
    expect(check.reason).toContain('DAILY_LOSS_CAP');
  });

  it('blocks trading when maximum trades per day are reached (Case 4)', () => {
    const s: RiskState = {
      dailyPnL: 500,
      tradesToday: 5,
      consecutiveLosses: 0,
      lastTradeAt: Date.now(),
      inCooldown: false,
      cooldownUntil: 0,
      dateKey: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
    };
    const check = checkRiskCaps(s, config);
    expect(check.allow).toBe(false);
    expect(check.reason).toContain('MAX_TRADES');
  });

  it('blocks trading when maximum consecutive losses are exceeded (Case 5)', () => {
    const s: RiskState = {
      dailyPnL: -100,
      tradesToday: 3,
      consecutiveLosses: 3,
      lastTradeAt: Date.now(),
      inCooldown: false,
      cooldownUntil: 0,
      dateKey: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
    };
    const check = checkRiskCaps(s, config);
    expect(check.allow).toBe(false);
    expect(check.reason).toContain('CONSECUTIVE_LOSSES');
  });

  it('handles cooling down timers correctly (Case 6)', () => {
    const now = Date.now();
    const s: RiskState = {
      dailyPnL: -100,
      tradesToday: 1,
      consecutiveLosses: 1,
      lastTradeAt: now - 1000,
      inCooldown: true,
      cooldownUntil: now + 5 * 60 * 1000, // 5 minutes remaining
      dateKey: new Date(now + 330 * 60_000).toISOString().slice(0, 10),
    };
    const check = checkRiskCaps(s, config, now);
    expect(check.allow).toBe(false);
    expect(check.reason).toBe('COOLDOWN');
    expect(check.remainingMs).toBeCloseTo(5 * 60 * 1000, -2);
  });

  it('updates state properly on a closed profit/loss (Case 7)', () => {
    const now = Date.now();
    const s1 = resetRiskState(now);
    
    // First trade matches a loss of -500
    const s2 = onTradeClosed(s1, -500, config, now);
    expect(s2.dailyPnL).toBe(-500);
    expect(s2.tradesToday).toBe(1);
    expect(s2.consecutiveLosses).toBe(1);
    expect(s2.inCooldown).toBe(true);
    expect(s2.cooldownUntil).toBe(now + 10 * 60_000);

    // Second trade matches a win of +1000 (cooldown is unlocked)
    const s3 = onTradeClosed(s2, 1000, config, now + 1000);
    expect(s3.dailyPnL).toBe(500);
    expect(s3.tradesToday).toBe(2);
    expect(s3.consecutiveLosses).toBe(0);
    expect(s3.inCooldown).toBe(false);
  });

  it('rolls over on date change (Case 8)', () => {
    const now = Date.now();
    const s: RiskState = {
      dailyPnL: -5000,
      tradesToday: 12,
      consecutiveLosses: 4,
      lastTradeAt: now,
      inCooldown: true,
      cooldownUntil: now + 10_000,
      dateKey: '2026-06-02',
    };
    saveRiskState(s);
    
    // Day changes to 2026-06-03
    const nextDayMs = new Date('2026-06-03T00:00:00Z').getTime() - 330 * 60_000; // roll over
    const activeState = loadRiskState(nextDayMs + 100);
    expect(activeState.dailyPnL).toBe(0);
    expect(activeState.tradesToday).toBe(0);
    expect(activeState.consecutiveLosses).toBe(0);
    expect(activeState.dateKey).toBe('2026-06-03');
  });
});
