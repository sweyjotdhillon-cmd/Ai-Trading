import { useState, useEffect, useCallback } from 'react';
import { settleEODTrades, isAfterMarketClose } from '../services/eodSettlementService';

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

export interface EODSettlementResult {
  settled:     number;
  skipped:     number;
  totalNetPnL: number;
  errors:      string[];
  ambiguous:   number;
}

export interface EODSettlementState {
  isSettling:     boolean;
  lastResult:     EODSettlementResult | null;
  error:          string | null;
  canSettle:      boolean;   // true if current IST time >= 15:30
  alreadySettled: boolean;
}

export function useEODSettlement(uid: string | null): {
  state:             EODSettlementState;
  triggerSettlement: () => Promise<void>;
} {
  const [state, setState] = useState<EODSettlementState>(() => ({
    isSettling:     false,
    lastResult:     null,
    error:          null,
    canSettle:      isAfterMarketClose(),
    alreadySettled: uid ? hasAlreadySettled(uid) : false,
  }));

  const triggerSettlement = useCallback(async () => {
    if (!uid || state.isSettling) return;

    setState(prev => ({ ...prev, isSettling: true, error: null }));
    try {
      const result = await settleEODTrades(uid);
      setState(prev => ({
        ...prev,
        isSettling:     false,
        lastResult:     result,
        alreadySettled: true,
        error: result.errors.length > 0 && result.settled === 0
          ? `Settlement failed for ${result.skipped} trade(s)`
          : null,
      }));
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        isSettling: false,
        error:      err?.message ?? 'Settlement failed unexpectedly',
      }));
    }
  }, [uid, state.isSettling]);

  // Auto-trigger once on mount if conditions are met
  useEffect(() => {
    if (!uid) return;
    if (!isAfterMarketClose()) return;
    if (hasAlreadySettled(uid)) {
      setState(prev => ({ ...prev, alreadySettled: true, canSettle: true }));
      return;
    }
    // 2 second delay — let component tree and Firestore auth stabilize first
    const timer = setTimeout(() => {
      settleEODTrades(uid).then(result => {
        setState(prev => ({
          ...prev,
          isSettling: false,
          lastResult: result,
          alreadySettled: true,
          error: result.errors.length > 0 && result.settled === 0
            ? `Settlement failed for ${result.skipped} trade(s)`
            : null,
        }));
      }).catch(err => {
        setState(prev => ({
          ...prev,
          isSettling: false,
          error: err?.message ?? 'Settlement failed unexpectedly',
        }));
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [uid]);

  return { state, triggerSettlement };
}
