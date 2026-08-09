const fs = require('fs');
let typesContent = fs.readFileSync('src/types/backtest.ts', 'utf8');
typesContent = typesContent.replace('exitPrice:        number | null;', 'exitPrice:        number | null;\n  requestedInvestment?: number;\n  actualInvestment?: number;\n  availableCashBefore?: number;\n  availableCashAfter?: number;\n  allocationPct?: number;');
fs.writeFileSync('src/types/backtest.ts', typesContent, 'utf8');
