const fs = require('fs');

let content = fs.readFileSync('src/quant/backtestEngine.ts', 'utf8');

const codeToInsert = `
export function runPortfolioBacktest(
  allStockCandles: Record<string, OHLCV[]>,
  config: BacktestConfig
): BacktestResult {
  const trades: BacktestTrade[] = [];
  const logs: string[] = [];

  const log = (msg: string) => {
    const timestampStr = new Date().toISOString().split('T')[1].slice(0, 8);
    logs.push(\`[\${timestampStr}] \${msg}\`);
  };

  const initialCapital = config.initialCapital ?? config.scalpConfig.capitalRupees ?? 100000;

  const state: PortfolioState = {
    initialCapital,
    availableCash: initialCapital,
    realizedPnL: 0,
    totalInvestedCapital: 0,
    openPositions: []
  };

  log(\`[INIT] Starting Portfolio Backtest | Initial Capital: ₹\${initialCapital} | Max Trades/Day: \${config.maxTradesPerDay} | Margin Thresh: \${config.marginThreshold}\`);

  // 1. Collect and sort all unique timestamps across all stocks
  const uniqueTimestamps = new Set<number>();
  for (const symbol in allStockCandles) {
    const candles = allStockCandles[symbol];
    // Skip warmup candles for each stock
    for (let i = config.warmupCandles; i < candles.length; i++) {
      if (candles[i].timestamp) {
        uniqueTimestamps.add(candles[i].timestamp!);
      }
    }
  }
  const timeline = Array.from(uniqueTimestamps).sort((a, b) => a - b);
  log(\`[INIT] Total Unique Timestamps across all stocks: \${timeline.length}\`);

  // We need to track the current index in each stock's candle array to efficiently find the current candle
  const stockIndices: Record<string, number> = {};
  for (const symbol in allStockCandles) {
    stockIndices[symbol] = config.warmupCandles;
  }

  const patternStabilityManagers: Record<string, PatternStabilityManager> = {};
  const gapStabilityManagers: Record<string, GapStabilityManager> = {};
  let tradesTodayByStock: Record<string, number> = {};

  for (const symbol in allStockCandles) {
    patternStabilityManagers[symbol] = new PatternStabilityManager();
    gapStabilityManagers[symbol] = new GapStabilityManager();
  }

  let currentDayKey = '';

  for (const ts of timeline) {
    const dayKey = getISTDateString(ts);
    const timeStr = new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    if (dayKey !== currentDayKey) {
      if (currentDayKey !== '') log(\`\\n--- NEW TRADING DAY: \${dayKey} ---\`);
      currentDayKey = dayKey;
      tradesTodayByStock = {};
    }

    // A. Advance indices for all stocks to the current timestamp
    const currentCandles: Record<string, OHLCV> = {};
    for (const symbol in allStockCandles) {
      const candles = allStockCandles[symbol];
      let idx = stockIndices[symbol];
      while (idx < candles.length && (candles[idx].timestamp ?? 0) < ts) {
        idx++;
      }
      stockIndices[symbol] = idx;
      if (idx < candles.length && candles[idx].timestamp === ts) {
        currentCandles[symbol] = candles[idx];
      }
    }

    // B. Process EXITS for existing open positions BEFORE new entries
    const remainingPositions: OpenPosition[] = [];
    for (const pos of state.openPositions) {
      const c = currentCandles[pos.symbol];
      if (!c) {
        remainingPositions.push(pos);
        continue; // No data for this stock at this tick, wait for next
      }

      let outcome: BacktestTrade['outcome'] = null;
      let exitPrice = 0;

      const cDayKey = getISTDateString(c.timestamp ?? 0);
      const isEndOfDay = cDayKey !== dayKey; // Data jumped to next day unexpectedly

      // Lookahead check for last candle of day
      const candles = allStockCandles[pos.symbol];
      const nextCandle = candles[stockIndices[pos.symbol] + 1];
      const isLastCandleOfDay = !nextCandle || getISTDateString(nextCandle.timestamp ?? 0) !== dayKey;

      if (isEndOfDay) {
         log(\`  -> Data gap jumped day boundary. Forcing TIME_EXIT for \${pos.symbol}.\`);
         outcome = 'TIME_EXIT';
         exitPrice = c.open; // Best effort if we jumped
      } else {
        // Normal stop/tp checks (pessimistic: check low before high)
        if (c.low <= pos.currentStop) {
          outcome = pos.tp1Hit ? 'BREAK_EVEN' : 'SL_HIT';
          exitPrice = pos.currentStop;
        } else if (c.high >= pos.tp2) {
          outcome = 'TP2_HIT';
          exitPrice = pos.tp2;
        } else if (isLastCandleOfDay) {
          outcome = 'TIME_EXIT';
          exitPrice = c.close;
        } else {
          // TP1 check
          if (!pos.useFixedRR && !pos.tp1Hit && c.high >= pos.tp1) {
            pos.tp1Hit = true;
            pos.tp1ExitPrice = pos.tp1;
            pos.currentStop = pos.breakEvenPrice;
            log(\`  -> [\${timeStr}] \${pos.symbol} TP1 HIT at \${pos.tp1.toFixed(2)} | Stop moved to breakeven\`);
          }

          // Update trailing stop
          pos.runningMaxHigh = Math.max(pos.runningMaxHigh, c.high);
          pos.runningMinLow = Math.min(pos.runningMinLow, c.low);

          if (pos.useTrailAfterTP1 && pos.tp1Hit) {
            const trailActivationPrice = pos.entryPrice + pos.riskPerShare * 1.3;
            if (pos.runningMaxHigh >= trailActivationPrice) {
              const trailStop = pos.runningMaxHigh - pos.riskPerShare * pos.trailDistanceR;
              if (trailStop > pos.currentStop) {
                pos.currentStop = trailStop;
              }
            }
          }
        }
      }

      if (outcome) {
        // Position Closed!
        let netPnL = 0;
        let totalCharges = 0;

        if (pos.tp1Hit && pos.tp1ExitPrice > 0) {
          const leg1Charges = computeRoundTripCharges(pos.entryPrice, pos.tp1ExitPrice, pos.tp1Qty, pos.instrument).total;
          const leg2Charges = computeRoundTripCharges(pos.entryPrice, exitPrice, pos.remainderQty, pos.instrument).total;
          const leg1PnL = (pos.tp1ExitPrice - pos.entryPrice) * pos.tp1Qty - leg1Charges;
          const leg2PnL = (exitPrice - pos.entryPrice) * pos.remainderQty - leg2Charges;
          netPnL = leg1PnL + leg2PnL;
          totalCharges = leg1Charges + leg2Charges;
        } else {
          totalCharges = computeRoundTripCharges(pos.entryPrice, exitPrice, pos.positionSize, pos.instrument).total;
          netPnL = (exitPrice - pos.entryPrice) * pos.positionSize - totalCharges;
        }

        const rMultiple = pos.riskPerShare > 0 ? netPnL / (pos.riskPerShare * pos.positionSize) : 0;
        const durationMinutes = (ts - pos.entryTime) / 60000;

        // Return capital + realized PnL to availableCash
        const cashReleased = pos.investmentAmount + netPnL;
        const availableCashBefore = state.availableCash;
        state.availableCash += cashReleased;
        state.realizedPnL += netPnL;

        log(\`[EXIT] [\${timeStr}] \${pos.symbol} | Outcome: \${outcome} | PnL: ₹\${netPnL.toFixed(2)} | Cash \${availableCashBefore.toFixed(0)} -> \${state.availableCash.toFixed(0)}\`);

        // Assemble final BacktestTrade
        const finalTrade = {
           ...pos.tradeContext,
           exitTime: ts,
           exitPrice: exitPrice,
           outcome,
           pnl: netPnL,
           rMultiple,
           durationMinutes,
           availableCashAfter: state.availableCash
        } as BacktestTrade;
        trades.push(finalTrade);
      } else {
        remainingPositions.push(pos);
      }
    }
    state.openPositions = remainingPositions;

    // C. Evaluate NEW ENTRIES
    // If multiple signals occur on the same tick, evaluate deterministically
    // We store candidates, sort them, and allocate cash
    const entryCandidates: any[] = [];

    for (const symbol in currentCandles) {
      if ((tradesTodayByStock[symbol] ?? 0) >= config.maxTradesPerDay) continue;

      const idx = stockIndices[symbol];
      const candles = allStockCandles[symbol];
      // We need window ending at current candle to evaluate signal
      if (idx < ANALYSIS_WINDOW_SIZE - 1) continue;

      // Ensure we are not looking ahead. The signal evaluates ON the current candle,
      // and we enter at the OPEN of the NEXT candle (which we do virtually here if qualified)
      const windowStart = Math.max(0, idx - ANALYSIS_WINDOW_SIZE + 1);
      const windowCandles = candles.slice(windowStart, idx + 1);
      const numericWindow = toNumericWindow(windowCandles);
      const horizonCtx = buildHorizonCtx();

      let confirmedPatterns: PatternEvidence[] = [];
      if (featureFlags.enableCandlestickRepoPatterns) {
        const rawPatterns = extractCandlestickPatterns(numericWindow);
        confirmedPatterns = patternStabilityManagers[symbol].processFrame(rawPatterns);
      }
      let confirmedGaps: GapEvidence[] = [];
      if (featureFlags.enableGapDetection) {
        const latestGap = detectLatestGap(numericWindow);
        confirmedGaps = gapStabilityManagers[symbol].processFrame(latestGap);
      }

      const decision = evaluateSignal(
        numericWindow,
        config.techniquesList || [],
        horizonCtx,
        confirmedPatterns,
        confirmedGaps,
        undefined,
        undefined
      );

      const qualifies = decision.winner === 'BULL' && decision.margin >= config.marginThreshold;

      // J1, J2, J3 Gates...
      let blocked = false;
      let j1RangeStr = 'NONE';
      let j2RangeStr = 'NONE';
      let j3RangeStr = 'NONE';

      if (qualifies) {
        if (featureFlags.ENABLE_J1_GATE) {
          const j1 = decision.winner === 'BEAR' ? decision.bearJ1 : decision.bullJ1;
          if (j1 < 2.0) blocked = true;
          else if (j1 >= 2.0 && j1 < 2.5) j1RangeStr = 'J1_2.0_2.5';
          else if (j1 >= 2.5 && j1 < 3.0) j1RangeStr = 'J1_2.5_3.0';
          else if (j1 >= 3.0 && j1 < 3.5) j1RangeStr = 'J1_3.0_3.5';
          else if (j1 >= 3.5 && j1 <= 4.0) j1RangeStr = 'J1_3.5_4.0';
        }
        if (featureFlags.ENABLE_J2_GATE && !blocked) {
          const j2 = decision.winner === 'BEAR' ? decision.bearJ2 : decision.bullJ2;
          if (j2 < 1.5) blocked = true;
          else if (j2 >= 1.5 && j2 < 2.0) j2RangeStr = 'J2_1.5_2.0';
          else if (j2 >= 2.0 && j2 < 2.5) j2RangeStr = 'J2_2.0_2.5';
          else if (j2 >= 2.5 && j2 < 3.0) j2RangeStr = 'J2_2.5_3.0';
          else if (j2 >= 3.0 && j2 < 3.5) j2RangeStr = 'J2_3.0_3.5';
        }
        if (featureFlags.ENABLE_J3_GATE && !blocked) {
          const j3 = decision.winner === 'BEAR' ? decision.cases.bear.j3 : decision.cases.bull.j3;
          if (j3 >= 0.5 && j3 < 1.0) blocked = true;
          else if (j3 < 0.5) j3RangeStr = 'J3_BELOW_0.5';
          else j3RangeStr = 'J3_1.0_PLUS';
        }

        const nextCandle = candles[idx + 1];
        if (!blocked && nextCandle && getISTDateString(nextCandle.timestamp ?? 0) === dayKey) {
          entryCandidates.push({
            symbol,
            decision,
            idx,
            nextCandle,
            windowCandles,
            j1RangeStr, j2RangeStr, j3RangeStr
          });
        }
      }
    }

    // Sort candidates deterministically: highest margin first, then alphabetically
    entryCandidates.sort((a, b) => {
      if (b.decision.margin !== a.decision.margin) return b.decision.margin - a.decision.margin;
      return a.symbol.localeCompare(b.symbol);
    });

    for (const cand of entryCandidates) {
      const entry = cand.nextCandle.open;
      const highs = cand.windowCandles.map((c: OHLCV) => c.high);
      const lows  = cand.windowCandles.map((c: OHLCV) => c.low);
      const atr14Arr = atr(cand.windowCandles, 14);
      const pivots = findSwingPivots(highs, lows, 2);

      const ctx: ScalpContext = {
        config: config.scalpConfig,
        riskState: dummyRiskState(dayKey),
        pivots,
        atr14: atr14Arr,
        vwapProxy: [],
        nowMsEpoch: cand.nextCandle.timestamp ?? 0,
        nowISTMinutesSinceMidnight: getISTMinutes(cand.nextCandle.timestamp ?? 0),
        currentBarIndex: cand.windowCandles.length - 1,
        currentPrice: entry,
      };

      let sl = calculateStopLoss(entry, config.scalpConfig.slMode, ctx);
      const exits = buildExitPlan(entry, sl, ctx);
      if (!exits) continue;

      let tp1 = exits.tp1;
      let tp2 = exits.tp2;
      let breakEvenPrice = exits.breakEvenAfter === exits.tp1 ? entry : exits.breakEvenAfter;

      const exitMode = config.exitMode ?? 'DYNAMIC';
      if (exitMode === 'FIXED_RR') {
        const rr = config.fixedRRRatio ?? 2.0;
        tp1 = Infinity;
        tp2 = entry + (entry - sl) * rr;
        breakEvenPrice = sl;
      } else if (exitMode === 'FIXED_PCT') {
        const slPct = config.fixedSLPct ?? 0.5;
        const tpPct = config.fixedTPPct ?? 1.0;
        sl = entry * (1 - slPct / 100);
        tp1 = Infinity;
        tp2 = entry * (1 + tpPct / 100);
        breakEvenPrice = sl;
      }

      const riskPerShare = entry - sl;
      if (!isFinite(riskPerShare) || riskPerShare <= 0) continue;

      // PORTFOLIO CASH GATE
      // Use CURRENT AVAILABLE CASH, not initial capital
      const riskPerTradePct = config.scalpConfig.riskPerTradePct ?? 1.0;
      const maxPositionPctCapital = config.scalpConfig.maxPositionPctCapital ?? 30;
      const lotSize = config.scalpConfig.lotSize ?? 1;

      // For equity, maxPositionPctCapital determines the allocation block.
      // E.g. if maxPositionPct is 30%, we want to deploy 30% of AVAILABLE CASH into this position.
      // Then, we check if the SL risk on that position size exceeds our max risk (riskPerTradePct).

      const allocationPct = maxPositionPctCapital;
      const desiredNotional = state.availableCash * (allocationPct / 100);

      // Calculate risk-based limit (using % of available cash as well, to be proportional and safe)
      const maxRiskRupees = state.availableCash * (riskPerTradePct / 100);
      const riskBasedSize = Math.floor(maxRiskRupees / riskPerShare);

      const notionalCappedSize = Math.floor(desiredNotional / entry);

      let positionSize = Math.min(riskBasedSize, notionalCappedSize);
      if (lotSize > 1) {
        positionSize = Math.floor(positionSize / lotSize) * lotSize;
      }

      const actualInvestment = positionSize * entry;
      const availableCashBefore = state.availableCash;

      if (positionSize <= 0 || actualInvestment > state.availableCash) {
        log(\`[PORTFOLIO CASH GATE] [\${timeStr}] \${cand.symbol} SKIPPED - Req: ₹\${actualInvestment.toFixed(0)}, Avail: ₹\${state.availableCash.toFixed(0)}\`);
        continue; // Skip this trade
      }

      // Deduct cash and open position
      state.availableCash -= actualInvestment;
      state.totalInvestedCapital += actualInvestment;

      tradesTodayByStock[cand.symbol] = (tradesTodayByStock[cand.symbol] ?? 0) + 1;

      const tp1Qty = config.scalpConfig.useFixedRR ? 0 : Math.floor(positionSize / 2);

      const decision = cand.decision;
      const patternNames = decision.topPatterns.bull.length > 0 ? decision.topPatterns.bull.join(',') : 'NONE';
      const atrAtEntry = atr14Arr[atr14Arr.length - 1] ?? 0;
      const validAtrHistory = atr14Arr.filter((v: number) => isFinite(v) && v > 0);
      const atrPercentile = validAtrHistory.length > 0
        ? 100 * (validAtrHistory.filter((v: number) => v <= atrAtEntry).length / validAtrHistory.length)
        : 50;
      const nowMin = ctx.nowISTMinutesSinceMidnight;
      const entryTimeBucket: 'OPEN' | 'MID' | 'CLOSE' = nowMin <= 600 ? 'OPEN' : nowMin >= 870 ? 'CLOSE' : 'MID';
      const dayOfWeek = new Date(cand.nextCandle.timestamp ?? 0).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });

      const j3Components = (decision.auditTrail?.judgeContribs ?? [])
        .filter((c: any) => c.judge === 'J3' && c.side === 'BULL')
        .map((c: any) => \`\${c.contributor}:\${c.value.toFixed(2)}\`)
        .join(',') || 'NONE';

      log(\`[PORTFOLIO CASH GATE] [\${timeStr}] \${cand.symbol} ACCEPTED - Invested: ₹\${actualInvestment.toFixed(0)} | Avail: ₹\${state.availableCash.toFixed(0)} | Qty: \${positionSize}\`);

      state.openPositions.push({
        id: \`bt_\${cand.nextCandle.timestamp}_\${cand.symbol}\`,
        symbol: cand.symbol,
        entryTime: cand.nextCandle.timestamp ?? 0,
        entryPrice: entry,
        positionSize,
        riskPerShare,
        sl, tp1, tp2,
        tp1Hit: false,
        tp1Qty,
        remainderQty: positionSize - tp1Qty,
        tp1ExitPrice: 0,
        currentStop: sl,
        runningMaxHigh: entry,
        runningMinLow: entry,
        investmentAmount: actualInvestment,
        breakEvenPrice,
        instrument: config.scalpConfig.instrument,
        useFixedRR: !!config.scalpConfig.useFixedRR,
        useTrailAfterTP1: !!config.scalpConfig.useTrailAfterTP1,
        trailDistanceR: config.scalpConfig.trailDistanceR ?? 0.5,
        tradeContext: {
          id: \`bt_\${cand.nextCandle.timestamp}_\${cand.symbol}\`,
          symbol: cand.symbol,
          entryTime: cand.nextCandle.timestamp ?? 0,
          entryPrice: entry,
          bullScore: decision.bullScore,
          bearScore: decision.bearScore,
          margin: decision.margin,
          bullJ1: decision.bullJ1,
          bullJ2: decision.bullJ2,
          bullJ3: decision.bullJ3,
          bullTotal: decision.bullTotal,
          j4Verdict: decision.skepticVerdict,
          j4PenaltyPct: decision.j4PenaltyPct,
          patternNames,
          atrAtEntry,
          atrPercentile,
          entryTimeBucket,
          dayOfWeek,
          j3Components,
          j1Range: cand.j1RangeStr,
          j2Range: cand.j2RangeStr,
          j3Range: cand.j3RangeStr,
          requestedInvestment: desiredNotional,
          actualInvestment: actualInvestment,
          availableCashBefore,
          allocationPct
        }
      });
    }
  }

  // FORCE CLOSE ANY REMAINING OPEN POSITIONS AT THE END OF THE BACKTEST
  for (const pos of state.openPositions) {
     const lastCandle = allStockCandles[pos.symbol][allStockCandles[pos.symbol].length - 1];
     const exitPrice = lastCandle ? lastCandle.close : pos.entryPrice;
     const outcome = 'TIME_EXIT';

     let netPnL = 0;
     let totalCharges = 0;

     if (pos.tp1Hit && pos.tp1ExitPrice > 0) {
       const leg1Charges = computeRoundTripCharges(pos.entryPrice, pos.tp1ExitPrice, pos.tp1Qty, pos.instrument).total;
       const leg2Charges = computeRoundTripCharges(pos.entryPrice, exitPrice, pos.remainderQty, pos.instrument).total;
       const leg1PnL = (pos.tp1ExitPrice - pos.entryPrice) * pos.tp1Qty - leg1Charges;
       const leg2PnL = (exitPrice - pos.entryPrice) * pos.remainderQty - leg2Charges;
       netPnL = leg1PnL + leg2PnL;
       totalCharges = leg1Charges + leg2Charges;
     } else {
       totalCharges = computeRoundTripCharges(pos.entryPrice, exitPrice, pos.positionSize, pos.instrument).total;
       netPnL = (exitPrice - pos.entryPrice) * pos.positionSize - totalCharges;
     }

     const rMultiple = pos.riskPerShare > 0 ? netPnL / (pos.riskPerShare * pos.positionSize) : 0;
     const durationMinutes = ((lastCandle?.timestamp ?? pos.entryTime) - pos.entryTime) / 60000;

     // Return capital + realized PnL to availableCash
     const cashReleased = pos.investmentAmount + netPnL;
     state.availableCash += cashReleased;
     state.realizedPnL += netPnL;

     const finalTrade = {
        ...pos.tradeContext,
        exitTime: lastCandle?.timestamp ?? pos.entryTime,
        exitPrice: exitPrice,
        outcome,
        pnl: netPnL,
        rMultiple,
        durationMinutes,
        availableCashAfter: state.availableCash
     } as BacktestTrade;
     trades.push(finalTrade);
  }
  state.openPositions = []; // All closed

  // Reconciliation Check
  const finalCapital = state.availableCash;
  const theoreticalFinal = state.initialCapital + state.realizedPnL;
  if (Math.abs(finalCapital - theoreticalFinal) > 1.0) {
    log(\`[ERROR] RECONCILIATION FAILED: Final \${finalCapital.toFixed(2)} != Initial + PnL \${theoreticalFinal.toFixed(2)}\`);
  } else {
    log(\`[RECONCILIATION] PASSED: Initial(₹\${state.initialCapital}) + PnL(₹\${state.realizedPnL.toFixed(2)}) = Final(₹\${finalCapital.toFixed(2)})\`);
  }

  // Since computeBacktestStats is strictly for BacktestResult, we need a flat list of ALL trades across ALL stocks for it.
  const flatCandles: OHLCV[] = []; // Not directly used by computeBacktestStats heavily except maybe duration
  const res = computeBacktestStats(flatCandles, config, trades, logs);

  res.initialCapital = state.initialCapital;
  res.finalCapital = finalCapital;
  res.availableCash = state.availableCash;
  res.totalInvestedCapital = state.totalInvestedCapital;
  res.openPositionValue = 0; // Forced closed at end
  res.unrealizedPnL = 0;

  return res;
}
`;

content = content + '\n' + codeToInsert;
fs.writeFileSync('src/quant/backtestEngine.ts', content, 'utf8');
