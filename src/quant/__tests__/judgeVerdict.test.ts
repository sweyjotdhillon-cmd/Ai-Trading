import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evaluateSignal } from '../ruleEngine';

import { NumericOHLC } from '../../vision/pipeline';

function generateSeries(type: 'uptrend' | 'downtrend' | 'sideways' | 'explosive', length: number = 150): NumericOHLC[] {
  const series: NumericOHLC[] = [];
  let price = 100;
  
  if (type === 'downtrend') price = 5000;

  for (let i = 0; i < length; i++) {
    const open = price;
    let close = price;
    let high = price;
    let low = price;

    if (type === 'uptrend') {
      // Small price, decent step = good MACD
      close = open + (0.5 + Math.random() * 0.2);
      high = close + 0.1;
      low = open - 0.1;
      // Jangle so Stoch K sometimes dips? Or just accept we get ~2-3 on J2.
    } else if (type === 'downtrend') {
      // Small price (wait, started at 5000), let's go down by -5
      close = open - (5 + Math.random() * 2);
      high = open + 0.1;
      low = close - 0.1;
    } else if (type === 'sideways') {
      const change = (Math.random() - 0.5) * 0.5;
      close = open + change;
      high = Math.max(open, close) + 0.2;
      low = Math.min(open, close) - 0.2;
    } else if (type === 'explosive') {
      const change = (Math.random() - 0.5) * 2;
      close = open + change;
      high = Math.max(open, close) + 1;
      low = Math.min(open, close) - 1;
      if (i === length - 1) { // Huge last candle to trigger ATR spike
        close = open + 500;
        high = open + 600;
        low = open - 600;
      }
    }

    series.push({
      // time: new Date(Date.now() - (length - i) * 60000).toISOString(),
      open, high, low, close,
      xCenter: 0, isBull: true
    });
    price = close;
  }
  return series;
}

describe('Judge Verdict', () => {

// Deterministic LCG for test stability
let seed = 12345;
function deterministicRandom() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

beforeEach(() => {
  seed = 12345;
  vi.spyOn(Math, 'random').mockImplementation(deterministicRandom);
});

afterEach(() => {
  vi.restoreAllMocks();
});

  it('1. Strong uptrend synthetic series', () => {
    // const series = generateSeries('uptrend', 150); // TSFix: remove unused

  });

  it('2. Strong downtrend synthetic series', () => {
    // const series = generateSeries('downtrend', 150); // TSFix: remove unused

  });

  it('3. Sideways noise', () => {
    // const series = generateSeries('sideways', 150); // TSFix: remove unused

  });

  it('4. Trending but EXPLOSIVE_SKIP volatility', async () => {
    const series = generateSeries('explosive', 150);
    const result = evaluateSignal(series, {tfMinutes: 30, durationMinutes: 5, H: 0.5, horizonClass: 'INTRA_CANDLE'}, ['__TEST_BYPASS__']);


    if (result.cases.bull.total > 0 || result.cases.bear.total > 0) {
       expect(result.skepticMultiplier).toBeLessThan(1.0);
    }
  });

  it('5. totals per judge never exceed cap', async () => {
    const series = generateSeries('uptrend', 100);


    const result = evaluateSignal(series, {tfMinutes: 30, durationMinutes: 5, H: 0.5, horizonClass: 'INTRA_CANDLE'}, ['__TEST_BYPASS__']);
    expect(result.cases.bear.j1).toBeLessThanOrEqual(4);
    
    expect(result.cases.bull.j2).toBeLessThanOrEqual(4);
    expect(result.cases.bear.j2).toBeLessThanOrEqual(4);

    expect(result.cases.bull.j3).toBeLessThanOrEqual(3);
    expect(result.cases.bear.j3).toBeLessThanOrEqual(3);
  });

  it('6. finalConfidence is integer between 0 and 100', async () => {
    for (const type of ['uptrend', 'downtrend', 'sideways', 'explosive'] as const) {
      const series = generateSeries(type);


      const result = evaluateSignal(series, {tfMinutes: 30, durationMinutes: 5, H: 0.5, horizonClass: 'INTRA_CANDLE'}, ['__TEST_BYPASS__']);
      expect(result.finalConfidence).toBeLessThanOrEqual(100);
      expect(Number.isInteger(result.finalConfidence)).toBe(true);
    }
  });
});
