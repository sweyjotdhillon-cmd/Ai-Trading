import { PatternEvidence } from './patternAdapter';

export class PatternStabilityManager {
  private patternCounts: Map<string, number> = new Map();
  private readonly threshold: number;
  private readonly mode: 'streaming' | 'bar'; // FIXED: add mode field to store evaluation mode

  constructor(consecutiveFramesThreshold: number = 3, mode: 'streaming' | 'bar' = 'bar') {
    this.threshold = consecutiveFramesThreshold;
    // FIX 8: Remove unreliable arguments.length fallback to guarantee TypeScript/strict-mode compatibility
    this.mode = mode;
  }

  public processFrame(currentFramePatterns: PatternEvidence[]): PatternEvidence[] {
    if (this.mode === 'bar') {
      // FIXED: in 'bar' mode, return all detected patterns immediately (threshold effectively = 1)
      return currentFramePatterns;
    }

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
