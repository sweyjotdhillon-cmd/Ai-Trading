const fs = require('fs');

let testContent = fs.readFileSync('src/quant/__tests__/portfolio.test.ts', 'utf8');

testContent = testContent.replace('console.log("TRADE A", tradeA?.entryTime, tradeA?.exitTime, tradeA?.outcome);', '');
testContent = testContent.replace('console.log("TRADE B", tradeB?.entryTime, tradeB?.exitTime, tradeB?.outcome);', '');

testContent = testContent.replace('expect(tradeB?.availableCashBefore).toBe(50000);', `console.log("TRADE A", tradeA?.entryTime, tradeA?.exitTime, tradeA?.outcome);
    console.log("TRADE B", tradeB?.entryTime, tradeB?.exitTime, tradeB?.outcome);
    expect(tradeB?.availableCashBefore).toBe(50000);`);

fs.writeFileSync('src/quant/__tests__/portfolio.test.ts', testContent, 'utf8');
