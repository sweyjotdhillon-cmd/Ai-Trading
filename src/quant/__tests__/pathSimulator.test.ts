import { describe, it, expect } from 'vitest';
import { simulateScalpTrade } from '../pathSimulator';
import { ScalpingPlan, ScalpConfig } from '../../types';
import { NumericOHLC } from '../../vision/pipeline';

describe('pathSimulator', () => {
  const defaultPlan: ScalpingPlan = {
    entry: 100,
    stopLoss: 98,
    takeProfit1: 101,
    takeProfit2: 104,
    trailingActivate: 101,
    trailingDistance: 1.5,
    breakEvenAfter: 101,
    positionSize: 10,
    riskRupees: 20,
    potentialRewardRupees: 40,
    rrRatio: 2.0,
    maxHoldingMinutes: 5,
    confluenceScore: 8,
    brokerCharges: 5,
    netExpectedPnL: 35,
    slMode: 'AUTO',
    tpMode: 'PARTIAL_RR',
    instrument: 'EQUITY_INTRADAY',
    noteReasons: [],
  };

  const defaultConfig: ScalpConfig = {
    capitalRupees: 100000,
    riskPerTradePct: 1,
    maxPositionPctCapital: 30,
    leverage: 1,
    instrument: 'EQUITY_INTRADAY',
    lotSize: 1,
    slMode: 'AUTO',
    atrMultiplierSL: 1.2,
    slPercent: 0.4,
    tpMode: 'PARTIAL_RR',
    rrRatio: 2.0,
    tp1RMultiple: 1.0,
    trailMultiplier: 1.5,
    minConfluence: 5,
    minRR: 1.5,
    longOnly: true,
    enableMarketHoursGate: false,
    enablePredictabilityGate: false,
    risk: {
      dailyLossCapRupees: 2000,
      maxTradesPerDay: 5,
      maxConsecutiveLosses: 3,
      cooldownMinutes: 10,
      slippageTicks: 0, // Slippage 0 for ease of strict math testing
    },
    maxHoldingMinutes: 5,
  };

  const dummyCharges = (entry: number, exit: number, size: number) => ({ total: 5 });

  it('handles clean TP2 execution (Case 1)', () => {
    const candles: NumericOHLC[] = [
      { open: 100, high: 100.5, low: 99.8, close: 100.2, xCenter: 0, isBull: true },
      { open: 100.2, high: 105, low: 100, close: 104.5, xCenter: 1, isBull: true },
    ];
    const res = simulateScalpTrade(defaultPlan, candles, defaultConfig, dummyCharges);
    expect(res.outcome).toBe('TP2_HIT');
    expect(res.exitPrice).toBe(104); 
    expect(res.realizedPnLGross).toBe(25); // 5 booked at TP1 (101) + 5 booked at TP2 (104) -> (1 * 5) + (4 * 5) = 25
    expect(res.realizedPnL).toBe(20); // Gross - charges
  });

  it('handles clean SL execution (Case 2)', () => {
    const candles: NumericOHLC[] = [
      { open: 100, high: 100.2, low: 97.5, close: 97.8, xCenter: 0, isBull: false },
    ];
    const res = simulateScalpTrade(defaultPlan, candles, defaultConfig, dummyCharges);
    expect(res.outcome).toBe('SL_HIT');
    expect(res.exitPrice).toBe(98);
    expect(res.realizedPnLGross).toBe(-20); // 10 shares * (98 - 100)
  });

  it('handles TP1 hit and break-even SL progression (Case 3)', () => {
    const candles: NumericOHLC[] = [
      { open: 100, high: 101.5, low: 99.5, close: 101.2, xCenter: 0, isBull: true }, // TP1 hit! Position size is halved from 10 to 5. SL moves to 100 (BE_SHIFT)
      { open: 101.2, high: 101.5, low: 99.2, close: 99.5, xCenter: 1, isBull: false }, // Low is 99.2 which touches the break-even SL of 100 -> TRAIL_HIT exit
    ];
    const res = simulateScalpTrade(defaultPlan, candles, defaultConfig, dummyCharges);
    expect(res.outcome).toBe('TRAIL_HIT');
    expect(res.exitPrice).toBe(100); // BE stop
    // Phase 1: Halved 5 shares exited at 101 (TP1) -> +5 profit
    // Phase 2: Rest 5 shares exited at 100 (BE SL) -> 0 profit
    // Total gross = +5
    expect(res.realizedPnLGross).toBe(5);
  });

  it('pessimistically stops out on same-candle SL & TP collisions (Case 4)', () => {
    const candles: NumericOHLC[] = [
      // Candle high is 105 (past TP) but low is 97 (below SL) -> assume SL hit first!
      { open: 100, high: 105, low: 97, close: 102, xCenter: 0, isBull: true },
    ];
    const res = simulateScalpTrade(defaultPlan, candles, defaultConfig, dummyCharges);
    expect(res.outcome).toBe('SL_HIT');
    expect(res.exitPrice).toBe(98);
  });

  it('closes trade at timeout if holding time exceeded (Case 5)', () => {
    const candles: NumericOHLC[] = [
      { open: 100, high: 100.5, low: 99.5, close: 100.1, xCenter: 0, isBull: true },
      { open: 100.1, high: 100.5, low: 99.5, close: 100.2, xCenter: 1, isBull: true },
      { open: 100.2, high: 100.5, low: 99.5, close: 100.3, xCenter: 2, isBull: true },
      { open: 100.3, high: 100.5, low: 99.5, close: 100.4, xCenter: 3, isBull: true },
      { open: 100.4, high: 100.5, low: 99.5, close: 100.5, xCenter: 4, isBull: true }, // 5th candle = timeout
    ];
    const res = simulateScalpTrade(defaultPlan, candles, defaultConfig, dummyCharges);
    expect(res.outcome).toBe('TIME_EXIT');
    expect(res.exitPrice).toBe(100.5);
    expect(res.realizedPnLGross).toBeCloseTo(5.0, 4);
  });

  it('applies slippage to entry & exit prices under pessimistic mode (Case 6)', () => {
    const cfgSlippage = {
      ...defaultConfig,
      risk: { ...defaultConfig.risk, slippageTicks: 1 }, // 1 tick = 0.05
    };
    const candles: NumericOHLC[] = [
      { open: 100, high: 100.2, low: 97.0, close: 97.4, xCenter: 0, isBull: false },
    ];
    const res = simulateScalpTrade(defaultPlan, candles, cfgSlippage, dummyCharges);
    // Slippage 1 tick (0.05): entry effective is 100.05, SL exit effective is 98 - 0.05 = 97.95
    expect(res.exitPrice).toBe(97.95);
    expect(res.realizedPnLGross).toBeCloseTo((97.95 - 100.05) * 10, 4);
  });

  it('respects partition rounding edge cases (Case 7)', () => {
    // 1-share position cannot be halved cleanly, positionSize = 1
    const oddPlan = { ...defaultPlan, positionSize: 1 };
    const candles: NumericOHLC[] = [
      { open: 100, high: 102, low: 99.5, close: 101.5, xCenter: 0, isBull: true }, // TP1 hit
      { open: 101.5, high: 102, low: 99.2, close: 99.5, xCenter: 1, isBull: false }, // Back to BE
    ];
    const res = simulateScalpTrade(oddPlan, candles, defaultConfig, dummyCharges);
    // position size = 1. Math.floor(1 / 2) = 0. So no shares are partially booked at TP1.
    // The trailing SL trails to high 102 - trailingDistance 1.5 = 100.5. Hits on the next candle!
    expect(res.outcome).toBe('TRAIL_HIT');
    expect(res.realizedPnLGross).toBe(0.5);
  });

  it('runs out immediately with 0 P&L if empty candles array is passed (Case 8)', () => {
    const res = simulateScalpTrade(defaultPlan, [], defaultConfig, dummyCharges);
    expect(res.outcome).toBe('TIME_EXIT');
    expect(res.realizedPnL).toBe(-5); // Net pnl = gross (0) - charges (5)
  });
});
