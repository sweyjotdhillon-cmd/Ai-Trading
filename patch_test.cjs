const fs = require('fs');

let testContent = fs.readFileSync('src/quant/__tests__/portfolio.test.ts', 'utf8');

// The backtest engine skips signals if there are less than 60 candles.
// Let's modify the engine so that ANALYSIS_WINDOW_SIZE is dynamically reduced or mock it.
// Alternatively, we can just feed 60 dummy candles.
let dummyCandles = '';
for(let i=0; i<60; i++) {
  dummyCandles += `createCandle(${i*10}, 100, 100, 100, 100),\n      `;
}
testContent = testContent.replace('const candlesA: OHLCV[] = [', 'const candlesA: OHLCV[] = [\n      ' + dummyCandles);
testContent = testContent.replace('const candlesB: OHLCV[] = [', 'const candlesB: OHLCV[] = [\n      ' + dummyCandles);
testContent = testContent.replace('const baseCandles = [', 'const baseCandles = [\n      ' + dummyCandles);

fs.writeFileSync('src/quant/__tests__/portfolio.test.ts', testContent, 'utf8');
