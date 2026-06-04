import { useState, useEffect } from 'react';
import { ScalpingPlan, TradeOutcome } from '../types';

export function useScalpPositionWatcher(plan: ScalpingPlan | null, currentPrice: number | null) {
  const [outcome, setOutcome] = useState<TradeOutcome | null>(null);
  const [exitPrice, setExitPrice] = useState<number | null>(null);
  const [isExited, setIsExited] = useState(false);
  const [trailSL, setTrailSL] = useState<number>(0);
  const [tp1Hit, setTp1Hit] = useState(false);

  useEffect(() => {
    if (!plan) {
      setOutcome(null);
      setExitPrice(null);
      setIsExited(false);
      setTp1Hit(false);
      return;
    }
    setTrailSL(plan.stopLoss);
    setTp1Hit(false);
    setIsExited(false);
    setOutcome(null);
    setExitPrice(null);
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

  const forceExit = (price: number) => {
    setOutcome('MANUAL_EXIT');
    setExitPrice(price);
    setIsExited(true);
  };

  return {
    outcome,
    exitPrice,
    isExited,
    trailSL,
    tp1Hit,
    forceExit
  };
}
