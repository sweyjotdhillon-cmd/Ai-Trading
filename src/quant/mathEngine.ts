import * as ss from 'simple-statistics';
import pako from 'pako';

/**
 * Wasserstein-2 Distance (Sinkhorn Algorithm)
 * Measures geometric similarity between current chart and a prototype.
 */
export function calculateWassersteinSimilarity(source: number[], target: number[], iterations = 20, reg = 0.1) {
  const n = source.length;
  const m = target.length;
  
  // Normalize both series to [0, 1] to prevent cost matrix explosion and Sinkhorn underflow
  const minS = Math.min(...source);
  const maxS = Math.max(...source);
  const rangeS = Math.max(maxS - minS, 1e-9);
  const normSource = source.map(s => (s - minS) / rangeS);

  const minT = Math.min(...target);
  const maxT = Math.max(...target);
  const rangeT = Math.max(maxT - minT, 1e-9);
  const normTarget = target.map(t => (t - minT) / rangeT);

  // Cost matrix (Euclidean distance squared)
  const cost = Array.from({ length: n }, (_, i) => 
    Array.from({ length: m }, (_, j) => Math.pow(normSource[i] - normTarget[j], 2))
  );

  // Uniform distributions
  let u = Array(n).fill(1 / n);
  const v = Array(m).fill(1 / m);
  const K = cost.map(row => row.map(c => Math.exp(-c / reg)));

  // Sinkhorn iterations
  for (let iter = 0; iter < iterations; iter++) {
    const Kv = K.map(row => row.reduce((acc, val, j) => acc + val * v[j], 0));
    u = u.map((_, i) => (1 / n) / (Kv[i] || 1e-9));
    
    const Ktu = Array(m).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        Ktu[j] += K[i][j] * u[i];
      }
    }
    for (let j = 0; j < m; j++) v[j] = (1 / m) / (Ktu[j] || 1e-9);
  }

  // Compute distance
  let dist = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      dist += u[i] * K[i][j] * v[j] * cost[i][j];
    }
  }
  
  return Math.sqrt(dist);
}

/**
 * Recurrence Quantification Analysis (RQA)
 * Quantifies market memory and deterministic chaos.
 */
export function calculateRQA(series: number[], epsilon = 0.1) {
  const n = series.length;
  const rp = Array.from({ length: n }, () => Array(n).fill(0));
  const range = Math.max(...series) - Math.min(...series);
  const threshold = epsilon * range;

  let recurrenceRate = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (Math.abs(series[i] - series[j]) < threshold) {
        rp[i][j] = 1;
        recurrenceRate++;
      }
    }
  }
  recurrenceRate /= (n * n);

  // Determinism (DET): Percentage of recurrence points forming diagonal lines >= lmin
  let diagPoints = 0;
  const lmin = 2;
  // Scan for diagonal lines 
  // We only need to check upper triangle (excluding main diagonal) since RP is symmetric
  for (let d = 1; d < n; d++) {
    let currentRun = 0;
    for (let i = 0; i < n - d; i++) {
        const j = i + d;
        if (rp[i][j] === 1) {
            currentRun++;
        } else {
            if (currentRun >= lmin) diagPoints += currentRun;
            currentRun = 0;
        }
    }
    if (currentRun >= lmin) diagPoints += currentRun;
  }
  // Multiply by 2 for symmetric lower triangle
  diagPoints *= 2;
  // Note: We don't count main diagonal (length N) for determinism usually, but if we do, add N. 
  // Standard RQA omits the main line of identity (LOI).

  const totalRecurrenceExcludingLOI = (recurrenceRate * n * n) - n;
  const determinism = totalRecurrenceExcludingLOI > 0 ? diagPoints / totalRecurrenceExcludingLOI : 0;

  // Laminarity (LAM): Percentage of recurrence points forming vertical lines >= vmin
  let vertPoints = 0;
  const vmin = 2;
  for (let j = 0; j < n; j++) {
      let currentRun = 0;
      for (let i = 0; i < n; i++) {
          // exclude main diagonal for laminarity too
          if (i !== j && rp[i][j] === 1) {
              currentRun++;
          } else {
              if (currentRun >= vmin) vertPoints += currentRun;
              currentRun = 0;
          }
      }
      if (currentRun >= vmin) vertPoints += currentRun;
  }
  const laminarity = totalRecurrenceExcludingLOI > 0 ? vertPoints / totalRecurrenceExcludingLOI : 0;

  return { recurrenceRate, determinism, laminarity };
}

