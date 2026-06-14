import { RiskState, RiskConfig } from '../types';
import { getISTDateString } from '../utils/istUtils';

const LS_KEY = 'chartlens_risk_state_v1';

export function loadRiskState(now = Date.now()): RiskState {
  if (typeof window === 'undefined') return freshState(now);
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return freshState(now);
    const s = JSON.parse(raw) as RiskState;
    const today = getISTDateString(now);
    if (s.dateKey !== today) {
      localStorage.setItem('chartlens_risk_yesterday_v1', raw);
      return freshState(now); // roll over at IST midnight
    }
    return s;
  } catch {
    return freshState(now);
  }
}

export function saveRiskState(s: RiskState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch (error) {
    console.error('Failed to save risk state', error);
  }
}

export interface RiskVerdict {
  allow: boolean;
  reason?: string;
  code?: 'DAILY_LOSS_CAP' | 'MAX_TRADES' | 'CONSECUTIVE_LOSSES' | 'COOLDOWN';
  remainingMs?: number;
}

export function checkRiskCaps(state: RiskState, cfg: RiskConfig, now = Date.now(), virtualBalance?: number): RiskVerdict {
  const effectiveCap = cfg.dailyLossCapPct !== undefined && virtualBalance !== undefined 
    ? Math.min(cfg.dailyLossCapRupees, virtualBalance * (cfg.dailyLossCapPct / 100))
    : cfg.dailyLossCapRupees;
  if (state.dailyPnL <= -Math.abs(effectiveCap)) {
    return { allow: false, code: 'DAILY_LOSS_CAP', reason: `DAILY_LOSS_CAP: ₹${(-state.dailyPnL).toFixed(0)} hit. Trading locked until tomorrow.` };
  }
  if (state.tradesToday >= cfg.maxTradesPerDay) {
    return { allow: false, code: 'MAX_TRADES', reason: `MAX_TRADES: ${cfg.maxTradesPerDay} reached. Overtrading guard active.` };
  }
  if (state.consecutiveLosses >= cfg.maxConsecutiveLosses) {
    return { allow: false, code: 'CONSECUTIVE_LOSSES', reason: `CONSECUTIVE_LOSSES: ${state.consecutiveLosses} in a row. Walk away.` };
  }
  if (state.inCooldown && now < state.cooldownUntil) {
    return { allow: false, code: 'COOLDOWN', reason: `COOLDOWN`, remainingMs: state.cooldownUntil - now };
  }
  return { allow: true };
}

export function onTradeClosed(state: RiskState, pnl: number, cfg: RiskConfig, now = Date.now(), virtualBalance?: number, symbol?: string): RiskState {
  const next: RiskState = { ...state };
  next.dailyPnL += pnl;
  next.tradesToday += 1;
  if (symbol) {
    if (!next.tradesPerSymbol) next.tradesPerSymbol = {};
    next.tradesPerSymbol[symbol] = (next.tradesPerSymbol[symbol] || 0) + 1;
  }
  next.lastTradeAt = now;
  if (pnl < 0) {
    next.consecutiveLosses += 1;
    next.inCooldown = true;
    let scaledCooldownMinutes = cfg.cooldownMinutes || 1;
    if (cfg.cooldownMinutesPerPctLoss !== undefined && virtualBalance !== undefined && virtualBalance > 0) {
      const pnlPct = (Math.abs(pnl) / virtualBalance) * 100;
      scaledCooldownMinutes = Math.max(cfg.cooldownMinutes, Math.min(60, pnlPct * cfg.cooldownMinutesPerPctLoss));
    }
    next.cooldownUntil = now + Math.min(60, scaledCooldownMinutes) * 60_000;
  } else {
    next.consecutiveLosses = 0;
    next.inCooldown = false;
    next.cooldownUntil = 0;
  }
  saveRiskState(next);
  return next;
}

export function resetRiskState(now = Date.now()): RiskState {
  const s = freshState(now);
  saveRiskState(s);
  return s;
}

function freshState(now: number): RiskState {
  return {
    dailyPnL: 0,
    tradesToday: 0,
    tradesPerSymbol: {},
    consecutiveLosses: 0,
    lastTradeAt: 0,
    inCooldown: false,
    cooldownUntil: 0,
    dateKey: getISTDateString(now)
  };
}

export function loadYesterdayRiskState(): RiskState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('chartlens_risk_yesterday_v1');
    if (!raw) return null;
    return JSON.parse(raw) as RiskState;
  } catch {
    return null;
  }
}

export function checkRiskWarnings(state: RiskState, cfg: RiskConfig, virtualBalance?: number): { warning: boolean, reasons: string[] } {
  const reasons: string[] = [];
  const effectiveCap = cfg.dailyLossCapPct !== undefined && virtualBalance !== undefined 
    ? Math.min(cfg.dailyLossCapRupees, virtualBalance * (cfg.dailyLossCapPct / 100))
    : cfg.dailyLossCapRupees;
  
  if (state.dailyPnL < 0 && Math.abs(state.dailyPnL) >= effectiveCap * 0.75) {
    reasons.push(`Daily loss at 75% of cap. Cap: ₹${effectiveCap.toFixed(0)}. Current: ₹${state.dailyPnL.toFixed(0)}`);
  }
  if (state.tradesToday >= Math.floor(cfg.maxTradesPerDay * 0.8)) {
    reasons.push(`Trade count at 80% of daily limit. Used: ${state.tradesToday} of ${cfg.maxTradesPerDay}`);
  }
  if (cfg.maxConsecutiveLosses > 1 && state.consecutiveLosses >= cfg.maxConsecutiveLosses - 1) {
    reasons.push(`One more loss triggers consecutive loss halt. Current streak: ${state.consecutiveLosses}`);
  }
  return { warning: reasons.length > 0, reasons };
}

export function reconcileDailyPnL(todayTrades: { pnl: number, brokerCharges: number }[]): number {
  return todayTrades.reduce((sum, t) => sum + (t.pnl - t.brokerCharges), 0);
}
