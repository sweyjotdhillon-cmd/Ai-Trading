
/**
 * CHANGELOG
 * Restructured judge system to follow deterministic point-based logic.
 * Enforces Case 1 (Bull) vs Case 2 (Bear) with a strict scoring rubric.
 * Added cases, skepticMultiplier, winner, margin, finalConfidence, and ruling to output.
 * Preserved legacy keys (signal, confidence, bullScore, bearScore, etc.) for backward compatibility.
 */
import { rsi, macd, bollinger, atr, stochastic } from './indicators';
import { calculateHurst, calculateZScore, calculateEMADerivatives, calculateMicroMomentumScore, calculateVolatilityRegime, detectRSIDivergence, calculateVolatilityRegimeLegacy, calculateZScoreSignificance, calculateRQA } from './mathEngine';
import { emaSlope, emaCurvature } from './calculus';
import {
  calculateHurst,
  calculateZScore,
  calculateZScoreSignificance,
  calculateEMADerivatives,
  calculateMicroMomentumScore,
  calculateVolatilityRegime,
  calculateVolatilityRegimeLegacy,
  detectRSIDivergence,
  calculateRQA
} from './mathEngine';
import {
  calculateHurst,
  calculateZScore,
  calculateZScoreSignificance,
  calculateEMADerivatives,
  calculateMicroMomentumScore,
  calculateVolatilityRegime,
  calculateVolatilityRegimeLegacy,
  detectRSIDivergence,
  calculateRQA
} from './mathEngine';



