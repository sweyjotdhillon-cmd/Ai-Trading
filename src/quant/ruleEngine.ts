/**
 * CHANGELOG
 * Restructured judge system to follow deterministic point-based logic.
 * Enforces Case 1 (Bull) vs Case 2 (Bear) with a strict scoring rubric.
 * Added cases, skepticMultiplier, winner, margin, finalConfidence, and ruling to output.
 * Preserved legacy keys (signal, confidence, bullScore, bearScore, etc.) for backward compatibility.
 */
import { rsi, macd, bollinger, atr, stochastic } from './indicators';
import { emaSlope, emaCurvature } from './calculus';
import { calculateBoundaryReversal } from './boundary';
import { 
  calculateVolatilityRegime, 
  calculateZScoreSignificance,
  calculatePredictability,
  calculateRobustness,
  calculateCEF,
  calculateRQA
} from './mathEngine';
import { PriceAxisTransform } from '../vision/axisReader';
import { NumericOHLC } from '../vision/pipeline';

export interface CaseScore {
  j1: number;
  j2: number;
  j3: number;
  total: number;
}

export interface JudgeVerdict {
  cases: { bull: CaseScore; bear: CaseScore };
  skepticMultiplier: number;
  winner: 'BULL' | 'BEAR' | 'NO_TRADE';
  margin: number;
  finalConfidence: number;
  ruling: string;
}

export interface DecisionResult extends JudgeVerdict {
  signal: 'CALL' | 'PUT' | 'NO_TRADE';
  confidence: number;
  bullScore: number;
  bearScore: number;
  skepticPenalty: number;
  boundaryBias: number;
  finalScore: number;
  evidence: any;
}

