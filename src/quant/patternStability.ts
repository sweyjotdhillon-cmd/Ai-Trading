import { PatternEvidence } from './patternAdapter';

export class PatternStabilityManager {
  private patternCounts: Map<string, number> = new Map();
  private readonly threshold: number;

  constructor(consecutiveFramesThreshold: number = 3) {
    this.threshold = consecutiveFramesThreshold;
  }

  public processFrame(currentFramePatterns: PatternEvidence[]): PatternEvidence[] {
    const currentPatternNames = new Set(currentFramePatterns.map(p => p.pattern));
    const confirmedPatterns: PatternEvidence[] = [];

    // Increment counts for patterns present in the current frame
    for (const pattern of currentFramePatterns) {
      const count = (this.patternCounts.get(pattern.pattern) || 0) + 1;
      this.patternCounts.set(pattern.pattern, count);

      if (count >= this.threshold) {
        confirmedPatterns.push(pattern);
      }
    }

    // Reset counts for patterns that were not detected in the current frame
    for (const key of this.patternCounts.keys()) {
      if (!currentPatternNames.has(key)) {
         this.patternCounts.set(key, 0);
      }
    }

    return confirmedPatterns;
  }

  public reset(): void {
    this.patternCounts.clear();
  }
}
