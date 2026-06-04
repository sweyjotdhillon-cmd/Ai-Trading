import { ScalpingPlan, ScalpConfig, ScalpSimResult, PathEvent, ScalpInstrument, TradeOutcome } from '../types';
import { NumericOHLC } from '../vision/pipeline';

export function inferTickSize(price: number): number {
  // NSE default tick size is 0.05 INR for equities, index futures, options, etc.
  return 0.05;
}

export function simulateScalpTrade(
  plan: ScalpingPlan,
  futureCandles: NumericOHLC[],   // strictly AFTER entry bar
  config: ScalpConfig,
  brokerChargesFn: (entry: number, exit: number, sizeShares: number, inst: ScalpInstrument) => { total: number }
): ScalpSimResult {
  const tickSize = inferTickSize(plan.entry);
  const slippage = config.risk.slippageTicks * tickSize;
  
  // Effective entry price is higher by slippage on long entry (pessimistic)
  const entryEffective = plan.entry + slippage;
  
  const events: PathEvent[] = [{ barIndex: -1, price: entryEffective, event: 'ENTRY' }];
  let currentSL = plan.stopLoss;
  let position = plan.positionSize;
  let tp1Hit = false;
  let realizedGross = 0;
  
  const finish = (outcome: TradeOutcome, exitPrice: number, exitIdx: number): ScalpSimResult => {
    const chargeRes = brokerChargesFn(plan.entry, exitPrice, plan.positionSize, plan.instrument);
    const charges = chargeRes.total;
    const netPnL = realizedGross - charges;
    const risk = (plan.entry - plan.stopLoss) * plan.positionSize;
    return {
      outcome,
      exitPrice,
      exitBarIndex: exitIdx,
      realizedPnL: netPnL,
      realizedPnLGross: realizedGross,
      brokerCharges: charges,
      events,
      rMultiple: risk > 0 ? netPnL / risk : 0,
    };
  };

  if (!futureCandles || futureCandles.length === 0) {
    // Empty future candles, close immediately at entry
    realizedGross = 0;
    events.push({ barIndex: 0, price: entryEffective, event: 'TIME_OUT' });
    return finish('TIME_EXIT', entryEffective, 0);
  }

  for (let i = 0; i < futureCandles.length; i++) {
    const c = futureCandles[i];

    // Time-out check (bar count index corresponds to minutes since entry visual bar spacing)
    if ((i + 1) >= plan.maxHoldingMinutes) {
      realizedGross += (c.close - entryEffective) * position;
      events.push({ barIndex: i, price: c.close, event: 'TIME_OUT' });
      return finish('TIME_EXIT', c.close, i);
    }

    // PESSIMISTIC ORDER: SL check FIRST so a simultaneous touch of SL and TP evaluates as SL hit.
    if (c.low <= currentSL) {
      const slPx = currentSL - slippage; // exit price slips down further (pessimistic)
      realizedGross += (slPx - entryEffective) * position;
      events.push({ barIndex: i, price: slPx, event: 'SL' });
      return finish(tp1Hit ? 'TRAIL_HIT' : 'SL_HIT', slPx, i);
    }

    // TP1 partial book (50% booking)
    if (!tp1Hit && c.high >= plan.takeProfit1) {
      const half = Math.floor(position / 2);
      if (half > 0) {
        realizedGross += (plan.takeProfit1 - entryEffective) * half;
        position -= half;
      }
      currentSL = entryEffective; // break-even shift on SL
      tp1Hit = true;
      events.push({ barIndex: i, price: plan.takeProfit1, event: 'TP1' });
      events.push({ barIndex: i, price: entryEffective, event: 'BE_SHIFT', newSL: currentSL });
    }

    // Trail after TP1
    if (tp1Hit && config.tpMode === 'PARTIAL_RR') {
      const newTrail = c.high - plan.trailingDistance;
      if (newTrail > currentSL) {
        currentSL = newTrail;
        events.push({ barIndex: i, price: c.high, event: 'TRAIL_UPDATE', newSL: currentSL });
      }
    }

    // TP2 full exit
    if (c.high >= plan.takeProfit2) {
      realizedGross += (plan.takeProfit2 - entryEffective) * position;
      events.push({ barIndex: i, price: plan.takeProfit2, event: 'TP2' });
      return finish('TP2_HIT', plan.takeProfit2, i);
    }
  }

  // Ran out of candles -> mark-to-close at last close
  const last = futureCandles[futureCandles.length - 1];
  realizedGross += (last.close - entryEffective) * position;
  events.push({ barIndex: futureCandles.length - 1, price: last.close, event: 'TIME_OUT' });
  return finish('TIME_EXIT', last.close, futureCandles.length - 1);
}
