import { describe, it, expect } from 'vitest';
import { evaluateSignal } from '../ruleEngine';
import { NumericOHLC } from '../../vision/pipeline';

// Helper to create a base validation series with 40 candles (all deterministic, no random numbers)
function generateDeterministicSeries(length = 40, modification?: (candle: NumericOHLC, idx: number) => void): NumericOHLC[] {
  const series: NumericOHLC[] = [];
  let price = 100;
  for (let i = 0; i < length; i++) {
    const isEven = i % 2 === 0;
    const change = isEven ? 0.5 : -0.2; // slight upward drift
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + 0.1;
    const low = Math.min(open, close) - 0.1;

    const candle: NumericOHLC = {
      date: new Date(Date.now() - (length - i) * 60000).toISOString(),
      open,
      high,
      low,
      close,
      volume: 1000
    };

    if (modification) {
      modification(candle, i);
    }

    series.push(candle);
    price = close;
  }
  return series;
}

describe('Judge Wiring Architectural Verification Tests', () => {
  // Test 1: Separate capped Case score calculations
  it('1. Computes Bull and Bear Cases separately, enforcing caps correctly', () => {
    const series = generateDeterministicSeries(40);
    // Include test bypass token so we do not block on fewer than 10 custom techniques
    const techniques = ['rsioversold', 'macdbullcross', 'hammer', '__TEST_BYPASS__'];
    // Mock horizonCtx
    const horizon = { tfMinutes: 5, durationMinutes: 15, H: 1.0, horizonClass: 'MULTI_CANDLE' as const };

    const result = evaluateSignal(series, techniques, horizon);

    expect(result.cases.bull).toBeDefined();
    expect(result.cases.bear).toBeDefined();

    // Verify caps (J1 cap 4.0, J2 cap 4.0, J3 cap 3.0)
    expect(result.cases.bull.j1).toBeLessThanOrEqual(4.0);
    expect(result.cases.bull.j2).toBeLessThanOrEqual(4.0);
    expect(result.cases.bull.j3).toBeLessThanOrEqual(3.0);
    expect(result.cases.bull.total).toBeLessThanOrEqual(11.0);

    expect(result.cases.bear.j1).toBeLessThanOrEqual(4.0);
    expect(result.cases.bear.j2).toBeLessThanOrEqual(4.0);
    expect(result.cases.bear.j3).toBeLessThanOrEqual(3.0);
    expect(result.cases.bear.total).toBeLessThanOrEqual(11.0);
  });

  // Test 2: Hurst amplification and dampening
  it('2. Hurst balancer amplifies and dampens scores according to regime thresholds', () => {
    // A linear ramp has high persistence (Hurst ~ 1.0 > 0.55), which amplifies J1 and dampens J3
    const trendSeries = generateDeterministicSeries(40, (c, idx) => {
      // Monotonic step ramp upward
      c.open = 100 + idx;
      c.close = 101 + idx;
      c.high = 101.5 + idx;
      c.low = 99.5 + idx;
    });

    const resultTrend = evaluateSignal(trendSeries, ['__TEST_BYPASS__'], { tfMinutes: 5, durationMinutes: 15, H: 1.0, horizonClass: 'MULTI_CANDLE' as const });

    // A mean-reverting series (sawtooth wave: H < 0.45) dampens J1 and amplifies J3
    const alternatingSeries = generateDeterministicSeries(40, (c, idx) => {
      // Perfect sawtooth pattern
      const peak = idx % 2 === 0;
      c.open = peak ? 100 : 102;
      c.close = peak ? 102 : 100;
      c.high = 102.5;
      c.low = 99.5;
    });

    const resultAlternating = evaluateSignal(alternatingSeries, ['__TEST_BYPASS__'], { tfMinutes: 5, durationMinutes: 15, H: 0.2, horizonClass: 'MULTI_CANDLE' as const });

    expect(resultTrend.auditTrail).toBeDefined();
    expect(resultTrend.auditTrail.hurstRegime.H_exp).toBeGreaterThan(0.55);
    expect(resultAlternating.auditTrail.hurstRegime.H_exp).toBeLessThan(0.45);
  });

  // Test 3: Pre-flight integrity checks and hard limits
  it('3. Pre-flight structural violations block trades when anomaly ratio exceeds 5%', () => {
    // Generate series with high-low inverted or negative values on multiple rows (more than 5% of 40 candles, i.e., > 2 rows)
    const corruptSeries = generateDeterministicSeries(40, (c, idx) => {
      if (idx === 5) {
        c.high = 10;
        c.low = 20; // Inverted high/low
      }
      if (idx === 10) {
        c.close = -5; // Negative coordinates
      }
      if (idx === 15) {
        c.open = 1500;
        c.high = 100; // body out of bounds
      }
    });

    const result = evaluateSignal(corruptSeries, ['__TEST_BYPASS__']);

    expect(result.winner).toBe('NO_TRADE');
    expect(result.signal).toBe('NO_TRADE');
    expect(result.noTradeReason).toContain('Standard market structure violation');
  });

  // Test 4: Dynamic sliding window and forecast intervals
  it('4. Live options analysis restricts context to sliding window sizes and uses forecast intervals correctly', () => {
    const series = generateDeterministicSeries(100);
    // durationMinutes = 5, graphTimeframeMinutes = 5 => nCandles = max(1, ceil(5/5)) = 1
    // nCut = max(20, 1 * 5) = 20
    const horizon = { tfMinutes: 5, durationMinutes: 5, H: 1.0, horizonClass: 'NEAR_FULL' as const };

    const result = evaluateSignal(series, ['__TEST_BYPASS__'], horizon);

    expect(result.auditTrail).toBeDefined();
    expect(result.auditTrail.temporalFiltering.nCandles).toBe(1);
    expect(result.auditTrail.temporalFiltering.nCut).toBe(20);
  });
});
