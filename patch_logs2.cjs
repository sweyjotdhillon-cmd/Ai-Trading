const fs = require('fs');
let engine = fs.readFileSync('src/quant/backtestEngine.ts', 'utf8');

// Add ENTRY ORDER logging
const sortBlock = `    // Sort candidates deterministically: highest margin first, then alphabetically
    entryCandidates.sort((a, b) => {
      if (b.decision.margin !== a.decision.margin) return b.decision.margin - a.decision.margin;
      return a.symbol.localeCompare(b.symbol);
    });`;

const newSortBlock = `    // Sort candidates deterministically: highest margin first, then alphabetically
    entryCandidates.sort((a, b) => {
      if (b.decision.margin !== a.decision.margin) return b.decision.margin - a.decision.margin;
      return a.symbol.localeCompare(b.symbol);
    });

    if (entryCandidates.length > 1) {
      log(\`\\n[ENTRY ORDER]\\ntimestamp: \${timeStr}\\n\`);
      entryCandidates.forEach((c, i) => {
        log(\`\${i + 1}. \${c.symbol} (Margin: \${c.decision.margin.toFixed(2)})\`);
      });
      log(\`\\n\`);
    }`;
engine = engine.replace(sortBlock, newSortBlock);

// Entry Candidates logging
const oldEntryLoop = `      const riskPerShare = entry - sl;
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
      state.totalInvestedCapital += actualInvestment;`;

const newEntryLoop = `      const riskPerShare = entry - sl;
      if (!isFinite(riskPerShare) || riskPerShare <= 0) continue;

      // PORTFOLIO CASH GATE
      // Use CURRENT AVAILABLE CASH, not initial capital
      const riskPerTradePct = config.scalpConfig.riskPerTradePct ?? 1.0;
      const maxPositionPctCapital = config.scalpConfig.maxPositionPctCapital ?? 30;
      const lotSize = config.scalpConfig.lotSize ?? 1;

      const allocationPct = maxPositionPctCapital;
      const desiredNotional = state.availableCash * (allocationPct / 100);

      const maxRiskRupees = state.availableCash * (riskPerTradePct / 100);
      const riskBasedSize = Math.floor(maxRiskRupees / riskPerShare);

      const notionalCappedSize = Math.floor(desiredNotional / entry);

      let positionSize = Math.min(riskBasedSize, notionalCappedSize);
      if (lotSize > 1) {
        positionSize = Math.floor(positionSize / lotSize) * lotSize;
      }

      const actualInvestment = positionSize * entry;
      const availableCashBefore = state.availableCash;

      let accepted = true;
      let skipReason = 'NONE';
      if (positionSize <= 0 || actualInvestment > state.availableCash) {
        accepted = false;
        skipReason = \`Insufficient cash (Req: ₹\${actualInvestment.toFixed(0)}, Avail: ₹\${state.availableCash.toFixed(0)})\`;
      }

      const candSeq = String(state.sequenceId++).padStart(3, '0');
      log(\`[PORTFOLIO EVENT #\${candSeq}] [ENTRY CANDIDATE]
timestamp: \${timeStr}
symbol: \${cand.symbol}
availableCashBefore: ₹\${availableCashBefore.toFixed(2)}
requestedAllocationPct: \${allocationPct}%
requestedInvestment: ₹\${desiredNotional.toFixed(2)}
calculatedRiskBasedSize: \${riskBasedSize}
calculatedNotionalSize: \${notionalCappedSize}
finalPositionSize: \${positionSize}
actualInvestment: ₹\${actualInvestment.toFixed(2)}
decision: \${cand.decision.winner} (Margin: \${cand.decision.margin.toFixed(2)})
accepted: \${accepted}
skipReason: \${skipReason}
\`);

      if (!accepted) {
        continue;
      }

      // Deduct cash and open position
      state.availableCash -= actualInvestment;
      state.totalInvestedCapital += actualInvestment;

      const entrySeq = String(state.sequenceId++).padStart(3, '0');
      log(\`[PORTFOLIO EVENT #\${entrySeq}] [PORTFOLIO ENTRY]
timestamp: \${timeStr}
symbol: \${cand.symbol}
entryPrice: ₹\${entry.toFixed(2)}
quantity: \${positionSize}
investment: ₹\${actualInvestment.toFixed(2)}
availableCashBefore: ₹\${availableCashBefore.toFixed(2)}
cashDeducted: ₹\${actualInvestment.toFixed(2)}
availableCashAfter: ₹\${state.availableCash.toFixed(2)}
totalInvestedCapitalAfter: ₹\${state.totalInvestedCapital.toFixed(2)}
openPositionsAfter: \${state.openPositions.length + 1}
realizedPnL: ₹\${state.realizedPnL.toFixed(2)}
totalEquityAfter: ₹\${(state.availableCash + state.totalInvestedCapital + state.realizedPnL).toFixed(2)}\n\`);
`;

engine = engine.replace(oldEntryLoop, newEntryLoop);

// Add Snapshot
const endOfLoop = `  // FORCE CLOSE ANY REMAINING OPEN POSITIONS AT THE END OF THE BACKTEST`;
const snapshot = `    if (state.openPositions.length > 0) {
      log(\`[PORTFOLIO SNAPSHOT]
timestamp: \${timeStr}
availableCash: ₹\${state.availableCash.toFixed(2)}
investedCapital: ₹\${state.totalInvestedCapital.toFixed(2)}
realizedPnL: ₹\${state.realizedPnL.toFixed(2)}
totalEquity: ₹\${(state.availableCash + state.totalInvestedCapital + state.realizedPnL).toFixed(2)}
openPositionCount: \${state.openPositions.length}
\`);
    }

  } // End of timeline loop
`;

// wait, I can just replace the end of the loop directly:
engine = engine.replace(
  `    }
  }

  // FORCE CLOSE ANY REMAINING OPEN POSITIONS`,
  `    }
${snapshot}
  // FORCE CLOSE ANY REMAINING OPEN POSITIONS`
);

fs.writeFileSync('src/quant/backtestEngine.ts', engine, 'utf8');
