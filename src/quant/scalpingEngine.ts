import { 
  ScalpSignal, ScalpingPlan, SLMode, TPMode, ScalpInstrument, 
  ScalpFeatures, RiskState, ScalpConfig, TradeAnalysis 
} from '../types';
import { NumericOHLC } from '../vision/pipeline';
import { SwingPivot } from './marketStructure';
import { checkRiskCaps } from './riskGuard';
import { computeRoundTripCharges } from './brokerCharges';
import { buildScalpFeatures } from './scalpFeatures';
import { scalpOverTradingPenalty } from './neutralityGuard';

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
  const atr14 = ctx.atr14[ctx.atr14.length - 1] || entry * 0.01;
  const swing = findRecentSwingLow(ctx.pivots, ctx.currentBarIndex);
  const structural = (swing ?? entry) - atr14 * 0.3;

  switch (mode) {
    case 'ATR':
      return entry - atr14 * ctx.config.atrMultiplierSL;
    case 'PERCENT':
      return entry * (1 - ctx.config.slPercent / 100);
    case 'STRUCTURE':
      return structural;
    case 'AUTO':
    default: {
      // Safest = tightest valid SL (highest number, but still below entry)
      const candidates = [
        entry - atr14 * ctx.config.atrMultiplierSL,
        structural,
      ].filter(v => v > 0 && v < entry);
      return candidates.length ? Math.max(...candidates) : entry - atr14 * 1.5;
    }
  }
}

export function buildExitPlan(entry: number, sl: number, ctx: ScalpContext) {
  const risk = entry - sl;
  if (risk <= 0) throw new Error('Invalid SL');
  const atr14 = ctx.atr14[ctx.atr14.length - 1] || entry * 0.01;
  const tp1 = entry + risk * ctx.config.tp1RMultiple;       // default 1R
  const tp2 = entry + risk * ctx.config.rrRatio;            // default 2R
  return {
    tp1,
    tp2,
    trailingActivate: tp1,
    trailingDistance: atr14 * ctx.config.trailMultiplier,
    breakEvenAfter: tp1,
    rr: ctx.config.rrRatio,
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
  ctx: ScalpContext
): ScalpDecision {
  const rawWinner = legacyDecision.winner;
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

  const penalty = scalpOverTradingPenalty();
  const effectiveMinConfluence = ctx.config.minConfluence + Math.round(penalty * 10);
  
  if (confluenceScore < effectiveMinConfluence) {
    return { signal: 'WAIT', confluenceScore, blockers: [`LOW_CONFLUENCE: Need ${effectiveMinConfluence} (Got ${confluenceScore})`], features, rawWinner };
  }

  // LAYER 3 - Plan formulation
  const blockers: string[] = [];
  
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
  const totalCapitalAtRisk = ctx.config.capitalRupees * (ctx.config.riskPerTradePct / 100);
  const lotSize = ctx.config.lotSize ?? 1;
  const baseSizeShares = totalCapitalAtRisk / riskPerShare;
  
  // Leverage relaxes the maxPositionAllowed cap (Section 13)
  const maxPositionAllowedRupees = ctx.config.capitalRupees * (ctx.config.maxPositionPctCapital / 100) * ctx.config.leverage;
  const maxSharesByPositionLimit = maxPositionAllowedRupees / entry;
  
  let sizeShares = Math.min(baseSizeShares, maxSharesByPositionLimit);
  sizeShares = Math.floor(sizeShares / lotSize) * lotSize;

  if (sizeShares <= 0) {
    blockers.push('POSITION_SIZE_ZERO');
    return { signal: 'WAIT', confluenceScore, blockers, features, rawWinner };
  }

  // Exit Targets
  const exits = buildExitPlan(entry, sl, ctx);
  const rrRatio = (exits.tp2 - entry) / riskPerShare;

  // Min R:R verification
  if (rrRatio < ctx.config.minRR) {
    blockers.push(`RR_TOO_LOW: Target R:R ${rrRatio.toFixed(2)} < Minimum ${ctx.config.minRR.toFixed(2)}`);
    return { signal: 'WAIT', confluenceScore, blockers, features, rawWinner };
  }

  // Predictability Gate
  if (ctx.config.enablePredictabilityGate && !features.predictabilityPassed) {
    blockers.push('PREDICTABILITY_FAILED');
    return { signal: 'WAIT', confluenceScore, blockers, features, rawWinner };
  }

  // Market Hours Gate
  if (ctx.config.enableMarketHoursGate && !features.withinMarketHours) {
    blockers.push('OUTSIDE_MARKET_HOURS');
    return { signal: 'NO_TRADE', confluenceScore, blockers, features, rawWinner };
  }

  // Risk Caps Verification
  const riskCaps = checkRiskCaps(ctx.riskState, ctx.config.risk, ctx.nowMsEpoch);
  if (!riskCaps.allow) {
    blockers.push(riskCaps.reason || 'RISK_CAPS_EXCEEDED');
    return { signal: 'NO_TRADE', confluenceScore, blockers, features, rawWinner };
  }

  // Broker Charges check
  const chargesBreakdown = computeRoundTripCharges(entry, exits.tp2, sizeShares, ctx.config.instrument);
  const potentialRewardRupees = (exits.tp2 - entry) * sizeShares;
  const netExpectedPnL = potentialRewardRupees - chargesBreakdown.total;

  if (netExpectedPnL <= 0) {
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
  };

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

