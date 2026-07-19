import { HorizonContext } from './horizon';
import { extractChartJSON } from './dataExtractor';
import { ChartAnalysisWindow, evaluateTechniques } from './techniqueEngine';
import { evaluateShard } from './techniqueShardEngine';
import { enforceNeutrality, recordDecision } from './neutralityGuard';
import { rsi, macd, bollinger, atr, stochastic, adx } from './indicators';
import { calculateZScore, calculateEMADerivatives, calculateMicroMomentumScore, calculateVolatilityRegime, detectRSIDivergence, calculateZScoreSignificance, calculateRQA, calculateBoundaryReversal, detectMACDDivergence } from './mathEngine';
import { detectStructureSignal, detectDoubleTopBottom, findSwingPivots, getTrendState } from './marketStructure';
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
  auditTrail?: any;
}

export interface DecisionResult extends JudgeVerdict {
  agent: 'JUDGE';
  signal: 'LONG' | 'NO_TRADE';
  decision: 'STRONG SIGNAL' | 'WEAK';
  skepticVerdict: 'ACCEPT' | 'CAUTION' | 'WEAK';
  primaryEvidence: string;
  noTradeReason: string | null;
  confidenceRange: number;
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
  bullJ1: number;   // cases.bull.j1 alone (0-4.0) — the actual score driving this specific trade
  bullJ2: number;   // cases.bull.j2 alone (0-4.0)
  bullJ3: number;   // cases.bull.j3 alone (0-4.0), clamped
  bullJ3Raw: number; // bullJ3 BEFORE the Math.min(4.0, ...) clamp — diagnostic only, to see true distribution
  bullTotal: number; // cases.bull.total (0-12.0)
  j4Score: number;       // DEPRECATED — kept for legacy callers only, equals j4PenaltyPct
  j4PenaltyPct: number;  // Skeptic penalty as a percentage (0–100). NOT a judge score. "Skeptic stripped X% confidence."

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
  noTechniquesUploaded?: boolean;
  techniqueVotes?: any[];
  deadTechniques?: string[];
}

