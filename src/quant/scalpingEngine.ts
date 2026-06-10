import { 
  ScalpSignal, ScalpingPlan, SLMode, TPMode, ScalpInstrument, 
  ScalpFeatures, RiskState, ScalpConfig, TradeAnalysis, AntiHallucinationCheck
} from '../types';
import { NumericOHLC } from '../vision/pipeline';
import { SwingPivot } from './marketStructure';
import { checkRiskCaps } from './riskGuard';
import { computeRoundTripCharges } from './brokerCharges';
import { buildScalpFeatures } from './scalpFeatures';

export interface ScalpContext {
  config: ScalpConfig;
  riskState: RiskState;
  pivots: SwingPivot[];
  atr14: number[];
  vwapProxy: number[];
  nowMsEpoch: number;
  nowISTMinutesSinceMidnight: number;
  currentBarIndex: number;
}

export interface ScalpDecision {
  signal: ScalpSignal;
  confluenceScore: number;
  plan?: ScalpingPlan;
  blockers: string[];
  features: ScalpFeatures;
  rawWinner: 'BULL' | 'BEAR' | 'NO_TRADE';
}

export function findRecentSwingLow(pivots: SwingPivot[], currentBarIndex: number): number | undefined {
  // Sort descending to find closest lookback pivot
  const sorted = [...pivots].sort((a, b) => b.index - a.index);
  for (const pivot of sorted) {
    if (pivot.kind === 'LOW' && pivot.index < currentBarIndex) {
      return pivot.price;
    }
  }
  return undefined;
}

export function calculateStopLoss(entry: number, mode: SLMode, ctx: ScalpContext): number {
  const atrMultiplierSL = ctx.config.atrMultiplierSL ?? 1.5;
  const atr14 = ctx.atr14[ctx.atr14.length - 1] || entry * 0.01;
  const slPercent = ctx.config.slPercent ?? 0.5;

  let sl: number;

  if (mode === 'PERCENT') {
    sl = entry - (entry * slPercent / 100);
    // Floor: sl must never be more than 1.5% below entry for PERCENT mode
    sl = Math.max(sl, entry * 0.985);
  } else if (mode === 'ATR') {
    sl = entry - atrMultiplierSL * atr14;
  } else if (mode === 'STRUCTURE') {
    const swing = findRecentSwingLow(ctx.pivots, ctx.currentBarIndex);
    const limit = 2 * atrMultiplierSL * atr14;
    if (swing !== undefined) {
      if (entry - swing <= limit) {
        sl = swing - 0.3 * atr14;
      } else {
        sl = entry - atrMultiplierSL * atr14;
      }
    } else {
      sl = entry - atrMultiplierSL * atr14;
    }
  } else {
    // AUTO mode
    const swing = findRecentSwingLow(ctx.pivots, ctx.currentBarIndex);
    const limit = 2 * atrMultiplierSL * atr14;
    if (swing !== undefined) {
      if (entry - swing <= limit) {
        sl = swing - 0.3 * atr14;
      } else {
        sl = entry - atrMultiplierSL * atr14;
      }
    } else {
      sl = entry - 0.3 * atr14;
    }
  }

  return sl;
}

export function buildExitPlan(entry: number, sl: number, ctx: ScalpContext) {
  const risk = entry - sl;
  if (risk <= 0) throw new Error('Invalid SL');
  const tp1RMultiple = ctx.config.tp1RMultiple ?? 1.0;
  const rrRatio = ctx.config.rrRatio ?? 2.0;
  const tp1 = entry + risk * tp1RMultiple;
  const tp2 = entry + risk * rrRatio;
  const trailMultiplier = ctx.config.trailMultiplier ?? 1.5;
  const atr14 = ctx.atr14[ctx.atr14.length - 1] || entry * 0.01;
  const trailingDistance = atr14 * trailMultiplier;

  return {
    tp1,
    tp2,
    trailingActivate: tp1,
    trailingDistance,
    breakEvenAfter: tp1,
    rr: rrRatio,
  };
}

