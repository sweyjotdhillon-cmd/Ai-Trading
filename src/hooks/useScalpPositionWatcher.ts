import { useState, useEffect } from 'react';
import { ScalpingPlan, TradeOutcome } from '../types';

export function useScalpPositionWatcher(
  plan:          ScalpingPlan | null,
  currentPrice:  number | null,
  tradeOpenedAt: number | null   // trade open timestamp
) {
  const [outcome, setOutcome] = useState<TradeOutcome | null>(null);
  const [exitPrice, setExitPrice] = useState<number | null>(null);
  const [isExited, setIsExited] = useState(false);
  const [trailSL, setTrailSL] = useState<number>(0);
  const [tp1Hit, setTp1Hit] = useState(false);
  const [timeExpired, setTimeExpired] = useState(false);

  useEffect(() => {
    if (!plan) {
      setOutcome(null);
      setExitPrice(null);
      setIsExited(false);
      setTp1Hit(false);
      setTimeExpired(false);
      return;
    }
    setTrailSL(plan.stopLoss);
    setTp1Hit(false);
    setIsExited(false);
    setOutcome(null);
    setExitPrice(null);
    setTimeExpired(false);
  }, [plan]);

  useEffect(() => {
    if (!plan || isExited || currentPrice === null || currentPrice <= 0) return;

    // Check SL first (risk-first approach)
    if (currentPrice <= trailSL) {
      setOutcome(tp1Hit ? 'TRAIL_HIT' : 'SL_HIT');
      setExitPrice(trailSL);
      setIsExited(true);
      return;
    }

    // Check TP1 progress
    if (!tp1Hit && currentPrice >= plan.takeProfit1) {
      setTp1Hit(true);
      setTrailSL(plan.entry); // SHIFT to Break Even (entry) on TP1 hit
    }

    // Trailing shift after TP1
    if (tp1Hit) {
      const newTrail = currentPrice - plan.trailingDistance;
      if (newTrail > trailSL) {
        setTrailSL(newTrail);
      }
    }

    // Check TP2 final target
    if (currentPrice >= plan.takeProfit2) {
      setOutcome('TP2_HIT');
      setExitPrice(plan.takeProfit2);
      setIsExited(true);
      return;
    }
  }, [currentPrice, plan, trailSL, tp1Hit, isExited]);

  useEffect(() => {
    if (!plan || isExited || !tradeOpenedAt) return;
    if (plan.maxHoldingMinutes <= 0) return;

    const deadlineMs = tradeOpenedAt + plan.maxHoldingMinutes * 60_000;
    const remainingMs = deadlineMs - Date.now();

    if (remainingMs <= 0) {
      // Already expired on mount
      setOutcome('TIME_EXIT');
      setExitPrice(currentPrice ?? plan.entry);
      setIsExited(true);
      setTimeExpired(true);
      return;
    }

    // Schedule the exit at exactly the deadline
    const timer = setTimeout(() => {
      if (isExited) return; // already closed by SL/TP
      setOutcome('TIME_EXIT');
      setExitPrice(currentPrice ?? plan.entry);
      setIsExited(true);
      setTimeExpired(true);
    }, remainingMs);

    return () => clearTimeout(timer);
  }, [plan, tradeOpenedAt, isExited, currentPrice]);

  const forceExit = (price: number) => {
    setOutcome('MANUAL_EXIT');
    setExitPrice(price);
    setIsExited(true);
  };

  // Compute time remaining for UI display — recalculate every render
  const timeRemainingMs = (() => {
    if (!plan || !tradeOpenedAt || isExited) return null;
    const deadline = tradeOpenedAt + plan.maxHoldingMinutes * 60_000;
    return Math.max(0, deadline - Date.now());
  })();

  // Unrealized P&L — only meaningful while in trade and not exited
  const unrealizedPnL = (() => {
    if (!plan || !currentPrice || isExited) return null;
    const positionSize = plan.positionSize ?? 1;
    return (currentPrice - plan.entry) * positionSize;
  })();

  const unrealizedPnLPct = (() => {
    if (!plan || unrealizedPnL === null) return null;
    return (unrealizedPnL / plan.riskRupees) * 100;
  })();

  return {
    outcome,
    exitPrice,
    isExited,
    trailSL,
    tp1Hit,
    forceExit,
    timeExpired,
    timeRemainingMs,
    unrealizedPnL,
    unrealizedPnLPct,
  };
}
