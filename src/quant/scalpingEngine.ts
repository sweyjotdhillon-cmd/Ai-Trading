import { 
  ScalpSignal, ScalpingPlan, SLMode, TPMode, ScalpInstrument, 
  ScalpFeatures, RiskState, ScalpConfig, TradeAnalysis, AntiHallucinationCheck
} from '../types';
import { NumericOHLC } from '../vision/pipeline';
import { SwingPivot } from './marketStructure';
import { checkRiskCaps } from './riskGuard';
import { computeRoundTripCharges } from './brokerCharges';
import { buildScalpFeatures } from './scalpFeatures';
import { getDefaultScalpConfig, loadScalpConfig } from '../config/scalpConfig';

export interface ScalpContext {
  config: ScalpConfig;
  riskState: RiskState;
  pivots: SwingPivot[];
  atr14: number[];
  vwapProxy: number[];
  nowMsEpoch: number;
  nowISTMinutesSinceMidnight: number;
  currentBarIndex: number;
  currentPrice?: number;
  indicatorCache?: any;
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
  let atr14 = ctx.atr14[ctx.atr14.length - 1] || entry * 0.01;
  if (isNaN(atr14) || atr14 <= 0) atr14 = entry * 0.01;

  const slPercent = ctx.config.slPercent ?? 0.5;

  let sl: number;