export function calculateConfluence(f: ScalpFeatures): number {
  let s = 0;
  
  // Tier 1 triggers (max 6, but cap index at 4)
  let t1 = 0;
  if (f.bullEngulfingAtSupport) t1 += 2;
  if (f.hammerAtSupport)        t1 += 2;
  if (f.macdBullishDivergence)  t1 += 2;
  s += Math.min(t1, 4); // tier-1 cap

  // Tier 2 trend (max 4)
  let t2 = 0;
  if (f.ema9_above_ema21) t2 += 1;
  if (f.ema9_slope_up)    t2 += 1;
  if (f.adx_above_20 && f.plusDI_dominant) t2 += 1;
  if (f.bos_bull || f.choch_bull) t2 += 1;
  s += Math.min(t2, 4);

  // Tier 3 quality (max 3)
  let t3 = 0;
  if (f.rsi_recovering_from_oversold) t3 += 1;
  if (f.volatility_normal)            t3 += 1;
  if (f.price_above_vwap)             t3 += 1;
  s += Math.min(t3, 3);

  // Penalties
  if (f.bear_engulfing_recent)              s -= 3;
  if (f.adx_above_25 && f.minusDI_dominant) s -= 2;

  return Math.max(0, Math.min(10, s));
}

export function evaluateScalpSignal(
  ohlc: NumericOHLC[],
  legacyDecision: { winner: 'BULL' | 'BEAR' | 'NO_TRADE' },
  ctx: ScalpContext,
  isForced: boolean = false
): ScalpDecision {
  const rawWinner = isForced ? 'BULL' : legacyDecision.winner;
  const lastBar = ohlc[ohlc.length - 1];
  const entry = lastBar ? lastBar.close : 0;
  
  // LAYER 1 & 2 - Filters & Long-Only Constraints
  const features = buildScalpFeatures(ohlc, ctx.pivots, ctx.atr14, ctx.vwapProxy, ctx.nowMsEpoch);
  const confluenceScore = calculateConfluence(features);
  
  if (rawWinner === 'BEAR') {
    return { signal: 'NO_TRADE', confluenceScore, blockers: ['BEARS_DOMINANT'], features, rawWinner };
  }
  if (rawWinner === 'NO_TRADE') {
    return { signal: 'NO_TRADE', confluenceScore, blockers: ['NO_EDGE'], features, rawWinner };
  }

  // LAYER 3 - Plan formulation
  const blockers: string[] = [];

  if (!isForced && confluenceScore < ctx.config.minConfluence) {
    blockers.push('LOW_CONFLUENCE');
    return { signal: 'WAIT', confluenceScore, blockers, features, rawWinner };
  }
  
  const atrVal = ctx.atr14[ctx.atr14.length - 1];
  if (!atrVal || atrVal <= 0) {
    blockers.push('INVALID_ATR');
    return { signal: 'WAIT', confluenceScore, blockers, features, rawWinner };
  }

  const sl = calculateStopLoss(entry, ctx.config.slMode, ctx);
  const riskPerShare = entry - sl;
  if (riskPerShare <= 0) {
    blockers.push('INVALID_SL');
    return { signal: 'WAIT', confluenceScore, blockers, features, rawWinner };
  }

  // Position Sizing
  const investmentAmount = ctx.config.investmentPerTrade ?? 10000;
  const lotSize = ctx.config.lotSize ?? 1;
  let sizeShares = 0;

  if (lotSize === 1) {
    // Standard equity stocks: allow fractional shares down to 2 decimal places (such as 0.5 shares)
    sizeShares = Math.floor((investmentAmount / entry) * 100) / 100;
  } else {
    // Non-equity options/futures: keep standard lot size multiples
    sizeShares = Math.floor(investmentAmount / entry / lotSize) * lotSize;
  }

  if (sizeShares <= 0 && !isForced) {
    blockers.push(`INSUFFICIENT_INVESTMENT: Allocated per trade (₹${investmentAmount}) results in 0 shares. (Stock price: ₹${entry.toFixed(2)})`);
    return { signal: 'WAIT', confluenceScore, blockers, features, rawWinner };
  }

  if (sizeShares <= 0) {
    sizeShares = lotSize === 1 ? 0.5 : lotSize;
  }

  // Exit Targets
  const exits = buildExitPlan(entry, sl, ctx);
  const rrRatio = (exits.tp2 - entry) / riskPerShare;

  // Min R:R verification
  if (!isForced && rrRatio < ctx.config.minRR) {
    blockers.push(`RR_TOO_LOW: Target R:R ${rrRatio.toFixed(2)} < Minimum ${ctx.config.minRR.toFixed(2)}`);
    return { signal: 'WAIT', confluenceScore, blockers, features, rawWinner };
  }

  // Predictability Gate
  if (!isForced && ctx.config.enablePredictabilityGate && !features.predictabilityPassed) {
    blockers.push('PREDICTABILITY_FAILED');
    return { signal: 'WAIT', confluenceScore, blockers, features, rawWinner };
  }

  // Market Hours Gate
  if (!isForced && ctx.config.enableMarketHoursGate && !features.withinMarketHours) {
    blockers.push('OUTSIDE_MARKET_HOURS');
    return { signal: 'NO_TRADE', confluenceScore, blockers, features, rawWinner };
  }

  // Risk Caps Verification
  const riskCaps = checkRiskCaps(ctx.riskState, ctx.config.risk, ctx.nowMsEpoch);
  if (!isForced && !riskCaps.allow) {
    blockers.push(riskCaps.reason || 'RISK_CAPS_EXCEEDED');
    return { signal: 'NO_TRADE', confluenceScore, blockers, features, rawWinner };
  }

  // Broker Charges check
  const chargesBreakdown = computeRoundTripCharges(entry, exits.tp2, sizeShares, ctx.config.instrument);
  const potentialRewardRupees = (exits.tp2 - entry) * sizeShares;
  const netExpectedPnL = potentialRewardRupees - chargesBreakdown.total;

  if (!isForced && netExpectedPnL <= 0) {
    blockers.push('CHARGES_EAT_EDGE');
    return { signal: 'WAIT', confluenceScore, blockers, features, rawWinner };
  }

  const plan: ScalpingPlan = {
    entry,
    stopLoss: sl,
    takeProfit1: exits.tp1,
    takeProfit2: exits.tp2,
    trailingActivate: exits.trailingActivate,
    trailingDistance: exits.trailingDistance,
    breakEvenAfter: exits.breakEvenAfter,
    positionSize: sizeShares,
    riskRupees: riskPerShare * sizeShares,
    potentialRewardRupees,
    rrRatio,
    maxHoldingMinutes: ctx.config.maxHoldingMinutes,
    confluenceScore,
    brokerCharges: chargesBreakdown.total,
    netExpectedPnL,
    slMode: ctx.config.slMode,
    tpMode: ctx.config.tpMode,
    instrument: ctx.config.instrument,
    noteReasons: blockers,
    investmentRupees: sizeShares * entry,
  };

  const antiHallc = runAntiHallucinationFilter(ohlc, plan, ctx);
  plan.antiHallucination = antiHallc;

  if (!isForced && !antiHallc.passed) {
    blockers.push('HALLUCINATION_DETECTED');
    antiHallc.reasons.forEach(r => blockers.push(`HALLUC_CHECK: ${r}`));
    return {
      signal: 'WAIT',
      confluenceScore,
      plan,
      blockers,
      features,
      rawWinner
    };
  }

  return {
    signal: 'BUY',
    confluenceScore,
    plan,
    blockers,
    features,
    rawWinner
  };
}

