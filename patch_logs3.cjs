const fs = require('fs');

let typesContent = fs.readFileSync('src/types/backtest.ts', 'utf8');
typesContent = typesContent.replace(
  'openPositions: OpenPosition[];\n}',
  'openPositions: OpenPosition[];\n  sequenceId?: number;\n}'
);
fs.writeFileSync('src/types/backtest.ts', typesContent, 'utf8');

// I also need to ensure that the Reconciliation is logged accurately as requested.
let engine = fs.readFileSync('src/quant/backtestEngine.ts', 'utf8');

const oldRecon = `  const theoreticalFinal = state.initialCapital + state.realizedPnL;
  if (Math.abs(finalCapital - theoreticalFinal) > 1.0) {
    log(\`[ERROR] RECONCILIATION FAILED: Final \${finalCapital.toFixed(2)} != Initial + PnL \${theoreticalFinal.toFixed(2)}\`);
  } else {
    log(\`[RECONCILIATION] PASSED: Initial(₹\${state.initialCapital}) + PnL(₹\${state.realizedPnL.toFixed(2)}) = Final(₹\${finalCapital.toFixed(2)})\`);
  }`;

const newRecon = `  const theoreticalFinal = state.initialCapital + state.realizedPnL;
  if (Math.abs(finalCapital - theoreticalFinal) > 1.0) {
    log(\`[RECONCILIATION ERROR] Final \${finalCapital.toFixed(2)} != Initial \${state.initialCapital.toFixed(2)} + PnL \${state.realizedPnL.toFixed(2)}\`);
    throw new Error(\`Reconciliation Failed: Final Capital (\${finalCapital}) does not match Initial + PnL (\${theoreticalFinal})\`);
  } else {
    log(\`[RECONCILIATION] PASSED: Initial(₹\${state.initialCapital}) + PnL(₹\${state.realizedPnL.toFixed(2)}) = Final(₹\${finalCapital.toFixed(2)})\`);
  }`;

engine = engine.replace(oldRecon, newRecon);
fs.writeFileSync('src/quant/backtestEngine.ts', engine, 'utf8');
