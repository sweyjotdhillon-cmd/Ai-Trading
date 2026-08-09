const fs = require('fs');
let testContent = fs.readFileSync('src/quant/__tests__/portfolio.test.ts', 'utf8');

// I generated 60 dummy candles at 0, 10, 20... 590
// Then added 1000, 2000, etc.
// The issue might be that Trade A triggered at ts=3000 but the dummy candles pushed the window length to > 60.
// Let's replace the whole test file with a clean one where we use exact timestamps and set ANALYSIS_WINDOW_SIZE to 5 via mock, or just provide 65 candles properly.

const newTestContent = `
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

// Mock the indicators so we don't depend on atr requiring 14 items
vi.mock('../indicators', async (importOriginal) => {
  return {
    atr: () => [1.0] // Always return 1 for ATR to make risk calculations simple
  };
});

describe('Portfolio Cash Flow Backtest', () => {
  const config: BacktestConfig = {
    symbol: 'MOCK',
    initialCapital: 100000,
    marginThreshold: 2.5,
    maxTradesPerDay: 5,
    warmupCandles: 0, // Disable warmup skip so we can control exactly
    exitMode: 'FIXED_PCT',
    fixedSLPct: 1.0,
    fixedTPPct: 2.0,
    scalpConfig: {
      capitalRupees: 100000,
      riskPerTradePct: 100, // Very high so maxPositionPctCapital dominates
      maxPositionPctCapital: 50, // 50% allocation
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
    // Generate 60 dummy candles to bypass ANALYSIS_WINDOW_SIZE check
    const padded: OHLCV[] = [];
    for(let i=0; i<60; i++) {
      padded.push(createCandle(i * 100, basePrice, basePrice, basePrice, basePrice));
    }
    // Shift suffix candles timestamps to be after 6000
    const adjustedSuffix = suffixCandles.map(c => ({
      ...c,
      timestamp: c.timestamp! + 10000
    }));
    return [...padded, ...adjustedSuffix];
  };

  it('Test A & D: Single trade uses 50% cash, multiple simultaneous trades', () => {
    const candlesA = getPaddedCandles([
      createCandle(1000, 100, 100, 100, 100),
      createCandle(2000, 100, 100, 100, 101), // Signal triggers here
      createCandle(3000, 100, 105, 95, 100),  // Entry at 100
      createCandle(4000, 100, 100, 100, 100), // Open
      createCandle(5000, 100, 105, 95, 103),  // TP hits (TP=102 based on FIXED_PCT 2%)
    ], 100);

    const candlesB = getPaddedCandles([
      createCandle(1000, 200, 200, 200, 200),
      createCandle(2000, 200, 200, 200, 200),
      createCandle(3000, 200, 200, 200, 101), // Signal triggers here (while A is open)
      createCandle(4000, 200, 210, 190, 200), // Entry at 200
      createCandle(5000, 200, 200, 200, 200), // Open
      createCandle(6000, 200, 210, 190, 205), // TP hits (TP=204)
    ], 200);

    const result = runPortfolioBacktest({ STOCK_A: candlesA, STOCK_B: candlesB }, config);

    expect(result.initialCapital).toBe(100000);
    expect(result.trades.length).toBe(2);

    const tradeA = result.trades.find(t => t.symbol === 'STOCK_A');
    const tradeB = result.trades.find(t => t.symbol === 'STOCK_B');

    expect(tradeA?.actualInvestment).toBe(50000);
    expect(tradeA?.availableCashBefore).toBe(100000);

    // Trade B triggers when Trade A is still open.
    // Available cash should be 50,000. 50% of 50,000 = 25,000.
    expect(tradeB?.availableCashBefore).toBe(50000);
    expect(tradeB?.actualInvestment).toBe(25000);
  });
});
`;
fs.writeFileSync('src/quant/__tests__/portfolio.test.ts', newTestContent, 'utf8');
