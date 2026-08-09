const fs = require('fs');

let testContent = fs.readFileSync('src/quant/__tests__/portfolio.test.ts', 'utf8');

// The issue is actualInvestment is 49600.
// Let's look at why tradeB is 49600.
// The entry price is 200. We want to invest 25,000.
// 25,000 / 200 = 125 shares.
// 125 * 200 = 25,000.
// Why did it invest 49,600?
// Oh! Because tradeA was closed BEFORE tradeB opened?
// Let's check timestamps.
// Trade A entry is 4000.
// Trade A TP hits 102 at ts 8000.
// Trade B signal is at 4000, entry at 5000.
// Wait, if Trade B entry is 5000, Trade A is still open.
// So cash should be 50,000.
// Let's debug logs in test.
