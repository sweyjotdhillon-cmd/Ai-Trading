const fs = require('fs');
let testContent = fs.readFileSync('src/quant/__tests__/portfolio.test.ts', 'utf8');

// The entry candle HIGH is 105, which is > TP (102)! So it exits immediately on the entry candle!
// Let me fix the high of the entry candle.

testContent = testContent.replace('createCandle(3000, 100, 105, 100, 100),  // Entry at 100', 'createCandle(3000, 100, 100, 100, 100),  // Entry at 100');
testContent = testContent.replace('createCandle(4000, 200, 210, 200, 200), // Entry at 200', 'createCandle(4000, 200, 200, 200, 200), // Entry at 200');

fs.writeFileSync('src/quant/__tests__/portfolio.test.ts', testContent, 'utf8');
