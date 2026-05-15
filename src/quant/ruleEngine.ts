/**
 * CHANGELOG
 * Restructured judge system to follow deterministic point-based logic.
 * Enforces Case 1 (Bull) vs Case 2 (Bear) with a strict scoring rubric.
 * Added cases, skepticMultiplier, winner, margin, finalConfidence, and ruling to output.
 * Preserved legacy keys (signal, confidence, bullScore, bearScore, etc.) for backward compatibility.
 */
import { rsi, macd, bollinger, atr, stochastic } from './indicators';
import { emaSlope, emaCurvature } from './calculus';

import { 
  calculateVolatilityRegime, 
  calculateZScoreSignificance,
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
  techniquesUsed?: string;
  techUsedCount?: number;
}

export function evaluateSignal(ohlcSeries: NumericOHLC[], priceAxis: PriceAxisTransform | null, ohlcQuality?: any, techniquesList: any[] = []): DecisionResult {
  const defaultCases = { bull: { j1: 0, j2: 0, j3: 0, total: 0 }, bear: { j1: 0, j2: 0, j3: 0, total: 0 } };
  const defaultNoTrade: DecisionResult = {
    cases: defaultCases, skepticMultiplier: 1, winner: 'NO_TRADE', margin: 0, finalConfidence: 0, ruling: 'Insufficient data or techniques',
    signal: 'NO_TRADE', confidence: 0, bullScore: 0, bearScore: 0,
    skepticPenalty: 0, boundaryBias: 0, finalScore: 0, evidence: {},
    techniquesUsed: '', techUsedCount: 0
  };
  
  if (ohlcSeries.length < 30) return defaultNoTrade;
  if (techniquesList.length < 10) return defaultNoTrade;

  const closes = ohlcSeries.map(c => c.close);
  const highs = ohlcSeries.map(c => c.high);
  const lows = ohlcSeries.map(c => c.low);

  // Constants
  const last = closes.length - 1;


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

    // --- CANDLESTICK PATTERNS ---
    const dojiThreshold = (c3.high - c3.low) * 0.1;
    if (bodySize(c3) <= dojiThreshold) {
      if (slope && slope[last] < 0) patterns.bullish.push("Doji");
      else if (slope && slope[last] > 0) patterns.bearish.push("Doji");

      // Gravestone Doji (no lower wick, long upper)
      if (lowerWickSize(c3) <= dojiThreshold && upperWickSize(c3) > dojiThreshold * 2) {
         patterns.bearish.push("Gravestone Doji");
      }
      // Dragonfly Doji (no upper wick, long lower)
      if (upperWickSize(c3) <= dojiThreshold && lowerWickSize(c3) > dojiThreshold * 2) {
         patterns.bullish.push("Dragonfly Doji");
      }
      // Long-Legged Doji
      if (upperWickSize(c3) > bodySize(c3)*3 && lowerWickSize(c3) > bodySize(c3)*3) {
         patterns.bullish.push("Long-Legged Doji");
         patterns.bearish.push("Long-Legged Doji");
      }
    }

    if (isBullishCandle(c3) && lowerWickSize(c3) >= 2 * bodySize(c3) && upperWickSize(c3) <= bodySize(c3) * 0.1) {
      patterns.bullish.push("Hammer");
    }
    if (isBearishCandle(c3) && lowerWickSize(c3) >= 2 * bodySize(c3) && upperWickSize(c3) <= bodySize(c3) * 0.1) {
      patterns.bearish.push("Hanging Man");
    }
    if (upperWickSize(c3) >= 2 * bodySize(c3) && lowerWickSize(c3) <= bodySize(c3) * 0.1) {
      if (slope && slope[last] < 0) patterns.bullish.push("Inverted Hammer");
      if (slope && slope[last] > 0) patterns.bearish.push("Shooting Star");
    }

    if (isBearishCandle(c2) && isBullishCandle(c3) && c3.open <= c2.close && c3.close >= c2.open) {
      patterns.bullish.push("Bullish Engulfing");
    }
    if (isBullishCandle(c2) && isBearishCandle(c3) && c3.open >= c2.close && c3.close <= c2.open) {
      patterns.bearish.push("Bearish Engulfing");
    }

    if (isBearishCandle(c1) && bodySize(c2) <= bodySize(c1) * 0.3 && isBullishCandle(c3) && c3.close > (c1.open + c1.close) / 2) {
      patterns.bullish.push("Morning Star");
    }
    if (isBullishCandle(c1) && bodySize(c2) <= bodySize(c1) * 0.3 && isBearishCandle(c3) && c3.close < (c1.open + c1.close) / 2) {
      patterns.bearish.push("Evening Star");
    }

    if (isBearishCandle(c2) && isBullishCandle(c3) && c3.open < c2.low && c3.close > (c2.open + c2.close) / 2) {
      patterns.bullish.push("Piercing Line");
    }
    if (isBullishCandle(c2) && isBearishCandle(c3) && c3.open > c2.high && c3.close < (c2.open + c2.close) / 2) {
      patterns.bearish.push("Dark Cloud Cover");
    }

    if (isBullishCandle(c1) && isBullishCandle(c2) && isBullishCandle(c3) && c2.close > c1.close && c3.close > c2.close) {
      patterns.bullish.push("Three White Soldiers");
    }
    if (isBearishCandle(c1) && isBearishCandle(c2) && isBearishCandle(c3) && c2.close < c1.close && c3.close < c2.close) {
      patterns.bearish.push("Three Black Crows");
    }

    if (isBullishCandle(c3) && upperWickSize(c3) <= bodySize(c3) * 0.05 && lowerWickSize(c3) <= bodySize(c3) * 0.05) {
      patterns.bullish.push("Marubozu");
    }
    if (isBearishCandle(c3) && upperWickSize(c3) <= bodySize(c3) * 0.05 && lowerWickSize(c3) <= bodySize(c3) * 0.05) {
      patterns.bearish.push("Marubozu");
    }

    // Inside/Outside bars
    if (c3.high < c2.high && c3.low > c2.low) {
      patterns.bullish.push("Inside Bar");
      patterns.bearish.push("Inside Bar");
    }
    if (c3.high > c2.high && c3.low < c2.low) {
      patterns.bullish.push("Outside Bar");
      patterns.bearish.push("Outside Bar");
    }

    // Shaven heads/bottoms
    if (upperWickSize(c3) === 0) patterns.bearish.push("Shaven Head");
    if (lowerWickSize(c3) === 0) patterns.bullish.push("Shaven Bottom");

    // --- INDICATOR & SYSTEM TECHNIQUES ---
    // RSI
    if (rsiVals[last] > 70) patterns.bearish.push("RSI Overbought", "Overbought");
    if (rsiVals[last] < 30) patterns.bullish.push("RSI Oversold", "Oversold");
    if (rsiVals[last] > rsiVals[last-1]) patterns.bullish.push("RSI Rising");
    if (rsiVals[last] < rsiVals[last-1]) patterns.bearish.push("RSI Falling");

    // MACD
    if (macdVals.macd[last] > macdVals.signal[last] && macdVals.macd[last-1] <= macdVals.signal[last-1]) patterns.bullish.push("MACD Bullish Cross", "MACD Cross Up");
    if (macdVals.macd[last] < macdVals.signal[last] && macdVals.macd[last-1] >= macdVals.signal[last-1]) patterns.bearish.push("MACD Bearish Cross", "MACD Cross Down");
    if (macdVals.hist[last] > macdVals.hist[last-1]) patterns.bullish.push("MACD Histogram Rising");
    if (macdVals.hist[last] < macdVals.hist[last-1]) patterns.bearish.push("MACD Histogram Falling");

    // Stochastic
    if (stochVals.k[last] > stochVals.d[last]) patterns.bullish.push("Stochastic Bullish", "Stochastic K over D");
    if (stochVals.k[last] < stochVals.d[last]) patterns.bearish.push("Stochastic Bearish", "Stochastic D over K");
    if (stochVals.k[last] > 80) patterns.bearish.push("Stochastic Overbought");
    if (stochVals.k[last] < 20) patterns.bullish.push("Stochastic Oversold");

    // Bollinger Bands
    if (c3.close >= bollVals.upper[last]) patterns.bearish.push("Bollinger Upper Band Touch", "Bollinger Band Overbought");
    if (c3.close <= bollVals.lower[last]) patterns.bullish.push("Bollinger Lower Band Touch", "Bollinger Band Oversold");
    if (c3.close > bollVals.middle[last]) patterns.bullish.push("Above Bollinger Middle");
    if (c3.close < bollVals.middle[last]) patterns.bearish.push("Below Bollinger Middle");

    // Moving Averages / Slope
    if (slope[last] > 0) patterns.bullish.push("Positive Moving Average", "Trend Following", "Uptrend");
    if (slope[last] < 0) patterns.bearish.push("Negative Moving Average", "Trend Following", "Downtrend");

    // Volume / Action
    if (isHH) patterns.bullish.push("Higher Highs", "Momentum Breakout");
    if (isLL) patterns.bearish.push("Lower Lows", "Momentum Breakdown");

    // Match techniques with requested list
    const techniquesStr = techniquesList.map(t => typeof t === "string" ? t : (t.name || "")).join(" ").toLowerCase();

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

    if (matchedTechniques.length < 10) {
      return {
        cases: defaultCases, skepticMultiplier: 1, winner: 'NO_TRADE', margin: 0, finalConfidence: 0,
        ruling: `Insufficient matching techniques (found ${matchedTechniques.length}, need 10)`,
        signal: 'NO_TRADE', confidence: 0, bullScore: 0, bearScore: 0,
        skepticPenalty: 0, boundaryBias: 0, finalScore: 0, evidence: {},
        techniquesUsed: matchedTechniques.join(", "), techUsedCount: matchedTechniques.length
      };
    }
  }

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

  const rawWinningTotal = winner === 'BULL' ? cases.bull.total : (winner === 'BEAR' ? cases.bear.total : 0);
  
  // Only neutral if points are tied or practically tied, as requested by strict point system
  if (margin < 0.5) winner = 'NO_TRADE';
  
  const finalConfidence = Math.round((rawWinningTotal * skepticMultiplier / 11) * 100);

  const ruling = winner === 'NO_TRADE' ? 'Points are tied.' : `Clear ${winner} edge.`;

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
    },
    techniquesUsed: matchedTechniques.join(", "),
    techUsedCount: matchedTechniques.length
  };
}
