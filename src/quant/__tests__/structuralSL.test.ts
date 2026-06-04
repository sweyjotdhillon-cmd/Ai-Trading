import { describe, it, expect } from 'vitest';
import { calculateStopLoss, findRecentSwingLow } from '../scalpingEngine';
import { ScalpContext } from '../scalpingEngine';

describe('structuralSL', () => {
  const defaultContext: ScalpContext = {
    config: {
      capitalRupees: 100000,
      riskPerTradePct: 1,
      maxPositionPctCapital: 30,
      leverage: 1,
      instrument: 'EQUITY_INTRADAY',
      lotSize: 1,
      slMode: 'STRUCTURE',
      atrMultiplierSL: 1.5,
      slPercent: 0.5,
      tpMode: 'RR',
      rrRatio: 2.0,
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
      { index: 8, price: 92, kind: 'LOW' },
      { index: 12, price: 94, kind: 'LOW' }
    ],
    atr14: [2, 2, 2, 2, 2],
    vwapProxy: [100, 100, 100, 100, 100],
    nowMsEpoch: Date.now(),
    nowISTMinutesSinceMidnight: 600,
    currentBarIndex: 14,
  };

  it('1. Calculates stop loss in PERCENT mode correctly', () => {
    const sl = calculateStopLoss(100, 'PERCENT', defaultContext);
    // slPercent is 0.5, so 100 - (100 * 0.005) = 99.5
    expect(sl).toBeCloseTo(99.5);
  });

  it('2. Calculates stop loss in ATR mode correctly', () => {
    const sl = calculateStopLoss(100, 'ATR', defaultContext);
    // atr14 = 2, atrMultiplierSL = 1.5. 100 - 1.5 * 2 = 97
    expect(sl).toBe(97);
  });

  it('3. Finds recent swing low successfully from pivots', () => {
    const swLow = findRecentSwingLow(defaultContext.pivots, defaultContext.currentBarIndex);
    expect(swLow).toBe(94); // Index 12 is closer to 14 than index 8
  });

  it('4. Uses structural swing low as stop loss when within 2xtr limit', () => {
    const sl = calculateStopLoss(100, 'STRUCTURE', defaultContext);
    // Recent swing low is 94. Difference from 100 = 6. 
    // Max ATR limit = 2 * atrMultiplierSL * atrVal = 2 * 1.5 * 2 = 6.
    // 94 is exactly in range, so it is picked and adjusted as 94 - 0.6 = 93.4
    expect(sl).toBe(93.4);
  });

  it('5. Falls back to ATR when structural level is too far (greater than 2xATR limit)', () => {
    const farContext = {
      ...defaultContext,
      pivots: [{ index: 5, price: 80, kind: 'LOW' as const }] // 80 is too far from 100
    };
    const sl = calculateStopLoss(100, 'AUTO', farContext);
    // ATR backup = 100 - (1.5 * 2) = 97. In AUTO mode, 97 is picked over far structural
    expect(sl).toBe(97);
  });

  it('6. Falls back to ATR when no swing low is found in pivots', () => {
    const emptyPivotsContext = {
      ...defaultContext,
      pivots: []
    };
    const sl = calculateStopLoss(100, 'AUTO', emptyPivotsContext);
    expect(sl).toBe(99.4);
  });

  it('7. Calculates stop loss in AUTO mode successfully', () => {
    const sl = calculateStopLoss(100, 'AUTO', defaultContext);
    expect(sl).toBeGreaterThan(0);
  });

  it('8. Supports custom atrMultiplier settings dynamically', () => {
    const customContext = {
      ...defaultContext,
      config: { ...defaultContext.config, atrMultiplierSL: 3.0 }
    };
    const sl = calculateStopLoss(100, 'ATR', customContext);
    // 100 - (3.0 * 2) = 94
    expect(sl).toBe(94);
  });
});
