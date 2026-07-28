const fs = require('fs');

let code = fs.readFileSync('src/quant/pathSimulator.ts', 'utf8');

const target = `
    // TP1 partial book (50% booking)
    if (!tp1Hit && c.high >= plan.takeProfit1) {
      const half = Math.floor(position / 2);
      if (half > 0) {
        realizedGross += (plan.takeProfit1 - entryEffective) * half;
        position -= half;
      }
      currentSL = entryEffective; // break-even shift on SL
      tp1Hit = true;
      events.push({ barIndex: i, price: plan.takeProfit1, event: 'TP1' });
      events.push({ barIndex: i, price: entryEffective, event: 'BE_SHIFT', newSL: currentSL });
    }

    // Trail after TP1
    if (tp1Hit && config.tpMode === 'PARTIAL_RR') {
      const newTrail = c.high - plan.trailingDistance;
      if (newTrail > currentSL) {
        currentSL = newTrail;
        events.push({ barIndex: i, price: c.high, event: 'TRAIL_UPDATE', newSL: currentSL });
      }
    }
`;

const replacement = `
    // TP1 partial book (50% booking)
    let tp1HitThisCandle = false;
    if (!tp1Hit && c.high >= plan.takeProfit1) {
      const half = Math.floor(position / 2);
      if (half > 0) {
        realizedGross += (plan.takeProfit1 - entryEffective) * half;
        position -= half;
      }
      currentSL = entryEffective; // break-even shift on SL
      tp1Hit = true;
      tp1HitThisCandle = true;
      events.push({ barIndex: i, price: plan.takeProfit1, event: 'TP1' });
      events.push({ barIndex: i, price: entryEffective, event: 'BE_SHIFT', newSL: currentSL });
    }

    // Trail after TP1
    if (tp1Hit && !tp1HitThisCandle && config.tpMode === 'PARTIAL_RR') {
      const newTrail = c.high - plan.trailingDistance;
      if (newTrail > currentSL) {
        currentSL = newTrail;
        events.push({ barIndex: i, price: c.high, event: 'TRAIL_UPDATE', newSL: currentSL });
      }
    }
`;

if (code.includes(target.trim())) {
  code = code.replace(target.trim(), replacement.trim());
  fs.writeFileSync('src/quant/pathSimulator.ts', code);
  console.log('pathSimulator.ts updated successfully');
} else {
  console.log('Could not find target block in pathSimulator.ts');
}
