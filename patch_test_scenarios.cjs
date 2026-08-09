const fs = require('fs');
let testContent = fs.readFileSync('src/quant/__tests__/portfolio.test.ts', 'utf8');

// I need to add Test C (capital release + PnL) and the loss scenario.

const newTests = `
  it('Test C & Scenarios 3/8: Capital is released exactly once upon close, including PnL (Win & Loss)', () => {
    // Win scenario: Trade A closes for profit
    const candlesA = getPaddedCandles([
      createCandle(1000, 100, 100, 100, 100),
      createCandle(2000, 100, 100, 100, 101), // Signal
      createCandle(3000, 100, 100, 100, 100),  // Entry 100 (size 500)
      createCandle(4000, 100, 104, 95, 104),  // TP hits at 102 (+2 per share = +1000 PnL)
    ], 100);

    const winResult = runPortfolioBacktest({ STOCK_A: candlesA }, config);
    expect(winResult.trades.length).toBe(1);
    const winTrade = winResult.trades[0];

    // Initial 100,000 -> Invest 50,000. Cash=50,000.
    // Close at 102. Profit = 500 * (102 - 100) = 1000.
    // Cash = 50,000 (remaining) + 50,000 (returned) + 1000 (PnL) = 101,000.
    expect(winTrade.pnl).toBe(1000);
    expect(winTrade.availableCashAfter).toBe(101000);
    expect(winResult.finalCapital).toBe(101000);

    // Loss scenario: Trade A closes for loss
    const candlesLoss = getPaddedCandles([
      createCandle(1000, 100, 100, 100, 100),
      createCandle(2000, 100, 100, 100, 101), // Signal
      createCandle(3000, 100, 100, 100, 100),  // Entry 100 (size 500)
      createCandle(4000, 100, 100, 95, 100),  // SL hits at 99 (-1 per share = -500 PnL)
    ], 100);

    const lossResult = runPortfolioBacktest({ STOCK_A: candlesLoss }, config);
    expect(lossResult.trades.length).toBe(1);
    const lossTrade = lossResult.trades[0];

    // Initial 100,000 -> Invest 50,000. Cash=50,000.
    // Close at 99. Profit = 500 * (99 - 100) = -500.
    // Cash = 50,000 (remaining) + 50,000 (returned) - 500 (PnL) = 99,500.
    expect(lossTrade.pnl).toBe(-500);
    expect(lossTrade.availableCashAfter).toBe(99500);
    expect(lossResult.finalCapital).toBe(99500);

    // Trade B opens AFTER loss: Uses 50% of 99,500 = 49,750
    const candlesBLoss = getPaddedCandles([
      createCandle(4000, 200, 200, 200, 200),
      createCandle(5000, 200, 200, 200, 101), // Signal after A closed
      createCandle(6000, 200, 200, 200, 200), // Entry 200
      createCandle(7000, 200, 210, 190, 205), // TP
    ], 200);

    const seqResult = runPortfolioBacktest({ STOCK_A: candlesLoss, STOCK_B: candlesBLoss }, config);
    expect(seqResult.trades.length).toBe(2);
    const bTrade = seqResult.trades.find(t => t.symbol === 'STOCK_B');
    expect(bTrade?.availableCashBefore).toBe(99500);
    expect(bTrade?.actualInvestment).toBe(49600); // Math.floor(49750 / 200) * 200 = 248 * 200 = 49600
  });
`;

testContent = testContent.replace("});\n", "});\n" + newTests);
fs.writeFileSync('src/quant/__tests__/portfolio.test.ts', testContent, 'utf8');