import { ScalpConfig } from '../types';

export function getDefaultScalpConfig(): ScalpConfig {
  return {
    capitalRupees: 100000,
    riskPerTradePct: 1.0,
    maxPositionPctCapital: 30,
    leverage: 1,
    instrument: 'EQUITY_INTRADAY',
    lotSize: 1,
    investmentPerTrade: 10000,
    rrRatioChoice: 2,
    useConfidenceThreshold: true,
    maxConcurrentTrades: 1,
    slMode: 'AUTO',
    atrMultiplierSL: 1.2,
    slPercent: 0.4,
    tpMode: 'PARTIAL_RR',
    rrRatio: 2.0,
    tp1RMultiple: 1.0,
    trailMultiplier: 1.5,
    minConfluence: 5,
    minRR: 1.5,
    longOnly: true,
    enableMarketHoursGate: false,
    enablePredictabilityGate: true,
    risk: {
      dailyLossCapRupees: 2000,
      maxTradesPerDay: 5,
      maxConsecutiveLosses: 3,
      cooldownMinutes: 10,
      slippageTicks: 1,
    },
    maxHoldingMinutes: 5,
  };
}

export function loadScalpConfig(): ScalpConfig {
  if (typeof window === 'undefined') return getDefaultScalpConfig();
  try {
    const raw = localStorage.getItem('chartlens_scalp_config_v1');
    if (!raw) return getDefaultScalpConfig();
    return JSON.parse(raw);
  } catch {
    return getDefaultScalpConfig();
  }
}