export function evaluateSignal(
  ohlcSeries: NumericOHLC[],
  techniquesList: any[],
  horizonArg?: any,
  _confirmedPatterns: any[] = [],
  _confirmedGaps: any[] = [],
  onLog?: (key: string, text: string) => void,
  neutralityConfig?: {
    strictNeutrality?: boolean;
    biasCorrectionStrength?: number;
    noTradePreference?: number;
  }
): DecisionResult {
  const tStart = performance.now();
  const isNoTech = !techniquesList || !Array.isArray(techniquesList) || techniquesList.length === 0;

  const judgeContribs: Array<{
    judge: 'J1'|'J2'|'J3';
    side: 'BULL'|'BEAR';
    contributor: string;
    value: number;
    reason: string;
  }> = [];
  const auditPush = (
    judge: 'J1'|'J2'|'J3',
    side: 'BULL'|'BEAR',
    contributor: string,
    value: number,
    reason: string
  ) => {
    if (value !== 0) judgeContribs.push({ judge, side, contributor, value, reason });
  };

  const defaultCases = { bull: { j1: 0, j2: 0, j3: 0, total: 0 }, bear: { j1: 0, j2: 0, j3: 0, total: 0 } };
  const getEmptyNoTradeResult = (reasonText: string): DecisionResult => {
    return {
      agent: 'JUDGE',
      cases: defaultCases,
      skepticMultiplier: isNoTech ? 1.0 : 0.30,
      winner: 'NO_TRADE',
      margin: 0,
      finalConfidence: 0,
      ruling: `NO_TRADE — ${reasonText}`,
      signal: 'NO_TRADE',
      decision: 'WEAK',
      skepticVerdict: 'WEAK',
      primaryEvidence: 'Insufficient or Invalid Data',
      noTradeReason: reasonText,
      topPatterns: { bull: [], bear: [] },
      formattedReport: `┌─────────────────────────────────────┐\n│  ARBITRATOR FINAL VERDICT           │\n│  Signal: NO_TRADE                   │\n│  Confidence: 0%                     │\n├─────────────────────────────────────┤\n│  CASE 1 — BULL                      │\n│  J1 Reasoning: 0.0 / 4.0           │\n│  J2 Vehicle:   0.0 / 4.0           │\n│  J3 Reversal:  0.0 / 4.0           │\n│  Total:        0.0 / 12.0          │\n├─────────────────────────────────────┤\n│  CASE 2 — BEAR                      │\n│  J1 Reasoning: 0.0 / 4.0           │\n│  J2 Vehicle:   0.0 / 4.0           │\n│  J3 Reversal:  0.0 / 4.0           │\n│  Total:        0.0 / 12.0          │\n├─────────────────────────────────────┤\n│  SKEPTIC VETO:  0.30 (WEAK)        │\n│  Margin:        0.0                 │\n│  Final Score:   0.0                 │\n├─────────────────────────────────────┤\n│  RULING:                            │\n│  NO_TRADE — ${reasonText.substring(0, 20)}...   │\n└─────────────────────────────────────┘`,
      tradeDetails: {
        latencyAdjustedForecast: 'Signal: NO_TRADE',
        techniquesUsed: '',
        executionTimeMs: Number((performance.now() - tStart).toFixed(2))
      },
      j1Score: 0,
      j2Score: 0,
      j3Score: 0,
      bullJ1: 0,
      bullJ2: 0,
      bullJ3: 0,
      bullJ3Raw: 0,
      bullTotal: 0,
      j4Score: isNoTech ? 0 : 70,
      j4PenaltyPct: isNoTech ? 0 : 70,
      noTechniquesUploaded: isNoTech,

      // Legacy fields
      confidence: 0,
      bullScore: 0,
      bearScore: 0,
      skepticPenalty: isNoTech ? 0 : 70,
      boundaryBias: 0,
      finalScore: 0,
      evidence: {}
    };
  };

  // Gracefully handle horizon Context variants (e.g. Unit tests passing string, null, etc.)
  let horizonCtx: HorizonContext;
  if (horizonArg && typeof horizonArg === 'object' && 'tfMinutes' in horizonArg) {
    horizonCtx = horizonArg as HorizonContext;
  } else {
    const tf = 5;
    const dur = 15;
    const h = dur / tf;
    horizonCtx = {
      tfMinutes: tf,
      durationMinutes: dur,
      H: h,
      horizonClass: h > 1.2 ? 'MULTI_CANDLE' : h >= 0.8 ? 'NEAR_FULL' : 'INTRA_CANDLE'
    };
  }

  // Calculate forecast interval and dynamic live-mode sliding window
  const graphTimeframeMinutes = horizonCtx.tfMinutes || 30;
  const durationMinutes = horizonCtx.durationMinutes || 5;
  const nCandles = Math.max(1, Math.ceil(durationMinutes / graphTimeframeMinutes));
  const nCut = Math.max(20, nCandles * 5);

  if (!ohlcSeries || ohlcSeries.length < 5) {
    return getEmptyNoTradeResult(`Insufficient visibility. Need at least 5 candles (found ${ohlcSeries ? ohlcSeries.length : 0}).`);
  }

  // --- Step 1: Pre-flight Integrity & Physical Violations Checks (Hard Blocks) ---
  let physicsViolations = 0;
  let outOfBoundsCount = 0;
  let sensorAnomalies = 0;

  ohlcSeries.forEach((c) => {
    const eps = Math.max(1e-6, 1e-6 * Math.max(c.high - c.low, 1e-9));
    if (c.high < c.low - eps) physicsViolations++;
    if (c.open > c.high + eps || c.open < c.low - eps) physicsViolations++;
    if (c.close > c.high + eps || c.close < c.low - eps) physicsViolations++;
    if (c.open <= 0 || c.close <= 0 || c.high <= 0 || c.low <= 0) outOfBoundsCount++;
  });

  const totalChecked = ohlcSeries.length;
  const anomaliesRatio = totalChecked > 0 ? (physicsViolations + outOfBoundsCount) / totalChecked : 0;
  const hallucinationDetected = (physicsViolations + outOfBoundsCount + sensorAnomalies) > 0;
  const hallucinationMetrics = {
    physicsViolations,
    outOfBoundsCount,
    sensorAnomalies,
    integrityVerified: anomaliesRatio <= 0.05
  };

  let hardBlockReason: string | null = null;
  if (anomaliesRatio > 0.05) {
    hardBlockReason = `Standard market structure violation. ${((anomaliesRatio) * 100).toFixed(1)}% anomalies exceeded 5% integrity tolerance.`;
  } else {
    const volsCandles = ohlcSeries.map((c, i) => ({
      high: c.high,
      low: c.low,
      close: c.close,
      prevClose: i > 0 ? ohlcSeries[i - 1].close : c.open,
    }));
    const volReg = calculateVolatilityRegime(volsCandles);
    if (volReg.status === 'EXPLOSIVE_SKIP') {
      hardBlockReason = `Volatility anomaly detected: ${volReg.status} (Z-score = ${volReg.zScore.toFixed(2)}).`;
    }
  }

  // --- Standardize activeList to guarantee 10+ techniques rule ---
  let activeList: any[] = [];
  if (techniquesList && Array.isArray(techniquesList) && techniquesList.length > 0) {
    activeList = [...techniquesList];
  }

  const isBypass = activeList.some(t => {
    const name = typeof t === 'object' ? (t.name || t.technique || '') : String(t);
    return name === '__TEST_BYPASS__';
  });

  const isCustomList = techniquesList && Array.isArray(techniquesList) && techniquesList.length > 0;
  if (isBypass) {
    hardBlockReason = null;
  } else if (isCustomList) {
    if (activeList.length === 0) {
      hardBlockReason = `No custom techniques provided. Include at least 1 technique in your upload.`;
    }
  } else if (!isNoTech) {
    if (activeList.length < 10) {
      hardBlockReason = `Insufficient tech consensus. Found ${activeList.length} but need minimum 10 techniques.`;
    }
  }

  // Define Category Classifications for Judges
  function getTechniqueJudgeCategory(name: string, code?: string): 'J1' | 'J2' | 'J3' {
    const k = name.toLowerCase().replace(/[\s_-]/g, '');
    const c = (code || '').toLowerCase().replace(/[\s_-]/g, '');

    // J2 — Oscillators (check first, highest specificity)
    const J2_KEYS = ['rsi','stoch','oscillator','cci','williamsr','momentum',
                     'obv','mfi','cmf','getrsi','getstoch','getmacd','divergence'];
    if (J2_KEYS.some(key => k.includes(key) || c.includes(key))) return 'J2';

    // J3 — Reversal / Pattern / Structure
    const J3_KEYS = ['boll','reversal','hammer','invertedhammer','shootingstar','doji',
      'engulfing','morningstar','eveningstar','piercing','piercingline',
      'tweezer','tweezertop','tweezerbottom','pinbar','abandonedbaby',
      'support','resistance','boundary','wick','shadow','choch',
      'changeofcharacter','bos','breakofstructure','blowoff','climactic',
      'adxpeak','adxdivergence','outsidebar','insidebar','harami'];
    if (J3_KEYS.some(key => k.includes(key))) return 'J3';

    // J1 — Trend / Momentum / Continuation (explicit, not fallback)
    const J1_KEYS = ['ema','macd','adx','trend','momentum','continuation',
      'breakout','pullback','crossover','cross','slope','acceleration',
      'vwap','sma','ichimoku','supertrend','parabolic'];
    if (J1_KEYS.some(key => k.includes(key) || c.includes(key))) return 'J1';

    // True fallback — uncategorised → J1
    return 'J1';
  }

  // --- Shard into groupings & evaluate all active techniques ---
  const techCache: any = {};
  const closes = new Float64Array(ohlcSeries.length);
  const highs = new Float64Array(ohlcSeries.length);
  const lows = new Float64Array(ohlcSeries.length);
  ohlcSeries.forEach((c, i) => {
    closes[i] = c.close;
    highs[i] = c.high;
    lows[i] = c.low;
  });

  techCache.closes = Array.from(closes);
  const tfMins = typeof horizonArg?.tfMinutes === 'number' ? horizonArg.tfMinutes : 5;
  const rsiPeriod = tfMins <= 5 ? 9 : tfMins <= 15 ? 11 : 14;
  const stochPeriod = tfMins <= 5 ? 9 : tfMins <= 15 ? 11 : 14;
  
  techCache.rsiPeriod = rsiPeriod;
  techCache.stochPeriod = stochPeriod;
  
  techCache.rsiVals = rsi(Array.from(closes), rsiPeriod);
  techCache.macdVals = macd(Array.from(closes), 12, 26, 9);
  techCache.bollVals = bollinger(Array.from(closes), 20, 2);
  techCache.stochVals = ohlcSeries.length >= stochPeriod
    ? stochastic(ohlcSeries, stochPeriod, 3)
    : { k: Array(ohlcSeries.length).fill(null), d: Array(ohlcSeries.length).fill(null) };
  techCache.atrVals = atr(ohlcSeries, 14);
  techCache.adxVals = adx(ohlcSeries, 14);

  // Precompute physical swing pivots and trend state
  const pivots = findSwingPivots(highs, lows, 2);
  const trendState = getTrendState(pivots);

  // Precompute visual yPercent
  const prepVisibleSeries = ohlcSeries.slice(-Math.max(20, nCandles * 5));
  const prepLastCloseVal = ohlcSeries[Math.max(0, ohlcSeries.length - 2)].close;
  const prepVisibleCloses = prepVisibleSeries.map(c => c.close);
  const prepMinCloseVal = Math.min(...prepVisibleCloses);
  const prepMaxCloseVal = Math.max(...prepVisibleCloses);
  const currentYPercent = prepMaxCloseVal !== prepMinCloseVal
    ? ((prepLastCloseVal - prepMinCloseVal) / (prepMaxCloseVal - prepMinCloseVal)) * 100
    : 50;

  techCache.context = {
    trendState,
    yPercent: currentYPercent
  };

  // Exclude warmup mathematical anomalies
  if (techCache.rsiVals) {
    techCache.rsiVals.slice(20).forEach((val: number) => {
      if (val < 0 || val > 100 || isNaN(val)) sensorAnomalies++;
    });
  }
  if (techCache.stochVals && techCache.stochVals.k) {
    techCache.stochVals.k.slice(20).forEach((val: number) => {
      if (val < 0 || val > 100 || isNaN(val)) sensorAnomalies++;
    });
  }

  const shardSize = 5;
  const shards: any[][] = [];
  for (let i = 0; i < activeList.length; i += shardSize) {
    shards.push(activeList.slice(i, i + shardSize));
  }

  const evaluationVotes: any[] = [];
  const shardPassVotes: any[] = [];
  const deadTechniques: string[] = [];
  for (let i = 0; i < shards.length; i++) {
    const shard = shards[i];
    const shardResult = evaluateShard(shard, ohlcSeries, i * shardSize, techCache);
    evaluationVotes.push(...shardResult.votes);
    shardPassVotes.push(...shardResult.votes);
    if (shardResult.deadTechniques) {
      deadTechniques.push(...shardResult.deadTechniques);
    }
  }

  // FIX 1: Run contextual analysis pass via techniqueEngine.ts
  const extractedJSON = extractChartJSON(ohlcSeries.map(c => ({
    timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close
  })), `${tfMins}m`, tfMins);
  const chartWindow = extractedJSON as any as ChartAnalysisWindow;
  const tcResult = evaluateTechniques(chartWindow, activeList.filter(t => typeof t === "object"));

  let bullPoints = 0;
  let bearPoints = 0;
  let bullList: any[] = [];
  let bearList: any[] = [];
  let processedCount = 0; // Confidence denominator (non-neutral only)
  let evaluatedCount = 0; // Total diagnostic count

  let techBullJ1 = 0, techBearJ1 = 0;
  let techBullJ2 = 0, techBearJ2 = 0;
  let techBullJ3 = 0, techBearJ3 = 0;

  evaluationVotes.forEach(v => {
    evaluatedCount++;
    const isBull = v.vote === 'BULL';
    const isBear = v.vote === 'BEAR';
    if ((isBull || isBear) && (v.score || 0) > 0) {
      processedCount++;
    }
    const pointsEarned = v.score || 0;
    const isMatched = isBull || isBear;

    const bPts = v.bullPoints ?? (isBull ? pointsEarned : 0);
    const mPts = v.bearPoints ?? (isBear ? pointsEarned : 0);

    const obj = {
      id: v.id,
      name: v.name,
      vote: v.vote,
      caseIndicated: isBull ? 'Bulldog' : (isBear ? 'Peer' : 'Neutral'),
      pointsEarned: isMatched ? (isBull ? bPts : mPts) : 0,
      process: v.reason || 'Criteria non-active',
      matched: isMatched
    };

    if (isBull) { bullPoints += bPts; }
    if (isBear) { bearPoints += mPts; }

    const matchedItem = activeList.find(t => {
      const name = typeof t === 'object' ? (t.name || t.technique || '') : String(t);
      return name === v.name;
    });
    const code = matchedItem && typeof matchedItem === 'object' ? matchedItem.code : '';

    const cat = getTechniqueJudgeCategory(v.name, code);
    if (cat === 'J1') {
      techBullJ1 += bPts;
      techBearJ1 += mPts;
    } else if (cat === 'J2') {
      techBullJ2 += bPts;
      techBearJ2 += mPts;
    } else if (cat === 'J3') {
      techBullJ3 += bPts;
      techBearJ3 += mPts;
    }

    // Determine the proprietary side of this technique dynamically
    

    if (isBull) {
      bullList.push(obj);
    } else if (isBear) {
      bearList.push(obj);
    }
  });

  // Integrate the TechniqueEngine pass as a bounded secondary check
  const techEnginePassVotes: any[] = [];
  tcResult.techniqueBreakdown.forEach(br => {
    const matchedItem = activeList.find((t: any) => t.name === br.name);
    const code = matchedItem && typeof matchedItem === 'object' ? matchedItem.code : '';
    const cat = getTechniqueJudgeCategory(br.name, code);
    
    // Add up to 1.0 per technique per direction
    const addBull = Math.min(br.bullScore, 1.0);
    const addBear = Math.min(br.bearScore, 1.0);

    if (cat === 'J1') { techBullJ1 += addBull; techBearJ1 += addBear; }
    else if (cat === 'J2') { techBullJ2 += addBull; techBearJ2 += addBear; }
    else if (cat === 'J3') { techBullJ3 += addBull; techBearJ3 += addBear; }
    
    if (br.status === "SKIPPED") deadTechniques.push(br.name);
    
    evaluationVotes.push({
      id: br.id,
      name: br.name,
      vote: br.status === "SKIPPED" ? "SKIP" : (br.bullScore > br.bearScore ? 'BULL' : (br.bearScore > br.bullScore ? 'BEAR' : 'NEUTRAL')),
      score: Math.max(br.bullScore, br.bearScore),
      bullPoints: br.bullScore,
      bearPoints: br.bearScore,
      reason: br.status === "SKIPPED" ? "No executable conditions" : `BULL=${br.bullScore.toFixed(1)} BEAR=${br.bearScore.toFixed(1)}`
    });
    techEnginePassVotes.push({ id: br.id, name: br.name, vote: br.status === "SKIPPED" ? "SKIP" : (br.bullScore > br.bearScore ? 'BULL' : (br.bearScore > br.bullScore ? 'BEAR' : 'NEUTRAL')) });
    
    evaluatedCount++;
    if (br.bullScore > 0 || br.bearScore > 0) processedCount++;
  });

  if (processedCount < 10 && !isNoTech && !isCustomList && evaluatedCount < 10) {
    return getEmptyNoTradeResult('INSUFFICIENT_TECHNIQUES');
  }

  const techniquesEvaluation = {
    totalTechniques: evaluatedCount,
    bullPoints,
    bearPoints,
    bullList,
    bearList
  };

  // --- Step 2: 3-Judge Score Formulations (Accumulating separates) ---
  const last = closes.length - 1;
  const slopeSeries = emaSlope(Array.from(closes), 9);
  const lastSlope = slopeSeries.length > 0 ? slopeSeries[slopeSeries.length - 1] : 0;

  // ═════════════════════════════════════════════════════════════
  // J1 REASONING — MOMENTUM CONSENSUS (max 4.0 per side)
  //   Contributor A: engineIntrinsic (always runs)
  //   Contributor B: user technique points classified as J1
  // ═════════════════════════════════════════════════════════════
  let bullJ1Intrinsic = 0;
  let bearJ1Intrinsic = 0;
  {
    const m   = techCache.macdVals?.macd?.[last]   ?? 0;
    const sig = techCache.macdVals?.signal?.[last] ?? 0;
    const hst = techCache.macdVals?.hist?.[last]   ?? 0;
    const prevHst = techCache.macdVals?.hist?.[last - 1] ?? 0;
    const histVel = hst - prevHst;

    // MACD bull stack
    if (m > sig && hst > 0) {
      bullJ1Intrinsic += 1.5;
      auditPush('J1', 'BULL', 'intrinsic.macd_bull_stack',
        1.5, `MACD=${m.toFixed(4)} > Signal=${sig.toFixed(4)}, hist=${hst.toFixed(4)}>0`);
    }
    if (m < sig && hst < 0) {
      bearJ1Intrinsic += 1.5;
      auditPush('J1', 'BEAR', 'intrinsic.macd_bear_stack',
        1.5, `MACD=${m.toFixed(4)} < Signal=${sig.toFixed(4)}, hist=${hst.toFixed(4)}<0`);
    }

    // MACD acceleration
    if (hst > 0 && histVel > 0) {
      bullJ1Intrinsic += 0.75;
      auditPush('J1', 'BULL', 'intrinsic.macd_accel_up',
        0.75, `MACD hist accelerating up (Δ=${histVel.toFixed(5)})`);
    }
    if (hst < 0 && histVel < 0) {
      bearJ1Intrinsic += 0.75;
      auditPush('J1', 'BEAR', 'intrinsic.macd_accel_dn',
        0.75, `MACD hist accelerating down (Δ=${histVel.toFixed(5)})`);
    }

    // EMA slope as momentum proxy
    if (lastSlope > 0.05) {
      const pts = Math.min(1.75, lastSlope * 10);
      bullJ1Intrinsic += pts;
      auditPush('J1', 'BULL', 'intrinsic.ema9_slope_up',
        pts, `EMA9 slope=${lastSlope.toFixed(4)} > 0.05`);
    }
    if (lastSlope < -0.05) {
      const pts = Math.min(1.75, -lastSlope * 10);
      bearJ1Intrinsic += pts;
      auditPush('J1', 'BEAR', 'intrinsic.ema9_slope_dn',
        pts, `EMA9 slope=${lastSlope.toFixed(4)} < -0.05`);
    }

    // ADX Trend Corroboration (BUG #7 Component)
    const lastADXVal = !isNaN(techCache.adxVals?.adx?.[last]) ? techCache.adxVals.adx[last] : 0;
    const lastPlusDIVal = !isNaN(techCache.adxVals?.plusDI?.[last]) ? techCache.adxVals.plusDI[last] : 0;
    const lastMinusDIVal = !isNaN(techCache.adxVals?.minusDI?.[last]) ? techCache.adxVals.minusDI[last] : 0;

    if (lastADXVal > 20) {
      if (lastPlusDIVal > lastMinusDIVal) {
        bullJ1Intrinsic += 0.50;
        bearJ1Intrinsic = Math.max(0, bearJ1Intrinsic - 0.50);
        auditPush('J1', 'BULL', 'intrinsic.adx_trend_corroboration',
          0.50, `ADX=${lastADXVal.toFixed(1)} confirms strong bullish trend (plusDI=${lastPlusDIVal.toFixed(1)} > minusDI=${lastMinusDIVal.toFixed(1)})`);
      } else if (lastMinusDIVal > lastPlusDIVal) {
        bearJ1Intrinsic += 0.50;
        bullJ1Intrinsic = Math.max(0, bullJ1Intrinsic - 0.50);
        auditPush('J1', 'BEAR', 'intrinsic.adx_trend_corroboration',
          0.50, `ADX=${lastADXVal.toFixed(1)} confirms strong bearish trend (minusDI=${lastMinusDIVal.toFixed(1)} > plusDI=${lastPlusDIVal.toFixed(1)})`);
      }
    } else if (lastADXVal < 15) {
      bullJ1Intrinsic = Math.max(0, bullJ1Intrinsic - 0.15);
      bearJ1Intrinsic = Math.max(0, bearJ1Intrinsic - 0.15);
    }
  }

  if (isCustomList) {
    // Retain 60% of intrinsic indicators as a baseline model so systems are never dead,
    // allowing custom loaded techniques to build upon and perfect the analysis.
    bullJ1Intrinsic *= 0.60;
    bearJ1Intrinsic *= 0.60;
  }
  const bullJ1Raw = bullJ1Intrinsic + techBullJ1;   // intrinsic + user techniques
  const bearJ1Raw = bearJ1Intrinsic + techBearJ1;

  // Make J1 (Pattern Detection / Momentum Consensus) contradictory so Bull and Bear cancel each other out.
  // This prevents high-volume technique portfolios from flooding both sides with spurious coincident pattern points.
  const bullJ1 = Math.max(0, Math.min(4.0, bullJ1Raw - bearJ1Raw));
  const bearJ1 = Math.max(0, Math.min(4.0, bearJ1Raw - bullJ1Raw));

  

  let bullJ3Intrinsic = 0;
  let bearJ3Intrinsic = 0;

  // ═════════════════════════════════════════════════════════════
  // J2 VEHICLE — OSCILLATOR CONSENSUS (max 4.0 per side)
  // ═════════════════════════════════════════════════════════════
  let bullJ2Intrinsic = 0;
  let bearJ2Intrinsic = 0;

  // Bug #12 fix: check upfront whether user loaded any RSI or Stochastic techniques.
  // If a technique already covers RSI/Stoch, the intrinsic layer must skip those indicators
  // to prevent the same signal scoring twice from two owners.
  const rsiTechLoaded = activeList.some(t => {
    const n = (typeof t === 'object' ? (t.name || t.technique || '') : String(t)).toLowerCase().replace(/[\s_-]/g, '');
    return n.includes('rsi');
  });
  const stochTechLoaded = activeList.some(t => {
    const n = (typeof t === 'object' ? (t.name || t.technique || '') : String(t)).toLowerCase().replace(/[\s_-]/g, '');
    return n.includes('stoch');
  });
  const macdTechLoaded = activeList.some(t => {
    const n = (typeof t === 'object' ? (t.name || t.technique || '') : String(t)).toLowerCase().replace(/[\s_-]/g, '');
    return n.includes('macd');
  });

  {
    // RSI extremes
    const rVal = techCache.rsiVals?.[last] ?? 50;
    if (rVal < 30) {
      if (rsiTechLoaded) {
        auditPush('J2', 'BULL', 'intrinsic.rsi_oversold_skipped', 0,
          `RSI(14)=${rVal.toFixed(2)} oversold SKIPPED — RSI technique already owns this indicator`);
      } else {
        const pts = rVal < 20 ? 2.0 : 1.25;
        bullJ2Intrinsic += pts;
        auditPush('J2', 'BULL', 'intrinsic.rsi_oversold',
          pts, `RSI(14)=${rVal.toFixed(2)} < 30 oversold`);
      }
    }
    if (rVal > 70) {
      // Bug #4 fix: RSI overbought only scores BEAR when J1 has NOT confirmed
      // a strong bull trend. In a confirmed uptrend RSI=99 is momentum, not reversal.
      const strongBullTrend = bullJ1Raw >= 3.0;
      if (!strongBullTrend) {
        const pts = rVal > 80 ? 2.0 : 1.25;
        bearJ2Intrinsic += pts;
        auditPush('J2', 'BEAR', 'intrinsic.rsi_overbought',
          pts, `RSI(14)=${rVal.toFixed(2)} > 70 overbought (J1 bull=${bullJ1Raw.toFixed(2)} < 3.0, gate passed)`);
      } else {
        auditPush('J2', 'BEAR', 'intrinsic.rsi_overbought_suppressed',
          0, `RSI(14)=${rVal.toFixed(2)} overbought SUPPRESSED — strong bull trend confirmed (J1 bull=${bullJ1Raw.toFixed(2)} >= 3.0)`);
      }
    }

    // Stochastic
    const kVal = techCache.stochVals?.k?.[last];
    const dVal = techCache.stochVals?.d?.[last];
    if (!stochTechLoaded && kVal != null && dVal != null && !isNaN(kVal) && !isNaN(dVal)) {
      if (kVal < 20 && dVal < 20) {
        bullJ2Intrinsic += 1.0;
        auditPush('J2', 'BULL', 'intrinsic.stoch_oversold',
          1.0, `Stoch K=${kVal.toFixed(1)} D=${dVal.toFixed(1)} < 20`);
      }
      if (kVal > 80 && dVal > 80) {
        bearJ2Intrinsic += 1.0;
        auditPush('J2', 'BEAR', 'intrinsic.stoch_overbought',
          1.0, `Stoch K=${kVal.toFixed(1)} D=${dVal.toFixed(1)} > 80`);
      }
      // Crossovers
      const prevK = techCache.stochVals?.k?.[last - 1];
      const prevD = techCache.stochVals?.d?.[last - 1];
      if (prevK != null && prevD != null) {
        if (prevK <= prevD && kVal > dVal && kVal < 50) {
          bullJ2Intrinsic += 0.75;
          auditPush('J2', 'BULL', 'intrinsic.stoch_bull_cross',
            0.75, `Stoch K/D bull cross at K=${kVal.toFixed(1)}`);
        }
        if (prevK >= prevD && kVal < dVal && kVal > 50) {
          bearJ2Intrinsic += 0.75;
          auditPush('J2', 'BEAR', 'intrinsic.stoch_bear_cross',
            0.75, `Stoch K/D bear cross at K=${kVal.toFixed(1)}`);
        }
      }
    } else if (stochTechLoaded && kVal != null) {
      auditPush('J2', 'BULL', 'intrinsic.stoch_skipped', 0,
        `Stoch K=${kVal.toFixed(1)} SKIPPED — Stochastic technique already owns this indicator`);
    }

    // RSI divergence (uses enhanced detectRSIDivergence - BUG #5)
    try {
      const div = detectRSIDivergence(Array.from(closes), techCache.rsiVals);
      if (div.type === 'BULLISH') {
        const pts = parseFloat((1.5 * div.strength).toFixed(3));
        bullJ2Intrinsic += pts;
        auditPush('J2', 'BULL', 'intrinsic.rsi_bull_divergence',
          pts, `RSI bullish divergence detected (strength=${div.strength.toFixed(2)})`);
      } else if (div.type === 'BEARISH') {
        const pts = parseFloat((1.5 * div.strength).toFixed(3));
        bearJ2Intrinsic += pts;
        auditPush('J2', 'BEAR', 'intrinsic.rsi_bear_divergence',
          pts, `RSI bearish divergence detected (strength=${div.strength.toFixed(2)})`);
      }
    } catch {
      // Bypassed if insufficient rsi data length
    }

    // MACD divergence — skip if a MACD technique is loaded (Bug #12)
    try {
      if (macdTechLoaded) {
        auditPush('J2', 'BULL', 'intrinsic.macd_divergence_skipped', 0,
          `MACD divergence intrinsic SKIPPED — MACD technique already owns this indicator`);
      } else {
      const mDiv = detectMACDDivergence(Array.from(closes), techCache.macdVals);
      if (mDiv.type === 'BULLISH') {
        bullJ2Intrinsic += 1.50;
        auditPush('J2', 'BULL', 'intrinsic.macd_bull_divergence',
          1.50, `MACD Bullish Divergence detected (strength=${mDiv.strength.toFixed(2)})`);
          
        // Contribute to J3 boundary conditions (reversal points)
        bullJ3Intrinsic += 1.00;
        auditPush('J3', 'BULL', 'intrinsic.macd_divergence_bounce',
          1.00, `MACD Bullish divergence contributes to J3 floor strength`);
      } else if (mDiv.type === 'BEARISH') {
        bearJ2Intrinsic += 1.50;
        auditPush('J2', 'BEAR', 'intrinsic.macd_bear_divergence',
          1.50, `MACD Bearish Divergence detected (strength=${mDiv.strength.toFixed(2)})`);

        // Contribute to J3 boundary conditions (reversal points)
        bearJ3Intrinsic += 1.00;
        auditPush('J3', 'BEAR', 'intrinsic.macd_divergence_bounce',
          1.00, `MACD Bearish divergence contributes to J3 peak strength`);
      }
      } // end macdTechLoaded else
    } catch {
      // Bypassed if insufficient macd data length
    }

    // Z-score breakout
    try {
      const z = calculateZScore(Array.from(closes), 20);
      const zVal = Array.isArray(z) ? z[z.length - 1] : z;
      if (typeof zVal === 'number' && !isNaN(zVal)) {
        if (zVal > 2.0) {
          bullJ2Intrinsic += 0.75;
          auditPush('J2', 'BULL', 'intrinsic.z_breakout_up',
            0.75, `Z=${zVal.toFixed(2)} > 2.0`);
        }
        if (zVal < -2.0) {
          bearJ2Intrinsic += 0.75;
          auditPush('J2', 'BEAR', 'intrinsic.z_breakout_dn',
            0.75, `Z=${zVal.toFixed(2)} < -2.0`);
        }
      }
    } catch {
      // Bypassed if insufficient price series data length
    }
  }

  if (isCustomList) {
    // Retain 60% of intrinsic indicators as a baseline model so systems are never dead,
    // allowing custom loaded techniques to build upon and perfect the analysis.
    bullJ2Intrinsic *= 0.60;
    bearJ2Intrinsic *= 0.60;
  }
  const bullJ2Raw = bullJ2Intrinsic + techBullJ2;
  const bearJ2Raw = bearJ2Intrinsic + techBearJ2;
  const bullJ2 = Math.min(4.0, bullJ2Raw);
  const bearJ2 = Math.min(4.0, bearJ2Raw);

  // ═════════════════════════════════════════════════════════════
  // J3 REVERSAL — BOUNDARY + WICK + Z-SCORE SIGNIFICANCE (max 3.0)
  // ═════════════════════════════════════════════════════════════
  const visibleSeries = ohlcSeries.slice(-Math.max(20, nCandles * 5));
  const zScoreData    = calculateZScoreSignificance(visibleSeries);
  const lastClose     = ohlcSeries[last].close;
  const visibleCloses = visibleSeries.map(c => c.close);
  const minClose      = Math.min(...visibleCloses);
  const maxClose      = Math.max(...visibleCloses);
  const yPercent      = maxClose !== minClose
                          ? ((lastClose - minClose) / (maxClose - minClose)) * 100
                          : 50;
  const boundaryRes   = calculateBoundaryReversal(yPercent, visibleSeries);

  // IMPROVE-1: Directionally-split boundary detection for scalp precision
  // Bear boundary uses last bar's HIGH — where did price actually test resistance?
  // Bull boundary uses last bar's LOW  — where did price actually test support?
  const visibleHighs   = visibleSeries.map(c => c.high);
  const visibleLows    = visibleSeries.map(c => c.low);
  const minVisual      = Math.min(...visibleLows);
  const maxVisual      = Math.max(...visibleHighs);
  const lastBarHigh    = ohlcSeries[last].high;
  const lastBarLow     = ohlcSeries[last].low;

  const yPercentHigh   = maxVisual !== minVisual
    ? ((lastBarHigh - minVisual) / (maxVisual - minVisual)) * 100 : 50;
  const yPercentLow    = maxVisual !== minVisual
    ? ((lastBarLow  - minVisual) / (maxVisual - minVisual)) * 100 : 50;

  const boundaryResBear = calculateBoundaryReversal(yPercentHigh, visibleSeries);
  const boundaryResBull = calculateBoundaryReversal(yPercentLow,  visibleSeries);

  
  let bullBlowOffSurplus = 0;
  let bearBlowOffSurplus = 0;
  {
    // Boundary reversal contribution (IMPROVE-1: split bull/bear to use bar extremes)
    // Bull boundary: how low did the last bar reach? Uses yPercentLow (bar.low based)
    if (boundaryResBull.bullPoints !== 0) {
      bullJ3Intrinsic += boundaryResBull.bullPoints;
      auditPush('J3', 'BULL', 'intrinsic.boundary_reversal',
        boundaryResBull.bullPoints,
        `${boundaryResBull.label}, yPercentLow=${yPercentLow.toFixed(1)} (bar low used for bull boundary)`);
    }
    // Bear boundary: how high did the last bar reach? Uses yPercentHigh (bar.high based)
    if (boundaryResBear.bearPoints !== 0) {
      bearJ3Intrinsic += boundaryResBear.bearPoints;
      auditPush('J3', 'BEAR', 'intrinsic.boundary_reversal',
        boundaryResBear.bearPoints,
        `${boundaryResBear.label}, yPercentHigh=${yPercentHigh.toFixed(1)} (bar high used for bear boundary)`);
    }

    // Z-score significance (allow negative penalties to be subtracted - Invariant I-4)
    if (zScoreData.bullPoints !== 0) {
      bullJ3Intrinsic += zScoreData.bullPoints;
      auditPush('J3', 'BULL', 'intrinsic.z_significance',
        zScoreData.bullPoints,
        `Z=${zScoreData.zScore}, type=${zScoreData.signalType}`);
    }
    if (zScoreData.bearPoints !== 0) {
      bearJ3Intrinsic += zScoreData.bearPoints;
      auditPush('J3', 'BEAR', 'intrinsic.z_significance',
        zScoreData.bearPoints,
        `Z=${zScoreData.zScore}, type=${zScoreData.signalType}`);
    }

    // Bollinger band edge
    const bUp = techCache.bollVals?.upper?.[last];
    const bMd = techCache.bollVals?.middle?.[last];
    const bLo = techCache.bollVals?.lower?.[last];
    const px  = closes[last];
    if (bUp != null && bMd != null && bLo != null) {
      if (px < bLo + (bMd - bLo) * 0.15) {
        bullJ3Intrinsic += 0.75;
        auditPush('J3', 'BULL', 'intrinsic.boll_lower_edge',
          0.75, `Price ${px.toFixed(2)} near lower BB ${bLo.toFixed(2)}`);
      }
      if (px > bUp - (bUp - bMd) * 0.15) {
        bearJ3Intrinsic += 0.75;
        auditPush('J3', 'BEAR', 'intrinsic.boll_upper_edge',
          0.75, `Price ${px.toFixed(2)} near upper BB ${bUp.toFixed(2)}`);
      }
    }

    // Wick rejection on last candle
    // Bug #8 fix: gate intrinsic wick scoring if a technique already claimed this geometry.
    // Hammer/hangingman techniques own the lower wick; shootingstar/invertedhammer own the upper wick.
    const settledLast = Math.max(0, closes.length - 2);
    const lc = ohlcSeries[settledLast];
    if (lc) {
      const body = Math.abs(lc.close - lc.open);
      const uW   = lc.high - Math.max(lc.open, lc.close);
      const lW   = Math.min(lc.open, lc.close) - lc.low;

      // Check if any loaded technique already matched lower-wick geometry on this candle
      const hammerTechMatched = evaluationVotes.some(v =>
        (v.name === 'hammer' || v.name === 'hangingman') && (v.vote === 'BULL' || v.vote === 'BEAR')
      );
      // Check if any loaded technique already matched upper-wick geometry on this candle
      const shootingStarTechMatched = evaluationVotes.some(v =>
        (v.name === 'shootingstar' || v.name === 'invertedhammer') && (v.vote === 'BULL' || v.vote === 'BEAR')
      );

      // Gate: Z-score significance already scored this candle's wick geometry.
      // BULL_PINBAR = lower wick > 50% of range — already awarded in zScoreData.bullPoints.
      // BEAR_PINBAR = upper wick > 50% of range — already awarded in zScoreData.bearPoints.
      // Adding intrinsic wick on top would double-reward the same geometry.
      const zScoreClaimedLowerWick = zScoreData.signalType === 'BULL_PINBAR';
      const zScoreClaimedUpperWick = zScoreData.signalType === 'BEAR_PINBAR';

      if (lW > body * 1.8 && lW > 0) {
        if (hammerTechMatched || zScoreClaimedLowerWick) {
          judgeContribs.push({
            judge: 'J3', side: 'BULL',
            contributor: 'intrinsic.lower_wick_rejection_skipped',
            value: 0,
            reason: `Lower wick skipped — ${hammerTechMatched
              ? 'hammer/hangingman technique owns geometry'
              : 'zScoreData signalType=BULL_PINBAR already scored this wick'}`
          });
        } else {
          const ratio = lW / Math.max(1e-9, body);
          const pts = parseFloat((0.55 + Math.log(1 + ratio - 1.8)).toFixed(3));
          bullJ3Intrinsic += pts;
          auditPush('J3', 'BULL', 'intrinsic.lower_wick_rejection',
            pts, `Lower wick rejection (ratio=${ratio.toFixed(2)}, floor=0.55 + log topper)`);
          if (ratio > 4.5) {
            bullBlowOffSurplus = parseFloat(Math.min(1.0, 0.15 * (ratio - 4.5)).toFixed(3));
          }
        }
      }
      if (uW > body * 1.8 && uW > 0) {
        if (shootingStarTechMatched || zScoreClaimedUpperWick) {
          judgeContribs.push({
            judge: 'J3', side: 'BEAR',
            contributor: 'intrinsic.upper_wick_rejection_skipped',
            value: 0,
            reason: `Upper wick skipped — ${shootingStarTechMatched
              ? 'shootingstar/invertedhammer technique owns geometry'
              : 'zScoreData signalType=BEAR_PINBAR already scored this wick'}`
          });
        } else {
          const ratio = uW / Math.max(1e-9, body);
          const pts = parseFloat((0.55 + Math.log(1 + ratio - 1.8)).toFixed(3));
          bearJ3Intrinsic += pts;
          auditPush('J3', 'BEAR', 'intrinsic.upper_wick_rejection',
            pts, `Upper wick rejection (ratio=${ratio.toFixed(2)}, floor=0.55 + log topper)`);
          if (ratio > 4.5) {
            bearBlowOffSurplus = parseFloat(Math.min(1.0, 0.15 * (ratio - 4.5)).toFixed(3));
          }
        }
      }
    }

    // ADX Peak Exhaustion (BUG #7 Component)
    const lastAD6Val = !isNaN(techCache.adxVals?.adx?.[last]) ? techCache.adxVals.adx[last] : 0;
    if (lastAD6Val > 40) {
      if (yPercent >= 50) {
        bearJ3Intrinsic += 0.75;
        auditPush('J3', 'BEAR', 'intrinsic.adx_exhaustion', 0.75, `ADX=${lastAD6Val.toFixed(1)} > 40 indicates strong peak trend exhaustion`);
      } else {
        bullJ3Intrinsic += 0.75;
        auditPush('J3', 'BULL', 'intrinsic.adx_exhaustion', 0.75, `ADX=${lastAD6Val.toFixed(1)} > 40 indicates strong floor trend exhaustion`);
      }
    } else if (lastAD6Val < 15) {
      // In a flat-ADX market, mean reversion probability is high — but the direction
      // of that reversion depends on where price currently sits within its range.
      // Applying +0.5 to both sides unconditionally risks pushing a tied market into
      // a false signal. Gate the bonus to the boundary-favoured side only.
      if (yPercent > 52.5) {
        // Price in upper half → statistical reversion favours bear
        bearJ3Intrinsic += 0.50;
        auditPush('J3', 'BEAR', 'intrinsic.adx_flat_range', 0.50,
          `ADX=${lastAD6Val.toFixed(1)} < 15 flat market — price at ${yPercent.toFixed(1)}% of range, bear reversion probable`);
      } else if (yPercent < 47.5) {
        // Price in lower half → statistical reversion favours bull
        bullJ3Intrinsic += 0.50;
        auditPush('J3', 'BULL', 'intrinsic.adx_flat_range', 0.50,
          `ADX=${lastAD6Val.toFixed(1)} < 15 flat market — price at ${yPercent.toFixed(1)}% of range, bull reversion probable`);
      } else {
        // Price in central 47.5–52.5% band — genuine uncertainty, apply muted symmetric bonus
        bullJ3Intrinsic += 0.25;
        bearJ3Intrinsic += 0.25;
        auditPush('J3', 'BULL', 'intrinsic.adx_flat_range', 0.25,
          `ADX=${lastAD6Val.toFixed(1)} < 15 flat market — price centered at ${yPercent.toFixed(1)}%, symmetric muted bonus`);
        auditPush('J3', 'BEAR', 'intrinsic.adx_flat_range', 0.25,
          `ADX=${lastAD6Val.toFixed(1)} < 15 flat market — price centered at ${yPercent.toFixed(1)}%, symmetric muted bonus`);
      }
    }

    // Market Structure Reversion & Continuity (BUG #8 Component)
    let structSignal = { type: 'NONE' };
    try {
      structSignal = detectStructureSignal(closes, highs, lows);
    } catch {
      // safe bypass
    }
    const doubleTopBottom = detectDoubleTopBottom(pivots, 0.015);

    // IMPROVE-2: ADX-scaled CHoCH weight
    // Linear interpolation from 1.0× at ADX=20 to 1.5× at ADX=60, capped at both ends.
    // ADX 20 → scale 1.00 → chochScore 1.500
    // ADX 30 → scale 1.10 → chochScore 1.650
    // ADX 40 → scale 1.25 → chochScore 1.875
    // ADX 50 → scale 1.38 → chochScore 2.063
    // ADX 60 → scale 1.50 → chochScore 2.250 (cap)
    const chochADXScale = Math.min(1.5, Math.max(1.0, 1.0 + (lastAD6Val - 20) / 40));
    const chochScore    = parseFloat((1.5 * chochADXScale).toFixed(3));

    if (structSignal.type === 'CHOCH_BULL') {
      bullJ3Intrinsic += chochScore;
      auditPush('J3', 'BULL', 'intrinsic.choch_rejection', chochScore,
        `CHoCH Bullish — prior trend ADX=${lastAD6Val.toFixed(1)}, adxScale=${chochADXScale.toFixed(2)}, score=${chochScore}`);
    } else if (structSignal.type === 'CHOCH_BEAR') {
      bearJ3Intrinsic += chochScore;
      auditPush('J3', 'BEAR', 'intrinsic.choch_rejection', chochScore,
        `CHoCH Bearish — prior trend ADX=${lastAD6Val.toFixed(1)}, adxScale=${chochADXScale.toFixed(2)}, score=${chochScore}`);
    } else if (structSignal.type === 'BOS_BULL') {
      bearJ3Intrinsic = Math.max(0, bearJ3Intrinsic - 1.00);
      auditPush('J3', 'BEAR', 'intrinsic.bos_continuity_penalty', -1.00, `BOS Bullish trend continuity penalizes counter-trend bear reversal`);
    } else if (structSignal.type === 'BOS_BEAR') {
      bullJ3Intrinsic = Math.max(0, bullJ3Intrinsic - 1.00);
      auditPush('J3', 'BULL', 'intrinsic.bos_continuity_penalty', -1.00, `BOS Bearish trend continuity penalizes counter-trend bull reversal`);
    }

    if (doubleTopBottom === 'DOUBLE_TOP') {
      bearJ3Intrinsic += 1.00;
      auditPush('J3', 'BEAR', 'intrinsic.double_top', 1.00, `Reversion from peak resistance (Double Top)`);
    } else if (doubleTopBottom === 'DOUBLE_BOTTOM') {
      bullJ3Intrinsic += 1.00;
      auditPush('J3', 'BULL', 'intrinsic.double_bottom', 1.00, `Reversion from floor support (Double Bottom)`);
    }

    // ── NEW-1: Engulfing Candle Detection ──────────────────────────────────
    // Bullish engulfing: prior bearish, current bullish, current body wraps prior body.
    // Bearish engulfing: prior bullish, current bearish, current body wraps prior body.
    // Score scales: base 0.75, +0.25 per extra body-ratio, capped at 1.0.
    if (ohlcSeries.length >= 2) {
      const prevBar = ohlcSeries[last - 1];
      const currBar = ohlcSeries[last];
      const prevBody = Math.abs(prevBar.close - prevBar.open);
      const currBody = Math.abs(currBar.close - currBar.open);

      const isBullishEngulf =
        prevBar.close < prevBar.open &&              // prior candle: bearish body
        currBar.close > currBar.open &&              // current candle: bullish body
        currBar.open  <= prevBar.close &&            // opens at or below prior close (gap allowed)
        currBar.close >= prevBar.open  &&            // closes at or above prior open
        currBody > prevBody * 0.90;                  // body substantial (90% size minimum)

      const isBearishEngulf =
        prevBar.close > prevBar.open &&              // prior candle: bullish body
        currBar.close < currBar.open &&              // current candle: bearish body
        currBar.open  >= prevBar.close &&            // opens at or above prior close
        currBar.close <= prevBar.open  &&            // closes at or below prior open
        currBody > prevBody * 0.90;

      if (isBullishEngulf) {
        const sizeRatio   = currBody / Math.max(prevBody, 1e-9);
        const engulfScore = Math.min(1.0, parseFloat((0.75 + (sizeRatio - 1.0) * 0.25).toFixed(3)));
        bullJ3Intrinsic += engulfScore;
        auditPush('J3', 'BULL', 'intrinsic.bull_engulfing', engulfScore,
          `Bullish engulfing — curr body ${currBody.toFixed(2)} wraps prev body ${prevBody.toFixed(2)}, sizeRatio=${sizeRatio.toFixed(2)}, score=${engulfScore}`);
      }

      if (isBearishEngulf) {
        const sizeRatio   = currBody / Math.max(prevBody, 1e-9);
        const engulfScore = Math.min(1.0, parseFloat((0.75 + (sizeRatio - 1.0) * 0.25).toFixed(3)));
        bearJ3Intrinsic += engulfScore;
        auditPush('J3', 'BEAR', 'intrinsic.bear_engulfing', engulfScore,
          `Bearish engulfing — curr body ${currBody.toFixed(2)} wraps prev body ${prevBody.toFixed(2)}, sizeRatio=${sizeRatio.toFixed(2)}, score=${engulfScore}`);
      }
    }

    // ── NEW-2: Three-bar consecutive close pressure at boundaries ──────────
    // Confirms the reversal is in progress, not just a single-candle reaction.
    // Only fires when yPercent confirms we are in a boundary zone.
    if (ohlcSeries.length >= 3) {
      const barC1 = ohlcSeries[last - 2];
      const barC2 = ohlcSeries[last - 1];
      const barC3 = ohlcSeries[last];

      const threeBearClose =
        barC1.close < barC1.open &&
        barC2.close < barC2.open &&
        barC3.close < barC3.open;

      const threeBullClose =
        barC1.close > barC1.open &&
        barC2.close > barC2.open &&
        barC3.close > barC3.open;

      if (threeBearClose && yPercent >= 65) {
        bearJ3Intrinsic += 0.60;
        auditPush('J3', 'BEAR', 'intrinsic.three_bar_bear_pressure', 0.60,
          `3 consecutive bearish closes at high boundary (yPercent=${yPercent.toFixed(1)}%)`);
      }
      if (threeBullClose && yPercent <= 35) {
        bullJ3Intrinsic += 0.60;
        auditPush('J3', 'BULL', 'intrinsic.three_bar_bull_pressure', 0.60,
          `3 consecutive bullish closes at low boundary (yPercent=${yPercent.toFixed(1)}%)`);
      }
    }

    // ── NEW-3: Fair Value Gap (FVG) — 3-candle imbalance zone detection ────
    // FVG forms when there is a gap between C1 and C3 that C2 did not trade through.
    // Score is proportional to gap size in ATR units. Only fires in boundary zones.
    if (ohlcSeries.length >= 3) {
      const fvgBar1    = ohlcSeries[last - 2];   // C1
      const fvgBar3    = ohlcSeries[last];        // C3
      const atrNow     = techCache.atrVals?.[last] ?? 0;
      const fvgMinSize = atrNow * 0.30;           // Minimum 0.3×ATR for significance

      // Bearish FVG: C3.low is ABOVE C1.high → unfilled gap above current bar
      const bearFVGSize = fvgBar3.low - fvgBar1.high;   // positive = gap exists above

      // Bullish FVG: C3.high is BELOW C1.low → unfilled gap below current bar
      const bullFVGSize = fvgBar1.low - fvgBar3.high;   // positive = gap exists below

      if (bearFVGSize > fvgMinSize && yPercent >= 60) {
        const atrRatio = atrNow > 0 ? bearFVGSize / atrNow : 0;
        const fvgScore = Math.min(0.75, parseFloat((0.40 + atrRatio * 0.10).toFixed(3)));
        bearJ3Intrinsic += fvgScore;
        auditPush('J3', 'BEAR', 'intrinsic.fvg_resistance', fvgScore,
          `Bearish FVG: gap=${bearFVGSize.toFixed(2)} (${atrRatio.toFixed(1)}×ATR) at high boundary yPercent=${yPercent.toFixed(1)}%`);
      }

      if (bullFVGSize > fvgMinSize && yPercent <= 40) {
        const atrRatio = atrNow > 0 ? bullFVGSize / atrNow : 0;
        const fvgScore = Math.min(0.75, parseFloat((0.40 + atrRatio * 0.10).toFixed(3)));
        bullJ3Intrinsic += fvgScore;
        auditPush('J3', 'BULL', 'intrinsic.fvg_support', fvgScore,
          `Bullish FVG: gap=${bullFVGSize.toFixed(2)} (${atrRatio.toFixed(1)}×ATR) at low boundary yPercent=${yPercent.toFixed(1)}%`);
      }
    }

    // ── NEW-4: Triple boundary wick rejection ──────────────────────────────
    // 3 consecutive candles with highs within 0.3% = triple resistance cluster.
    // 3 consecutive candles with lows within 0.3%  = triple support cluster.
    // Adds to rejection side, penalises counter-trend side.
    if (ohlcSeries.length >= 3) {
      const triBar1  = ohlcSeries[last - 2];
      const triBar2  = ohlcSeries[last - 1];
      const triBar3  = ohlcSeries[last];
      const midPrice = lastClose > 0 ? lastClose : 1;

      const triHighs    = [triBar1.high, triBar2.high, triBar3.high];
      const triLows     = [triBar1.low,  triBar2.low,  triBar3.low];
      const highSpread  = (Math.max(...triHighs) - Math.min(...triHighs)) / midPrice;
      const lowSpread   = (Math.max(...triLows)  - Math.min(...triLows))  / midPrice;

      // Triple resistance: all 3 highs within 0.3% of each other, price in high zone
      if (highSpread < 0.003 && yPercent >= 65) {
        bearJ3Intrinsic += 0.80;
        bullJ3Intrinsic  = Math.max(0, bullJ3Intrinsic - 0.50);
        auditPush('J3', 'BEAR', 'intrinsic.triple_wick_resistance', 0.80,
          `Triple upper wick cluster — 3-bar high spread=${( highSpread * 100).toFixed(3)}% < 0.3%, yPercent=${yPercent.toFixed(1)}%`);
        auditPush('J3', 'BULL', 'intrinsic.triple_wick_resistance_penalty', -0.50,
          `Bull J3 penalised −0.50 — triple resistance reduces breakout probability`);
      }

      // Triple support: all 3 lows within 0.3% of each other, price in low zone
      if (lowSpread < 0.003 && yPercent <= 35) {
        bullJ3Intrinsic += 0.80;
        bearJ3Intrinsic  = Math.max(0, bearJ3Intrinsic - 0.50);
        auditPush('J3', 'BULL', 'intrinsic.triple_wick_support', 0.80,
          `Triple lower wick cluster — 3-bar low spread=${(lowSpread * 100).toFixed(3)}% < 0.3%, yPercent=${yPercent.toFixed(1)}%`);
        auditPush('J3', 'BEAR', 'intrinsic.triple_wick_support_penalty', -0.50,
          `Bear J3 penalised −0.50 — triple support reduces breakdown probability`);
      }
    }

    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║  FUTURE J3 IMPROVEMENTS — Scaffolding (not active code)             ║
    // ╚══════════════════════════════════════════════════════════════════════╝

    // ── FUTURE-1: Orderblock Detection ─────────────────────────────────────
    // An orderblock is the last bearish candle before a strong impulsive bull move
    // (demand block) or the last bullish candle before a strong bear move (supply block).
    // Plan: findOrderBlocks(series, atrMultiplier=1.5) → {demand[], supply[]}
    //   A "strong
  }

  if (isCustomList) {
    // Retain 60% of intrinsic indicators as a baseline model so systems are never dead,
    // allowing custom loaded techniques to build upon and perfect the analysis.
    bullJ3Intrinsic *= 0.60;
    bearJ3Intrinsic *= 0.60;
    bullBlowOffSurplus *= 0.60;
    bearBlowOffSurplus *= 0.60;
  }
  const bullJ3Raw = bullJ3Intrinsic + techBullJ3;
  const bearJ3Raw = bearJ3Intrinsic + techBearJ3;
  let bullJ3 = Math.min(4.0, Math.max(0, bullJ3Raw));
  let bearJ3 = Math.min(4.0, Math.max(0, bearJ3Raw));

  if (bullBlowOffSurplus > 0) {
    bullJ3 = parseFloat((bullJ3 + bullBlowOffSurplus).toFixed(3));
    auditPush('J3', 'BULL', 'intrinsic.blow_off_surplus', bullBlowOffSurplus, `Hyper-extended lower wick blow-off surplus breaks standard cap`);
  }
  if (bearBlowOffSurplus > 0) {
    bearJ3 = parseFloat((bearJ3 + bearBlowOffSurplus).toFixed(3));
    auditPush('J3', 'BEAR', 'intrinsic.blow_off_surplus', bearBlowOffSurplus, `Hyper-extended upper wick blow-off surplus breaks standard cap`);
  }

  // --- Hurst regime balancer (Macrosynergy study) (Zero-Sum - Deliverable 7) ---
  let bullJ1Final = bullJ1;
  let bearJ1Final = bearJ1;
  let bullJ2Final = bullJ2;
  let bearJ2Final = bearJ2;
  let bullJ3Final = bullJ3;
  let bearJ3Final = bearJ3;

  const recentSlopeSeries = emaSlope(Array.from(closes).slice(-64), 9);
  const recentSlope = recentSlopeSeries.length > 0 ? recentSlopeSeries[recentSlopeSeries.length - 1] : 0;

  let H_exp = NaN;
  let hurstExplanation = "Neutral range_balanced";
  
  if (ohlcSeries.length >= 64) {
    H_exp = rescaledRangeHurst(Array.from(closes).slice(-64));
  } else {
    hurstExplanation = "Insufficient candles for Hurst — regime neutral";
  }

  const activeADX = !isNaN(techCache.adxVals?.adx?.[last]) ? techCache.adxVals.adx[last] : 0;

  if (!isNaN(H_exp)) {
    // BUG #3: Support synthetic trends taking over when ADX is explosive even if Hurst returns neutral 0.5
    const isTrending = (H_exp > 0.53 || activeADX > 30) && activeADX > 20;
    const isMeanReverting = H_exp < 0.45 || activeADX < 15;

    if (isTrending) {
      // Stage A: Trending regime alignment
      // Stage B: Directional Gates for J1 (Winning trend-following vs losing trend-following)
      if (recentSlope > 0) {
        // Bullish Trend is active
        bullJ1Final = Math.min(4.0, bullJ1 * 1.25);
        bearJ1Final = Math.min(4.0, bearJ1 * 0.50);
        // Suppress counter-trend overbought J2 vehicles
        bearJ2Final = Math.min(4.0, bearJ2 * 0.35);
      } else if (recentSlope < 0) {
        // Bearish Trend is active
        bearJ1Final = Math.min(4.0, bearJ1 * 1.25);
        bullJ1Final = Math.min(4.0, bullJ1 * 0.50);
        // Suppress counter-trend oversold J2 vehicles
        bullJ2Final = Math.min(4.0, bullJ2 * 0.35);
      }
      
      // Symmetrically dampen J3 (Reversals) by 30%
      bullJ3Final = Math.min(4.0, bullJ3 * 0.70);
      bearJ3Final = Math.min(4.0, bearJ3 * 0.70);
      
      hurstExplanation = `Trending regime (H=${H_exp.toFixed(2)}, ADX=${activeADX.toFixed(1)}), J1 amplified directionally, J3 recovery-blocked`;
    } else if (isMeanReverting) {
      // Stage A: Mean-reverting regime alignment
      // Dampen J1 (Trend) on both sides by 30%
      bullJ1Final = Math.min(4.0, bullJ1 * 0.70);
      bearJ1Final = Math.min(4.0, bearJ1 * 0.70);

      // Stage B: Directional Gates for J3 based on boundary position (yPercent)
      if (yPercent >= 70) {
        // Overbought peak -> BEAR J3 amplified by 1.30, BULL J3 dampened by 50%
        bearJ3Final = Math.min(4.0, bearJ3 * 1.30);
        bullJ3Final = Math.min(4.0, bullJ3 * 0.50);
      } else if (yPercent <= 30) {
        // Oversold valley -> BULL J3 amplified by 1.30, BEAR J3 dampened by 50%
        bullJ3Final = Math.min(4.0, bullJ3 * 1.30);
        bearJ3Final = Math.min(4.0, bearJ3 * 0.50);
      } else {
        // Not near boundaries, standard symmetrical mean-reversion
        bullJ3Final = Math.min(4.0, bullJ3 * 1.15);
        bearJ3Final = Math.min(4.0, bearJ3 * 1.15);
      }
      
      hurstExplanation = `Mean-reverting regime (H=${H_exp.toFixed(2)}, ADX=${activeADX.toFixed(1)}), J1 dampened, J3 boundary-amplified`;
    } else {
      hurstExplanation = `Balanced Hurst regime (H=${H_exp.toFixed(2)}, ADX=${activeADX.toFixed(1)})`;
    }
  }

  const cases = {
    bull: {
      j1: Number(bullJ1Final.toFixed(2)),
      j2: Number(bullJ2Final.toFixed(2)),
      j3: Number(bullJ3Final.toFixed(2)),
      total: 0
    },
    bear: {
      j1: Number(bearJ1Final.toFixed(2)),
      j2: Number(bearJ2Final.toFixed(2)),
      j3: Number(bearJ3Final.toFixed(2)),
      total: 0
    }
  };
  cases.bull.total = Number((cases.bull.j1 + cases.bull.j2 + cases.bull.j3).toFixed(2));
  cases.bear.total = Number((cases.bear.j1 + cases.bear.j2 + cases.bear.j3).toFixed(2));

  // --- Step 3: J4 Skeptic Multiplier & Penalties ---
  let skepticMultiplier = 1.0;
  const skepticReasons: string[] = [];

  const J1_dominates = Math.max(cases.bull.j1, cases.bear.j1) > Math.max(cases.bull.j3, cases.bear.j3);
  const isTrendFollowingTrade = J1_dominates && (Math.abs(lastSlope) > 0.05);
  const currentAtr = techCache.atrVals[last];
  const atrMean = techCache.atrVals.slice(-20).filter((v: number) => !isNaN(v)).reduce((sum: number, v: number) => sum + v, 0) / 20;

  // 1. Z-Score explosive deviation (>2.5) => mult 0.60 (or breakout protection)
  if (Math.abs(zScoreData.zScore) > 2.5) {
    if (isTrendFollowingTrade) {
      skepticMultiplier *= 0.85;
      skepticReasons.push(`Strong trend expansion validated (Z-score=${zScoreData.zScore.toFixed(2)} > 2.5, breakout alignment)`);
    } else {
      skepticMultiplier *= 0.60;
      skepticReasons.push(`Explosive candle volatility (Z-score=${zScoreData.zScore.toFixed(2)} > 2.5)`);
    }
  }

  // 2. ATR expansion Check (>1.8x average) => mult 0.70
  if (!isNaN(currentAtr) && atrMean > 0 && currentAtr > 1.8 * atrMean) {
    if (isTrendFollowingTrade) {
      skepticMultiplier *= 0.90;
      skepticReasons.push(`ATR momentum breakout verified (${currentAtr.toFixed(4)} > 1.8x average ${atrMean.toFixed(4)})`);
    } else {
      skepticMultiplier *= 0.70;
      skepticReasons.push(`ATR volatility spike (${currentAtr.toFixed(4)} > 1.8x average ${atrMean.toFixed(4)})`);
    }
  }

  // 3. Asset-Agnostic ATR-Normalized Slope Flat Gate
  const slopeInAtrUnits = (currentAtr && currentAtr > 0) ? Math.abs(lastSlope) / currentAtr : Math.abs(lastSlope) / (closes[last] * 0.001);
  if (slopeInAtrUnits < 0.12) {
    skepticMultiplier *= 0.70;
    skepticReasons.push(`Flat Normalized Trend Slope (${slopeInAtrUnits.toFixed(3)} ATR-units belongs to stagnation range)`);
  }

  // 4. RQA stability limits (Laminarity < 0.1, Determinism < 0.15) => mult 0.50
  const rqa = calculateRQA(Array.from(closes).slice(-20));
  if (rqa.laminarity < 0.1 && rqa.determinism < 0.15) {
    skepticMultiplier *= 0.50;
    skepticReasons.push(`Extreme low RQA structural stability (laminarity=${rqa.laminarity.toFixed(2)}, determinism=${rqa.determinism.toFixed(2)})`);
  }

  // 5. Timeframe Trend Stability adjustment: Higher timeframes (e.g. 15m or 30m) are structurally more reliable and less noisy than low timeframes
  let tfMultiplier = 1.0;
  if (graphTimeframeMinutes >= 30) {
    tfMultiplier = 1.15;
    skepticReasons.push(`30-Minute High Timeframe trend stability boost (1.15x multiplier)`);
  } else if (graphTimeframeMinutes >= 15) {
    tfMultiplier = 1.05;
    skepticReasons.push(`15-Minute Structural trend stability boost (1.05x multiplier)`);
  } else {
    tfMultiplier = 0.90;
    skepticReasons.push(`Low Timeframe noise correction (0.90x modifier)`);
  }
  skepticMultiplier *= tfMultiplier;

  if (isNoTech) {
    const extremeZ = Math.abs(zScoreData.zScore) > 2.5;
    const extremeATR = !isNaN(currentAtr) && atrMean > 0 && currentAtr > 1.8 * atrMean;
    if (extremeZ || extremeATR) {
      const filtered = skepticReasons.filter(r => r.includes('Explosive') || r.includes('spike'));
      skepticReasons.length = 0;
      skepticReasons.push(...filtered);
    } else {
      skepticMultiplier = 1.0;
      skepticReasons.length = 0;
    }
  } else {
    skepticMultiplier = Math.max(0.30, Math.min(1.00, skepticMultiplier));
  }

  let skepticVerdict: 'ACCEPT' | 'CAUTION' | 'WEAK' = 'ACCEPT';
  if (!isNoTech) {
    if (skepticMultiplier < 0.60) skepticVerdict = 'WEAK';
    else if (skepticMultiplier < 0.85) skepticVerdict = 'CAUTION';
  }

  // --- Step 4: Margin and Decision Resolution (with NEL Integration) ---
  const bullTotal = Number(cases.bull.total.toFixed(2));
  const bearTotal = Number(cases.bear.total.toFixed(2));

  // Nest, directionally-blind margin computation to satisfy Invariant I-8
  const initialMargin = Number(Math.abs(bullTotal - bearTotal).toFixed(2));
  
  // Scale the confidence denominator and dynamic thresholds based on custom list size if applicable
  const scaleThresholdFactor = isCustomList ? Math.max(0.08, Math.min(1.0, activeList.length / 12)) : 1.0;
  
  const signalSide = bullTotal > bearTotal ? 'bull' : 'bear';
  const totalJ3 = signalSide === 'bull' ? cases.bull.j3 : cases.bear.j3;
  const totalJ1 = signalSide === 'bull' ? cases.bull.j1 : cases.bear.j1;
  const reversalDominant = totalJ3 >= 2.0 && totalJ3 > totalJ1;

  let confidenceDenominator = isCustomList ? Math.max(1, activeList.length) : 12;
  if (reversalDominant) {
    confidenceDenominator = isCustomList ? 8.5 : 10;
  }
  
  // Scale thresholds down in testMode by a factor of 0.35 to allow diagnostic/backtest signals to emit
  const testModeFactor = horizonArg?.isTestMode ? 0.35 : 1.0;

  // Threshold definitions (Default minimum difference of 1.0 required)
  let minMarginThreshold = 1.0 * scaleThresholdFactor * testModeFactor;
  let minStrengthThreshold = 4.0 * scaleThresholdFactor * testModeFactor;
  if (reversalDominant) {
    minMarginThreshold *= 0.85;
    minStrengthThreshold *= 0.85;
  }

  const rawWinningTotal = bullTotal > bearTotal ? bullTotal : bearTotal;
  const initialConfidence = Math.round((rawWinningTotal * skepticMultiplier / confidenceDenominator) * 100);

  // Read Calibration settings of the system (Deliverable 8 / 3)
  const isStrictNeutral = neutralityConfig?.strictNeutrality !== false; // defaults to true
  const epsilonTie = neutralityConfig?.noTradePreference !== undefined ? neutralityConfig.noTradePreference : 0.05;
  const biasStrength = neutralityConfig?.biasCorrectionStrength !== undefined ? neutralityConfig.biasCorrectionStrength : 0.05;

  let finalSignal: 'LONG' | 'NO_TRADE' = 'NO_TRADE';
  let noTradeReason: string | null = null;
  let finalConfidence = initialConfidence;
  let adjustedBull = bullTotal;
  let adjustedBear = bearTotal;
  let nelMessages: string[] = [];

  if (isStrictNeutral) {
    const nelResult = enforceNeutrality(
      bullTotal,
      bearTotal,
      initialMargin,
      initialConfidence,
      {
        epsilonTie,
        softNeutralBand: 0.5,
        biasCorrectionFactor: biasStrength
      }
    );
    finalSignal = nelResult.signal;
    // Bug #10 fix: always recompute confidence from the single canonical formula after
    // NEL may have adjusted bull/bear totals. Never use the pre-NEL initialConfidence as final.
    const nelWinnerTotal = nelResult.adjustedBull > nelResult.adjustedBear
      ? nelResult.adjustedBull
      : nelResult.adjustedBear;
    finalConfidence = Math.round((nelWinnerTotal * skepticMultiplier / confidenceDenominator) * 100);
    // Apply soft-band damping from NEL if it was triggered (ratio from NEL)
    if (nelResult.adjustedConfidence < initialConfidence && initialConfidence > 0) {
      const dampRatio = nelResult.adjustedConfidence / initialConfidence;
      finalConfidence = Math.round(finalConfidence * dampRatio);
    }
    adjustedBull = nelResult.adjustedBull;
    adjustedBear = nelResult.adjustedBear;
    nelMessages = nelResult.neutralityActions;
  } else {
    if (initialMargin >= epsilonTie) {
      // Scalp trading: LONG only if bull case is strong enough AND bear invalidation is not too high
      const invalidationFactor = lastSlope > 0 && activeADX > 25 ? 0.4 : (lastSlope < 0 && activeADX > 25 ? 1.2 : 0.7);
      const netConviction = adjustedBull - (adjustedBear * invalidationFactor);
      if (adjustedBull >= minStrengthThreshold && netConviction >= minMarginThreshold) {
        finalSignal = 'LONG';
      } else {
        finalSignal = 'NO_TRADE';
        if (!noTradeReason) {
          if (adjustedBull < minStrengthThreshold) {
            noTradeReason = `Bull conviction too weak (${adjustedBull.toFixed(1)} < ${minStrengthThreshold.toFixed(1)}). No LONG entry.`;
          } else {
            noTradeReason = `Bear invalidation too strong (net conviction ${netConviction.toFixed(1)} < ${minMarginThreshold.toFixed(1)}). LONG entry blocked.`;
          }
        }
      }
    }
  }

  const rawWinner = adjustedBull > adjustedBear ? 'BULL' : (adjustedBear > adjustedBull ? 'BEAR' : 'TIE');
  const margin = Number(Math.abs(adjustedBull - adjustedBear).toFixed(2));
  const winningTotal = rawWinner === 'BULL' ? adjustedBull : (rawWinner === 'BEAR' ? adjustedBear : 0);

  let confidenceRange = 0;
  if (rawWinner !== 'TIE') {
    const winningSide = rawWinner === 'BULL' ? cases.bull : cases.bear;
    const scores = [winningSide.j1, winningSide.j2, winningSide.j3];
    const mean = scores.reduce((a, b) => a + b, 0) / 3;
    const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 3;
    const stdDev = Math.sqrt(variance);
    confidenceRange = Math.round(stdDev * 10);
  }

  const minSkepticMarginThreshold = 4.0 * scaleThresholdFactor * testModeFactor;
  const minConfidenceThreshold = 25 * scaleThresholdFactor * testModeFactor;

  if (hardBlockReason) {
    finalSignal = 'NO_TRADE';
    noTradeReason = `BLOCKED: ${hardBlockReason}`;
  } else if (rawWinner === 'TIE') {
    finalSignal = 'NO_TRADE';
    noTradeReason = `TIE: Bull and Bear scored identically (${adjustedBull.toFixed(2)} vs ${adjustedBear.toFixed(2)}). No directional edge.`;
  } else if (margin < minMarginThreshold) {
    finalSignal = 'NO_TRADE';
    noTradeReason = `Margin of ${margin.toFixed(2)} is below minimum threshold of ${minMarginThreshold.toFixed(2)}. Scores (${adjustedBull.toFixed(2)} vs ${adjustedBear.toFixed(2)}) are too close (minimum difference of ${minMarginThreshold.toFixed(2)} required).`;
  } else if (winningTotal < minStrengthThreshold) {
    finalSignal = 'NO_TRADE';
    noTradeReason = `Winning total of ${winningTotal.toFixed(1)} is below minimum strength threshold of ${minStrengthThreshold.toFixed(1)}/12. Evidence too weak to trade.`;
  } else if (skepticVerdict === 'WEAK' && margin < minSkepticMarginThreshold) {
    finalSignal = 'NO_TRADE';
    noTradeReason = `Skeptic issued WEAK verdict with insufficient margin. High risk environment requires minimum margin of ${minSkepticMarginThreshold.toFixed(2)} (found ${margin.toFixed(2)}).`;
  } else if (finalConfidence < minConfidenceThreshold) {
    finalSignal = 'NO_TRADE';
    noTradeReason = `Final confidence of ${finalConfidence}% falls below minimum actionable threshold of ${minConfidenceThreshold.toFixed(0)}%.`;
  }

  // Record solved signal into Aggregated Bias Sentinel History (Invariant I-10)
  recordDecision(finalSignal);

  let finalScore = 0;
  if (finalSignal === 'LONG') finalScore = adjustedBull * skepticMultiplier;

  const decisionLabel: 'STRONG SIGNAL' | 'WEAK' = finalSignal === 'LONG' ? 'STRONG SIGNAL' : 'WEAK';

  const primaryEvidence = rawWinner === 'BULL'
    ? 'Bullish momentum structure dominant'
    : 'Bearish momentum structure dominant';

  let ruling = '';
  if (finalSignal === 'NO_TRADE') {
    const reasonText = noTradeReason ? `${noTradeReason} ` : '';
    ruling = `NO_TRADE — ${reasonText}A clearer trend or score divergence is required to safely execute scalp trades.`;
  } else {
    const skepticNote = skepticMultiplier < 0.85 ? ` Skeptic flagged concerns; multiplied score by ${skepticMultiplier.toFixed(2)}.` : '';
    ruling = `${finalSignal} ENTRY — ${primaryEvidence}. Margin ${margin.toFixed(2)}, Confidence ${finalConfidence}%.${skepticNote}`;
  }

  // --- Step 5: Formatted Report Layout ---
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
│  SCALP ENTRY VERDICT                │
│  Signal: ${finalSignal.padEnd(21)}│
│  Confidence: ${finalConfidence.toString().padEnd(3)}%                 │
├─────────────────────────────────────┤
│  CASE 1 — BULL                      │
│  J1 Reasoning: ${cases.bull.j1.toFixed(1).padEnd(5)}/ 4.0         │
│  J2 Vehicle:   ${cases.bull.j2.toFixed(1).padEnd(5)}/ 4.0         │
│  J3 Reversal:  ${cases.bull.j3.toFixed(1).padEnd(5)}/ 4.0         │
│  Total:        ${cases.bull.total.toFixed(1).padEnd(5)}/ 12.0        │
├─────────────────────────────────────┤
│  CASE 2 — BEAR                      │
│  J1 Reasoning: ${cases.bear.j1.toFixed(1).padEnd(5)}/ 4.0         │
│  J2 Vehicle:   ${cases.bear.j2.toFixed(1).padEnd(5)}/ 4.0         │
│  J3 Reversal:  ${cases.bear.j3.toFixed(1).padEnd(5)}/ 4.0         │
│  Total:        ${cases.bear.total.toFixed(1).padEnd(5)}/ 12.0        │
├─────────────────────────────────────┤
│  SKEPTIC VETO:  ${skepticMultiplier.toFixed(2)} (${skepticVerdict.padEnd(7)}) │
│  Margin:        ${margin.toFixed(2).padEnd(19)} │
│  Final Score:   ${finalScore.toFixed(1).padEnd(19)} │
├─────────────────────────────────────┤
│  RULING:                            │
${rulingStr}
└─────────────────────────────────────┘`;

  const techniquesUsedNameList = activeList.map(t => typeof t === 'string' ? t : (t.name || 'Custom')).join(', ');
  const skepticPenalty = Math.round((1 - skepticMultiplier) * 100);

  // Populate patterns and gaps exactly as per Rule F requirement
  const topPatterns = {
    bull: [
      ..._confirmedPatterns.filter(p => p.direction === 'BULL').map(p => p.pattern),
      ..._confirmedGaps.filter(g => g.direction === 'BULL').map(g => g.type)
    ],
    bear: [
      ..._confirmedPatterns.filter(p => p.direction === 'BEAR').map(p => p.pattern),
      ..._confirmedGaps.filter(g => g.direction === 'BEAR').map(g => g.type)
    ]
  };

  const runtimeMs = Number((performance.now() - tStart).toFixed(2));

  // Build rigorous deterministic Audit Trail mapping every single decision parameter
  const auditTrail = {
    judgeContribs,
    temporalFiltering: {
      graphTimeframeMinutes,
      durationMinutes,
      nCandles,
      nCut,
      totalCandles: ohlcSeries.length
    },
    preFlightIntegrity: {
      violations: physicsViolations,
      outOfBounds: outOfBoundsCount,
      nonFinite: sensorAnomalies,
      totalChecked: ohlcSeries.length,
      anomaliesRatio,
      decision: anomaliesRatio > 0.05 ? 'BLOCK' : 'PASS'
    },
    techniquesEvaluated: evaluationVotes.map(v => ({
      id: v.id,
      name: v.name,
      vote: v.vote,
      score: v.score,
      bullPoints: v.bullPoints ?? (v.vote === 'BULL' ? v.score : 0),
      bearPoints: v.bearPoints ?? (v.vote === 'BEAR' ? v.score : 0),
      reason: v.reason
    })),
    shardPassVotes: shardPassVotes.map(v => ({ id: v.id, name: v.name, vote: v.vote })),
    techEnginePassVotes: techEnginePassVotes.map(v => ({ id: v.id, name: v.name, vote: v.vote })),
    judges: {
      J1: {
        techOnlyBull: techBullJ1,
        techOnlyBear: techBearJ1,
        intrinsicBull: Number(bullJ1Intrinsic.toFixed(3)),
        intrinsicBear: Number(bearJ1Intrinsic.toFixed(3)),
        preCapBull: Number(bullJ1Raw.toFixed(3)),
        preCapBear: Number(bearJ1Raw.toFixed(3)),
        cappedBull: bullJ1,
        cappedBear: bearJ1,
        hurstTransformBull: bullJ1 > 0 ? Number((cases.bull.j1 / bullJ1).toFixed(4)) : 1,
        hurstTransformBear: bearJ1 > 0 ? Number((cases.bear.j1 / bearJ1).toFixed(4)) : 1,
        finalBull: cases.bull.j1,
        finalBear: cases.bear.j1
      },
      J2: {
        techOnlyBull: techBullJ2,
        techOnlyBear: techBearJ2,
        intrinsicBull: Number(bullJ2Intrinsic.toFixed(3)),
        intrinsicBear: Number(bearJ2Intrinsic.toFixed(3)),
        preCapBull: Number(bullJ2Raw.toFixed(3)),
        preCapBear: Number(bearJ2Raw.toFixed(3)),
        cappedBull: bullJ2,
        cappedBear: bearJ2,
        hurstTransformBull: bullJ2 > 0 ? Number((cases.bull.j2 / bullJ2).toFixed(4)) : 1,
        hurstTransformBear: bearJ2 > 0 ? Number((cases.bear.j2 / bearJ2).toFixed(4)) : 1,
        finalBull: cases.bull.j2,
        finalBear: cases.bear.j2
      },
      J3: {
        techOnlyBull: techBullJ3,
        techOnlyBear: techBearJ3,
        intrinsicBull: Number(bullJ3Intrinsic.toFixed(3)),
        intrinsicBear: Number(bearJ3Intrinsic.toFixed(3)),
        preCapBull: Number(bullJ3Raw.toFixed(3)),
        preCapBear: Number(bearJ3Raw.toFixed(3)),
        cappedBull: bullJ3,
        cappedBear: bearJ3,
        hurstTransformBull: bullJ3 > 0 ? Number((cases.bull.j3 / bullJ3).toFixed(4)) : 1,
        hurstTransformBear: bearJ3 > 0 ? Number((cases.bear.j3 / bearJ3).toFixed(4)) : 1,
        finalBull: cases.bull.j3,
        finalBear: cases.bear.j3,
        components: {
          zScore: zScoreData.zScore,
          zScoreBullPts: zScoreData.bullPoints,
          zScoreBearPts: zScoreData.bearPoints,
          priceYPercent: yPercent,
          boundaryLabel: boundaryRes.label,
          boundaryBullPts: boundaryRes.bullPoints,
          boundaryBearPts: boundaryRes.bearPoints
        }
      }
    },
    hurstRegime: {
      H_exp,
      explanation: hurstExplanation
    },
    j4Skeptic: {
      penalties: skepticReasons,
      finalMultiplier: skepticMultiplier,
      verdict: skepticVerdict
    },
    finalResolution: {
      rawWinner,
      margin,
      rawWinningTotal,
      finalConfidence,
      finalSignal,
      noTradeReason,
      finalScore
    }
  };

  if (typeof console !== 'undefined' && (globalThis as any).CHARTLENS_DEBUG !== false) {
    console.groupCollapsed(`[CHARTLENS] decision: ${finalSignal} conf=${finalConfidence}%`);
    console.log('Cases:', cases);
    console.log('Intrinsic J1:', { bull: bullJ1Intrinsic, bear: bearJ1Intrinsic });
    console.log('Intrinsic J2:', { bull: bullJ2Intrinsic, bear: bearJ2Intrinsic });
    console.log('Intrinsic J3:', { bull: bullJ3Intrinsic, bear: bearJ3Intrinsic });
    console.log('Technique J1/J2/J3:', { bullJ1: techBullJ1, bullJ2: techBullJ2, bullJ3: techBullJ3,
                                         bearJ1: techBearJ1, bearJ2: techBearJ2, bearJ3: techBearJ3 });
    console.log('Skeptic mult:', skepticMultiplier, 'verdict:', skepticVerdict);
    console.log('Techniques evaluated:', evaluationVotes.length,
                'matched:', evaluationVotes.filter(v => v.vote === 'BULL' || v.vote === 'BEAR').length,
                'skipped:', evaluationVotes.filter(v => v.vote === 'SKIP').length,
                'unknown:', evaluationVotes.filter(v => /unknown technique/.test(v.reason)).length);
    console.log('judgeContribs:', judgeContribs);
    console.groupEnd();
  }

  return {
    agent: 'JUDGE',
    signal: finalSignal,
    decision: decisionLabel,
    cases,
    winner: finalSignal === 'NO_TRADE' ? 'NO_TRADE' : finalSignal === 'LONG' ? 'BULL' : 'BEAR',
    margin,
    skepticMultiplier,
    skepticPenalty,
    skepticVerdict,
    finalConfidence,
    finalScore,
    ruling,
    primaryEvidence,
    noTradeReason,
    confidenceRange,
    topPatterns,
    techniquesUsed: "Execution Driven Only",
    techUsedCount: activeList.length,
    
    hallucinationDetected,
    hallucinationMetrics,
    tradeDetails: {
      latencyAdjustedForecast: `Signal: ${finalSignal}`,
      techniquesUsed: techniquesUsedNameList,
      executionTimeMs: runtimeMs
    },
    j1Score: cases.bull.j1 + cases.bear.j1,
    j2Score: cases.bull.j2 + cases.bear.j2,
    j3Score: cases.bull.j3 + cases.bear.j3,
    bullJ1: cases.bull.j1,
    bullJ2: cases.bull.j2,
    bullJ3: cases.bull.j3,
    bullJ3Raw: bullJ3Raw,
    bullTotal: cases.bull.total,
    
    j4PenaltyPct: skepticPenalty,  // Skeptic stripped X% confidence — not a judge score
    techniquesEvaluation,
    techniqueVotes: evaluationVotes,
    deadTechniques,
    auditTrail,
    noTechniquesUploaded: isNoTech,

    // Legacy fields
    confidence: finalConfidence,
    bullScore: cases.bull.total,
    bearScore: cases.bear.total,
    boundaryBias: 0,
    evidence: {
      rsi: techCache.rsiVals?.[last] ?? 50,
      macd: techCache.macdVals?.macd?.[last] ?? 0,
      macdHist: techCache.macdVals?.hist?.[last] ?? 0,
      bollMiddle: techCache.bollVals?.middle?.[last] ?? 0,
      bollLower: techCache.bollVals?.lower?.[last] ?? 0,
      bollUpper: techCache.bollVals?.upper?.[last] ?? 0,
      localSupport: Math.min(...Array.from(lows.slice(-15))),
      localResistance: Math.max(...Array.from(highs.slice(-15))),
      lastClose: ohlcSeries[last].close
    }
  };
}
