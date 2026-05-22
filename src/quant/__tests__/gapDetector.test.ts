import { describe, it, expect } from 'vitest';
import { detectLatestGap } from '../gapDetector';

describe('gapDetector', () => {
  it('detects full gap up deterministically', () => {
    const gap = detectLatestGap([
      { open: 10, high: 12, low: 9, close: 11 },
      { open: 13, high: 14, low: 13.1, close: 13.5 },
    ] as any);
    expect(gap?.type).toBe('GAP_UP');
    expect(gap?.direction).toBe('BULL');
  });

  it('detects full gap down deterministically', () => {
    const gap = detectLatestGap([
      { open: 10, high: 12, low: 9, close: 11 },
      { open: 8.8, high: 8.9, low: 8.1, close: 8.5 },
    ] as any);
    expect(gap?.type).toBe('GAP_DOWN');
    expect(gap?.direction).toBe('BEAR');
  });
});
