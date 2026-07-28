const fs = require('fs');

let code = fs.readFileSync('src/quant/backtestEngine.ts', 'utf8');

const target = `
      // TP1 check (only before it's been booked) - skipped entirely in fixed-R:R mode
      const candleHigh = c.high;
      if (!config.scalpConfig.useFixedRR && !tp1Hit && candleHigh >= tp1) {
        log('[TP1_CHECK] hit at candle ' + k);
        tp1Hit = true;
        tp1ExitPrice = tp1;
        currentStop = breakEvenPrice;
        log(\`  -> TP1 HIT at \${tp1.toFixed(2)} (Candle High: \${c.high.toFixed(2)}) | Booked \${tp1Qty} shares | Stop moved to breakeven \${breakEvenPrice.toFixed(2)} for remaining \${remainderQty}\`);
      }

      if (c.high >= tp2) {
        outcome = 'TP2_HIT';
        exitPrice = tp2;
        exitIdx = k;
        log(\`  -> TP2 HIT at \${tp2.toFixed(2)} (Candle High: \${c.high.toFixed(2)})\`);
        break;
      }

      // Trailing stop AFTER TP1 (replaces flat breakeven if enabled) - ratchets the stop up
      // behind the running high for use starting the NEXT candle.
      if (config.scalpConfig.useTrailAfterTP1 && tp1Hit) {
        const trailDistanceR = 0.25; // Variant D1 (0.5x of original 0.5R)
        const trailStop = runningMaxHigh - riskPerShare * trailDistanceR;
        if (trailStop > currentStop) {
          currentStop = trailStop;
        }
      }
`;

const replacement = `
      // TP1 check (only before it's been booked) - skipped entirely in fixed-R:R mode
      const candleHigh = c.high;
      let tp1HitThisCandle = false;
      if (!config.scalpConfig.useFixedRR && !tp1Hit && candleHigh >= tp1) {
        log('[TP1_CHECK] hit at candle ' + k);
        tp1Hit = true;
        tp1HitThisCandle = true;
        tp1ExitPrice = tp1;
        currentStop = breakEvenPrice;
        log(\`  -> TP1 HIT at \${tp1.toFixed(2)} (Candle High: \${c.high.toFixed(2)}) | Booked \${tp1Qty} shares | Stop moved to breakeven \${breakEvenPrice.toFixed(2)} for remaining \${remainderQty}\`);
      }

      if (c.high >= tp2) {
        outcome = 'TP2_HIT';
        exitPrice = tp2;
        exitIdx = k;
        log(\`  -> TP2 HIT at \${tp2.toFixed(2)} (Candle High: \${c.high.toFixed(2)})\`);
        break;
      }

      // Trailing stop AFTER TP1 (replaces flat breakeven if enabled) - ratchets the stop up
      // behind the running high for use starting the NEXT candle.
      if (config.scalpConfig.useTrailAfterTP1 && tp1Hit && !tp1HitThisCandle) {
        const trailDistanceR = config.scalpConfig.trailDistanceR ?? 0.25;
        const trailStop = runningMaxHigh - riskPerShare * trailDistanceR;
        if (trailStop > currentStop) {
          currentStop = trailStop;
        }
      }
`;

if (code.includes(target.trim())) {
  code = code.replace(target.trim(), replacement.trim());
  fs.writeFileSync('src/quant/backtestEngine.ts', code);
  console.log('backtestEngine.ts updated successfully');
} else {
  console.log('Could not find target block in backtestEngine.ts');
}
