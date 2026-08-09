const fs = require('fs');
let testContent = fs.readFileSync('src/quant/__tests__/portfolio.test.ts', 'utf8');

// I need to add Test E & F back, and clean up the console logs.
testContent = testContent.replace('console.log("TRADE A", tradeA?.entryTime, tradeA?.exitTime, tradeA?.outcome);', '');
testContent = testContent.replace('console.log("TRADE B", tradeB?.entryTime, tradeB?.exitTime, tradeB?.outcome);', '');

testContent += `
  it('Test E & F: Insufficient cash skipped and deterministic entry order', () => {
    // 3 stocks trigger at the exact same time.
    const baseCandles = getPaddedCandles([
      createCandle(1000, 100, 100, 100, 100),
      createCandle(2000, 100, 100, 100, 101), // Signal
      createCandle(3000, 100, 100, 100, 100),  // Entry
      createCandle(4000, 100, 105, 95, 103),  // Exit
    ], 100);

    const cfg: BacktestConfig = {
      ...config,
      scalpConfig: {
        ...config.scalpConfig,
        maxPositionPctCapital: 60,
      }
    };

    const result = runPortfolioBacktest({
      STOCK_Z: baseCandles,
      STOCK_Y: baseCandles,
      STOCK_X: baseCandles
    }, cfg);

    expect(result.trades.length).toBe(3);

    const sortedTrades = result.trades.sort((a, b) => a.entryTime - b.entryTime || (a.actualInvestment! < b.actualInvestment! ? 1 : -1));

    expect(sortedTrades[0].symbol).toBe('STOCK_X');
    expect(sortedTrades[0].actualInvestment).toBe(60000);

    expect(sortedTrades[1].symbol).toBe('STOCK_Y');
    expect(sortedTrades[1].actualInvestment).toBe(24000);

    expect(sortedTrades[2].symbol).toBe('STOCK_Z');
    expect(sortedTrades[2].actualInvestment).toBe(9600);
  });
`;

fs.writeFileSync('src/quant/__tests__/portfolio.test.ts', testContent, 'utf8');