  if (mode === 'PERCENT') {
    sl = entry - (entry * slPercent / 100);
    sl = Math.max(sl, entry * 0.985);
  } else if (mode === 'ATR') {
    sl = entry - atrMultiplierSL * atr14;
  } else if (mode === 'STRUCTURE') {
    const swing = findRecentSwingLow(ctx.pivots, ctx.currentBarIndex);
    const limit = 2 * atrMultiplierSL * atr14;
    if (swing !== undefined && swing < entry) {
      if (Math.abs(entry - swing) <= limit) {
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
    if (swing !== undefined && swing < entry && Math.abs(entry - swing) <= limit) {
      sl = swing - 0.3 * atr14;
    } else {
      sl = entry - atrMultiplierSL * atr14;
    }
    const percentFloor = entry * (1 - slPercent / 100);
    if (sl < percentFloor) {
      sl = percentFloor;
    }
  }

  // Enforce an absolute minimum SL distance to prevent immediate trigger due to tick noise or spread
  const minSlDistance = entry * 0.002; // minimum 0.2% away
  if (entry - sl < minSlDistance) {
    sl = entry - minSlDistance;
  }

  return sl;
}

export function buildExitPlan(entry: number, sl: number, ctx: ScalpContext) {
  const risk = entry - sl;
  if (risk <= 0) return null;
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
  
  // Tier 1 triggers (uncapped now)
  let t1 = 0;
  if (f.bullEngulfingAtSupport) t1 += 2;
  if (f.hammerAtSupport)        t1 += 2;
  if (f.macdBullishDivergence)  t1 += 2;
  s += t1;

  // Tier 2 trend (max 4)
  let t2 = 0;
  if (f.ema9_above_ema21) t2 += 1;
  if (f.ema9_slope_up)    t2 += 1;
  if (f.adx_above_20 && f.plusDI_dominant) t2 += 1;
  if (f.bos_bull || f.choch_bull) t2 += 1;
  s += Math.min(t2, 4);

  // Tier 3 quality (max 4)
  let t3 = 0;
  if (f.rsi_recovering_from_oversold) t3 += 1;
  if (f.volatility_normal)            t3 += 1;
  if (f.price_above_vwap)             t3 += 1;
  if (f.timeOfDayQuality === 'OPTIMAL') t3 += 1;
  s += Math.min(t3, 4);

  // Penalties
  if (f.bear_engulfing_recent)              s -= 3;
  if (f.adx_above_25 && f.minusDI_dominant) s -= 2;
  if (f.timeOfDayQuality === 'AVOID')       s -= 2;

  return Math.max(0, Math.min(10, s));
}

export function filterScalpSignal(
  ohlc: NumericOHLC[],
  legacyDecision: { winner: 'BULL' | 'BEAR' | 'NO_TRADE' },
  ctx: ScalpContext,
  isForced: boolean,
  confluenceScore: number,
  features: ScalpFeatures,
  preCheckedRiskVerdict?: import('./riskGuard').RiskVerdict
): { passed: boolean; signal?: 'NO_TRADE'|'WAIT'; blockers: string[] } {
  const blockers: string[] = [];
  const rawWinner = isForced ? 'BULL' : legacyDecision.winner;

  if (rawWinner === 'BEAR') {
    blockers.push('BEARS_DOMINANT');
    return { passed: false, signal: 'NO_TRADE', blockers };
  }
  if (rawWinner === 'NO_TRADE') {
    blockers.push('NO_EDGE');
    return { passed: false, signal: 'NO_TRADE', blockers };
  }

  if (!isForced && confluenceScore < ctx.config.minConfluence) {
    blockers.push('LOW_CONFLUENCE');
    return { passed: false, signal: 'WAIT', blockers };
  }
  
  const atrVal = ctx.atr14[ctx.atr14.length - 1];
  if (!atrVal || atrVal <= 0 || isNaN(atrVal)) {
    blockers.push('INVALID_ATR');
    return { passed: false, signal: 'WAIT', blockers };
  }

  if (!isForced && ctx.config.enablePredictabilityGate && !features.predictabilityPassed) {
    blockers.push('PREDICTABILITY_FAILED');
    return { passed: false, signal: 'WAIT', blockers };
  }

  if (!isForced && ctx.config.enableMarketHoursGate && !features.withinMarketHours) {
    blockers.push('OUTSIDE_MARKET_HOURS');
    return { passed: false, signal: 'NO_TRADE', blockers };
  }

  const riskCaps = preCheckedRiskVerdict ?? checkRiskCaps(ctx.riskState, ctx.config.risk, ctx.nowMsEpoch, ctx.config.capitalRupees);
  if (!isForced && !riskCaps.allow) {
    blockers.push(riskCaps.reason || 'RISK_CAPS_EXCEEDED');
    return { passed: false, signal: 'NO_TRADE', blockers };
  }

  return { passed: true, blockers };
}

export function buildScalpPlan(
  entry: number,
  sl: number,
  exits: { tp1: number, tp2: number, trailingActivate: number, trailingDistance: number, breakEvenAfter: number },
  sizeShares: number,
  confluenceScore: number,
  ctx: ScalpContext,
  chargesAtTP1: any,
  chargesAtTP2: any,
  features: ScalpFeatures,
  slippageAdjusted: any,
  confluenceScaleFactor: number,
  blockers: string[]
): ScalpingPlan {
  const riskPerShare = entry - sl;
  const potentialRewardRupees = (exits.tp2 - entry) * sizeShares;
  const rrRatio = (exits.tp2 - entry) / riskPerShare;
  const netExpectedPnL = potentialRewardRupees - chargesAtTP2.total;

  return {
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
    brokerCharges: chargesAtTP2.total,
    brokerChargesConservative: chargesAtTP1.total,
    netExpectedPnL,
    slMode: ctx.config.slMode,
    tpMode: ctx.config.tpMode,
    instrument: ctx.config.instrument,
    noteReasons: blockers,
    investmentRupees: sizeShares * entry,
    confluenceScaleFactor,
    ...slippageAdjusted
  } as any; // Type-cast because of our new fields (slippageAdjusted/confluenceScaleFactor) not in type optionally yet. We'll update the type via another file edit if needed, or JS will just accept it.
}

export function validateScalpPlan(
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

  const orderCorrect = plan.takeProfit2 > plan.takeProfit1 && plan.takeProfit1 > plan.entry && plan.entry > plan.stopLoss;
  const valuesPositive = plan.entry > 0 && plan.stopLoss > 0 && plan.takeProfit1 > 0 && plan.takeProfit2 > 0;
  checks.priceOrdering = orderCorrect && valuesPositive;
  if (!orderCorrect) reasons.push('Invalid price boundary structure: TP2 > TP1 > Entry > SL violated.');
  if (!valuesPositive) reasons.push('Zero or negative trade plan boundaries detected.');

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

  const lastBar = ohlc[ohlc.length - 1];
  const currentAtr = ctx.atr14[ctx.atr14.length - 1] ?? 1;
  const tolerance = ctx.currentPrice ? Math.max(0.5, currentAtr * 0.5) : 0.001;
  const targetPrice = ctx.currentPrice ?? (lastBar ? lastBar.close : 0);
  const entryMatch = lastBar ? Math.abs(plan.entry - targetPrice) <= tolerance : false;
  checks.entryMatching = entryMatch;
  if (!entryMatch) reasons.push(`Trade entry price differs from last candle close by more than 0.5 ATR. Entry: ${plan.entry}, Last Close: ${targetPrice}, Tolerance: ${tolerance.toFixed(4)}`);

  const indicatorsValid = currentAtr > 0;
  checks.nonZeroIndicators = indicatorsValid;
  if (!indicatorsValid) reasons.push('Technical indicator ATR14 is zero, invalid or missing.');

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

  const validMathVals = Number.isFinite(plan.riskRupees) && Number.isFinite(plan.potentialRewardRupees);
  if (!validMathVals) reasons.push('NaN or Infinity detected in risk/reward values. ATR may have produced invalid output.');
  const rewardMatch = Math.abs(plan.potentialRewardRupees - (plan.takeProfit2 - plan.entry) * plan.positionSize) < 0.01;
  const riskMatch = Math.abs(plan.riskRupees - (plan.entry - plan.stopLoss) * plan.positionSize) < 0.01;
  checks.mathCongruence = validMathVals && rewardMatch && riskMatch;
  if (!validMathVals || !rewardMatch || !riskMatch) reasons.push('Internal mathematical discrepancy found in risk-reward calculations.');

  const checksPassed = Object.values(checks).filter(Boolean).length;
  const verityScore = Math.round((checksPassed / 6) * 100);
  const passed = checksPassed === 6;

  return { passed, verityScore, checks, reasons };
}

export function evaluateScalpSignal(
  ohlc: NumericOHLC[],
  legacyDecision: { winner: 'BULL' | 'BEAR' | 'NO_TRADE' },
  ctx: ScalpContext,
  isForced: boolean = false,
  preCheckedRiskVerdict?: import('./riskGuard').RiskVerdict
): ScalpDecision {
  const rawWinner = isForced ? 'BULL' : legacyDecision.winner;
  const lastBar = ohlc[ohlc.length - 1];
  const entry = ctx.currentPrice ?? (lastBar ? lastBar.close : 0);
  
  const features = buildScalpFeatures(ohlc, ctx.pivots, ctx.atr14, ctx.vwapProxy, ctx.nowMsEpoch, ctx.indicatorCache);
  const confluenceScore = calculateConfluence(features);
  
  const filterRes = filterScalpSignal(ohlc, legacyDecision, ctx, isForced, confluenceScore, features, preCheckedRiskVerdict);
  if (!filterRes.passed) {
    return { signal: filterRes.signal as ScalpSignal, confluenceScore, blockers: filterRes.blockers, features, rawWinner };
  }

  const sl = calculateStopLoss(entry, ctx.config.slMode, ctx);
  const riskPerShare = entry - sl;
  if (isNaN(riskPerShare)) {
    return { signal: 'WAIT', confluenceScore, blockers: filterRes.blockers.concat('INVALID_ATR_NaN'), features, rawWinner };
  }
  if (riskPerShare <= 0) {
    return { signal: 'WAIT', confluenceScore, blockers: filterRes.blockers.concat('INVALID_SL'), features, rawWinner };
  }

  // Slippage application
  const slippageTicks = ctx.config.risk.slippageTicks ?? 1;
  const tickSize = 0.05;
  const slippageRupees = slippageTicks * tickSize;

  const exits = buildExitPlan(entry, sl, ctx);
  if (!exits) {
    return { signal: 'WAIT', confluenceScore, blockers: filterRes.blockers.concat('INVALID_EXIT_PLAN'), features, rawWinner };
  }

  const effectiveEntry = entry + slippageRupees;
  const effectiveSL = sl - slippageRupees;
  const effectiveTP1 = exits.tp1 - slippageRupees;
  const effectiveTP2 = exits.tp2 - slippageRupees;

  const slippageAdjusted = {
    effectiveEntry,
    effectiveSL,
    effectiveTP1,
    effectiveTP2
  };
  
  const effectiveRiskPerShare = effectiveEntry - effectiveSL;

  // Scale position
  let scaleFactor = 1.0;
  if (confluenceScore < 5) scaleFactor = 0.50;
  else if (confluenceScore <= 6) scaleFactor = 0.75;
  else if (confluenceScore <= 8) scaleFactor = 0.90;
  
  const investmentAmount = ctx.config.investmentPerTrade ?? 10000;
  const leverage = ctx.config.leverage ?? 1;
  const scaledInvestment = investmentAmount * scaleFactor * leverage;
  const lotSize = ctx.config.lotSize ?? 1;
  let sizeShares = 0;

  if (lotSize === 1) {
    sizeShares = Math.floor(scaledInvestment / effectiveEntry);
  } else {
    sizeShares = Math.floor((scaledInvestment / effectiveEntry) / lotSize) * lotSize;
  }

  if (sizeShares <= 0 && !isForced) {
    return { signal: 'WAIT', confluenceScore, blockers: filterRes.blockers.concat(`INSUFFICIENT_INVESTMENT: Allocated per trade (₹${scaledInvestment}) results in 0 shares. (Stock price: ₹${effectiveEntry.toFixed(2)})`), features, rawWinner };
  }

  if (sizeShares <= 0) {
    sizeShares = lotSize === 1 ? 1 : lotSize;
  }

  const rrRatio = (effectiveTP2 - effectiveEntry) / effectiveRiskPerShare;
  if (!isForced && rrRatio < ctx.config.minRR) {
    return { signal: 'WAIT', confluenceScore, blockers: filterRes.blockers.concat(`RR_TOO_LOW: Target R:R ${rrRatio.toFixed(2)} < Minimum ${ctx.config.minRR.toFixed(2)}`), features, rawWinner };
  }

  const chargesAtTP1 = computeRoundTripCharges(effectiveEntry, effectiveTP1, sizeShares, ctx.config.instrument);
  const chargesAtTP2 = computeRoundTripCharges(effectiveEntry, effectiveTP2, sizeShares, ctx.config.instrument);

  const potentialRewardAtTP1 = (effectiveTP1 - effectiveEntry) * sizeShares;
  if (!isForced && (potentialRewardAtTP1 - chargesAtTP1.total) <= 0) {
    return { signal: 'WAIT', confluenceScore, blockers: filterRes.blockers.concat('CHARGES_EAT_EDGE'), features, rawWinner };
  }

  const plan = buildScalpPlan(entry, sl, exits, sizeShares, confluenceScore, ctx, chargesAtTP1, chargesAtTP2, features, slippageAdjusted, scaleFactor, filterRes.blockers);

  // Since we replaced the plan entry/exits but validation still checks original plan, that's fine.
  const antiHallc = validateScalpPlan(ohlc, plan, ctx);
  plan.antiHallucination = antiHallc;

  if (!isForced && !antiHallc.passed) {
    let bl = [...filterRes.blockers, 'HALLUCINATION_DETECTED'];
    antiHallc.reasons.forEach(r => bl.push(`HALLUC_CHECK: ${r}`));
    return { signal: 'WAIT', confluenceScore, plan, blockers: bl, features, rawWinner };
  }

  return { signal: 'BUY', confluenceScore, plan, blockers: filterRes.blockers, features, rawWinner };
}

export function shouldMoveToBreakeven(plan: ScalpingPlan, currentPrice: number): boolean {
  return currentPrice >= plan.breakEvenAfter && plan.stopLoss < plan.entry;
}

export function computeBreakevenSL(plan: ScalpingPlan, slippageTicks: number = 1, tickSize: number = 0.05): number {
  return plan.entry + slippageTicks * tickSize;
}
