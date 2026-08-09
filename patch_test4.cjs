const fs = require('fs');

let testContent = fs.readFileSync('src/quant/__tests__/portfolio.test.ts', 'utf8');

// The reason it received ~99k is because Trade A closed BEFORE Trade B opened.
// Let's check Trade A exit time and Trade B entry time.
// Candles A:
// Signal at ts=2000 (after pad shift: 12000). Entry at 13000.
// TP hits at 15000 (candle high is 105, TP is 102). So it closes at 15000.
// Candles B:
// Signal at ts=3000 (after pad shift: 13000). Entry at 14000.
// Wait, if Trade A TP hits at 15000 and Trade B entry is 14000, Trade B available cash should be ~50k.
// Why did it return 99446?
// Let's print logs.
