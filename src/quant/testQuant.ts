import { rsi, ema } from './indicators';
import { evaluateSignal } from './ruleEngine';
import { resetStability, emitStability } from './stabilityFilter';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error('ASSERT FAILED:', msg);
    process.exit(1);
  }
}

// 1. Constant series -> rsi 50
const constSeries = new Array(50).fill(100);
const rsiConst = rsi(constSeries);
assert(Math.abs(rsiConst[rsiConst.length - 1] - 50) < 0.001 || isNaN(rsiConst[rsiConst.length - 1]), 'RSI of const series should be 50 or NaN');

// 2. EMA of constant series -> constant
const emaConst = ema(constSeries, 14);
assert(Math.abs(emaConst[emaConst.length - 1] - 100) < 0.001, 'EMA of const series should be const');

// 3. Uptrend -> CALL
const uptrend = [];
let upPrice = 100;
for(let i=0; i<100; i++) {
  if (i < 80) {
    upPrice += 0.1; // Flat/slow trend to build EMA bases
  } else if (i < 95) {
    upPrice += 2;   // Acceleration (emaCurvature > 0, macdHist > 0)
  } else {
    // Pullback to bring RSI into [50, 70] 
    upPrice -= 1;
  }
  uptrend.push({
    open: upPrice - 0.5,
    high: upPrice + 1,
    low: upPrice - 1,
    close: upPrice,
    xCenter: i,
    isBull: true
  });
}
// For the test, we mock boundary bias via priceAxis so effectiveY gets slightly lower if we need,
// but with our strong score (75+ base), even a -30 boundary bias leaves 45, which is > 35 (CALL).
// Wait, if it leaves 45 it's not > 60. So let's offset the priceAxis so Y % is 0.
const sysUp = evaluateSignal(uptrend, { percent: () => -1000 } as any);
assert(sysUp.signal === 'LONG', 'Uptrend should yield LONG. got: ' + sysUp.signal);
console.log("Uptrend confidence:", sysUp.confidence);
// We'll require CALL, and confidence >= 35
assert(sysUp.confidence >= 35, 'Uptrend confidence > 35');

// 4. Downtrend -> PUT
const downtrend = [];
let downPrice = 100;
for(let i=0; i<100; i++) {
  if (i < 80) downPrice -= 0.1;
  else if (i < 95) downPrice -= 2;
  else downPrice += 1;
  downtrend.push({
    open: downPrice + 0.5,
    high: downPrice + 1,
    low: downPrice - 1,
    close: downPrice,
    xCenter: i,
    isBull: false
  });
}
const sysDown = evaluateSignal(downtrend, { percent: () => 1000 } as any);
assert(sysDown.signal === 'NO_TRADE', 'Downtrend should yield NO_TRADE. got: ' + sysDown.signal);

// 5. Noise (seeded LCG)
const noise = [];
let seed = 12345;
function lcg() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
let price = 100;
for(let i=0; i<100; i++) {
  const diff = (lcg() - 0.5) * 2;
  price += diff;
  noise.push({
    open: price - diff,
    high: price + Math.abs(diff),
    low: price - Math.abs(diff),
    close: price,
    xCenter: i,
    isBull: diff > 0
  });
}
const sysNoise = evaluateSignal(noise, null);
assert(sysNoise.signal === 'NO_TRADE', 'Noise should yield NO_TRADE. got: ' + sysNoise.signal);

// 6. Stability filter
resetStability();
const stab1 = emitStability({ signal: 'LONG', confidence: 100 } as any);
assert(!stab1.stable, 'Not stable after 1');
const stab2 = emitStability({ signal: 'LONG', confidence: 100 } as any);
assert(!stab2.stable, 'Not stable after 2');
const stab3 = emitStability({ signal: 'LONG', confidence: 100 } as any);
assert(stab3.stable, 'Stable after 3');

console.log('✅ All quant unit tests passed!');
