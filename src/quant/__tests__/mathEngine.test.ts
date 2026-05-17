import { describe, it, expect } from 'vitest';
import { calculateRQA } from '../mathEngine';

describe('mathEngine - calculateRQA', () => {
  it('returns zeros for short series (< 10 elements)', () => {
    const shortSeries = [1, 2, 3, 4, 5];
    const result = calculateRQA(shortSeries);
    expect(result).toEqual({ recurrenceRate: 0, determinism: 0, laminarity: 0 });
  });

  it('handles flat series properly (range = 0)', () => {
    const flatSeries = Array(20).fill(5);
    // When range is 0, threshold is 0.
    // Math.abs(5 - 5) is 0, which is NOT < 0. So rp matrix is all 0s.
    // As a result, recurrenceRate is 0, determinism is 0, laminarity is 0.
    const result = calculateRQA(flatSeries);
    expect(result).toEqual({ recurrenceRate: 0, determinism: 0, laminarity: 0 });
  });

  it('yields high determinism and laminarity for a predictable deterministic series (e.g. sine wave)', () => {
    const sineWave = Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1));
    const result = calculateRQA(sineWave, 0.1);

    // Deterministic series should have high determinism and laminarity
    expect(result.recurrenceRate).toBeGreaterThan(0);
    expect(result.determinism).toBeGreaterThan(0.9);
    expect(result.laminarity).toBeGreaterThan(0.9);
  });

  it('yields lower determinism and laminarity for random noise compared to deterministic series', () => {
    const randomNoise = Array.from({ length: 100 }, () => Math.random());
    const result = calculateRQA(randomNoise, 0.1);

    // Random series should have lower determinism and laminarity than sine wave
    // (Typically ~0.2 - 0.4 depending on length and epsilon)
    expect(result.recurrenceRate).toBeGreaterThan(0);
    expect(result.determinism).toBeLessThan(0.6);
    expect(result.laminarity).toBeLessThan(0.6);
  });
});