/**
 * Persistent Entropy (TDA-Lite)
 * Captures "shape" invariants using simplified persistence of price peaks.
 */
export function calculatePersistentEntropy(series: number[]) {
  const n = series.length;
  const persistence = [];
  
  // Find local extrema (birth/death of features)
  for (let i = 1; i < n - 1; i++) {
    if ((series[i] > series[i-1] && series[i] > series[i+1]) || 
        (series[i] < series[i-1] && series[i] < series[i+1])) {
      persistence.push(Math.abs(series[i] - series[i-1]));
    }
  }

  const sum = persistence.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  
  const normalized = persistence.map(p => p / sum);
  const entropy = -normalized.reduce((acc, p) => acc + (p > 0 ? p * Math.log2(p) : 0), 0);
  
  return { entropy, featureCount: persistence.length };
}

/**
 * Symplectic Hamiltonian Flow
 * Simulates physics-constrained future paths (conserving energy).
 */
export function calculateHamiltonianFlow(price: number, momentum: number, steps = 10, dt = 0.1) {
  let q = price; // Position
  let p = momentum; // Momentum
  const k = 0.5; // "Spring constant" (mean reversion strength)
  const paths = [];

  for (let i = 0; i < steps; i++) {
    // Leapfrog integrator (Symplectic)
    // Normalize spring constant relative to price scale to avoid explosions
    const priceScale = Math.max(Math.abs(price), 1e-9);
    const normalizedK = k / priceScale;

    p = p - normalizedK * q * (dt / 2);
    q = q + p * dt;
    p = p - normalizedK * q * (dt / 2);
    paths.push(q);
  }

  return paths;
}

/**
 * Judge 3 — Enhanced Z-Score Candle Significance
 * Fixes:
 * 1. Continuous scoring (no cliff edges)
 * 2. Directional output (bullish vs bearish significance)
 * 3. Full candle analysis (body + wicks)
 * 4. Absolute floor (relative significance needs a minimum absolute size)
 * 5. Composite signal type detection (pin bar, engulfing, doji)
 */
