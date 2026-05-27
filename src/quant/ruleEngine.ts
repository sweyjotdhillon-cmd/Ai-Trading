import { HorizonContext } from './horizon';
import { evaluateShard } from './techniqueShardEngine';

/**
 * CHANGELOG
 * Restructured judge system to follow deterministic point-based logic.
 * Enforces Case 1 (Bull) vs Case 2 (Bear) with a strict scoring rubric.
 * Added cases, skepticMultiplier, winner, margin, finalConfidence, and ruling to output.
 * Preserved legacy keys (signal, confidence, bullScore, bearScore, etc.) for backward compatibility.
 */
import { rsi, macd, bollinger, atr, stochastic } from './indicators';
import { calculateZScore, calculateEMADerivatives, calculateMicroMomentumScore, calculateVolatilityRegime, detectRSIDivergence, calculateZScoreSignificance, calculateRQA } from './mathEngine';
import { emaSlope, emaCurvature } from './calculus';




import { NumericOHLC } from '../vision/pipeline';
import { rescaledRangeHurst, PATTERN_WEIGHTS_BY_HORIZON } from './horizon';
import { featureFlags } from '../config/featureFlags';
import { patternWeights } from '../config/patternWeights';
import { gapWeights } from '../config/gapWeights';


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
  hallucinationDetected?: boolean;
  hallucinationMetrics?: {
    physicsViolations: number;
    outOfBoundsCount: number;
    sensorAnomalies: number;
    integrityVerified: boolean;
  };
}

export interface DecisionResult extends JudgeVerdict {
  agent: 'JUDGE';
  signal: 'CALL' | 'PUT' | 'NO_TRADE';
  decision: 'STRONG SIGNAL' | 'WEAK';
  skepticVerdict: 'ACCEPT' | 'CAUTION' | 'WEAK';
  primaryEvidence: string;
  noTradeReason: string | null;
  topPatterns: { bull: string[]; bear: string[] };
  formattedReport: string;
  tradeDetails: {
    latencyAdjustedForecast: string;
    techniquesUsed: string;
    executionTimeMs: number;
  };
  j1Score: number;
  j2Score: number;
  j3Score: number;
  j4Score: number;

  // Legacy fields
  confidence: number;
  bullScore: number;
  bearScore: number;
  skepticPenalty: number;
  boundaryBias: number;
  finalScore: number;
  evidence: any;
  techniquesUsed?: string;
  techUsedCount?: number;
  repoPatternsDetected?: string;
  techniquesEvaluation?: any;
  repoPatternCount?: number;
}