export function evaluateSignal(ohlcSeries: NumericOHLC[], priceAxis: PriceAxisTransform | null, ohlcQuality: 'REAL_PRICE' | 'NORMALIZED_FALLBACK' = 'REAL_PRICE'): DecisionResult {
  const defaultCases = { bull: { j1: 0, j2: 0, j3: 0, total: 0 }, bear: { j1: 0, j2: 0, j3: 0, total: 0 } };
  const defaultNoTrade: DecisionResult = {
    cases: defaultCases, skepticMultiplier: 1, winner: 'NO_TRADE', margin: 0, finalConfidence: 0, ruling: 'Insufficient data',
    signal: 'NO_TRADE', confidence: 0, bullScore: 0, bearScore: 0,
    skepticPenalty: 0, boundaryBias: 0, finalScore: 0, evidence: {}
  };
  
  if (ohlcSeries.length < 30) return defaultNoTrade;

  const closes = ohlcSeries.map(c => c.close);
  const highs = ohlcSeries.map(c => c.high);
  const lows = ohlcSeries.map(c => c.low);

  // Constants
  const last = closes.length - 1;
  const prev = closes.length - 2;

  // Compute indicators
  const rsiVals = rsi(closes, 14);
  const macdVals = macd(closes, 12, 26, 9);
  const stochVals = stochastic(ohlcSeries, 14, 3);
  const atrVals = atr(ohlcSeries, 14);
  const slope = emaSlope(closes, 21);
  const curve = emaCurvature(closes, 21);
  const bollVals = bollinger(closes, 20, 2);

  let bullJ1 = 0, bullJ2 = 0, bullJ3 = 0;
  let bearJ1 = 0, bearJ2 = 0, bearJ3 = 0;

  // --- Judge 1: Trend & Momentum ---
  if (!isNaN(slope[last])) {
    if (slope[last] > 0) bullJ1 += Math.min(2, Math.abs(slope[last]) * 10); // magnitude heuristic up to 2
    else if (slope[last] < 0) bearJ1 += Math.min(2, Math.abs(slope[last]) * 10);
  }
  if (!isNaN(curve[last]) && !isNaN(slope[last])) {
    if (curve[last] > 0 && slope[last] > 0) bullJ1 += 1;
    if (curve[last] < 0 && slope[last] < 0) bearJ1 += 1;
  }
  
  // Higher-highs / Lower-lows of last 5 closes
  const last5 = closes.slice(-5);
  let isHH = true, isLL = true;
  for (let i = 1; i < last5.length; i++) {
    if (last5[i] <= last5[i-1]) isHH = false;
    if (last5[i] >= last5[i-1]) isLL = false;
  }
  if (isHH) bullJ1 += 1;
  if (isLL) bearJ1 += 1;
  
  bullJ1 = Math.min(4, bullJ1);
  bearJ1 = Math.min(4, bearJ1);

  // --- Judge 2: Oscillator Consensus ---
  const rsiValue = rsiVals[last];
  if (!isNaN(rsiValue)) {
    if (rsiValue >= 45) bullJ2 += Math.min(1.5, ((rsiValue - 45) / 30) * 1.5);
    if (rsiValue <= 55) bearJ2 += Math.min(1.5, ((55 - rsiValue) / 30) * 1.5);
  }

  const hist = macdVals.hist[last];
  if (!isNaN(hist) && closes[last] !== 0) {
    const histNorm = (hist / closes[last]) * 1000;
    if (histNorm > 0) bullJ2 += Math.min(1.5, Math.tanh(histNorm) * 1.5);
    if (histNorm < 0) bearJ2 += Math.min(1.5, Math.tanh(-histNorm) * 1.5);
  }

  const stochK = stochVals.k[last];
  const stochD = stochVals.d[last];
  if (!isNaN(stochK) && !isNaN(stochD)) {
    if (stochK > stochD && stochK < 80) bullJ2 += 1;
    if (stochK < stochD && stochK > 20) bearJ2 += 1;
  }

  bullJ2 = Math.min(4, bullJ2);
  bearJ2 = Math.min(4, bearJ2);

  // --- Judge 3: Boundary / Reversal ---
  let yPercent = 50;
  const maxH = Math.max(...highs);
  const minL = Math.min(...lows);
  if (maxH !== minL) {
    yPercent = ((closes[last] - minL) / (maxH - minL)) * 100;
  }
  
  // yPercent (0..100 -> 0..3 mapping)
  // Low yPercent means price is near bottom (bullish). High means near top (bearish).
  if (yPercent <= 50) bullJ3 += (50 - yPercent) / 50 * 3;
  if (yPercent >= 50) bearJ3 += (yPercent - 50) / 50 * 3;

  const lastCandle = ohlcSeries[last];
  const body = Math.abs(lastCandle.close - lastCandle.open);
  const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
  const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
  
  if (body > 0 && lowerWick > body * 1.5) bullJ3 += 1;
  if (body > 0 && upperWick > body * 1.5) bearJ3 += 1;

  bullJ3 = Math.min(3, bullJ3);
  bearJ3 = Math.min(3, bearJ3);

  const cases = {
    bull: { j1: Number(bullJ1.toFixed(2)), j2: Number(bullJ2.toFixed(2)), j3: Number(bullJ3.toFixed(2)), total: Number((bullJ1 + bullJ2 + bullJ3).toFixed(2)) },
    bear: { j1: Number(bearJ1.toFixed(2)), j2: Number(bearJ2.toFixed(2)), j3: Number(bearJ3.toFixed(2)), total: Number((bearJ1 + bearJ2 + bearJ3).toFixed(2)) }
  };

  // --- Skeptic Multiplier ---
  let skepticMultiplier = 1.0;
  const candlesForMathEngine = ohlcSeries.map((c, i) => ({ ...c, prevClose: i > 0 ? ohlcSeries[i-1].close : c.open }));
  
  const vol = calculateVolatilityRegime(candlesForMathEngine.slice(-20));
  if (vol.status === 'EXPLOSIVE_SKIP') skepticMultiplier *= 0.5;

  const zScoreData = calculateZScoreSignificance(candlesForMathEngine.slice(-21));
  if (Math.abs(zScoreData.zScore) > 2.5) skepticMultiplier *= 0.6;

  const atrAvgSlice = atrVals.slice(-20).filter(v => !isNaN(v));
  const atrMean = atrAvgSlice.length > 0 ? atrAvgSlice.reduce((a, b) => a + b, 0) / atrAvgSlice.length : 0;
  if (!isNaN(atrVals[last]) && atrMean > 0 && atrVals[last] > 2 * atrMean) skepticMultiplier *= 0.7;

  const rqa = calculateRQA(closes.slice(-20));
  if (rqa.laminarity < 0.1 && rqa.determinism < 0.15) skepticMultiplier *= 0.5;

  skepticMultiplier = Math.max(0, Math.min(1, skepticMultiplier));

  // --- Decision Logic ---
  let winner: 'BULL' | 'BEAR' | 'NO_TRADE' = cases.bull.total > cases.bear.total ? 'BULL' : (cases.bear.total > cases.bull.total ? 'BEAR' : 'NO_TRADE');
  const margin = Math.abs(cases.bull.total - cases.bear.total);

  if (margin < 4.0) winner = 'NO_TRADE';
  const winningTotal = winner === 'BULL' ? cases.bull.total : (winner === 'BEAR' ? cases.bear.total : 0);
  
  if (winningTotal < 8.0) winner = 'NO_TRADE';
  if (skepticMultiplier < 0.5) winner = 'NO_TRADE';
  const finalConfidence = Math.round((winningTotal * skepticMultiplier / 11) * 100);

  let ruling = winner === 'NO_TRADE' ? 'Margin too close or high skeptic veto.' : `Clear ${winner} edge.`;

  return {
    cases,
    skepticMultiplier,
    winner,
    margin,
    finalConfidence,
    ruling,
    
    // Legacy fields
    signal: winner === 'BULL' ? 'CALL' : (winner === 'BEAR' ? 'PUT' : 'NO_TRADE'),
    confidence: finalConfidence,
    bullScore: cases.bull.total,
    bearScore: cases.bear.total,
    skepticPenalty: (1 - skepticMultiplier) * 100,
    boundaryBias: 0,
    finalScore: (winner === 'BULL' ? cases.bull.total : -cases.bear.total) * skepticMultiplier,
    evidence: {
      rsi: rsiVals[last],
      macd: macdVals.macd[last],
      macdHist: macdVals.hist[last],
      bollMiddle: bollVals.middle[last],
      lastClose: closes[last]
    }
  };
}
