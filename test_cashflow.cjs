const assert = require('assert');

let initialCapital = 100000;
let availableCash = initialCapital;
let openPositions = [];

function openPosition(investment) {
  if (investment > availableCash) {
    investment = availableCash;
  }
  availableCash -= investment;
  openPositions.push({ investment });
  return investment;
}

function closePosition(pos, pnl) {
  availableCash += pos.investment + pnl;
}

let invA = openPosition(50000);
console.log("InvA:", invA, "Avail:", availableCash);

let invB = openPosition(availableCash * 0.60);
console.log("InvB:", invB, "Avail:", availableCash);

closePosition(openPositions[0], 5000);
openPositions.shift();
console.log("Closed A. Avail:", availableCash);

closePosition(openPositions[0], -3000);
openPositions.shift();
console.log("Closed B. Avail:", availableCash);