export function evaluateSignal(
  ohlcSeries: NumericOHLC[],
  techniquesList: any[],
  horizonCtx: HorizonContext,
  _confirmedPatterns: any[] = [],
  _confirmedGaps: any[] = [],
  onLog?: (key: string, text: string) => void

): DecisionResult {
  const defaultCases = { bull: { j1: 0, j2: 0, j3: 0, total: 0 }, bear: { j1: 0, j2: 0, j3: 0, total: 0 } };
  const defaultNoTrade: DecisionResult = {
    agent: 'JUDGE',
    cases: defaultCases,
    skepticMultiplier: 0,
    winner: 'NO_TRADE',
    margin: 0,
    finalConfidence: 0,
    ruling: 'NO_TRADE — Not enough data to extract a reliable signal.',
    signal: 'NO_TRADE',
    decision: 'WEAK',
    skepticVerdict: 'WEAK',
    primaryEvidence: 'Insufficient data points',
    noTradeReason: 'Winning total of 0.0 is below minimum strength threshold of 4.0/11. Evidence too weak to trade.',
    topPatterns: { bull: [], bear: [] },
    formattedReport: '┌─────────────────────────────────────┐\n│  ARBITRATOR FINAL VERDICT           │\n│  Signal: NO_TRADE                   │\n│  Confidence: 0%                     │\n├─────────────────────────────────────┤\n│  CASE 1 — BULL                      │\n│  J1 Momentum:  0.0 / 4.0           │\n│  J2 Oscillator:0.0 / 4.0           │\n│  J3 Boundary:  0.0 / 3.0           │\n│  Total:        0.0 / 11.0          │\n├─────────────────────────────────────┤\n│  CASE 2 — BEAR                      │\n│  J1 Momentum:  0.0 / 4.0           │\n│  J2 Oscillator:0.0 / 4.0           │\n│  J3 Boundary:  0.0 / 3.0           │\n│  Total:        0.0 / 11.0          │\n├─────────────────────────────────────┤\n│  SKEPTIC VETO:  0.00 (WEAK)        │\n│  Margin:        0.0                 │\n│  Final Score:   0.0                 │\n├─────────────────────────────────────┤\n│  RULING:                            │\n│  NO_TRADE — Not enough data to     │\n│  extract a reliable signal.         │\n└─────────────────────────────────────┘',
    tradeDetails: {
      latencyAdjustedForecast: 'Signal: NO_TRADE',
      techniquesUsed: '',
      executionTimeMs: 0
    },
    j1Score: 0,
    j2Score: 0,
    j3Score: 0,
    j4Score: 100,

    // Legacy fields
    confidence: 0,
    bullScore: 0,
    bearScore: 0,
    skepticPenalty: 0,
    boundaryBias: 0,
    finalScore: 0,
    evidence: {}
  };

  // --- Pad series if it has at least 5 candles but fewer than 30 ---
  let paddedSeries = [...ohlcSeries];
  if (paddedSeries.length >= 5 && paddedSeries.length < 30) {
    const padCount = 30 - paddedSeries.length;
    const firstCandle = paddedSeries[0];
    const pad = Array(padCount).fill(null).map((_, i) => ({
      ...firstCandle,
      xCenter: firstCandle.xCenter - (padCount - i) * 10
    }));
    paddedSeries = [...pad, ...paddedSeries];
  }
  ohlcSeries = paddedSeries;

  if (ohlcSeries.length < 30) return defaultNoTrade;

  // --- Apply Heikin Ashi Smoothing to reduce Open/Close confusion ---
  // A "Japanese candlestick moving average" (Heikin Ashi) makes trends clearer
  const haSeries = new Array(ohlcSeries.length);
  haSeries[0] = {
    ...ohlcSeries[0],
    open: ohlcSeries[0].open,
    close: (ohlcSeries[0].open + ohlcSeries[0].high + ohlcSeries[0].low + ohlcSeries[0].close) / 4,
  };
  
  for (let i = 1; i < ohlcSeries.length; i++) {
    const prevHA = haSeries[i - 1];
    const curr = ohlcSeries[i];
    
    const haOpen = (prevHA.open + prevHA.close) / 2;
    const haClose = (curr.open + curr.high + curr.low + curr.close) / 4;
    const haHigh = Math.max(curr.high, haOpen, haClose);
    const haLow = Math.min(curr.low, haOpen, haClose);
    
    haSeries[i] = {
      ...curr,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
    };
  }
  ohlcSeries = haSeries;

  let isBypass = false;
  const activeList: any[] = [...(techniquesList || [])];
  if (activeList.length > 0) {
    isBypass = activeList.some(t => {
      const name = typeof t === 'string' ? t : t.name;
      return name === '__TEST_BYPASS__';
    });
  }

  // Pre-defined techniques backup list REMOVED entirely per strict rule.

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



  // Computations for external techniques if needed
  // ... predefined technique points calculations REMOVED ...
  
  // --- Dynamic Batches Point System (Evaluate all configured active techniques) ---
  const techCache: any = {};
  
  // Shard into batches of 5
  const shardSize = 5;
  const shards: any[][] = [];
  for (let i = 0; i < activeList.length; i += shardSize) {
    shards.push(activeList.slice(i, i + shardSize));
  }
  
  const evaluationVotes: any[] = [];
  
  // Evaluate ALL shards to ensure continuous non-hallucinated verification matrix mapping
  for (let i = 0; i < shards.length; i++) {
    const shard = shards[i];
    const shardVotes = evaluateShard(shard, ohlcSeries, i * shardSize, techCache);
    evaluationVotes.push(...shardVotes);
  }

  // Programmatic Integrity & Hallucination checks
  let physicsViolations = 0;
  let outOfBoundsCount = 0;
  let sensorAnomalies = 0;

  ohlcSeries.forEach((c) => {
    if (c.high < c.low) physicsViolations++;
    if (c.open > c.high || c.open < c.low) physicsViolations++;
    if (c.close > c.high || c.close < c.low) physicsViolations++;
    if (c.open <= 0 || c.close <= 0 || c.high <= 0 || c.low <= 0) {
      outOfBoundsCount++;
    }
  });

  if (techCache.rsiVals) {
    techCache.rsiVals.forEach((val: number) => {
      if (val < 0 || val > 100 || isNaN(val)) sensorAnomalies++;
    });
  }
  if (techCache.stochVals && techCache.stochVals.k) {
    techCache.stochVals.k.forEach((val: number) => {
      if (val < 0 || val > 100 || isNaN(val)) sensorAnomalies++;
    });
  }

  const hallucinationDetected = (physicsViolations + outOfBoundsCount + sensorAnomalies) > 0;
  const hallucinationMetrics = {
    physicsViolations,
    outOfBoundsCount,
    sensorAnomalies,
    integrityVerified: !hallucinationDetected
  };

  let bulldogPoints = 0;
  let peerPoints = 0;
  let bullList: any[] = [];
  let bearList: any[] = [];

  evaluationVotes.forEach(v => {
      const isBull = v.vote === 'BULL';
      const isBear = v.vote === 'BEAR';
      const pointsEarned = v.score || 0; 
      const matched = isBull || isBear;

      const obj = {
        id: v.id,
        name: v.name,
        vote: v.vote,
        caseIndicated: isBull ? 'Bulldog' : (isBear ? 'Peer' : 'Neutral'),
        pointsEarned: matched ? pointsEarned : 0,
        process: v.reason || 'Criteria non-active on current candle',
        matched
      };

      if (isBull) { bulldogPoints += pointsEarned; }
      if (isBear) { peerPoints += pointsEarned; }

      // Sort into the requested lists so users see every technique evaluated
      if (isBull) {
        bullList.push(obj);
      } else if (isBear) {
        bearList.push(obj);
      } else {
        // If neutral, distribute it to bullList so it is listed (users want all listed, even 0 points)
        bullList.push(obj);
      }
  });

  const techniquesEvaluation = {
    totalTechniques: bullList.length + bearList.length,
    bulldogPoints,
    peerPoints,
    bullList,
    bearList
  };

  // All Judge checks and pattern processing removed.
  // We only rely on evaluationVotes from user techniques.
  const totalEnginePoints = bulldogPoints + peerPoints;
  if (totalEnginePoints > 0) {
    bullJ1 = (bulldogPoints / totalEnginePoints) * 6.0;
    bearJ1 = (peerPoints / totalEnginePoints) * 6.0;
  }
  
  if (totalEnginePoints === 0) {
    bullJ1 = 0; bearJ1 = 0;
  }

  // Set rest to 0 to respect removal of heuristics
  bullJ2 = 0; bearJ2 = 0;
  bullJ3 = 0; bearJ3 = 0;

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





  const slopeSeries = emaSlope(Array.from(closes), 9);
  const slopeStrength = slopeSeries.length > 0 ? Math.abs(slopeSeries[slopeSeries.length - 1]) : 0;

  // R6: Slope strength gate
  if (slopeStrength < 0.15) {
     skepticMultiplier *= 0.7; // Reduce confidence
  }

  skepticMultiplier = Math.max(0, Math.min(1, skepticMultiplier));

  // --- Decision Logic ---

  // 2.1 Confirm Raw Totals
  const bullTotal = Number(Math.min(11.0, cases.bull.total).toFixed(2));
  const bearTotal = Number(Math.min(11.0, cases.bear.total).toFixed(2));

  // 2.2 Identify Raw Winner
  let rawWinner: 'BULL' | 'BEAR' | 'TIE' = 'TIE';
  if (bullTotal > bearTotal) rawWinner = 'BULL';
  else if (bearTotal > bullTotal) rawWinner = 'BEAR';

  // 2.3 Calculate Margin
  const margin = Number(Math.abs(bullTotal - bearTotal).toFixed(2));

  // 2.4 Raw Winning Total
  let rawWinningTotal = 0;
  if (rawWinner === 'BULL') rawWinningTotal = bullTotal;
  else if (rawWinner === 'BEAR') rawWinningTotal = bearTotal;

  // Clamp skeptic multiplier 0.30 - 1.00
  skepticMultiplier = Math.max(0.30, Math.min(1.00, skepticMultiplier));

  // Determine Skeptic Verdict
  let skepticVerdict: 'ACCEPT' | 'CAUTION' | 'WEAK' = 'ACCEPT';
  if (skepticMultiplier < 0.60) skepticVerdict = 'WEAK';
  else if (skepticMultiplier < 0.85) skepticVerdict = 'CAUTION';

  // 2.6 Calculate Final Confidence Percentage
  const finalConfidence = Math.round((rawWinningTotal * skepticMultiplier / 11) * 100);

  // --- Step 3: Apply NO_TRADE Rules ---
  let finalSignal: 'CALL' | 'PUT' | 'NO_TRADE' = rawWinner === 'BULL' ? 'CALL' : (rawWinner === 'BEAR' ? 'PUT' : 'NO_TRADE');
  let noTradeReason: string | null = null;

  if (hardBlockReason) {
    finalSignal = 'NO_TRADE';
    noTradeReason = `BLOCKED: ${hardBlockReason}`;
  } else if (rawWinner === 'TIE') {
    finalSignal = 'NO_TRADE';
    noTradeReason = "Bull and Bear scored identically. No directional edge.";
  } else if (margin < 3.0) {
    finalSignal = 'NO_TRADE';
    noTradeReason = `Margin of ${margin.toFixed(1)} is below minimum threshold of 3.0. Scores of Bulldog and Peer are too close to extract a reliable signal (minimum difference of 3 required).`;
  } else if (rawWinningTotal < 4.0) {
    finalSignal = 'NO_TRADE';
    noTradeReason = `Winning total of ${rawWinningTotal.toFixed(1)} is below minimum strength threshold of 4.0/11. Evidence too weak to trade.`;
  } else if (skepticVerdict === 'WEAK' && margin < 4.0) {
    finalSignal = 'NO_TRADE';
    noTradeReason = "Skeptic issued WEAK verdict with insufficient margin. Combined risk too high (minimum margin 4.0 required under WEAK skeptic verdict).";
  } else if (finalConfidence < 25) {
    finalSignal = 'NO_TRADE';
    noTradeReason = `Final confidence of ${finalConfidence}% falls below minimum actionable threshold of 25%.`;
  }

  // --- Step 4: Calculate Final Score ---
  let finalScore = 0;
  if (finalSignal === 'CALL') finalScore = bullTotal * skepticMultiplier;
  else if (finalSignal === 'PUT') finalScore = -(bearTotal * skepticMultiplier);

  // --- Step 5: Determine Decision Label ---
  const decisionLabel: 'STRONG SIGNAL' | 'WEAK' = (finalSignal === 'CALL' || finalSignal === 'PUT') ? 'STRONG SIGNAL' : 'WEAK';

  // --- Step 6: Write the Ruling ---
  const primaryEvidence = rawWinner === 'BULL'
    ? 'Bullish momentum'
    : 'Bearish momentum';

  let ruling = '';
  if (finalSignal === 'NO_TRADE') {
    ruling = `NO_TRADE — ${noTradeReason} A clearer trend or pattern confirmation would unlock a signal.`;
  } else {
    const skepticNote = skepticMultiplier < 0.75 ? ` Skeptic noted risks; multiplied by ${skepticMultiplier.toFixed(2)}.` : '';
    ruling = `${finalSignal} — ${primaryEvidence}. Margin ${margin.toFixed(1)}, Confidence ${finalConfidence}%.${skepticNote}`;
  }

  // --- Step 7: Formatted Report ---
  const wrapText = (text: string, width: number): string[] => {
    if (text.length <= width) return [text.padEnd(width)];
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
      if ((currentLine + word).length > width) {
        lines.push(currentLine.trim().padEnd(width));
        currentLine = word + ' ';
      } else {
        currentLine += word + ' ';
      }
    }
    if (currentLine) lines.push(currentLine.trim().padEnd(width));
    return lines;
  };

  const rulingLines = wrapText(ruling, 33);
  const rulingStr = rulingLines.map(line => `│  ${line}  │`).join('\n');

  const formattedReport =
