import { temporalFilterConfig } from '../config/temporalFilterConfig';

export interface TemporalFilterResult {
  signal: 'CALL' | 'PUT' | 'NO_TRADE';
  confidence: number;
  finalScore: number;
  stable: boolean;
}

let smoothedConfidence: number | null = null;
let smoothedFinalScore: number | null = null;
let previousDirection: 'CALL' | 'PUT' | 'NO_TRADE' = 'NO_TRADE';

export function applyTemporalFilter(
  rawSignal: 'CALL' | 'PUT' | 'NO_TRADE',
  rawConfidence: number,
  rawFinalScore: number,
  rawStable: boolean
): TemporalFilterResult {
  const { alpha, confidenceThreshold } = temporalFilterConfig;

  // If the directional signal changes entirely (CALL <-> PUT), break the EMA chain.
  // Blending opposite confidences violates deterministic explainability.
  if (rawSignal !== 'NO_TRADE' && previousDirection !== 'NO_TRADE' && rawSignal !== previousDirection) {
    smoothedConfidence = null;
    smoothedFinalScore = null;
  }

  // Target values for EMA
  // Treat NO_TRADE as 0 confidence and 0 score to gracefully decay the filter
  const targetConfidence = rawSignal === 'NO_TRADE' ? 0 : rawConfidence;
  const targetFinalScore = rawSignal === 'NO_TRADE' ? 0 : rawFinalScore;

  if (smoothedConfidence === null || smoothedFinalScore === null) {
    smoothedConfidence = targetConfidence;
    smoothedFinalScore = targetFinalScore;
  } else {
    smoothedConfidence = (alpha * targetConfidence) + ((1 - alpha) * smoothedConfidence);
    smoothedFinalScore = (alpha * targetFinalScore) + ((1 - alpha) * smoothedFinalScore);
  }

  // Keep track of the last active direction so we can break the EMA on reversals
  if (rawSignal !== 'NO_TRADE') {
    previousDirection = rawSignal;
  } else if (smoothedConfidence < 1) {
    // If it decayed close to 0, completely reset previous direction to prevent stale state
    previousDirection = 'NO_TRADE';
  }

  let outSignal = rawSignal;
  let outStable = rawStable;

  // Rule: Smoothing must NEVER force trades.
  if (rawSignal === 'NO_TRADE') {
    outSignal = 'NO_TRADE';
    outStable = false;
  }
  // Rule: Stable silence & NO_TRADE enforcement
  // If smoothed confidence drops below threshold, suppress the signal.
  else if (smoothedConfidence < confidenceThreshold) {
    outSignal = 'NO_TRADE';
    outStable = false; // It's no longer a stable trade if it's downgraded to NO_TRADE
  }

  return {
    signal: outSignal,
    confidence: smoothedConfidence,
    finalScore: smoothedFinalScore,
    stable: outStable
  };
}

export function resetTemporalFilter(): void {
  smoothedConfidence = null;
  smoothedFinalScore = null;
  previousDirection = 'NO_TRADE';
}
