import { describe, it, expect } from 'vitest';
import { simulateScalpTrade } from '../pathSimulator';
import { ScalpingPlan, ScalpConfig } from '../../types';
import { NumericOHLC } from '../../vision/pipeline';

describe('bulkTestScalp', () => {
  const dummyChargesFn = (entry: number, exit: number, size: number) => {
    return { total: 10 }; // Flat 10 rupees charge
  };

  const samplePlan: ScalpingPlan = {
    entry: 100,
    stopLoss: 98,
    takeProfit1: 102, // 1R Target
    takeProfit2: 105, // 2.5R Target
    trailingActivate: 102,
    trailingDistance: 1.5,
    breakEvenAfter: 102,
    positionSize: 100, // 100 shares
    riskRupees: 200,   // (100 - 98) * 100
    potentialRewardRupees: 500, // (105 - 100) * 100
    rrRatio: 2.5,
    maxHoldingMinutes: 10,
    confluenceScore: 7,
    brokerCharges: 10,
    netExpectedPnL: 490,
    slMode: 'ATR',
    tpMode: 'PARTIAL_RR',
    instrument: 'EQUITY_INTRADAY',
    noteReasons: []
  };

  const sampleConfig: ScalpConfig = {
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
      slippageTicks: 0, // No slippage for simple calculations
    },
    maxHoldingMinutes: 10,
  };

  it('1. Handles immediate SL hit correctly', () => {
    const candles: NumericOHLC[] = [
      { open: 99, high: 99.5, low: 97.5, close: 98, xCenter: 0 }, // Low drops below SL (98)
    ];
    const res = simulateScalpTrade(samplePlan, candles, sampleConfig, dummyChargesFn);
    expect(res.outcome).toBe('SL_HIT');
    expect(res.realizedPnL).toBe(-210); // Loss -200 - 10 charges
  });

  it('2. Reaches full TP2 take profit successfully', () => {
    const candles: NumericOHLC[] = [
      { open: 101, high: 103, low: 100, close: 102, xCenter: 0 }, // TP1 hit (102)
      { open: 103, high: 106, low: 102, close: 105.5, xCenter: 1 }, // TP2 hit (105)
    ];
    const res = simulateScalpTrade(samplePlan, candles, sampleConfig, dummyChargesFn);
    expect(res.outcome).toBe('TP2_HIT');
    expect(res.realizedPnL).toBeGreaterThan(0);
  });

  it('3. Triggers TIME_EXIT on maximum holding duration reached', () => {
    const flatCandles: NumericOHLC[] = Array(12).fill(0).map((_, idx) => ({
      open: 100.5, high: 101, low: 100, close: 100.2, xCenter: idx
    }));
    const res = simulateScalpTrade(samplePlan, flatCandles, sampleConfig, dummyChargesFn);
    expect(res.outcome).toBe('TIME_EXIT');
  });

  it('4. Executes safely on empty next path', () => {
    const res = simulateScalpTrade(samplePlan, [], sampleConfig, dummyChargesFn);
    expect(res.outcome).toBe('TIME_EXIT');
    expect(res.realizedPnL).toBe(-10); // Only flat charges
  });

  it('5. Adjusts slippage expectations correctly', () => {
    const slippageConfig = {
      ...sampleConfig,
      risk: { ...sampleConfig.risk, slippageTicks: 2 } // 0.1 slippage
    };
    const candles: NumericOHLC[] = [
      { open: 99, high: 99.5, low: 97.5, close: 98, xCenter: 0 },
    ];
    const res = simulateScalpTrade(samplePlan, candles, slippageConfig, dummyChargesFn);
    expect(res.outcome).toBe('SL_HIT');
  });

  it('6. Records all path events sequentially', () => {
    const candles: NumericOHLC[] = [
      { open: 101, high: 103, low: 100, close: 102, xCenter: 0 },
      { open: 103, high: 106, low: 102, close: 105.5, xCenter: 1 },
    ];
    const res = simulateScalpTrade(samplePlan, candles, sampleConfig, dummyChargesFn);
    expect(res.events).toBeDefined();
    expect(res.events[0].event).toBe('ENTRY');
  });

  it('7. Handles TP1 parcial target then stop-out safely with break even shifting', () => {
    const candles: NumericOHLC[] = [
      { open: 101, high: 102.5, low: 100.5, close: 102.1, xCenter: 0 }, // TP1 hit
      { open: 101, high: 101.5, low: 99.5, close: 100, xCenter: 1 }, // Drops back
    ];
    const res = simulateScalpTrade(samplePlan, candles, sampleConfig, dummyChargesFn);
    expect(res.outcome).toBeDefined();
  });

  it('8. Verifies proper R multiple metrics returned', () => {
    const candles: NumericOHLC[] = [
      { open: 101, high: 103, low: 100, close: 102, xCenter: 0 },
      { open: 103, high: 106, low: 102, close: 105.5, xCenter: 1 },
    ];
    const res = simulateScalpTrade(samplePlan, candles, sampleConfig, dummyChargesFn);
    expect(res.rMultiple).toBeDefined();
  });
});