`┌─────────────────────────────────────┐
│  ARBITRATOR FINAL VERDICT           │
│  Signal: ${finalSignal.padEnd(21)}│
│  Confidence: ${finalConfidence.toString().padEnd(3)}%                 │
├─────────────────────────────────────┤
│  CASE 1 — BULL                      │
│  J1 Momentum:  ${cases.bull.j1.toFixed(1).padEnd(5)}/ 6.0         │
│  J2 Oscillator:${cases.bull.j2.toFixed(1).padEnd(5)}/ 2.0         │
│  J3 Boundary:  ${cases.bull.j3.toFixed(1).padEnd(5)}/ 3.0         │
│  Total:        ${cases.bull.total.toFixed(1).padEnd(5)}/ 11.0        │
├─────────────────────────────────────┤
│  CASE 2 — BEAR                      │
│  J1 Momentum:  ${cases.bear.j1.toFixed(1).padEnd(5)}/ 6.0         │
│  J2 Oscillator:${cases.bear.j2.toFixed(1).padEnd(5)}/ 2.0         │
│  J3 Boundary:  ${cases.bear.j3.toFixed(1).padEnd(5)}/ 3.0         │
│  Total:        ${cases.bear.total.toFixed(1).padEnd(5)}/ 11.0        │
├─────────────────────────────────────┤
│  SKEPTIC VETO:  ${skepticMultiplier.toFixed(2)} (${skepticVerdict.padEnd(7)}) │
│  Margin:        ${margin.toFixed(1).padEnd(19)} │
│  Final Score:   ${finalScore.toFixed(1).padEnd(19)} │
├─────────────────────────────────────┤
│  RULING:                            │
${rulingStr}
└─────────────────────────────────────┘`;

  const techniquesUsed = activeList.map(t => typeof t === 'string' ? t : (t.name || 'Custom')).join(', ');
  const skepticPenalty = (1 - skepticMultiplier) * 100;

  return {
    agent: 'JUDGE',
    signal: finalSignal,
    decision: decisionLabel,
    cases,
    winner: rawWinner === 'TIE' ? 'NO_TRADE' : rawWinner,
    margin,
    skepticMultiplier,
    skepticPenalty,
    skepticVerdict,
    finalConfidence,
    finalScore,
    ruling,
    primaryEvidence,
    noTradeReason,
    topPatterns: {
      bull: [],
      bear: []
    },
    techniquesUsed: "Execution Driven Only",
    techUsedCount: activeList.length,
    formattedReport,
    hallucinationDetected,
    hallucinationMetrics,
    tradeDetails: {
      latencyAdjustedForecast: `Signal: ${finalSignal}`,
      techniquesUsed,
      executionTimeMs: 0
    },
    j1Score: cases.bull.j1 + cases.bear.j1,
    j2Score: cases.bull.j2 + cases.bear.j2,
    j3Score: cases.bull.j3 + cases.bear.j3,
    j4Score: skepticPenalty,
    techniquesEvaluation,

    // Legacy fields
    confidence: finalConfidence,
    bullScore: cases.bull.total,
    bearScore: cases.bear.total,
    boundaryBias: 0,

    
    evidence: {
      rsi: rsiVals[last],
      macd: macdVals.macd[last],
      macdHist: macdVals.hist[last],
      bollMiddle: bollVals.middle[last],
      bollLower: bollVals.lower[last],
      bollUpper: bollVals.upper[last],
      localSupport: Math.min(...Array.from(lows.slice(-15))),
      localResistance: Math.max(...Array.from(highs.slice(-15))),
      lastClose: closes[last]
    }
  };
}
