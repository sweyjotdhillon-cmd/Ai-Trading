/**
 * ChartLens Neutrality Enforcement Layer (NEL)
 * Implements strict directional symmetry gates and anti-bias adjustments
 * to eliminate systemic CALL/PUT asymmetries over long-run execution.
 */

const MAX_HISTORY = 100;
const globalDecisionHistory: ('LONG' | 'NO_TRADE')[] = [];

/**
 * Record a decision into the global history for rolling bias detection.
 */
export function recordDecision(signal: 'LONG' | 'NO_TRADE'): void {
  globalDecisionHistory.push(signal);
  if (globalDecisionHistory.length > MAX_HISTORY) {
    globalDecisionHistory.shift();
  }
}

/**
 * Reset the rolling decision history (useful for automated backtesting).
 */
export function resetDecisionHistory(): void {
  globalDecisionHistory.length = 0;
}

/**
 * Retrieve current rolling historical LONG signal selection rates.
 */
export function getHistoricalRates() {
  const total = globalDecisionHistory.length;
  if (total === 0) {
    return { bullRate: 0.5, bearRate: 0.0, flatRate: 0.5, total: 0 };
  }
  const bulls = globalDecisionHistory.filter(s => s === 'LONG').length;
  const flats = globalDecisionHistory.filter(s => s === 'NO_TRADE').length;
  return {
    bullRate: bulls / total,
    bearRate: 0.0,
    flatRate: flats / total,
    total
  };
}

export interface NeutralityConfig {
  epsilonTie: number;             // margin below which decision is immediately tie/neutral
  softNeutralBand: number;        // soft band below which confidence is damped
  biasCorrectionFactor: number;   // multiplier adjustment strength for anti-bias
  historicalBullRate?: number;    // external hook for testing bias correction
  historicalBearRate?: number;    // external hook for testing bias correction
}

/**
 * Enforce strict mechanical symmetry and rolling anti-bias on trading scores.
 */
export function enforceNeutrality(
  bullTotal: number,
  bearTotal: number,
  margin: number,
  finalConfidence: number,
  config: NeutralityConfig
) {
  const neutralityActions: string[] = [];
  let adjustedBull = bullTotal;
  let adjustedBear = bearTotal;
  let adjustedConfidence = finalConfidence;

  // 1. Pointwise Margin Symmetry & Tie-Breaker Gate (Invariant I-2)
  if (margin < config.epsilonTie) {
    neutralityActions.push(`FORCED NO_TRADE: absolute margin ${margin.toFixed(3)} < epsilonTie ${config.epsilonTie}`);
    return {
      signal: 'NO_TRADE' as const,
      adjustedBull,
      adjustedBear,
      adjustedConfidence: 0,
      neutralityActions
    };
  }

  // 2. Anti-Bias Rolling Historical Correction Channel (Invariant I-10)
  const bullRate = config.historicalBullRate !== undefined 
    ? config.historicalBullRate 
    : getHistoricalRates().bullRate;

  const biasStrength = config.biasCorrectionFactor;

  if (biasStrength > 0) {
    if (bullRate > 0.70) {
      // Historical over-representation of LONG signals (>70%). Apply anti-bias bull dampening correction.
      const correctionFactor = Math.min(0.15, (bullRate - 0.70) * 0.5) * biasStrength * 10; 
      adjustedBull = bullTotal * (1 - correctionFactor);
      adjustedBear = bearTotal * (1 + correctionFactor);
      neutralityActions.push(`BULL DAMPENING: LONG rate ${bullRate.toFixed(2)} > 0.70. Penalized BULL (-${(correctionFactor * 100).toFixed(1)}%), Boosted BEAR (+${(correctionFactor * 100).toFixed(1)}%)`);
    }
  }

  // Recalculate margins after bias correction (if any correction was applied)
  const adjustedMargin = Math.abs(adjustedBull - adjustedBear);

  // 3. Soft Neutral Band Dampening inside range (Preventing high confidence on close decisions)
  if (adjustedMargin < config.softNeutralBand && config.softNeutralBand > 0) {
    const ratio = Math.max(0, adjustedMargin / config.softNeutralBand);
    adjustedConfidence = Math.round(finalConfidence * ratio);
    neutralityActions.push(`SOFT BAND DAMP: Adjusted margin ${adjustedMargin.toFixed(3)} < softNeutralBand ${config.softNeutralBand}. Damped confidence from ${finalConfidence}% to ${adjustedConfidence}%`);
  }

  // Define winning state based on final, adjusted values (Only LONG is permitted as trade direction; BEAR wins output NO_TRADE)
  let signal: 'LONG' | 'NO_TRADE' = 'NO_TRADE';
  if (adjustedBull > adjustedBear) {
    signal = 'LONG';
  } else {
    signal = 'NO_TRADE';
  }

  return {
    signal,
    adjustedBull: Number(adjustedBull.toFixed(3)),
    adjustedBear: Number(adjustedBear.toFixed(3)),
    adjustedConfidence,
    neutralityActions
  };
}

// ─── Scalp Long-Only Additions ──────────────────────────────
import { ScalpSignal } from '../types';

const BUY_HISTORY_MAX = 100;
const scalpDecisionHistory: ('BUY' | 'NO_TRADE')[] = [];

export function recordScalpDecision(signal: ScalpSignal): void {
  if (signal !== 'BUY' && signal !== 'NO_TRADE') return;
  scalpDecisionHistory.push(signal);
  if (scalpDecisionHistory.length > BUY_HISTORY_MAX) scalpDecisionHistory.shift();
}

export function getScalpBuyRate(): { buyRate: number; total: number } {
  const total = scalpDecisionHistory.length;
  if (total === 0) return { buyRate: 0, total: 0 };
  return { buyRate: scalpDecisionHistory.filter(s => s === 'BUY').length / total, total };
}

/**
 * Returns an additive penalty (0..0.20) to apply to confluence threshold
 * when BUY-rate is > 70% (engine over-trading) — equivalent of legacy NEL's
 * symmetric bias correction, but one-sided for long-only.
 */
export function scalpOverTradingPenalty(): number {
  const { buyRate, total } = getScalpBuyRate();
  if (total < 25) return 0;
  if (buyRate > 0.70) return Math.min(0.20, (buyRate - 0.70) * 0.50);
  if (buyRate < 0.05 && total > 50) return -0.05; // under-trading hint, optional unlock
  return 0;
}

export function resetScalpHistory(): void {
  scalpDecisionHistory.length = 0;
}

