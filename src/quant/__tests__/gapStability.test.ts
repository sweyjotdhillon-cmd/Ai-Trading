import { describe, it, expect } from 'vitest';
import { GapStabilityManager } from '../gapStability';

describe('gapStability', () => {
  it('requires persistence across frames', () => {
    const mgr = new GapStabilityManager(3);
    const gap = { type: 'GAP_UP', direction: 'BULL', strength: 1, index: 1 } as any;
    expect(mgr.processFrame(gap)).toEqual([]);
    expect(mgr.processFrame(gap)).toEqual([]);
    expect(mgr.processFrame(gap).length).toBe(1);
  });

  it('resets on null gap frame', () => {
    const mgr = new GapStabilityManager(2);
    const gap = { type: 'PARTIAL_GAP_DOWN', direction: 'BEAR', strength: 0.6, index: 2 } as any;
    mgr.processFrame(gap);
    mgr.processFrame(null);
    expect(mgr.processFrame(gap)).toEqual([]);
  });
});
