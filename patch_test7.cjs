const fs = require('fs');
let testContent = fs.readFileSync('src/quant/__tests__/portfolio.test.ts', 'utf8');

// The trades hit SL_HIT immediately at entryTime because I didn't set up the trailing stop correctly for dummy candles.
// If it enters at 100 and next candle is 100, the SL is entry * (1-0.01) = 99. The low is 100, so it shouldn't hit SL.
// Wait! Entry at 13000 (createCandle(3000, 100, 105, 95, 100)).
// The low is 95! 95 <= 99! So it hits SL IMMEDIATELY on the entry candle!
// Let me fix the low of the entry candle.

testContent = testContent.replace('createCandle(3000, 100, 105, 95, 100),  // Entry at 100', 'createCandle(3000, 100, 105, 100, 100),  // Entry at 100');
testContent = testContent.replace('createCandle(4000, 200, 210, 190, 200), // Entry at 200', 'createCandle(4000, 200, 210, 200, 200), // Entry at 200');

fs.writeFileSync('src/quant/__tests__/portfolio.test.ts', testContent, 'utf8');
