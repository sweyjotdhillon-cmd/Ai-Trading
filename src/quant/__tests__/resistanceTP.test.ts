import { describe, it, expect } from 'vitest';
import { buildExitPlan } from '../scalpingEngine';
import { ScalpContext } from '../scalpingEngine';

describe('resistanceTP', () => {
  const defaultContext: ScalpContext = {
    config: {
      capitalRupees: 100000,
      riskPerTradePct: 1,
      maxPositionPctCapital: 30,
      leverage: 1,
      instrument: 'EQUITY_INTRADAY',
      lotSize: 1,
      slMode: 'ATR',
      atrMultiplierSL: 1.5,
      slPercent: 0.5,
      tpMode: 'PARTIAL_RR',
      rrRatio: 2.5,
      tp1RMultiple: 1.0,
      trailMultiplier: 1.5,
      minConfluence: 3,
      minRR: 1.5,
      longOnly: true,
      enableMarketHoursGate: false,
      enablePredictabilityGate: false,
      risk: {
        dailyLossCapRupees: 2000,
        maxTradesPerDay: 5,
        maxConsecutiveLosses: 3,
        cooldownMinutes: 10,
        slippageTicks: 1,
      },
      maxHoldingMinutes: 5,
    },
    riskState: {
      dailyPnL: 0,
      tradesToday: 0,
      consecutiveLosses: 0,
      lastTradeAt: 0,
      inCooldown: false,
      cooldownUntil: 0,
      dateKey: '2026-06-03',
    },
    pivots: [
      { index: 8, price: 105, kind: 'HIGH' }
    ],
    atr14: [1, 1, 1, 1, 1],
    vwapProxy: [100, 100, 100, 100, 100],
    nowMsEpoch: Date.now(),
    nowISTMinutesSinceMidnight: 600,
    currentBarIndex: 14,
  };

  it('1. Calculates exit plan with correct default tp1 and tp2', () => {
    const exits = buildExitPlan(100, 98, defaultContext);
    // Risk = 100 - 98 = 2.
    // tp1 = 100 + 2 * 1.0 = 102
    // tp2 = 100 + 2 * 2.5 = 105
    expect(exits.tp1).toBe(102);
    expect(exits.tp2).toBe(105);
  });

  it('2. Evaluates trailing activation at correct target', () => {
    const exits = buildExitPlan(100, 98, defaultContext);
    expect(exits.trailingActivate).toBe(exits.tp1);
  });

  it('3. Sets dynamic break even trigger', () => {
    const exits = buildExitPlan(100, 98, defaultContext);
    expect(exits.breakEvenAfter).toBe(exits.tp1);
  });

  it('4. Computes trailing distance properly based on ATR and multiplier config', () => {
    const exits = buildExitPlan(100, 98, defaultContext);
    // atr14 = 1, trailMultiplier = 1.5 -> distance = 1.5
    expect(exits.trailingDistance).toBe(1.5);
  });

  it('5. Computes correct R:R matches', () => {
    const exits = buildExitPlan(100, 98, defaultContext);
    expect(exits.rr).toBe(2.5);
  });

  it('6. Adjusts tp1 target based on dynamic R multiples', () => {
    const customCtx = {
      ...defaultContext,
      config: { ...defaultContext.config, tp1RMultiple: 0.5 }
    };
    const exits = buildExitPlan(100, 98, customCtx);
    expect(exits.tp1).toBe(101); // 100 + 2 * 0.5 = 101
  });

  it('7. Adapts trailing variables when trailMultiplier decreases', () => {
    const tighterCtx = {
      ...defaultContext,
      config: { ...defaultContext.config, trailMultiplier: 0.8 }
    };
    const exits = buildExitPlan(100, 98, tighterCtx);
    expect(exits.trailingDistance).toBe(0.8);
  });

  it('8. Safeguards against extremely small SL risk', () => {
    // Should throw or handle fractional inputs elegantly
    expect(() => buildExitPlan(100, 100, defaultContext)).toThrow('Invalid SL');
  });
});
