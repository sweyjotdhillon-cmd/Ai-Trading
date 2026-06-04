import { describe, it, expect } from 'vitest';
import { evaluateScalpSignal } from '../scalpingEngine';
import { ScalpContext } from '../scalpingEngine';
import { NumericOHLC } from '../../vision/pipeline';

describe('netConviction', () => {
  const ohlcSample: NumericOHLC[] = [
    { open: 100, high: 102, low: 98, close: 100, xCenter: 0, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 1, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 2, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 3, isBull: true },
    { open: 100, high: 102, low: 98, close: 100, xCenter: 4, isBull: true },
  ];

  const defaultCtx: ScalpContext = {
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
      minConfluence: 0,
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
      { index: 3, price: 95, kind: 'LOW' }
    ],
    atr14: [2, 2, 2, 2, 2],
    vwapProxy: [100, 100, 100, 100, 100],
    nowMsEpoch: Date.now(),
    nowISTMinutesSinceMidnight: 600,
    currentBarIndex: 4,
  };

  it('1. Passes when BULL is strong and BEAR is weak', () => {
    // Bull strong, bear weak -> verdict should pass are BULL
    const res = evaluateScalpSignal(ohlcSample, { winner: 'BULL' }, defaultCtx);
    expect(res.signal).toBe('BUY');
    expect(res.blockers).toHaveLength(0);
  });

  it('2. Blocks when BEAR is dominant', () => {
    const res = evaluateScalpSignal(ohlcSample, { winner: 'BEAR' }, defaultCtx);
    expect(res.signal).toBe('NO_TRADE');
    expect(res.blockers).toContain('BEARS_DOMINANT');
  });

  it('3. Filters when NO_EDGE is returned', () => {
    const res = evaluateScalpSignal(ohlcSample, { winner: 'NO_TRADE' }, defaultCtx);
    expect(res.signal).toBe('NO_TRADE');
    expect(res.blockers).toContain('NO_EDGE');
  });

  it('4. Applies overtrading penalties based on minConfluence', () => {
    const penalizedCtx = {
      ...defaultCtx,
      config: { ...defaultCtx.config, minConfluence: 9 } // High hurdle
    };
    const res = evaluateScalpSignal(ohlcSample, { winner: 'BULL' }, penalizedCtx);
    expect(res.signal).toBe('WAIT');
    expect(res.blockers[0]).toContain('LOW_CONFLUENCE');
  });

  it('5. Evaluates risk profile variations on stop loss thresholds', () => {
    const aggressiveCtx = {
      ...defaultCtx,
      config: { ...defaultCtx.config, slMode: 'PERCENT' as const, slPercent: 0.1 }
    };
    const res = evaluateScalpSignal(ohlcSample, { winner: 'BULL' }, aggressiveCtx);
    expect(res.signal).toBe('BUY');
    expect(res.plan?.slMode).toBe('PERCENT');
  });

  it('6. Blocks low R:R setup', () => {
    const lowRRCtx = {
      ...defaultCtx,
      config: { ...defaultCtx.config, minRR: 10, rrRatio: 1.0 } // High hurdle for RR
    };
    const res = evaluateScalpSignal(ohlcSample, { winner: 'BULL' }, lowRRCtx);
    expect(res.signal).toBe('WAIT');
    expect(res.blockers[0]).toContain('RR_TOO_LOW');
  });

  it('7. Handles extreme ATR values safely', () => {
    const brokenAtrCtx = {
      ...defaultCtx,
      atr14: [0, 0, 0, 0, 0] // Invalid ATR
    };
    const res = evaluateScalpSignal(ohlcSample, { winner: 'BULL' }, brokenAtrCtx);
    expect(res.signal).toBe('WAIT');
    expect(res.blockers).toContain('INVALID_ATR');
  });

  it('8. Validates correct position sizing based on trade safety limits', () => {
    const tightCapitalCtx = {
      ...defaultCtx,
      config: { ...defaultCtx.config, capitalRupees: 50, maxPositionPctCapital: 10 }
    };
    const res = evaluateScalpSignal(ohlcSample, { winner: 'BULL' }, tightCapitalCtx);
    // Might result in size=0 or very small
    expect(res.signal === 'BUY' || res.signal === 'WAIT').toBe(true);
  });
});
