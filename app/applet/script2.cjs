const fs = require('fs');
const code = fs.readFileSync('./src/quant/ruleEngine.ts', 'utf8');

function doReplacements() {
  let newCode = code;

  // FIX 1: detectStructureSignal 
  newCode = newCode.replace(
    'const structSignal = detectStructureSignal(highs, lows, pivots);',
    'const structSignal = detectStructureSignal(closes, highs, lows, 2, pivots);'
  );

  // FIX 2: Move bullJ3Intrinsic and bearJ3Intrinsic declarations
  newCode = newCode.replace(
    /let bullJ3Intrinsic = 0;\s*let bearJ3Intrinsic = 0;/,
    ''
  );
  newCode = newCode.replace(
    `  // ═════════════════════════════════════════════════════════════\n  // J2 VEHICLE`,
    `  let bullJ3Intrinsic = 0;\n  let bearJ3Intrinsic = 0;\n\n  // ═════════════════════════════════════════════════════════════\n  // J2 VEHICLE`
  );

  // FIX 3: Hurst R/S input too small
  newCode = newCode.replace(
    /Array\.from\(closes\)\.slice\(-32\)/g,
    `Array.from(closes).slice(-64)`
  );

  // FIX 4: recentSlope for Hurst
  newCode = newCode.replace(
    /const H_exp = rescaledRangeHurst\(/g,
    `const recentSlopeSeries = emaSlope(Array.from(closes).slice(-64), 9);\n  const recentSlope = recentSlopeSeries.length > 0 ? recentSlopeSeries[recentSlopeSeries.length - 1] : 0;\n\n  const H_exp = rescaledRangeHurst(`
  );
  // Also we need to replace `lastSlope` with `recentSlope` inside Hurst block.
  // The Hurst block is right after `const H_exp = rescaledRangeHurst(`. 
  // Let's do a narrower replace for the J4 slope gate later... actually FIX4 says:
  // "Use recentSlope for all branching inside the Hurst regime block."
  // Wait, let's look at the Hurst regime block uses of lastSlope.
  // We can do this manually in sed-like string replace if predictable.

  // FIX 5: J3 max cap mismatch
  newCode = newCode.replace(
    `// J3 REVERSAL / BOUNDARY (max 3.0)`,
    `// J3 REVERSAL / BOUNDARY (max 4.0 plus blow-off surplus)`
  );

  // FIX 6: propSide heuristic produces wrong technique panel grouping
  const propSideRegex = /const kName = v\.name\.toLowerCase\(\);[\s\S]*?propSide = 'BULL';\n\s*\}\n\s*\}/g;
  newCode = newCode.replace(propSideRegex, '');
  newCode = newCode.replace(
    /let propSide: 'BULL' \| 'BEAR' = 'BULL';\n/g,
    ''
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

  // FIX 7: isCustomList and isNoTech contradiction
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

  // FIX 9: J4 flat slope penalty fires in mean reverting
  newCode = newCode.replace(
    `    if (slopeInAtrUnits < 0.12 && Math.abs(currentYPercent - 50) < 20) {`,
    `    if (!isMeanReverting && slopeInAtrUnits < 0.12 && Math.abs(currentYPercent - 50) < 20) {`
  );

  // FIX 10: minStrengthThreshold too easy to pass
  newCode = newCode.replace(
    `  if (finalSignal === 'LONG') {
    if (bullTotal < minStrengthThreshold) {`,
    `  if (finalSignal === 'LONG') {
    const hasStrongJudge = cases.bull.j1 >= 1.5 || cases.bull.j2 >= 1.5 || cases.bull.j3 >= 1.5;
    if (bullTotal < minStrengthThreshold) {`
  );
  newCode = newCode.replace(
    `      return getEmptyNoTradeResult(\`Insufficient conviction (LONG score \${bullTotal.toFixed(1)} < minimum \${minStrengthThreshold.toFixed(1)})\`);\n    }`,
    `      return getEmptyNoTradeResult(\`Insufficient conviction (LONG score \${bullTotal.toFixed(1)} < minimum \${minStrengthThreshold.toFixed(1)})\`);
    }
    if (!hasStrongJudge) {
      return getEmptyNoTradeResult(\`No single judge produced strong enough conviction. All three judges are weak.\`);
    }`
  );

  // FIX 11: scaleThresholdFactor allows near-zero
  newCode = newCode.replace(
    `const scaleThresholdFactor = Math.max(0.08, Math.min(1.0, activeList.length / 12));`,
    `const scaleThresholdFactor = Math.max(0.50, Math.min(1.0, activeList.length / 12));`
  );

  // FIX 13: winner field in return value
  newCode = newCode.replace(
    `winner: (finalSignal === 'NO_TRADE' && Math.abs(margin) < minMarginThreshold) ? 'NO_TRADE' : rawWinner,`,
    `winner: finalSignal === 'NO_TRADE' ? 'NO_TRADE' : finalSignal === 'LONG' ? 'BULL' : 'BEAR',`
  );

  // FIX 15: J3 uses forming candle
  newCode = newCode.replace(
    `    const lc = ohlcSeries[last];`,
    `    const settledLast = Math.max(0, closes.length - 2);\n    const lc = ohlcSeries[settledLast];`
  );
  newCode = newCode.replace(
    `const px = closes[last];`,
    `const px = closes[settledLast];`
  );
  // Also fix double yPercent declaration if yPercent was relying on it... wait yPercent is computed top level.
  // Bug 15 says: "The yPercent calculation should use closes[settledLast] as the lastClose."
  newCode = newCode.replace(
    `const prepLastCloseVal = ohlcSeries[ohlcSeries.length - 1].close;`,
    `const prepLastCloseVal = ohlcSeries[Math.max(0, ohlcSeries.length - 2)].close;`
  );

  // FIX 16: ADX corroboration threshold 
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

  // FIX 17: RQA slice length hardcoded
  newCode = newCode.replace(
    `const rqaObj = calculateRQA(Array.from(closes).slice(-20));`,
    `const rqaWindow = graphTimeframeMinutes <= 3 ? 15 : graphTimeframeMinutes <= 5 ? 20 : 30;\n  const rqaObj = calculateRQA(Array.from(closes).slice(-rqaWindow));`
  );

  // FIX 21: formattedReport ASCII box is dead code
  newCode = newCode.replace(
    `  function wrapText(text: string, maxLen: number): string[] {`,
    `  /* deleted wrapText */ function _wrapText(text: string, maxLen: number): string[] {`
  );
  const formattedReportRegex = /const formattedReport = `┌─[\s\S]*?└─────────────────────────────────────┘`;/g;
  newCode = newCode.replace(formattedReportRegex, "const formattedReport = '';");
  newCode = newCode.replace(`formattedReport,`, ``); // where it's returned
  
  // FIX 22: j4Score legacy field
  newCode = newCode.replace(`j4Score: j4PenaltyPct,`, ``);
  newCode = newCode.replace(`j4Score: skepticPenalty,       // legacy`, ``);

  // FIX 23: bulldogPoints and peerPoints naming
  newCode = newCode.replace(/bulldogPoints/g, "bullPoints");
  newCode = newCode.replace(/peerPoints/g, "bearPoints");

  // Output newCode to a safe temp file
  fs.writeFileSync('./src/quant/ruleEngine_new.ts', newCode);
  console.log("Replacements done. Length difference:", newCode.length - code.length);
}

doReplacements();
