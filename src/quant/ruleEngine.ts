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

export interface DecisionResult {
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
  const defaultNoTrade: DecisionResult = {
    signal: 'NO_TRADE', confidence: 0, bullScore: 0, bearScore: 0,
    skepticPenalty: 0, boundaryBias: 0, finalScore: 0, evidence: {}
  };
  if (ohlcSeries.length < 30) return defaultNoTrade;

  const closes = ohlcSeries.map(c => c.close);
  const highs = ohlcSeries.map(c => c.high);
  const lows = ohlcSeries.map(c => c.low);

  // Pre-filter: Predictability
  const predResult = calculatePredictability(closes.slice(-30));
  if (!predResult.isPredictable) {
    return { ...defaultNoTrade, signal: 'NO_TRADE', confidence: 0 };
  }

  const rsiVals = rsi(closes, 14);
  const macdVals = macd(closes, 12, 26, 9);
  const bollVals = bollinger(closes, 20, 2);
  const atrVals = atr(ohlcSeries, 14);
  const stochVals = stochastic(ohlcSeries, 14, 3);
  
  const slope = emaSlope(closes, 21);
  const curve = emaCurvature(closes, 21);

  const last = closes.length - 1;
  const prev = closes.length - 2;

  let bullScore = 0;
  let bearScore = 0;

  const useFullScoring = ohlcQuality === 'REAL_PRICE';

  // 1. Slope & Curve
  if (!isNaN(slope[last]) && slope[last] > 0) bullScore += 20;
  if (!isNaN(slope[last]) && slope[last] < 0) bearScore += 20;
  if (!isNaN(curve[last]) && !isNaN(slope[last]) && curve[last] > 0 && slope[last] > 0) bullScore += 10;
  if (!isNaN(curve[last]) && !isNaN(slope[last]) && curve[last] < 0 && slope[last] < 0) bearScore += 10;

  // 2. Continuous RSI Gradient Scoring
  const rsiValue = rsiVals[last];
  const rsiMomentum = rsiVals[last] - rsiVals[prev];
  if (!isNaN(rsiValue) && !isNaN(rsiMomentum)) {
    if (rsiValue >= 45 && rsiValue <= 75) {
      const rsiCentered = (rsiValue - 60) / 15;
      const rsiShape = 1 - Math.abs(rsiCentered);
      const rsiMomentumBonus = Math.tanh(rsiMomentum * 5);
      bullScore += 15 * Math.max(0, rsiShape) * (0.7 + 0.3 * rsiMomentumBonus);
    }
    if (rsiValue >= 25 && rsiValue <= 55) {
      const rsiCentered = (rsiValue - 40) / 15;
      const rsiShape = 1 - Math.abs(rsiCentered);
      const rsiMomentumBonus = Math.tanh(-rsiMomentum * 5);
      bearScore += 15 * Math.max(0, rsiShape) * (0.7 + 0.3 * rsiMomentumBonus);
    }
  }

  // 3. Continuous MACD Scoring
  if (useFullScoring && !isNaN(macdVals.hist[last]) && !isNaN(macdVals.hist[prev])) {
    const hist = macdVals.hist[last] / closes[last]; // Normalize to percentage
    const histMom = (macdVals.hist[last] - macdVals.hist[prev]) / closes[last];
    if (hist > 0) {
      const shape = Math.max(0, Math.tanh(hist * 1000));
      const momBonus = Math.max(0, Math.tanh(histMom * 1000));
      bullScore += 20 * shape * (0.7 + 0.3 * momBonus);
    } else if (hist < 0) {
      const shape = Math.max(0, Math.tanh(-hist * 1000));
      const momBonus = Math.max(0, Math.tanh(-histMom * 1000));
      bearScore += 20 * shape * (0.7 + 0.3 * momBonus);
    }
  }

  // 4. Continuous Bollinger Scoring
  if (useFullScoring && !isNaN(bollVals.middle[last]) && bollVals.upper[last] > bollVals.lower[last]) {
    const bandWidth = bollVals.upper[last] - bollVals.lower[last];
    const pos = (closes[last] - bollVals.lower[last]) / bandWidth; // 0 (lower) to 1 (upper)
    if (pos > 0.5) {
      bullScore += 15 * Math.min(1, Math.max(0, (pos - 0.5) * 2));
    } else {
      bearScore += 15 * Math.min(1, Math.max(0, (0.5 - pos) * 2));
    }
  }

  // Stoch
  if (!isNaN(stochVals.k[last]) && !isNaN(stochVals.d[last]) && stochVals.k[last] > stochVals.d[last] && stochVals.k[last] < 80) bullScore += 10;
  if (!isNaN(stochVals.k[last]) && !isNaN(stochVals.d[last]) && stochVals.k[last] < stochVals.d[last] && stochVals.k[last] > 20) bearScore += 10;

