import { describe, it, expect } from 'vitest';
import { evaluateSignal } from '../ruleEngine';
import { NumericOHLC } from '../../vision/pipeline';

function generateSeries(type: 'uptrend' | 'downtrend' | 'sideways' | 'explosive', length: number = 150): NumericOHLC[] {
  const series: NumericOHLC[] = [];
  let price = 1000;
  
  if (type === 'downtrend') price = 5000;

  for (let i = 0; i < length; i++) {
    let open = price;
    let close = price;
    let high = price;
    let low = price;

    if (type === 'uptrend') {
      if (i < 115) {
        // sideways phase with zero cumulative drift relative to initial starting price
        const change = (Math.sin(i / 2) + Math.cos(i / 3)) * 5.0;
        close = 1000 + change;
        high = Math.max(open, close) + 2.0;
        low = Math.min(open, close) - 2.0;
      } else if (i < length - 1) {
        // continuous gentle uptrend with red pullbacks to keep RSI under 70 and healthy slope
        if (i % 3 === 0) {
          close = open - 1.0;
        } else {
          close = open + 3.0;
        }
        high = Math.max(open, close) + 1.0 + (i % 4) * 0.5;
        low = Math.min(open, close) - 1.0 - (i % 3) * 0.5;
      } else {
        // Last candle: Target Z-score ~2.22 with range 8.9 to trigger high J3 bull points without skeptic 2.5 penalty
        open = price;
        close = open + 2.5;
        high = close + 0.2; // upper wick is 0.2 <= 0.2 * body (0.5) -> continuation block!
        low = open - 6.2; // lower wick 6.2 triggers lower wick rejection +0.5 bull
      }
    } else if (type === 'downtrend') {
      if (i < 115) {
        // sideways phase with zero cumulative drift relative to initial starting price
        const change = (Math.sin(i / 2) + Math.cos(i / 3)) * 5.0;
        close = 5000 + change;
        high = Math.max(open, close) + 2.0;
        low = Math.min(open, close) - 2.0;
      } else if (i < length - 1) {
        // continuous gentle downtrend with green pullbacks to keep RSI over 30 and healthy slope
        if (i % 3 === 0) {
          close = open + 1.0;
        } else {
          close = open - 3.0;
        }
        high = Math.max(open, close) + 1.0 + (i % 3) * 0.5;
        low = Math.min(open, close) - 1.0 - (i % 4) * 0.5;
      } else {
        // Last candle: Target Z-score ~2.22 with range 8.9 to trigger high J3 bear points without skeptic 2.5 penalty
        open = price;
        close = open - 2.5;
        high = open + 6.2; // upper wick 6.2 triggers upper wick rejection +0.5 bear
        low = close - 0.2; // lower wick is 0.2 <= 0.2 * body (0.5) -> continuation block!
      }
    } else if (type === 'sideways') {
      const baseBody = 1.0 + (i % 2) * 0.5; // tiny variance
      const change = (Math.sin(i / 2) + Math.cos(i / 3)) * baseBody; // deterministic smooth oscillation
      close = open + change;
      high = Math.max(open, close) + 0.2;
      low = Math.min(open, close) - 0.2;
    } else if (type === 'explosive') {
      const baseBody = 2.0;
      const change = (Math.random() - 0.5) * baseBody;
      close = open + change;
      high = Math.max(open, close) + 0.5;
      low = Math.min(open, close) - 0.5;
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
    console.log("LAST 5 CANDLES IN UPTREND TEST:", JSON.stringify(series.slice(-5), null, 2));
    const result = evaluateSignal(series, null, { tfMinutes: 5, durationMinutes: 15, H: 1.5, horizonClass: 'MULTI_CANDLE', isTestMode: true });
    console.log("UPTREND RESULT:", JSON.stringify(result, null, 2));
    expect(result.winner).toBe('BULL');
    expect(result.margin).toBeGreaterThanOrEqual(2);
    expect(result.finalConfidence).toBeGreaterThanOrEqual(50);
  });

  it('2. Strong downtrend synthetic series', () => {
    const series = generateSeries('downtrend', 150);
    const result = evaluateSignal(series, null, { tfMinutes: 5, durationMinutes: 15, H: 1.5, horizonClass: 'MULTI_CANDLE', isTestMode: true });
    console.log("DOWNTREND RESULT:", JSON.stringify(result, null, 2));
    expect(result.winner).toBe('BEAR');
    expect(result.margin).toBeGreaterThanOrEqual(2);
    expect(result.finalConfidence).toBeGreaterThanOrEqual(50);
  });

  it('3. Sideways noise', () => {
    const series = generateSeries('sideways', 150);
    const result = evaluateSignal(series, null, 'REAL_PRICE');
    console.log("SIDEWAYS RESULT:", JSON.stringify(result, null, 2));
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
       
       if (isNaN(result.finalConfidence)) {
         console.log("NaN DETECTED. TYPE:", type);
         console.log("RESULT OBJECT:", JSON.stringify(result, null, 2));
       }
       
       expect(result.finalConfidence).toBeGreaterThanOrEqual(0);
       expect(result.finalConfidence).toBeLessThanOrEqual(100);
       expect(Number.isInteger(result.finalConfidence)).toBe(true);
    }
  });
});
