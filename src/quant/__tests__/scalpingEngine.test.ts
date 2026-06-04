import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateScalpSignal, calculateConfluence, calculateStopLoss, findRecentSwingLow } from '../scalpingEngine';
import { ScalpContext } from '../scalpingEngine';
import { NumericOHLC } from '../../vision/pipeline';
import { SwingPivot } from '../marketStructure';

describe('scalpingEngine', () => {
  const ohlcBase: NumericOHLC[] = [
    { open: 100, high: 102, low: 98, close: 100, xCenter: 0, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 1, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 2, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 3, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 4, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 5, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 6, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 7, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 8, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 9, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 10, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 11, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 12, isBull: true },
    { open: 100, high: 102, low: 90, close: 95, xCenter: 13, isBull: false },
    { open: 95, high: 105, low: 94, close: 104, xCenter: 14, isBull: true },
  ];

  const defaultContext: ScalpContext = {
    config: {
      capitalRupees: 100000,
      riskPerTradePct: 1,
      maxPositionPctCapital: 30,
      leverage: 1,
      instrument: 'EQUITY_INTRADAY',
      lotSize: 1,
      slMode: 'ATR',
      atrMultiplierSL: 1.2,
      slPercent: 0.4,
      tpMode: 'PARTIAL_RR',
      rrRatio: 2.5,
      tp1RMultiple: 1.0,
      trailMultiplier: 1.5,
      minConfluence: 4,
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
      { index: 13, price: 90, kind: 'LOW' }
    ],
    atr14: [1, 2, 2, 2, 1.5],
    vwapProxy: [100, 100, 100, 100, 98],
    nowMsEpoch: Date.now(),
    nowISTMinutesSinceMidnight: 600,
    currentBarIndex: 14,
  };

  it('rejects BEAR trends immediately with BEAR_DOMINANT blocker (Case 1)', () => {
    const res = evaluateScalpSignal(ohlcBase, { winner: 'BEAR' }, defaultContext);
    expect(res.signal).toBe('NO_TRADE');
    expect(res.blockers).toContain('BEARS_DOMINANT');
  });

  it('filters out NO_TRADE conditions early (Case 2)', () => {
    const res = evaluateScalpSignal(ohlcBase, { winner: 'NO_TRADE' }, defaultContext);
    expect(res.signal).toBe('NO_TRADE');
    expect(res.blockers).toContain('NO_EDGE');
  });

  it('delays entry in low confluence situations with LOW_CONFLUENCE blocker (Case 3)', () => {
    const highRequiredCtx = {
      ...defaultContext,
      config: { ...defaultContext.config, minConfluence: 10 } // unachievably high
    };
    const res = evaluateScalpSignal(ohlcBase, { winner: 'BULL' }, highRequiredCtx);
    expect(res.signal).toBe('WAIT');
    expect(res.blockers[0]).toContain('LOW_CONFLUENCE');
  });

  it('builds a healthy BUY plan under proper market parameters (Case 4)', () => {
    const res = evaluateScalpSignal(ohlcBase, { winner: 'BULL' }, defaultContext);
    expect(res.signal).toBe('BUY');
    expect(res.plan).toBeDefined();
    expect(res.plan?.positionSize).toBeGreaterThan(0);
    expect(res.plan?.potentialRewardRupees).toBeGreaterThan(0);
    expect(res.plan?.brokerCharges).toBeGreaterThan(0);
    expect(res.plan?.netExpectedPnL).toBeGreaterThan(0);
  });

  it('enforces a minimum Risk Reward ratio check (Case 5)', () => {
    const badRRCtx = {
      ...defaultContext,
      config: { ...defaultContext.config, minRR: 5.0, rrRatio: 1.0 } // R:R too low
    };
    const res = evaluateScalpSignal(ohlcBase, { winner: 'BULL' }, badRRCtx);
    expect(res.signal).toBe('WAIT');
    expect(res.blockers[0]).toContain('RR_TOO_LOW');
  });

  it('respects risk guard and trips on flat losses (Case 6)', () => {
    const riskCrippledCtx = {
      ...defaultContext,
      riskState: {
        ...defaultContext.riskState,
        dailyPnL: -2500, // Tripped daily cap of 2000
      }
    };
    const res = evaluateScalpSignal(ohlcBase, { winner: 'BULL' }, riskCrippledCtx);
    expect(res.signal).toBe('NO_TRADE');
    expect(res.blockers[0]).toContain('DAILY_LOSS_CAP');
  });

  it('selects valid swing low pivot prices correctly (Case 7)', () => {
    const swing = findRecentSwingLow(defaultContext.pivots, 15);
    expect(swing).toBe(90);
  });

  it('tests standard ATR stop loss calculations (Case 8)', () => {
    const sl = calculateStopLoss(100, 'ATR', defaultContext);
    // 100 - ATR (1.5) * SL mult (1.2) = 100 - 1.8 = 98.2
    expect(sl).toBe(98.2);
  });
});
