"use strict";
const fs = require("fs");
const code = fs.readFileSync("./src/quant/ruleEngine.ts", "utf8");
function doReplacements() {
  let newCode = code;
  newCode = newCode.replace(
    "const structSignal = detectStructureSignal(highs, lows, pivots);",
    "const structSignal = detectStructureSignal(closes, highs, lows, 2, pivots);"
  );
  newCode = newCode.replace(
    /let bullJ3Intrinsic = 0;\s*let bearJ3Intrinsic = 0;/,
    ""
  );
  newCode = newCode.replace(
    `  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // J2 VEHICLE`,
    `  let bullJ3Intrinsic = 0;
  let bearJ3Intrinsic = 0;

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // J2 VEHICLE`
  );
  newCode = newCode.replace(
    /Array\.from\(closes\)\.slice\(-32\)/g,
    `Array.from(closes).slice(-64)`
  );
  newCode = newCode.replace(
    /const H_exp = rescaledRangeHurst\(/g,
    `const recentSlopeSeries = emaSlope(Array.from(closes).slice(-64), 9);
  const recentSlope = recentSlopeSeries.length > 0 ? recentSlopeSeries[recentSlopeSeries.length - 1] : 0;

  const H_exp = rescaledRangeHurst(`
  );
  newCode = newCode.replace(
    `// J3 REVERSAL / BOUNDARY (max 3.0)`,
    `// J3 REVERSAL / BOUNDARY (max 4.0 plus blow-off surplus)`
  );
  const propSideRegex = /const kName = v\.name\.toLowerCase\(\);[\s\S]*?propSide = 'BULL';\n\s*\}\n\s*\}/g;
  newCode = newCode.replace(propSideRegex, "");
  newCode = newCode.replace(
    /let propSide: 'BULL' \| 'BEAR' = 'BULL';\n/g,
    ""
  );
  newCode = newCode.replace(
    `    if (isBull || (propSide === 'BULL' && !isBear)) {
      bullList.push(obj);
    } else {
      bearList.push(obj);
    }`,
    `    if (isBull) {
      bullList.push(obj);
    } else if (isBear) {
      bearList.push(obj);
    }`
  );
  newCode = newCode.replace(
    `  if (isCustomList) {
    if (activeList.length < 1 && !isBypass) {
      hardBlockReason = \`No custom techniques provided. Include at least 1 technique in your upload.\`;
    }
  } else if (!isNoTech) {
    if (activeList.length < 10 && !isBypass) {
      hardBlockReason = \`Insufficient tech consensus. Found \${activeList.length} but need minimum 10 techniques.\`;
    }
  }`,
    `  if (isBypass) {
    hardBlockReason = null;
  } else if (isCustomList) {
    if (activeList.length === 0) {
      hardBlockReason = \`No custom techniques provided. Include at least 1 technique in your upload.\`;
    }
  } else if (!isNoTech) {
    if (activeList.length < 10) {
      hardBlockReason = \`Insufficient tech consensus. Found \${activeList.length} but need minimum 10 techniques.\`;
    }
  }`
  );
  newCode = newCode.replace(
    `    if (slopeInAtrUnits < 0.12 && Math.abs(currentYPercent - 50) < 20) {`,
    `    if (!isMeanReverting && slopeInAtrUnits < 0.12 && Math.abs(currentYPercent - 50) < 20) {`
  );
  newCode = newCode.replace(
    `  if (finalSignal === 'LONG') {
    if (bullTotal < minStrengthThreshold) {`,
    `  if (finalSignal === 'LONG') {
    const hasStrongJudge = cases.bull.j1 >= 1.5 || cases.bull.j2 >= 1.5 || cases.bull.j3 >= 1.5;
    if (bullTotal < minStrengthThreshold) {`
  );
  newCode = newCode.replace(
    `      return getEmptyNoTradeResult(\`Insufficient conviction (LONG score \${bullTotal.toFixed(1)} < minimum \${minStrengthThreshold.toFixed(1)})\`);
    }`,
    `      return getEmptyNoTradeResult(\`Insufficient conviction (LONG score \${bullTotal.toFixed(1)} < minimum \${minStrengthThreshold.toFixed(1)})\`);
    }
    if (!hasStrongJudge) {
      return getEmptyNoTradeResult(\`No single judge produced strong enough conviction. All three judges are weak.\`);
    }`
  );
  newCode = newCode.replace(
    `const scaleThresholdFactor = Math.max(0.08, Math.min(1.0, activeList.length / 12));`,
    `const scaleThresholdFactor = Math.max(0.50, Math.min(1.0, activeList.length / 12));`
  );
  newCode = newCode.replace(
    `winner: (finalSignal === 'NO_TRADE' && Math.abs(margin) < minMarginThreshold) ? 'NO_TRADE' : rawWinner,`,
    `winner: finalSignal === 'NO_TRADE' ? 'NO_TRADE' : finalSignal === 'LONG' ? 'BULL' : 'BEAR',`
  );
  newCode = newCode.replace(
    `    const lc = ohlcSeries[last];`,
    `    const settledLast = Math.max(0, closes.length - 2);
    const lc = ohlcSeries[settledLast];`
  );
  newCode = newCode.replace(
    `const px = closes[last];`,
    `const px = closes[settledLast];`
  );
  newCode = newCode.replace(
    `const prepLastCloseVal = ohlcSeries[ohlcSeries.length - 1].close;`,
    `const prepLastCloseVal = ohlcSeries[Math.max(0, ohlcSeries.length - 2)].close;`
  );
  newCode = newCode.replace(
    `if (lastADXVal > 25) {`,
    `if (lastADXVal > 20) {`
  );
  newCode = newCode.replace(
    `} else if (lastADXVal < 20) {`,
    `} else if (lastADXVal < 15) {`
  );
  newCode = newCode.replace(
    `const isTrending = adxNow > 25;`,
    `const isTrending = adxNow > 20;`
  );
  newCode = newCode.replace(
    `const rqaObj = calculateRQA(Array.from(closes).slice(-20));`,
    `const rqaWindow = graphTimeframeMinutes <= 3 ? 15 : graphTimeframeMinutes <= 5 ? 20 : 30;
  const rqaObj = calculateRQA(Array.from(closes).slice(-rqaWindow));`
  );
  newCode = newCode.replace(
    `  function wrapText(text: string, maxLen: number): string[] {`,
    `  /* deleted wrapText */ function _wrapText(text: string, maxLen: number): string[] {`
  );
  const formattedReportRegex = /const formattedReport = `┌─[\s\S]*?└─────────────────────────────────────┘`;/g;
  newCode = newCode.replace(formattedReportRegex, "const formattedReport = '';");
  newCode = newCode.replace(`formattedReport,`, ``);
  newCode = newCode.replace(`j4Score: j4PenaltyPct,`, ``);
  newCode = newCode.replace(`j4Score: skepticPenalty,       // legacy`, ``);
  newCode = newCode.replace(/bulldogPoints/g, "bullPoints");
  newCode = newCode.replace(/peerPoints/g, "bearPoints");
  fs.writeFileSync("./src/quant/ruleEngine.ts", newCode);
  console.log("Replacements done. Length difference:", newCode.length - code.length);
}
doReplacements();
