const fs = require('fs');
let engine = fs.readFileSync('src/quant/backtestEngine.ts', 'utf8');

// Add sequenceId to portfolio state
engine = engine.replace(
  'openPositions: OpenPosition[];',
  'openPositions: OpenPosition[];\n  sequenceId: number;'
);

// Init
engine = engine.replace(
  'openPositions: []\n  };',
  'openPositions: [],\n    sequenceId: 1\n  };'
);

engine = engine.replace(
  'log(`[INIT] Starting Portfolio Backtest | Initial Capital: ₹${initialCapital} | Max Trades/Day: ${config.maxTradesPerDay} | Margin Thresh: ${config.marginThreshold}`);',
  `log(\`[PORTFOLIO INIT]
initialCapital: ₹\${initialCapital}
availableCash: ₹\${initialCapital}
realizedPnL: 0
totalInvestedCapital: 0
openPositions: 0
\`);
  log(\`[INIT] Starting Portfolio Backtest | Max Trades/Day: \${config.maxTradesPerDay} | Margin Thresh: \${config.marginThreshold}\`);`
);

// Exit logging
const oldExitLog = `        const availableCashBefore = state.availableCash;
        state.availableCash += cashReleased;
        state.realizedPnL += netPnL;

        log(\`[EXIT] [\${timeStr}] \${pos.symbol} | Outcome: \${outcome} | PnL: ₹\${netPnL.toFixed(2)} | Cash \${availableCashBefore.toFixed(0)} -> \${state.availableCash.toFixed(0)}\`);`;

const newExitLog = `        const availableCashBefore = state.availableCash;
        state.availableCash += cashReleased;
        const realizedPnLBefore = state.realizedPnL;
        state.realizedPnL += netPnL;

        const seq = String(state.sequenceId++).padStart(3, '0');
        log(\`[PORTFOLIO EVENT #\${seq}] [PORTFOLIO EXIT]
timestamp: \${timeStr}
symbol: \${pos.symbol}
entryTime: \${new Date(pos.entryTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
entryPrice: ₹\${pos.entryPrice.toFixed(2)}
exitPrice: ₹\${exitPrice.toFixed(2)}
quantity: \${pos.positionSize}
originalInvestment: ₹\${pos.investmentAmount.toFixed(2)}
grossPnL: ₹\${(netPnL + totalCharges).toFixed(2)}
charges: ₹\${totalCharges.toFixed(2)}
netPnL: ₹\${netPnL.toFixed(2)}
capitalReleased: ₹\${cashReleased.toFixed(2)}
availableCashBefore: ₹\${availableCashBefore.toFixed(2)}
availableCashAfter: ₹\${state.availableCash.toFixed(2)}
realizedPnLBefore: ₹\${realizedPnLBefore.toFixed(2)}
realizedPnLAfter: ₹\${state.realizedPnL.toFixed(2)}
openPositionsBefore: \${state.openPositions.length}
openPositionsAfter: \${state.openPositions.length - 1}
totalInvestedCapitalAfter: ₹\${(state.totalInvestedCapital - pos.investmentAmount).toFixed(2)}
totalEquityAfter: ₹\${(state.availableCash + (state.totalInvestedCapital - pos.investmentAmount) + state.realizedPnL).toFixed(2)}\n\`);`;

engine = engine.replace(oldExitLog, newExitLog);


fs.writeFileSync('src/quant/backtestEngine.ts', engine, 'utf8');
