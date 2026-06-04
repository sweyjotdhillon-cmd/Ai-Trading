import { RiskState, RiskConfig } from '../types';

const LS_KEY = 'chartlens_risk_state_v1';

export function loadRiskState(now = Date.now()): RiskState {
  if (typeof window === 'undefined') return freshState(now);
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return freshState(now);
    const s = JSON.parse(raw) as RiskState;
    const today = istDateKey(now);
    if (s.dateKey !== today) return freshState(now); // roll over at IST midnight
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
  remainingMs?: number;
}

export function checkRiskCaps(state: RiskState, cfg: RiskConfig, now = Date.now()): RiskVerdict {
  if (state.dailyPnL <= -Math.abs(cfg.dailyLossCapRupees)) {
    return { allow: false, reason: `DAILY_LOSS_CAP: ₹${(-state.dailyPnL).toFixed(0)} hit. Trading locked until tomorrow.` };
  }
  if (state.tradesToday >= cfg.maxTradesPerDay) {
    return { allow: false, reason: `MAX_TRADES: ${cfg.maxTradesPerDay} reached. Overtrading guard active.` };
  }
  if (state.consecutiveLosses >= cfg.maxConsecutiveLosses) {
    return { allow: false, reason: `CONSECUTIVE_LOSSES: ${state.consecutiveLosses} in a row. Walk away.` };
  }
  if (state.inCooldown && now < state.cooldownUntil) {
    return { allow: false, reason: `COOLDOWN`, remainingMs: state.cooldownUntil - now };
  }
  return { allow: true };
}

export function onTradeClosed(state: RiskState, pnl: number, cfg: RiskConfig, now = Date.now()): RiskState {
  const next: RiskState = { ...state };
  next.dailyPnL += pnl;
  next.tradesToday += 1;
  next.lastTradeAt = now;
  if (pnl < 0) {
    next.consecutiveLosses += 1;
    next.inCooldown = true;
    next.cooldownUntil = now + cfg.cooldownMinutes * 60_000;
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

function istDateKey(now: number): string {
  // IST offset is GMT+5:30. 5 hours 30 mins = 330 minutes
  const d = new Date(now + 330 * 60_000);
  return d.toISOString().slice(0, 10);
}

function freshState(now: number): RiskState {
  return {
    dailyPnL: 0,
    tradesToday: 0,
    consecutiveLosses: 0,
    lastTradeAt: 0,
    inCooldown: false,
    cooldownUntil: 0,
    dateKey: istDateKey(now)
  };
}
