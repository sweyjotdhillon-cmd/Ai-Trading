import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTemporalFilter, resetTemporalFilter } from '../temporalFilter';
import { temporalFilterConfig } from '../../config/temporalFilterConfig';

describe('Temporal Filter Integration', () => {
  beforeEach(() => {
    resetTemporalFilter();
  });

  it('preserves determinism: identical inputs yield identical outputs', () => {
    const res1 = applyTemporalFilter('CALL', 80, 70, true);
    resetTemporalFilter();
    const res2 = applyTemporalFilter('CALL', 80, 70, true);
    expect(res1).toEqual(res2);
  });

  it('dampens rapid signal spikes if confidence falls below threshold', () => {
    // Spike: raw confidence 80, raw score 70
    // Alpha is 0.25 by default.
    // First frame initialization (no smoothing yet)
    let res = applyTemporalFilter('CALL', 80, 70, true);
    expect(res.confidence).toBe(80);
    expect(res.stable).toBe(true);

    // Frame 2: Confidence drops sharply.
    res = applyTemporalFilter('CALL', 40, 20, false);
    // EMA: 0.25 * 40 + 0.75 * 80 = 10 + 60 = 70
    expect(res.confidence).toBe(70);
    // Still technically above 55 threshold, so it remains CALL but inherits rawStable=false.
    expect(res.signal).toBe('CALL');

    // Frame 3: Drops again.
    res = applyTemporalFilter('CALL', 20, 10, false);
    // EMA: 0.25 * 20 + 0.75 * 70 = 5 + 52.5 = 57.5
    expect(res.confidence).toBe(57.5);

    // Frame 4: Drops again, crossing the threshold (55).
    res = applyTemporalFilter('CALL', 10, 5, false);
    // EMA: 0.25 * 10 + 0.75 * 57.5 = 2.5 + 43.125 = 45.625
    expect(res.confidence).toBe(45.625);
    // Suppressed to NO_TRADE due to stable silence rule!
    expect(res.signal).toBe('NO_TRADE');
    expect(res.stable).toBe(false);
  });

  it('enforces stable silence: breaks chain on opposite signals', () => {
    let res = applyTemporalFilter('CALL', 80, 70, true);
    expect(res.confidence).toBe(80);

    // Reversal immediately breaks the EMA chain.
    res = applyTemporalFilter('PUT', 80, -70, true);
    expect(res.confidence).toBe(80);
    expect(res.signal).toBe('PUT');
  });

  it('never forces a trade: NO_TRADE raw always yields NO_TRADE', () => {
    // Initial high confidence CALL
    applyTemporalFilter('CALL', 90, 80, true);

    // Raw signal suddenly becomes NO_TRADE.
    const res = applyTemporalFilter('NO_TRADE', 0, 0, false);

    // Smooth confidence decays (0.25 * 0 + 0.75 * 90 = 67.5)
    // But since raw was NO_TRADE, the output must remain NO_TRADE.
    expect(res.signal).toBe('NO_TRADE');
    expect(res.stable).toBe(false);
  });
});
