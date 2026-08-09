
import { describe, it, expect, vi } from 'vitest';
import { runPortfolioBacktest } from '../backtestEngine';
import { BacktestConfig } from '../../types/backtest';
import { OHLCV } from '../../types';

vi.mock('../ruleEngine', async (importOriginal) => {
  const mod = await importOriginal<any>();
  return {
    ...mod,
    evaluateSignal: vi.fn((window: any) => {
      const lastCandle = window[window.length - 1];
      if (lastCandle.close === 101) {
        return {
          winner: 'BULL', margin: 3.0, bullScore: 8, bearScore: 5,
          topPatterns: { bull: [], bear: [] },
          bullJ1: 4.0, bullJ2: 4.0, bullJ3: 4.0, bullTotal: 12.0,
          bearJ1: 0, bearJ2: 0, bearJ3: 0, bearTotal: 0,
          cases: { bull: { j1: 4, j2: 4, j3: 4, total: 12 }, bear: { j1: 0, j2: 0, j3: 0, total: 0 } },
          auditTrail: { judgeContribs: [] },
          skepticVerdict: 'ACCEPT', j4PenaltyPct: 0
        };
      }
      return { winner: 'NO_TRADE', margin: 0, topPatterns: {bull:[],bear:[]}, cases: { bull: { j1: 0, j2: 0, j3: 0, total: 0 }, bear: { j1: 0, j2: 0, j3: 0, total: 0 } } };
    })
  };
});

vi.mock('../indicators', async (importOriginal) => {
  return {
    atr: () => [1.0]
  };
});
vi.mock('../brokerCharges', async (importOriginal) => {
  return {
    computeRoundTripCharges: () => ({ total: 0 })
  };
});

describe('Portfolio Cash Flow Backtest', () => {
  const config: BacktestConfig = {
    symbol: 'MOCK',
    initialCapital: 100000,
    marginThreshold: 2.5,
    maxTradesPerDay: 5,
    warmupCandles: 0,
    exitMode: 'FIXED_PCT',
    fixedSLPct: 1.0,
    fixedTPPct: 2.0,
    scalpConfig: {
      capitalRupees: 100000,
      riskPerTradePct: 100,
      maxPositionPctCapital: 50,
      leverage: 1,
      instrument: 'EQUITY_INTRADAY',
      lotSize: 1,
      slMode: 'ATR',
    },
    techniquesList: [],
  };

  const createCandle = (ts: number, open: number, high: number, low: number, close: number): OHLCV => ({
    timestamp: ts, open, high, low, close, volume: 1000
  });

  const getPaddedCandles = (suffixCandles: OHLCV[], basePrice: number) => {
    const padded: OHLCV[] = [];
    for(let i=0; i<60; i++) {
      padded.push(createCandle(i * 100, basePrice, basePrice, basePrice, basePrice));
    }
    const adjustedSuffix = suffixCandles.map(c => ({
      ...c,
      timestamp: c.timestamp! + 10000
    }));
    return [...padded, ...adjustedSuffix];
  };

  it('Test A & D: Single trade uses 50% cash, multiple simultaneous trades', () => {
    const candlesA = getPaddedCandles([
      createCandle(1000, 100, 100, 100, 100),
      createCandle(2000, 100, 100, 100, 101),
      createCandle(3000, 100, 100, 100, 100),
      createCandle(4000, 100, 100, 100, 100),
      createCandle(5000, 100, 105, 95, 103),
    ], 100);

    const candlesB = getPaddedCandles([
      createCandle(1000, 200, 200, 200, 200),
      createCandle(2000, 200, 200, 200, 200),
      createCandle(3000, 200, 200, 200, 101),
      createCandle(4000, 200, 200, 200, 200),
      createCandle(5000, 200, 200, 200, 200),
      createCandle(6000, 200, 210, 190, 205),
    ], 200);

    const result = runPortfolioBacktest({ STOCK_A: candlesA, STOCK_B: candlesB }, config);

    expect(result.initialCapital).toBe(100000);
    expect(result.trades.length).toBe(2);

    const tradeA = result.trades.find(t => t.symbol === 'STOCK_A');
    const tradeB = result.trades.find(t => t.symbol === 'STOCK_B');

    expect(tradeA?.actualInvestment).toBe(50000);
    expect(tradeA?.availableCashBefore).toBe(100000);

    expect(tradeB?.availableCashBefore).toBe(50000);
    expect(tradeB?.actualInvestment).toBe(25000);
  });

  it('Test E & F: Insufficient cash skipped and deterministic entry order', () => {
    const baseCandles = getPaddedCandles([
      createCandle(1000, 100, 100, 100, 100),
      createCandle(2000, 100, 100, 100, 101),
      createCandle(3000, 100, 100, 100, 100),
      createCandle(4000, 100, 105, 95, 103),
    ], 100);

    const cfg: BacktestConfig = {
      ...config,
      scalpConfig: {
        ...config.scalpConfig,
        maxPositionPctCapital: 60,
      }
    };

    const result = runPortfolioBacktest({
      STOCK_Z: baseCandles,
      STOCK_Y: baseCandles,
      STOCK_X: baseCandles
    }, cfg);

    expect(result.trades.length).toBe(3);

    const sortedTrades = result.trades.sort((a, b) => a.entryTime - b.entryTime || (a.actualInvestment! < b.actualInvestment! ? 1 : -1));

    expect(sortedTrades[0].symbol).toBe('STOCK_X');
    expect(sortedTrades[0].actualInvestment).toBe(60000);

    expect(sortedTrades[1].symbol).toBe('STOCK_Y');
    expect(sortedTrades[1].actualInvestment).toBe(24000);

    expect(sortedTrades[2].symbol).toBe('STOCK_Z');
    expect(sortedTrades[2].actualInvestment).toBe(9600);
  });
});