export function runAntiHallucinationFilter(
  ohlc: NumericOHLC[],
  plan: ScalpingPlan,
  ctx: ScalpContext
): AntiHallucinationCheck {
  const checks = {
    priceOrdering: false,
    candleConsistency: false,
    entryMatching: false,
    nonZeroIndicators: false,
    pivotsMatchData: false,
    mathCongruence: false,
  };
  const reasons: string[] = [];

  // Check 1 — Price Ordering: TP2 > TP1 > Entry > SL (strict long check)
  const orderCorrect = plan.takeProfit2 > plan.takeProfit1 && plan.takeProfit1 > plan.entry && plan.entry > plan.stopLoss;
  const valuesPositive = plan.entry > 0 && plan.stopLoss > 0 && plan.takeProfit1 > 0 && plan.takeProfit2 > 0;
  checks.priceOrdering = orderCorrect && valuesPositive;
  if (!orderCorrect) reasons.push('Invalid price boundary structure: TP2 > TP1 > Entry > SL violated.');
  if (!valuesPositive) reasons.push('Zero or negative trade plan boundaries detected.');

  // Check 2 — Candle Consistency: high >= low, high >= open, high >= close, open, high, low, close > 0
  let candleError = false;
  for (let i = 0; i < ohlc.length; i++) {
    const c = ohlc[i];
    if (c.high < c.low || c.high < c.open || c.high < c.close || c.low > c.open || c.low > c.close || c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
      candleError = true;
      break;
    }
  }
  checks.candleConsistency = !candleError;
  if (candleError) reasons.push('Detected inconsistent or glitched OHLCV values in historical buffer.');

  // Check 3 — Entry Matching: entry matches lastBar.close perfectly
  const lastBar = ohlc[ohlc.length - 1];
  const entryMatch = lastBar ? Math.abs(plan.entry - lastBar.close) < 0.001 : false;
  checks.entryMatching = entryMatch;
  if (!entryMatch) reasons.push('Trade entry price does not align with the most recent closing price.');

  // Check 4 — Non-zero indicators
  const currentAtr = ctx.atr14[ctx.atr14.length - 1];
  const indicatorsValid = currentAtr != null && currentAtr > 0;
  checks.nonZeroIndicators = indicatorsValid;
  if (!indicatorsValid) reasons.push('Technical indicator ATR14 is zero, invalid or missing.');

  // Check 5 — Swing Pivots match data high/low
  let pivotsConsistent = true;
  if (ohlc.length >= 10) {
    for (const p of ctx.pivots) {
      if (p.index < 0 || p.index >= ohlc.length) {
        pivotsConsistent = false;
        break;
      }
      const bar = ohlc[p.index];
      if (p.kind === 'HIGH' && Math.abs(p.price - bar.high) > 0.01) {
        pivotsConsistent = false;
      }
      if (p.kind === 'LOW' && Math.abs(p.price - bar.low) > 0.01) {
        pivotsConsistent = false;
      }
    }
  }
  checks.pivotsMatchData = pivotsConsistent;
  if (!pivotsConsistent) reasons.push('Identified divergent swing pivots that do not align mathematically with candle highs/lows.');

  // Check 6 — Math Congruence: reward calculation consistency
  const rewardMatch = Math.abs(plan.potentialRewardRupees - (plan.takeProfit2 - plan.entry) * plan.positionSize) < 0.01;
  const riskMatch = Math.abs(plan.riskRupees - (plan.entry - plan.stopLoss) * plan.positionSize) < 0.01;
  checks.mathCongruence = rewardMatch && riskMatch;
  if (!rewardMatch || !riskMatch) reasons.push('Internal mathematical discrepancy found in risk-reward calculations.');

  // Calculate verityScore
  const checksPassed = Object.values(checks).filter(Boolean).length;
  const verityScore = Math.round((checksPassed / 6) * 100);
  const passed = checksPassed === 6;

  return {
    passed,
    verityScore,
    checks,
    reasons,
  };
}