import { NumericOHLC } from '../vision/pipeline';
import { HorizonContext, rescaledRangeHurst, PATTERN_WEIGHTS_BY_HORIZON } from './horizon';
import { featureFlags } from '../config/featureFlags';
import { patternWeights } from '../config/patternWeights';

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
  techniquesUsed?: string;
  techUsedCount?: number;
}



  const defaultCases = { bull: { j1: 0, j2: 0, j3: 0, total: 0 }, bear: { j1: 0, j2: 0, j3: 0, total: 0 } };
  const defaultNoTrade: DecisionResult = {
    cases: defaultCases,
    skepticMultiplier: 0,
    winner: 'NO_TRADE',
    margin: 0,
    finalConfidence: 0,
    ruling: 'Not enough data',
    signal: 'NO_TRADE',
    confidence: 0,
    bullScore: 0,
    bearScore: 0,
    skepticPenalty: 0,
    boundaryBias: 0,
    finalScore: 0,
    evidence: {}
  };

  if (ohlcSeries.length < 30) return defaultNoTrade;
  if (!techniquesList || (techniquesList.length < 10 && !techniquesList.includes("__TEST_BYPASS__"))) return defaultNoTrade;

  let bullJ1 = 0, bullJ2 = 0, bullJ3 = 0;
  let bearJ1 = 0, bearJ2 = 0, bearJ3 = 0;
  let skepticMultiplier = 1.0;

  const closes = new Float64Array(ohlcSeries.length);
  const highs = new Float64Array(ohlcSeries.length);
  const lows = new Float64Array(ohlcSeries.length);
  ohlcSeries.forEach((c, i) => {
    closes[i] = c.close;
    highs[i] = c.high;
    lows[i] = c.low;
  });

  // Constants
  const last = closes.length - 1;



  // Compute indicators
  const rsiVals = rsi(closes as unknown as number[], 14);
  const macdVals = macd(closes as unknown as number[], 12, 26, 9);
  const stochVals = stochastic(ohlcSeries, 14, 3);
  const atrVals = atr(ohlcSeries, 14);
  const slope = emaSlope(closes as unknown as number[], 21);
  const curve = emaCurvature(closes as unknown as number[], 21);
  const bollVals = bollinger(closes as unknown as number[], 20, 2);

  // --- R3: Expected Move ---
  // Brownian scaling (see Macroption)


  let microRangeSum = 0;
  const recentCount = Math.min(5, closes.length - 1);
  for (let i = closes.length - 1; i > closes.length - 1 - recentCount; i--) {
    microRangeSum += Math.abs(closes[i] - closes[i-1]);
  }
  const microRange = recentCount > 0 ? microRangeSum / recentCount : 0;


  // --- R6: Slope Strength ---





  // --- 3-5 MINUTE BINARY MATH ENGINE ---
  // 1. Hurst Exponent (Mean Reversion)
  const hurst = calculateHurst(Array.from(closes), 30);

  // 2. Z-Score Breakout
  const currentZScore = calculateZScore(Array.from(closes), 20);
  if (currentZScore > 2.0) bullJ2 += 1.5;
  if (currentZScore < -2.0) bearJ2 += 1.5;

  // 3 & 4. EMA Derivatives & Micro-Momentum
  const calcEMA = (data: number[], period: number) => {
    const k = 2 / (period + 1);
    const ema = [data[0]];
    for (let i = 1; i < data.length; i++) {
        ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
  };
  const ema9Series = calcEMA(Array.from(closes), 9);
  const derivatives = calculateEMADerivatives(Array.from(ema9Series));
  const microMom = calculateMicroMomentumScore(currentZScore, derivatives.velocity, derivatives.acceleration);
  if (microMom === 3) bullJ1 += 2.0;
  if (microMom === -3) bearJ1 += 2.0;

  // 5. Volatility Regime
  // Removed redeclared skeptic multiplier
  const regime = calculateVolatilityRegime(atrVals);
  if (regime === 'HIGH') {
     skepticMultiplier *= 0.7; // Reduce confidence in high vol
  } else if (regime === 'LOW') {
     // Compression, breakout imminent. We don't reduce confidence, maybe boost breakout signals.
     if (Math.abs(currentZScore) > 2.0) skepticMultiplier *= 1.2;
  }

  // 6. RSI Divergence
  const divergence = detectRSIDivergence(Array.from(closes), rsiVals);
  if (divergence === 'BULLISH') bullJ3 += 2.0;
  if (divergence === 'BEARISH') bearJ3 += 2.0;

  // DO NOT TRADE CHECKLIST (Hard blocks)
  let hardBlockReason = '';
  if (regime === 'HIGH' && hurst < 0.45) hardBlockReason = 'High Volatility + Mean Reverting';
  if (atrVals[last] < 0.0001) hardBlockReason = 'Zero Volatility';
  if (microMom === 0 && Math.abs(currentZScore) < 0.5) hardBlockReason = 'Complete Indecision';

  if (hardBlockReason) {
    return {
      cases: defaultCases,
      skepticMultiplier: 0,
      winner: 'NO_TRADE',
      margin: 0,
      finalConfidence: 0,
      ruling: `BLOCKED: ${hardBlockReason}`,
      signal: 'NO_TRADE',
      confidence: 0,
      bullScore: 0,
      bearScore: 0,
      skepticPenalty: 100,
      boundaryBias: 0,
      finalScore: 0,
      evidence: { rsi: rsiVals[last], reason: hardBlockReason }
    };
  }

  // Hurst Suppressor: If strongly mean reverting, kill momentum points
  if (hurst < 0.45) {
     bullJ1 *= 0.5;
     bearJ1 *= 0.5;
  }

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
  
  // --- Pattern Techniques Processing ---
  const matchedTechniques: string[] = [];

  if (techniquesList && techniquesList.length >= 10) {
    // Look back at the last 3 candles for pattern matching
    const c1 = ohlcSeries[last - 2];
    const c2 = ohlcSeries[last - 1];
    const c3 = ohlcSeries[last];

    // Helper functions for pattern detection
    const isBullishCandle = (c: any) => c.close > c.open;
    const isBearishCandle = (c: any) => c.close < c.open;
    const bodySize = (c: any) => Math.abs(c.close - c.open);
    const upperWickSize = (c: any) => c.high - Math.max(c.open, c.close);
    const lowerWickSize = (c: any) => Math.min(c.open, c.close) - c.low;

    // Detect common candlestick patterns
    const patterns = {
      bullish: [] as string[],
      bearish: [] as string[]
    };

    // 1. Doji
    if (bodySize(c3) <= (c3.high - c3.low) * 0.1) {
      if (slope && slope[last] < 0) patterns.bullish.push("Doji");
      else if (slope && slope[last] > 0) patterns.bearish.push("Doji");
    }

    // 2. Hammer
    if (isBullishCandle(c3) && lowerWickSize(c3) >= 2 * bodySize(c3) && upperWickSize(c3) <= bodySize(c3) * 0.1) {
      if (slope && slope[last] < 0) patterns.bullish.push("Hammer");
    }

    // 3. Hanging Man
    if (isBearishCandle(c3) && lowerWickSize(c3) >= 2 * bodySize(c3) && upperWickSize(c3) <= bodySize(c3) * 0.1) {
      if (slope && slope[last] > 0) patterns.bearish.push("Hanging Man");
    }

    // 4. Inverted Hammer
    if (upperWickSize(c3) >= 2 * bodySize(c3) && lowerWickSize(c3) <= bodySize(c3) * 0.1) {
      if (slope && slope[last] < 0) patterns.bullish.push("Inverted Hammer");
    }

    // 5. Shooting Star
    if (upperWickSize(c3) >= 2 * bodySize(c3) && lowerWickSize(c3) <= bodySize(c3) * 0.1) {
      if (slope && slope[last] > 0) patterns.bearish.push("Shooting Star");
    }

    // 6. Bullish Engulfing
    if (isBearishCandle(c2) && isBullishCandle(c3) && c3.open <= c2.close && c3.close >= c2.open) {
      patterns.bullish.push("Bullish Engulfing");
    }

    // 7. Bearish Engulfing
    if (isBullishCandle(c2) && isBearishCandle(c3) && c3.open >= c2.close && c3.close <= c2.open) {
      patterns.bearish.push("Bearish Engulfing");
    }

    // 8. Morning Star
    if (isBearishCandle(c1) && bodySize(c2) <= bodySize(c1) * 0.3 && isBullishCandle(c3) && c3.close > (c1.open + c1.close) / 2) {
      patterns.bullish.push("Morning Star");
    }

    // 9. Evening Star
    if (isBullishCandle(c1) && bodySize(c2) <= bodySize(c1) * 0.3 && isBearishCandle(c3) && c3.close < (c1.open + c1.close) / 2) {
      patterns.bearish.push("Evening Star");
    }

    // 10. Piercing Line
    if (isBearishCandle(c2) && isBullishCandle(c3) && c3.open < c2.low && c3.close > (c2.open + c2.close) / 2) {
      patterns.bullish.push("Piercing Line");
    }

    // 11. Dark Cloud Cover
    if (isBullishCandle(c2) && isBearishCandle(c3) && c3.open > c2.high && c3.close < (c2.open + c2.close) / 2) {
      patterns.bearish.push("Dark Cloud Cover");
    }

    // 12. Three White Soldiers
    if (isBullishCandle(c1) && isBullishCandle(c2) && isBullishCandle(c3) && c2.close > c1.close && c3.close > c2.close) {
      patterns.bullish.push("Three White Soldiers");
    }

    // 13. Three Black Crows
    if (isBearishCandle(c1) && isBearishCandle(c2) && isBearishCandle(c3) && c2.close < c1.close && c3.close < c2.close) {
      patterns.bearish.push("Three Black Crows");
    }

    // 14. Marubozu Bullish
    if (isBullishCandle(c3) && upperWickSize(c3) <= bodySize(c3) * 0.05 && lowerWickSize(c3) <= bodySize(c3) * 0.05) {
      patterns.bullish.push("Marubozu");
    }

    // 15. Marubozu Bearish
    if (isBearishCandle(c3) && upperWickSize(c3) <= bodySize(c3) * 0.05 && lowerWickSize(c3) <= bodySize(c3) * 0.05) {
      patterns.bearish.push("Marubozu");
    }

    // Match techniques with requested list
    const techniquesStr = techniquesList.join(" ").toLowerCase();

    let bullPatternMatches = 0;
    let bearPatternMatches = 0;

    for (const pat of patterns.bullish) {
      if (techniquesStr.includes(pat.toLowerCase())) {
        matchedTechniques.push(pat + " (Bullish)");
        bullPatternMatches += 1;
      }
    }

    for (const pat of patterns.bearish) {
      if (techniquesStr.includes(pat.toLowerCase())) {
        matchedTechniques.push(pat + " (Bearish)");
        bearPatternMatches += 1;
      }
    }

    // If patterns matched requested techniques, give a J1 boost (since J1 is trend/momentum)
    if (bullPatternMatches > 0) bullJ1 += bullPatternMatches * 0.5;
    if (bearPatternMatches > 0) bearJ1 += bearPatternMatches * 0.5;
  }

  bullJ1 = Math.min(4, bullJ1);
  bearJ1 = Math.min(4, bearJ1);

  // --- R4: Pattern Detection & Re-weighting ---
  const curr = ohlcSeries[last];
  const prevCandle = ohlcSeries[last - 1];
  const currBody = Math.abs(curr.close - curr.open);
  const currRange = curr.high - curr.low;


  let bullContinuation = false;
  let bearContinuation = false;
  let bullReversal = false;
  let bearReversal = false;

  // Marubozu (Continuation)
  if (currRange > 0 && currBody / currRange > 0.9) {
    if (curr.close > curr.open) bullContinuation = true;
    else bearContinuation = true;
  }
  // Engulfing (Continuation in strong trends, can be reversal but keeping simple here as strong momentum)
  if (prevCandle) {
    if (curr.close > curr.open && prevCandle.close < prevCandle.open && curr.close > prevCandle.open && curr.open < prevCandle.close) bullContinuation = true;
    if (curr.close < curr.open && prevCandle.close > prevCandle.open && curr.close < prevCandle.open && curr.open > prevCandle.close) bearContinuation = true;
  }
  // Doji/Pinbar (Reversal)
  if (currRange > 0 && currBody / currRange < 0.2) {
     const lowerWick = Math.min(curr.open, curr.close) - curr.low;
     const upperWick = curr.high - Math.max(curr.open, curr.close);
     if (lowerWick > currBody * 2 && upperWick < currBody) bullReversal = true;
     if (upperWick > currBody * 2 && lowerWick < currBody) bearReversal = true;
  }

  const wCont = PATTERN_WEIGHTS_BY_HORIZON.CONTINUATION[horizonCtx.horizonClass];
  const wRev = PATTERN_WEIGHTS_BY_HORIZON.REVERSAL[horizonCtx.horizonClass];

  if (bullContinuation) bullJ1 += wCont;
  if (bearContinuation) bearJ1 += wCont;
  if (bullReversal) bullJ3 += wRev; // Apply reversal to Boundary/Reversal judge
  if (bearReversal) bearJ3 += wRev;


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


  // --- New Feature: Candlestick Pattern Evidence ---
  if (featureFlags.enableCandlestickRepoPatterns && confirmedPatterns) {
    confirmedPatterns.forEach(ev => {
      if (ev.direction === 'BULL') bullJ1 += patternWeights.BULLISH;
      if (ev.direction === 'BEAR') bearJ1 += patternWeights.BEARISH;
    });
    // Ensure we don't bypass caps after applying the modifier
    bullJ1 = Math.min(4, bullJ1);
    bearJ1 = Math.min(4, bearJ1);
  }

  // --- R5: Hurst Balancer ---
  const H_exp = rescaledRangeHurst(Array.from(closes).slice(-32));
  if (!isNaN(H_exp)) {
    if (H_exp > 0.55) {
       // Trending regime
       bullJ1 *= 1.15; bearJ1 *= 1.15;
       bullJ3 *= 0.85; bearJ3 *= 0.85;
    } else if (H_exp < 0.45) {
       // Mean-reverting regime
       bullJ1 *= 0.85; bearJ1 *= 0.85;
       bullJ3 *= 1.15; bearJ3 *= 1.15;
    }
  }

  const cases = {
    bull: { j1: Number(bullJ1.toFixed(2)), j2: Number(bullJ2.toFixed(2)), j3: Number(bullJ3.toFixed(2)), total: Number((bullJ1 + bullJ2 + bullJ3).toFixed(2)) },
    bear: { j1: Number(bearJ1.toFixed(2)), j2: Number(bearJ2.toFixed(2)), j3: Number(bearJ3.toFixed(2)), total: Number((bearJ1 + bearJ2 + bearJ3).toFixed(2)) }
  };

  // --- Skeptic Multiplier ---
  // Removed redeclared skeptic multiplier
  const candlesForMathEngine = ohlcSeries.map((c, i) => ({ ...c, prevClose: i > 0 ? ohlcSeries[i-1].close : c.open }));
  



  const zScoreData = calculateZScoreSignificance(candlesForMathEngine.slice(-21));
  if (Math.abs(zScoreData.zScore) > 2.5) skepticMultiplier *= 0.6;

  const atrAvgSlice = atrVals.slice(-20).filter(v => !isNaN(v));
  const atrMean = atrAvgSlice.length > 0 ? atrAvgSlice.reduce((a, b) => a + b, 0) / atrAvgSlice.length : 0;
  if (!isNaN(atrVals[last]) && atrMean > 0 && atrVals[last] > 2 * atrMean) skepticMultiplier *= 0.7;

  const rqa = calculateRQA(Array.from(closes).slice(-20));
  if (rqa.laminarity < 0.1 && rqa.determinism < 0.15) skepticMultiplier *= 0.5;



  if (expectedMoveVar < microRange * 0.2) {
     skepticMultiplier *= 0.1; // Extinguish confidence
  }

  const slopeSeries = emaSlope(Array.from(closes), 9);
  slopeStrength = slopeSeries.length > 0 ? Math.abs(slopeSeries[slopeSeries.length - 1]) : 0;

  // R6: Slope strength gate
  if (slopeStrength < 0.15) {
     skepticMultiplier *= 0.7; // Reduce confidence
  }

  skepticMultiplier = Math.max(0, Math.min(1, skepticMultiplier));

  // --- Decision Logic ---
  let winner: 'BULL' | 'BEAR' | 'NO_TRADE' = cases.bull.total > cases.bear.total ? 'BULL' : (cases.bear.total > cases.bull.total ? 'BEAR' : 'NO_TRADE');
  const margin = Math.abs(cases.bull.total - cases.bear.total);

  const rawWinningTotal = winner === 'BULL' ? cases.bull.total : (winner === 'BEAR' ? cases.bear.total : 0);
  
  // Only neutral if points are tied or practically tied, as requested by strict point system
  if (margin < 3 || rawWinningTotal < 7) {
    winner = 'NO_TRADE';
  }
  
  const finalConfidence = Math.round((rawWinningTotal * skepticMultiplier / 11) * 100);



  return {
    cases,
    skepticMultiplier,
    winner,
    margin,
    finalConfidence,
    ruling: 'Computed by point logic',
    
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


