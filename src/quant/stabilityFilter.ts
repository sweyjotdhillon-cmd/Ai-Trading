import { DecisionResult } from './ruleEngine';
import { ScalpSignal, ScalpStabilityResult } from '../types';

const FRAME_BUFFER_SIZE = 5;
let signals: { signal: 'CALL' | 'PUT' | 'NO_TRADE'; finalScore: number; confidence: number }[] = [];

export interface StabilityResult {
  stable: boolean;
  signal: 'CALL' | 'PUT' | 'NO_TRADE';
  confidence: number;
}

export function emitStability(decision: DecisionResult): StabilityResult {
  signals.push({ signal: decision.signal, finalScore: decision.finalScore, confidence: decision.confidence });
  if (signals.length > FRAME_BUFFER_SIZE) {
    signals.shift();
  }
  
  let stable = false;
  if (signals.length >= 3) {
    const last3 = signals.slice(-3);
    const sameSignal = last3[0].signal === last3[1].signal && last3[1].signal === last3[2].signal;
    const allStrong = last3.every(s => Math.abs(s.finalScore) >= 50);
    const notNoTrade = last3[0].signal !== 'NO_TRADE';
    
    // Also require minimum confidence of 55
    const latestConfidence = last3[2].confidence;
    
    if (sameSignal && allStrong && notNoTrade && latestConfidence >= 55) {
      stable = true;
    }
  }

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
  // Map BUY to CALL, and others to NO_TRADE for stability calculations
  const mappedSignal = rawSignal === 'BUY' ? 'CALL' : 'NO_TRADE';
  const legacyDecisionObj: DecisionResult = {
    winner: rawSignal === 'BUY' ? 'BULL' : 'NO_TRADE',
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

