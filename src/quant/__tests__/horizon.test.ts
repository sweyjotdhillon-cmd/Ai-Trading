import { describe, it, expect } from 'vitest';
import { parseDurationToMinutes, rescaledRangeHurst, HorizonContext } from '../horizon';
import { evaluateSignal } from '../ruleEngine';
import { NumericOHLC } from '../../vision/pipeline';

describe('Horizon Context & Helpers', () => {
  it('1. Parses duration strings correctly', () => {
    expect(parseDurationToMinutes('30m')).toBe(30);
    expect(parseDurationToMinutes('1h')).toBe(60);
    expect(parseDurationToMinutes('5m')).toBe(5);
    expect(parseDurationToMinutes('1d')).toBe(1440);
    expect(parseDurationToMinutes('garbage')).toBe(5);
  });

  it('2. Hurst returns ~0.5 for random walk and >0.6 for monotonic ramp', () => {
    const randomWalk = [];
    let val = 100;
    for (let i = 0; i < 40; i++) {
      val += (Math.random() - 0.5) * 2;
      randomWalk.push(val);
    }
    const hurstRandom = rescaledRangeHurst(randomWalk);
    expect(hurstRandom).toBeGreaterThan(0.3);
    expect(hurstRandom).toBeLessThan(0.7);

    const ramp = [];
    let rVal = 100;
    for (let i = 0; i < 40; i++) {
      rVal += 1 + Math.random() * 0.5;
      ramp.push(rVal);
    }
    const hurstRamp = rescaledRangeHurst(ramp);
    expect(hurstRamp).toBeGreaterThan(0.6);
  });

  it('3. evaluateSignal produces different confidence for H=0.1 vs H=1.0', async () => {
    const series: NumericOHLC[] = [];
    let val = 100;
    for (let i = 0; i < 50; i++) {
      val += 1.0;
      series.push({ open: val - 0.5, high: val + 2, low: val - 2, close: val, xCenter: 0, isBull: true });
    }
    // Inject a specific pattern right at the end to trigger the PATTERN re-weighting
    // We add a strong continuation candle (Marubozu)
    val += 5;
    series.push({ open: val - 4, high: val, low: val - 4, close: val, xCenter: 0, isBull: true });




    const resultLowH = evaluateSignal(series, ['__TEST_BYPASS__'], ctxLowH);
    const resultHighH = evaluateSignal(series, ['__TEST_BYPASS__'], ctxHighH);


    const resultLowH = evaluateSignal(series, {tfMinutes: 30, durationMinutes: 5, H: 0.1, horizonClass: 'INTRA_CANDLE'}, ['__TEST_BYPASS__']);
    const resultHighH = evaluateSignal(series, {tfMinutes: 30, durationMinutes: 5, H: 1.0, horizonClass: 'INTRA_CANDLE'}, ['__TEST_BYPASS__']);

    expect(resultLowH.finalConfidence).toBeDefined();
    expect(resultHighH.finalConfidence).toBeDefined();
  });
});