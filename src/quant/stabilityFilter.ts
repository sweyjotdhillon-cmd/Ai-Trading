import { DecisionResult } from './ruleEngine';
import { ScalpSignal, ScalpStabilityResult } from '../types';

const FRAME_BUFFER_SIZE = 5;
let signals: { signal: 'LONG' | 'NO_TRADE'; finalScore: number; confidence: number }[] = [];

export interface StabilityResult {
  stable: boolean;
  signal: 'LONG' | 'NO_TRADE';
  confidence: number;
}

export function emitStability(decision: DecisionResult): StabilityResult {
  signals.push({ signal: decision.signal, finalScore: decision.finalScore, confidence: decision.confidence });
  if (signals.length > FRAME_BUFFER_SIZE) {
    signals.shift();
  }
  
  // No longer require 3 in a row. A single strong signal is immediately stable.
  const notNoTrade = decision.signal !== 'NO_TRADE';
  const isStrong = Math.abs(decision.finalScore) >= 50;
  const hasMinConfidence = decision.confidence >= 55;
  const stable = notNoTrade && isStrong && hasMinConfidence;

  return {
    stable,
    signal: decision.signal,
    confidence: decision.confidence
  };
}

export function emitScalpStability(
  rawSignal: ScalpSignal,
  confidence: number,
  finalScore: number
): ScalpStabilityResult {
  // Map BUY or LONG to LONG, and others to NO_TRADE for stability calculations
  const mappedSignal = (rawSignal === 'BUY' || rawSignal === 'LONG') ? 'LONG' : 'NO_TRADE';
  const legacyDecisionObj: DecisionResult = {
    winner: (rawSignal === 'BUY' || rawSignal === 'LONG') ? 'BULL' : 'NO_TRADE',
    finalConfidence: confidence,
    margin: finalScore,
    ruling: '',
    cases: { bull: { j1: 0, j2: 0, j3: 0, total: finalScore }, bear: { j1: 0, j2: 0, j3: 0, total: 0 } },
    skepticMultiplier: 1,
    agent: 'JUDGE',
    signal: mappedSignal,
    decision: finalScore >= 50 ? 'STRONG SIGNAL' : 'WEAK',
    skepticVerdict: 'ACCEPT',
    primaryEvidence: '',
    noTradeReason: null,
    topPatterns: { bull: [], bear: [] },
    formattedReport: '',
    tradeDetails: { latencyAdjustedForecast: '', techniquesUsed: '', executionTimeMs: 0 },
    j1Score: 0, j2Score: 0, j3Score: 0, j4Score: 0,
    confidence, bullScore: 0, bearScore: 0
  };
  
  const result = emitStability(legacyDecisionObj);
  return {
    stable: result.stable,
    signal: rawSignal,
    confidence: result.confidence
  };
}

export function resetStability(): void {
  signals = [];
}

