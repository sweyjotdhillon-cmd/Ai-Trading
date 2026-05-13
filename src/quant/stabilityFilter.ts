import { DecisionResult } from './ruleEngine';

const FRAME_BUFFER_SIZE = 5;
let signals: ('CALL' | 'PUT' | 'NO_TRADE')[] = [];

export interface StabilityResult {
  stable: boolean;
  signal: 'CALL' | 'PUT' | 'NO_TRADE';
  confidence: number;
}

export function emitStability(decision: DecisionResult): StabilityResult {
  signals.push(decision.signal);
  if (signals.length > FRAME_BUFFER_SIZE) {
    signals.shift();
  }
  
  let stable = false;
  if (signals.length >= 3) {
    const last3 = signals.slice(-3);
    if (last3[0] === last3[1] && last3[1] === last3[2] && last3[0] !== 'NO_TRADE') {
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
