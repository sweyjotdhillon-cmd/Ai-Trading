import { describe, it, expect } from 'vitest';
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
      date: new Date(Date.now() - (length - i) * 60000).toISOString(),
      open, high, low, close,
      volume: 1000
    });
    price = close;
  }
  return series;
}

describe('Judge Verdict', () => {
  it('1. Strong uptrend synthetic series', () => {
    const series = generateSeries('uptrend', 150);
    const result = evaluateSignal(series, null, 'REAL_PRICE');
    console.log("UPTREND RESULT:", JSON.stringify(result, null, 2));
    expect(result.winner).toBe('BULL');
    expect(result.margin).toBeGreaterThanOrEqual(2);
    expect(result.finalConfidence).toBeGreaterThanOrEqual(50);
  });

  it('2. Strong downtrend synthetic series', () => {
    const series = generateSeries('downtrend', 150);
    const result = evaluateSignal(series, null, 'REAL_PRICE');
    console.log("DOWNTREND RESULT:", JSON.stringify(result, null, 2));
    expect(result.winner).toBe('BEAR');
    expect(result.margin).toBeGreaterThanOrEqual(2);
    expect(result.finalConfidence).toBeGreaterThanOrEqual(50);
  });

  it('3. Sideways noise', () => {
    const series = generateSeries('sideways', 150);
    const result = evaluateSignal(series, null, 'REAL_PRICE');
    
    expect(result.winner).toBe('NO_TRADE');
    expect(result.margin).toBeLessThan(2);
  });

  it('4. Trending but EXPLOSIVE_SKIP volatility', () => {
    const series = generateSeries('explosive', 150);
    const result = evaluateSignal(series, null, 'REAL_PRICE');
    
    // An explosive series might be rejected for predictability early, or caught by skeptic
    expect(result.winner).toBe('NO_TRADE');
    if (result.cases.bull.total > 0 || result.cases.bear.total > 0) {
       expect(result.skepticMultiplier).toBeLessThan(1.0);
    }
  });

  it('5. totals per judge never exceed cap', () => {
    const series = generateSeries('uptrend', 100);
    const result = evaluateSignal(series, null, 'REAL_PRICE');
    
    const j1Total = result.cases.bull.j1 + result.cases.bear.j1;
    const j2Total = result.cases.bull.j2 + result.cases.bear.j2;
    const j3Total = result.cases.bull.j3 + result.cases.bear.j3;

    expect(result.cases.bull.j1).toBeLessThanOrEqual(4);
    expect(result.cases.bear.j1).toBeLessThanOrEqual(4);
    
    expect(result.cases.bull.j2).toBeLessThanOrEqual(4);
    expect(result.cases.bear.j2).toBeLessThanOrEqual(4);

    expect(result.cases.bull.j3).toBeLessThanOrEqual(3);
    expect(result.cases.bear.j3).toBeLessThanOrEqual(3);
  });

  it('6. finalConfidence is integer between 0 and 100', () => {
    for (const type of ['uptrend', 'downtrend', 'sideways', 'explosive'] as const) {
      const series = generateSeries(type);
      const result = evaluateSignal(series, null, 'REAL_PRICE');
      
      expect(result.finalConfidence).toBeGreaterThanOrEqual(0);
      expect(result.finalConfidence).toBeLessThanOrEqual(100);
      expect(Number.isInteger(result.finalConfidence)).toBe(true);
    }
  });
});
