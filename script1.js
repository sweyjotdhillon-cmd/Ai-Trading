const fs = require('fs');

const code = fs.readFileSync('src/quant/ruleEngine.ts', 'utf8');

// We will map out where J1, J2, J3 blocks start and end.
const j1StartIdx = code.indexOf(`  // ═════════════════════════════════════════════════════════════\n  // J1 REASONING`);
const j2StartIdx = code.indexOf(`  // ═════════════════════════════════════════════════════════════\n  // J2 VEHICLE`);
const j3StartIdx = code.indexOf(`  // ═════════════════════════════════════════════════════════════\n  // J3 REVERSAL`);
const j4StartIdx = code.indexOf(`  // =========================================================================\n  // J4 SKEPTIC`);

console.log("J1 starts at", j1StartIdx);
console.log("J2 starts at", j2StartIdx);
console.log("J3 starts at", j3StartIdx);
console.log("J4 starts at", j4StartIdx);
