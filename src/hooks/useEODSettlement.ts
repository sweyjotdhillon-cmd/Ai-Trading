import { useState, useEffect, useCallback } from 'react';
import { settleEODTrades } from '../services/eodSettlementService';
import { todayIST, isAfterMarketClose } from '../utils/istUtils';

function getStorageKey(uid: string): string {
  return `eod_settled_${uid}_${todayIST()}`;
}

function hasAlreadySettled(uid: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(getStorageKey(uid)) === '1';
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
  canSettle:      boolean;   // true if current IST time >= 15:30 or already settled
  alreadySettled: boolean;
}

export function useEODSettlement(uid: string | null): {
  state:             EODSettlementState;
  triggerSettlement: (currentBalance?: number) => Promise<void>;
} {
  const [state, setState] = useState<EODSettlementState>(() => {
    const settled = uid ? hasAlreadySettled(uid) : false;
    return {
      isSettling:     false,
      lastResult:     null,
      error:          null,
      canSettle:      settled || isAfterMarketClose(),
      alreadySettled: settled,
    };
  });

  const triggerSettlement = useCallback(async (currentBalance?: number) => {
    if (!uid || state.isSettling) return;

    setState(prev => ({ ...prev, isSettling: true, error: null }));
    try {
      const result = await settleEODTrades(uid, currentBalance);
      try {
        sessionStorage.setItem(getStorageKey(uid), '1');
      } catch {
        // Safe check
      }
      setState(prev => ({
        ...prev,
        isSettling:     false,
        lastResult:     result,
        alreadySettled: true,
        canSettle:      true,
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

  useEffect(() => {
    if (!uid) return;
    const settled = hasAlreadySettled(uid);
    setState(prev => ({
      ...prev,
      alreadySettled: settled,
      canSettle:      settled || isAfterMarketClose(),
    }));
  }, [uid]);

  // Periodic checker for market close
  useEffect(() => {
    if (state.canSettle) return;

    const interval = setInterval(() => {
      if (isAfterMarketClose()) {
        setState(prev => ({ ...prev, canSettle: true }));
        clearInterval(interval);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [state.canSettle]);

  return { state, triggerSettlement };
}