export function calculateZScoreSignificance(
  candles: { open: number; close: number; high?: number; low?: number }[]
) {
  if (candles.length < 3) return {
    zScore: 0, points: -1.0,
    direction: 'NEUTRAL', signalType: 'INSUFFICIENT_DATA',
    bullPoints: -0.5, bearPoints: -0.5
  };

  const lookback = Math.min(candles.length, 21);
  const history = candles.slice(-lookback, -1);
  const current = candles[candles.length - 1];

  // ── 1. FULL CANDLE METRICS (not just body) ─────────────────────────────
  // Total range = high - low (the full candle, including wicks)
  // Body = |close - open|
  // Upper wick = high - max(open, close)
  // Lower wick = min(open, close) - low

  const getMetrics = (c: typeof current) => {
    const body = Math.abs(c.close - c.open);
    const high = c.high ?? Math.max(c.open, c.close);
    const low = c.low ?? Math.min(c.open, c.close);
    const totalRange = Math.max(high - low, body); // at minimum equals body
    const upperWick = high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - low;
    const bodyRatio = totalRange > 0 ? body / totalRange : 1; // 0=all wick, 1=all body
    return { body, totalRange, upperWick, lowerWick, bodyRatio };
  };

  const histMetrics = history.map(getMetrics);
  const currMetrics = getMetrics(current);

  // ── 2. Z-SCORE ON TOTAL RANGE (not just body) ──────────────────────────
  // Total range captures the full energy of the candle including wicks
  const historicalRanges = histMetrics.map(m => m.totalRange);
  const mean = historicalRanges.reduce((a, b) => a + b, 0) / historicalRanges.length;
  const variance = historicalRanges.length > 1
    ? historicalRanges.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (historicalRanges.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const zScore = stdDev === 0 ? 0 : (currMetrics.totalRange - mean) / stdDev;

  // ── 3. ABSOLUTE SIZE FLOOR ──────────────────────────────────────────────
  // Prevent a micro-move from scoring high just because everything else was flat.
  // If the current candle's range is less than 0.1% of the mean close price,
  // it's not meaningful regardless of relative z-score.
  const avgClose = history.reduce((a, c) => a + c.close, 0) / history.length;
  const absoluteFloor = avgClose * 0.001; // 0.1% of price
  const absolutelySignificant = currMetrics.totalRange > absoluteFloor;

  // ── 4. SIGNAL TYPE DETECTION ────────────────────────────────────────────
  // Classify the current candle pattern — determines direction of significance
  const isBullishBody = current.close > current.open;
  const isBearishBody = current.close < current.open;

  // Pin bar: body < 30% of range AND wick in one direction > 50% of range
  const isPinBarBull = currMetrics.bodyRatio < 0.3 && currMetrics.lowerWick > (currMetrics.totalRange * 0.5);
  const isPinBarBear = currMetrics.bodyRatio < 0.3 && currMetrics.upperWick > (currMetrics.totalRange * 0.5);

  // Doji: body < 10% of range → indecision, weakens both sides
  const isDoji = currMetrics.bodyRatio < 0.10;

  // Strong momentum candle: body > 70% of range
  const isStrongBody = currMetrics.bodyRatio > 0.70;

  type SignalType = 'BULL_MOMENTUM' | 'BEAR_MOMENTUM' | 'BULL_PINBAR' | 'BEAR_PINBAR' | 'DOJI' | 'MIXED' | 'INSUFFICIENT_DATA';
  let signalType: SignalType = 'MIXED';
  let direction: 'BULL' | 'BEAR' | 'NEUTRAL' = 'NEUTRAL';

  if (isDoji) {
    signalType = 'DOJI';
    direction = 'NEUTRAL';
  } else if (isPinBarBull) {
    signalType = 'BULL_PINBAR';
    direction = 'BULL';
  } else if (isPinBarBear) {
    signalType = 'BEAR_PINBAR';
    direction = 'BEAR';
  } else if (isStrongBody && isBullishBody) {
    signalType = 'BULL_MOMENTUM';
    direction = 'BULL';
  } else if (isStrongBody && isBearishBody) {
    signalType = 'BEAR_MOMENTUM';
    direction = 'BEAR';
  } else if (isBullishBody) {
    direction = 'BULL';
  } else if (isBearishBody) {
    direction = 'BEAR';
  }

  // ── 5. CONTINUOUS POINT SCORING ─────────────────────────────────────────
  // Replace discrete cliff-edge bands with a smooth tanh curve.
  // tanh naturally saturates near 1.0 and is smooth everywhere.
  // Scale to 0–4 range to match Judge scoring max.
  //
  //   score = 4.0 * tanh(max(0, zScore) / 2.0)
  //
  // This gives:
  //   zScore 0.0  → 0.00 pts
  //   zScore 0.5  → 0.95 pts
  //   zScore 1.0  → 1.75 pts
  //   zScore 1.5  → 2.41 pts
  //   zScore 2.0  → 2.93 pts
  //   zScore 3.0  → 3.63 pts  (never actually hits 4.0 — prevents gaming)
  const tanh = (x: number) => (Math.exp(x) - Math.exp(-x)) / (Math.exp(x) + Math.exp(-x));
  const rawScore = zScore > 0 ? 4.0 * tanh(zScore / 2.0) : 0;

  // Apply absolute floor penalty
  const absolutePenalty = absolutelySignificant ? 1.0 : 0.3;
  const baseScore = rawScore * absolutePenalty;

  // Doji gets a flat weak penalty to both sides (indecision)
  if (isDoji) {
    return {
      zScore: parseFloat(zScore.toFixed(3)),
      points: -0.5,
      bullPoints: -0.5,
      bearPoints: -0.5,
      direction: 'NEUTRAL' as const,
      signalType: 'DOJI' as SignalType,
      breakdown: { body: currMetrics.body, totalRange: currMetrics.totalRange, bodyRatio: currMetrics.bodyRatio }
    };
  }

  // Negative z-score (smaller-than-average candle) = mild penalty
  const negativeScore = zScore <= 0 ? Math.max(-1.5, zScore * 0.5) : 0;

  // ── 6. DIRECTIONAL POINT ASSIGNMENT ────────────────────────────────────
  // Winner direction gets the positive score.
  // Loser direction gets a mild negative (the significant move went against them).
  let bullPoints: number;
  let bearPoints: number;

  if (zScore <= 0) {
    bullPoints = parseFloat(Math.max(negativeScore, -0.5).toFixed(2));
    bearPoints = parseFloat(Math.max(negativeScore, -0.5).toFixed(2));
  } else if (direction === 'BULL') {
    bullPoints = parseFloat(Math.max(0.10, Math.min(4.0, baseScore)).toFixed(2));
    bearPoints = parseFloat(Math.max(-1.5, -(baseScore * 0.4)).toFixed(2)); // counter-signal penalty
  } else if (direction === 'BEAR') {
    bearPoints = parseFloat(Math.max(0.10, Math.min(4.0, baseScore)).toFixed(2));
    bullPoints = parseFloat(Math.max(-1.5, -(baseScore * 0.4)).toFixed(2));
  } else {
    bullPoints = parseFloat(Math.max(negativeScore, -0.5).toFixed(2));
    bearPoints = parseFloat(Math.max(negativeScore, -0.5).toFixed(2));
  }

  // Final guard against exactly 0.00 (replace with moderate value 0.10)
  if (bullPoints === 0) bullPoints = 0.10;
  if (bearPoints === 0) bearPoints = 0.10;

  return {
    zScore: parseFloat(zScore.toFixed(3)),
    points: direction === 'BULL' ? bullPoints : direction === 'BEAR' ? bearPoints : bullPoints,
    bullPoints,
    bearPoints,
    direction,
    signalType,
    breakdown: {
      body: parseFloat(currMetrics.body.toFixed(6)),
      totalRange: parseFloat(currMetrics.totalRange.toFixed(6)),
      bodyRatio: parseFloat(currMetrics.bodyRatio.toFixed(3)),
      upperWick: parseFloat(currMetrics.upperWick.toFixed(6)),
      lowerWick: parseFloat(currMetrics.lowerWick.toFixed(6)),
      absolutelySignificant,
    }
  };
}

/**
 * Physical Boundary Reversal Logic
 * Gives extra weight to reversals when price is at the extreme edges of the chart.
 * @param yPercent 0 (bottom of chart/lowest price) to 100 (top of chart/highest price)
 */
export function calculateBoundaryReversal(
  yPercent: number,
  ohlc?: { open: number; high: number; low: number; close: number }[]
) {
  let bullPoints = 0;
  let bearPoints = 0;
  let label = "NEUTRAL (CENTER)";

  let effectiveY = yPercent;
  let momentumMultiplier = 1.0;
  let wickMultiplier = 1.0;
  let stateDesc = "";

  if (ohlc && ohlc.length >= 3) {
    const highs = ohlc.map(c => c.high);
    const lows = ohlc.map(c => c.low);
    const maxH = Math.max(...highs);
    const minL = Math.min(...lows);
    const currentClose = ohlc[ohlc.length - 1].close;

    // 1. Zoom/Scale Independence: Combine visual Y with mathematical Stochastic Y
    if (maxH !== minL) {
      const mathY = ((currentClose - minL) / (maxH - minL)) * 100;
      effectiveY = (yPercent * 0.3) + (mathY * 0.7); // 70% weight to actual math structure
    }

    // 2. Momentum / Velocity Consideration
    const recentCandle = ohlc[ohlc.length - 1];
    const recentBody = Math.abs(recentCandle.close - recentCandle.open);
    
    let avgBody = 0;
    for (let i = 0; i < ohlc.length - 1; i++) {
      avgBody += Math.abs(ohlc[i].close - ohlc[i].open);
    }
    avgBody = avgBody / (ohlc.length - 1);

    if (avgBody > 0 && recentBody > avgBody * 2.0) {
      momentumMultiplier = 1.5; // Exhaustion spike
      stateDesc += " (Exhaustion Spike)";
    } else if (avgBody > 0 && recentBody < avgBody * 0.5) {
      momentumMultiplier = 0.5; // Slow drift has lower reversal chance
      stateDesc += " (Slow Drift)";
    }

    // 3. Wick Rejection Evidence
    const upperWick = recentCandle.high - Math.max(recentCandle.open, recentCandle.close);
    const lowerWick = Math.min(recentCandle.open, recentCandle.close) - recentCandle.low;
    
    if (effectiveY >= 70) {
      if (upperWick > recentBody * 1.5) {
        wickMultiplier = 1.5;
        stateDesc += " [Heavy Upper Rejection]";
      } else if (recentCandle.close >= recentCandle.open && upperWick <= recentBody * 0.2) {
        wickMultiplier = 0.0; // Clean close at the top implies continuation, block the reversal setup
        stateDesc += " [Clean Bullish Close -> Continuation Breakout Blocked]";
      }
    } else if (effectiveY <= 30) {
      if (lowerWick > recentBody * 1.5) {
        wickMultiplier = 1.5;
        stateDesc += " [Heavy Lower Rejection]";
      } else if (recentCandle.open >= recentCandle.close && lowerWick <= recentBody * 0.2) {
        wickMultiplier = 0.0; // Clean close at bottom implies continuation
        stateDesc += " [Clean Bearish Close -> Continuation Breakdown Blocked]";
      }
    }
  }

  if (effectiveY >= 85) {
    bearPoints = 3.0; // Price is at top, favor DOWN
    label = "EXTREME HIGH (DANGER)";
  } else if (effectiveY <= 15) {
    bullPoints = 3.0; // Price is at bottom, favor UP
    label = "EXTREME LOW (OVERSOLD)";
  } else if (effectiveY >= 75) {
    bearPoints = 2.0;
    label = "HIGH RANGE";
  } else if (effectiveY <= 25) {
    bullPoints = 2.0;
    label = "LOW RANGE";
  } else if (effectiveY >= 65) {
    bearPoints = 1.0;
    label = "MID-HIGH RANGE";
  } else if (effectiveY <= 35) {
    bullPoints = 1.0;
    label = "MID-LOW RANGE";
  }

  // Apply multipliers
  bullPoints = Math.min(bullPoints * momentumMultiplier * wickMultiplier, 3.0);
  bearPoints = Math.min(bearPoints * momentumMultiplier * wickMultiplier, 3.0);

  if (stateDesc) {
    label += stateDesc;
  }

  return { bullPoints, bearPoints, label, yPercent: effectiveY };
}

/**
 * Volatility Regime Gate
 * Measures market energy to filter out dead or explosive markets.
 */
export function calculateVolatilityRegime(candles: { high: number; low: number; close: number; prevClose: number }[], lookback = 20) {
  if (candles.length < lookback) return { status: 'INSUFFICIENT_DATA', zScore: 0 };

  const trueRanges = candles.slice(-lookback).map(c => 
    Math.max(c.high - c.low, Math.abs(c.high - c.prevClose), Math.abs(c.low - c.prevClose))
  );

  const atr = ss.mean(trueRanges);
  const atrStd = ss.standardDeviation(trueRanges);
  const currentTr = trueRanges[trueRanges.length - 1];

  const volZ = (currentTr - atr) / (atrStd || 0.0001);

  if (volZ >= -0.5 && volZ <= 1.2) return { status: 'TRADEABLE', zScore: volZ };
  if (volZ > 2.0) return { status: 'EXPLOSIVE_SKIP', zScore: volZ };
  return { status: 'DEAD_SKIP', zScore: volZ };
}

/**
 * Kolmogorov Predictability Certificate
 * Measures algorithmic structure using compression ratios.
 */
export function calculatePredictability(priceSeries: number[], threshold = 0.55) {
  if (priceSeries.length < 10) return { isPredictable: false, type: 'RANDOM', ratios: {} };

  const returns = [];
  for (let i = 1; i < priceSeries.length; i++) {
    returns.push(priceSeries[i] - priceSeries[i - 1]);
  }

  const directionSeq = returns.map(r => r > 0 ? 'U' : 'D').join('');
  
  const std = ss.standardDeviation(returns);
  const magnitudeSeq = returns.map(r => {
    const absR = Math.abs(r);
    if (absR < 0.5 * std) return 'L';
    if (absR < 1.5 * std) return 'M';
    return 'H';
  }).join('');

  const combinedSeq = returns.map((_, i) => directionSeq[i] + magnitudeSeq[i]).join('');

  const compressionRatio = (s: string) => {
    const encoded = new TextEncoder().encode(s);
    const compressed = pako.deflate(encoded);
    return compressed.length / encoded.length;
  };

  const ratios = {
    direction: compressionRatio(directionSeq),
    magnitude: compressionRatio(magnitudeSeq),
    combined: compressionRatio(combinedSeq)
  };

  const isPredictable = ratios.combined < threshold;
  let structureType = 'RANDOM';

  if (ratios.direction < 0.4 && ratios.magnitude > 0.6) structureType = 'TRENDING';
  else if (ratios.direction > 0.6 && ratios.magnitude < 0.4) structureType = 'MEAN_REVERTING';
  else if (ratios.direction < 0.4 && ratios.magnitude < 0.4) structureType = 'PATTERNED';

  return { isPredictable, structureType, ratios };
}

/**
 * Adversarial Robustness Pre-Filter
 * Tests signal stability by perturbing inputs.
 */
export function calculateRobustness(priceSeries: number[], nPerturbations = 20) {
  const classify = (series: number[]) => {
    const returns = [];
    for (let i = 1; i < series.length; i++) returns.push(series[i] - series[i-1]);
    const upCount = returns.filter(r => r > 0).length;
    return upCount > returns.length / 2 ? 'BULL' : 'BEAR';
  };

  const originalRegime = classify(priceSeries);
  const range = Math.max(...priceSeries) - Math.min(...priceSeries);
  const noiseScale = 0.001 * range;

  let flipCount = 0;
  for (let i = 0; i < nPerturbations; i++) {
    const perturbed = priceSeries.map(p => p + (Math.random() * 2 - 1) * noiseScale);
    if (classify(perturbed) !== originalRegime) flipCount++;
  }

  const robustness = 1 - (flipCount / nPerturbations);
  return { robustness, isStable: robustness >= 0.85 };
}

/**
 * Causal Entropic Force (CEF)
 * Predicts direction based on maximizing future path entropy (liquidity access).
 */
export function calculateCEF(priceSeries: number[], liquidityMap: Record<number, number>, nFutures = 500, timeHorizon = 10) {
  const currentPrice = priceSeries[priceSeries.length - 1];
  const returns = [];
  for (let i = 1; i < priceSeries.length; i++) {
    returns.push(priceSeries[i] - priceSeries[i - 1]);
  }
  const vol = ss.standardDeviation(returns);

  const directions = { UP: 1, DOWN: -1 };
  const futureEntropy: Record<string, number> = {};

  for (const [dir, sign] of Object.entries(directions)) {
    const pathEntropies = [];

    for (let i = 0; i < nFutures; i++) {
      const futurePrices = [currentPrice + sign * vol];
      for (let t = 0; t < timeHorizon; t++) {
        // Box-Muller transform for normal distribution
        const u1 = Math.random();
        const u2 = Math.random();
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const nextPrice = futurePrices[futurePrices.length - 1] + z0 * vol;
        futurePrices.push(nextPrice);
      }

      const zonesVisited = new Set<number>();
      for (const p of futurePrices) {
        // Find nearest liquidity zone
        const keys = Object.keys(liquidityMap).map(Number);
        if (keys.length === 0) continue; // Skip if no liquidity zones exist
        
        const nearestZone = keys.reduce((prev, curr) => Math.abs(curr - p) < Math.abs(prev - p) ? curr : prev);
        zonesVisited.add(nearestZone);
      }

      const weights = Array.from(zonesVisited).map(z => liquidityMap[z]);
      const sum = weights.reduce((a, b) => a + b, 0);
      const normalizedWeights = weights.map(w => w / sum);
      
      // Shannon Entropy
      const ent = -normalizedWeights.reduce((acc, w) => acc + (w > 0 ? w * Math.log2(w) : 0), 0);
      pathEntropies.push(ent);
    }

    futureEntropy[dir] = ss.mean(pathEntropies);
  }

  let predictedDirection: 'UP' | 'DOWN' | 'NEUTRAL' = futureEntropy.UP > futureEntropy.DOWN ? 'UP' : 'DOWN';
  const confidence = Math.max(futureEntropy.UP, futureEntropy.DOWN, 0.0001) === 0.0001 ? 0 : 
                     Math.abs(futureEntropy.UP - futureEntropy.DOWN) / Math.max(futureEntropy.UP, futureEntropy.DOWN, 0.0001);

  if (confidence < 0.05 || (futureEntropy.UP === 0 && futureEntropy.DOWN === 0)) {
    predictedDirection = 'NEUTRAL';
  }

  return { predictedDirection, confidence, futureEntropy };
}

/**
 * Transfer Entropy (TE)
 * Measures causal information flow from source to target.
 */
export function calculateTransferEntropy(source: number[], target: number[], k = 3, l = 1) {
  // Simplified discrete TE implementation using sliding windows to capture k lags
  const lag = Math.max(k, l);
  const n = target.length - lag;
  if (n <= 0) return 0;

  const getSymbol = (series: number[], i: number) => series[i] > series[i - 1] ? 1 : 0;

  const jointMap = new Map<string, number>();
  const targetPastMap = new Map<string, number>();
  const fullMap = new Map<string, number>();
  const pastSourceMap = new Map<string, number>();

  for (let i = lag; i < target.length; i++) {
    const tNext = getSymbol(target, i).toString();
    
    // Capture k past states of target
    let tPast = '';
    for (let j = 1; j <= k; j++) {
      tPast += getSymbol(target, i - j) + ',';
    }
    
    // Capture past state of source
    const sPast = getSymbol(source, i - 1).toString();

    const jointKey = `${tNext}|${tPast}`;
    const targetPastKey = `${tPast}`;
    const fullKey = `${tNext}|${tPast}|${sPast}`;
    const pastSourceKey = `${tPast}|${sPast}`;

    jointMap.set(jointKey, (jointMap.get(jointKey) || 0) + 1);
    targetPastMap.set(targetPastKey, (targetPastMap.get(targetPastKey) || 0) + 1);
    fullMap.set(fullKey, (fullMap.get(fullKey) || 0) + 1);
    pastSourceMap.set(pastSourceKey, (pastSourceMap.get(pastSourceKey) || 0) + 1);
  }

  let te = 0;
  const total = target.length - lag;

  for (const [fullKey, fullCount] of fullMap.entries()) {
    // split with limit to not split the commas inside tPast
    const parts = fullKey.split('|');
    const tNext = parts[0];
    const tPast = parts[1];
    const sPast = parts[2];
    
    const pFull = fullCount / total;
    
    const jointCount = jointMap.get(`${tNext}|${tPast}`) || 0;
    const targetPastCount = targetPastMap.get(`${tPast}`) || 0;
    const pastSourceCount = pastSourceMap.get(`${tPast}|${sPast}`) || 0;

    const pNextCondFull = fullCount / (pastSourceCount || 1);
    const pNextCondTarget = jointCount / (targetPastCount || 1);

    if (pNextCondFull > 0 && pNextCondTarget > 0) {
      te += pFull * Math.log2(pNextCondFull / pNextCondTarget);
    }
  }

  return Math.max(0, te);
}

/**
 * Optimal Stopping Entry
 * Calibrates entry timing based on historical decay.
 */
export class OptimalStoppingEntry {
  private delayMetrics: Record<number, { winRate: number; avgSlippage: number; ev: number }> = {};

  constructor(historicalEntries: any[]) {
    this.calibrate(historicalEntries);
  }

  private calibrate(entries: any[]) {
    const delays = [0, 1, 2, 3, 4, 5, 6, 7];
    delays.forEach(d => {
      const group = entries.filter(e => e.entryDelayCandles === d);
      if (group.length < 5) {
        // Default fallback if not enough data
        this.delayMetrics[d] = { winRate: 0.5, avgSlippage: 0, ev: 0.5 * 0.85 };
        return;
      }

      const winRate = ss.mean(group.map(e => e.outcome === 'WIN' ? 1 : 0));
      const avgSlippage = ss.mean(group.map(e => Math.abs(e.entryPrice - e.signalPrice)));
      // Normalize slippage against the entry price to be a dimensionless ratio, like winRate
      const avgPrice = ss.mean(group.map(e => e.entryPrice));
      const normalizedSlippage = avgPrice > 0 ? avgSlippage / avgPrice : 0;
      
      this.delayMetrics[d] = {
        winRate,
        avgSlippage,
        ev: winRate * 0.85 - normalizedSlippage
      };
    });
  }

  getDecision(candlesElapsed: number): { action: 'ENTER' | 'WAIT' | 'EXPIRED'; ev: number } {
    if (candlesElapsed > 7) return { action: 'EXPIRED', ev: 0 };
    
    const currentEv = this.delayMetrics[candlesElapsed]?.ev || 0;
    
    // Look ahead
    let bestFutureEv = -Infinity;
    for (let d = candlesElapsed + 1; d <= 7; d++) {
      if (this.delayMetrics[d]) {
        bestFutureEv = Math.max(bestFutureEv, this.delayMetrics[d].ev);
      }
    }

    const signalSurvivalProb = Math.exp(-0.15 * candlesElapsed);
    const discountedFutureEv = bestFutureEv * signalSurvivalProb;

    if (currentEv >= discountedFutureEv || candlesElapsed === 7) {
      return { action: 'ENTER', ev: currentEv };
    }

    return { action: 'WAIT', ev: currentEv };
  }
}
