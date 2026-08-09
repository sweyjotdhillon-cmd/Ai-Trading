const fs = require('fs');
let engine = fs.readFileSync('src/quant/backtestEngine.ts', 'utf8');

// The original signature expects `candles: OHLCV[]` to calculate start/end dates.
// In runPortfolioBacktest, I passed an empty array `flatCandles`. I need to fix it.
engine = engine.replace(
  'const flatCandles: OHLCV[] = []; // Not directly used by computeBacktestStats heavily except maybe duration',
  `const flatCandles: OHLCV[] = [];
  if (timeline.length > 0) {
    flatCandles.push({ timestamp: timeline[0], open:0, high:0, low:0, close:0, volume:0 });
    flatCandles.push({ timestamp: timeline[timeline.length - 1], open:0, high:0, low:0, close:0, volume:0 });
  }`
);

fs.writeFileSync('src/quant/backtestEngine.ts', engine, 'utf8');