  // IMPROVEMENT 4: Price Axis Anchors for Support/Resistance
  if (useFullScoring && priceAxis && priceAxis.anchors.length >= 2) {
    const currentClose = closes[last];
    const anchorPrices = priceAxis.anchors.map(a => a.price);
    
    const above = anchorPrices.filter(p => p > currentClose).sort((a,b) => a-b)[0];
    const below = anchorPrices.filter(p => p < currentClose).sort((a,b) => b-a)[0];
    
    if (above && below && above !== below) {
      const range = above - below;
      const posInRange = (currentClose - below) / range;
      
      // Close to support -> bullish
      if (posInRange < 0.2) bullScore += 10;
      // Close to resistance -> bearish
      if (posInRange > 0.8) bearScore += 10;
    }
  }

  // Calculate CEF (liquidity map)
  if (useFullScoring) {
    const recentHighs = ohlcSeries.slice(-15).map(c => c.high);
    const recentLows = ohlcSeries.slice(-15).map(c => c.low);
    const liquidityMap: Record<number, number> = {};
    [...recentHighs, ...recentLows].forEach(level => {
      const rounded = Math.round(level * 100) / 100;
      liquidityMap[rounded] = (liquidityMap[rounded] || 0) + 1;
    });
    const cef = calculateCEF(closes.slice(-20), liquidityMap);
    if (cef.predictedDirection === 'UP' && cef.confidence > 0.15) bullScore += 15;
    else if (cef.predictedDirection === 'DOWN' && cef.confidence > 0.15) bearScore += 15;
  }

  // Skeptic Penalty
  const candlesForMathEngine = ohlcSeries.map((c, i) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    prevClose: i > 0 ? ohlcSeries[i-1].close : c.open
  }));

  const vol = calculateVolatilityRegime(candlesForMathEngine.slice(-20)); // requires 20
  const zScoreData = calculateZScoreSignificance(candlesForMathEngine.slice(-21)); // takes historic (+1 current)

  let skepticPenalty = 0;
  if (useFullScoring) {
    if (vol.status === 'EXPLOSIVE_SKIP') skepticPenalty += 30;
    if (Math.abs(zScoreData.zScore) > 2.5) skepticPenalty += 25;

    const atrAvgSlice = atrVals.slice(-20).filter(v => !isNaN(v));
    const atrMean = atrAvgSlice.length > 0 ? atrAvgSlice.reduce((a, b) => a + b, 0) / atrAvgSlice.length : 0;
    if (!isNaN(atrVals[last]) && atrMean > 0 && atrVals[last] > 2 * atrMean) skepticPenalty += 15;
  }

  const rqa = calculateRQA(closes.slice(-20));
  if (rqa.laminarity < 0.1 && rqa.determinism < 0.15) {
    skepticPenalty += 20; // Market has no memory, chaotic
  }

  // Boundary Bias
  let yPercent = 50;
  const maxH = Math.max(...highs);
  const minL = Math.min(...lows);
  if (maxH !== minL) {
    yPercent = ((closes[last] - minL) / (maxH - minL)) * 100;
  }
  const boundary = calculateBoundaryReversal(yPercent, candlesForMathEngine);
  const rawBias = boundary.bullPoints - boundary.bearPoints; // -3.0 to +3.0
  const boundaryBias = rawBias * 10; // Scale to -30 to +30 range, preserving gradient

  const finalScore = bullScore - bearScore - skepticPenalty + boundaryBias;

  let signal: 'CALL' | 'PUT' | 'NO_TRADE' = 'NO_TRADE';
  const signalThreshold = useFullScoring ? 50 : 20;

  if (finalScore >= signalThreshold) signal = 'CALL';
  else if (finalScore <= -signalThreshold) signal = 'PUT';

  const rawConfidence = Math.min(Math.max(Math.abs(finalScore), 0), 100);

  // Apply Robustness
  const robustnessResult = calculateRobustness(closes.slice(-20));
  if (!robustnessResult.isStable) {
    return { ...defaultNoTrade, signal: 'NO_TRADE', confidence: 0 };
  }
  const confidence = Math.min(rawConfidence * robustnessResult.robustness, 100);

  return {
    signal,
    confidence,
    bullScore,
    bearScore,
    skepticPenalty,
    boundaryBias,
    finalScore,
    evidence: {
      rsi: rsiVals[last],
      macd: macdVals.macd[last],
      macdHist: macdVals.hist[last],
      bollMiddle: bollVals.middle[last],
      lastClose: closes[last]
    }
  };
}
