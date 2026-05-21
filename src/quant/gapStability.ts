import { GapEvidence } from './gapDetector';

export class GapStabilityManager {
  private counts = new Map<string, number>();
  constructor(private readonly threshold = 3) {}

  processFrame(gap: GapEvidence | null): GapEvidence[] {
    if (!gap) {
      this.counts.clear();
      return [];
    }
    const key = `${gap.type}:${gap.direction}`;
    const next = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, next);
    for (const k of this.counts.keys()) {
      if (k !== key) this.counts.set(k, 0);
    }
    return next >= this.threshold ? [gap] : [];
  }

  reset(): void { this.counts.clear(); }
}
