import { useState, useEffect, useCallback } from 'react';
import { settleEODTrades } from '../services/eodSettlementService';

interface EODSettlementState {
  isSettling: boolean;
  lastResult: {
    settled: number;
    skipped: number;
    totalNetPnL: number;
    errors: string[];
    ambiguous: number;
  } | null;
  error: string | null;
  canSettle: boolean;   // true if time >= 15:30 IST
  alreadySettled: boolean;
}

function isAfterMarketClose(): boolean {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST
  return now.getUTCHours() > 15 || (now.getUTCHours() === 15 && now.getUTCMinutes() >= 30);
}

function todayIST(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function hasAlreadySettled(uid: string): boolean {
  try {
    return !!sessionStorage.getItem(`eod_settled_${uid}_${todayIST()}`);
  } catch {
    return false;
  }
}

export function useEODSettlement(uid: string | null): {
  state: EODSettlementState;
  triggerSettlement: () => Promise<void>;
} {
  const [state, setState] = useState<EODSettlementState>({
    isSettling: false,
    lastResult: null,
    error: null,
    canSettle: isAfterMarketClose(),
    alreadySettled: uid ? hasAlreadySettled(uid) : false,
  });

  const triggerSettlement = useCallback(async () => {
    if (!uid) return;
    if (state.isSettling) return;

    setState(prev => ({ ...prev, isSettling: true, error: null }));
    try {
      const result = await settleEODTrades(uid);
      setState(prev => ({
        ...prev,
        isSettling: false,
        lastResult: result,
        alreadySettled: true,
        error: result.errors.length > 0
          ? `${result.errors.length} trade(s) failed to settle`
          : null,
      }));
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        isSettling: false,
        error: err?.message ?? 'Settlement failed',
      }));
    }
  }, [uid, state.isSettling]);

  // AUTO-TRIGGER on mount
  useEffect(() => {
    if (!uid) return;
    if (!isAfterMarketClose()) return;
    if (hasAlreadySettled(uid)) {
      setState(prev => ({ ...prev, alreadySettled: true }));
      return;
    }
    const timer = setTimeout(() => {
      triggerSettlement();
    }, 2000);
    return () => clearTimeout(timer);
  }, [uid, triggerSettlement]);

  return { state, triggerSettlement };
}
