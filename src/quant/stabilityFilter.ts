import { DecisionResult } from './ruleEngine';

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

export function resetStability(): void {
  signals = [];
}
