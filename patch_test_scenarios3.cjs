const fs = require('fs');
let testContent = fs.readFileSync('src/quant/__tests__/portfolio.test.ts', 'utf8');

// The Win trade had a PnL of -500 because the SL hit on the entry candle again!
// Let's fix the win scenario candles.
// createCandle(4000, 100, 104, 95, 104) -> Low is 95, SL hits!
// It should be: createCandle(4000, 100, 104, 100, 104)

testContent = testContent.replace('createCandle(4000, 100, 104, 95, 104),  // TP hits at 102 (+2 per share = +1000 PnL)', 'createCandle(4000, 100, 104, 100, 104),  // TP hits at 102 (+2 per share = +1000 PnL)');

fs.writeFileSync('src/quant/__tests__/portfolio.test.ts', testContent, 'utf8');
