const fs = require('fs');
let testContent = fs.readFileSync('src/quant/__tests__/portfolio.test.ts', 'utf8');

testContent = testContent.replace('const result = runPortfolioBacktest({ STOCK_A: candlesA, STOCK_B: candlesB }, config);', `const result = runPortfolioBacktest({ STOCK_A: candlesA, STOCK_B: candlesB }, config);
    console.log("TRADE A", tradeA?.entryTime, tradeA?.exitTime, tradeA?.outcome);
    console.log("TRADE B", tradeB?.entryTime, tradeB?.exitTime, tradeB?.outcome);`);
// Also let's set charges to 0 by mocking brokerCharges so that math is exactly 50000 etc.
testContent = testContent.replace(`vi.mock('../indicators', async (importOriginal) => {
  return {
    atr: () => [1.0] // Always return 1 for ATR to make risk calculations simple
  };
});`, `vi.mock('../indicators', async (importOriginal) => {
  return {
    atr: () => [1.0] // Always return 1 for ATR to make risk calculations simple
  };
});
vi.mock('../brokerCharges', async (importOriginal) => {
  return {
    computeRoundTripCharges: () => ({ total: 0 })
  };
});`);

fs.writeFileSync('src/quant/__tests__/portfolio.test.ts', testContent, 'utf8');
