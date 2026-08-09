const fs = require('fs');

let engine = fs.readFileSync('src/quant/backtestEngine.ts', 'utf8');

// I need to add a check: if availableCash < 0 throw Error right after deductions
const deductionCode = `      // Deduct cash and open position
      state.availableCash -= actualInvestment;
      state.totalInvestedCapital += actualInvestment;`;

const newDeductionCode = `      // Deduct cash and open position
      state.availableCash -= actualInvestment;
      state.totalInvestedCapital += actualInvestment;
      if (state.availableCash < 0) {
        throw new Error(\`[RECONCILIATION ERROR] availableCash dropped below 0 (₹\${state.availableCash.toFixed(2)})\`);
      }`;

engine = engine.replace(deductionCode, newDeductionCode);

fs.writeFileSync('src/quant/backtestEngine.ts', engine, 'utf8');
