const fs = require('fs');

let code = fs.readFileSync('src/hooks/useBotLoop.ts', 'utf8');

// Add missing imports
code = code.replace(
  /import \{ checkRiskCaps, onTradeClosed \} from '\.\.\/quant\/riskGuard';/,
  `import * as import_riskGuard from '../quant/riskGuard';\nimport { checkRiskCaps, onTradeClosed, reconcileDailyPnL } from '../quant/riskGuard';`
);

// 2 & 8: closeTradeById adjustments
code = code.replace(
  /const estCharges = trade\.plan\?\.brokerCharges \?\? 0;\n\s+const creditBack = parseFloat\(\(invested \+ estCharges \+ realizedPnL\)\.toFixed\(2\)\);/,
  `const estCharges = trade.plan?.brokerCharges ?? 0;\n    const netRealizedPnL = realizedPnL - estCharges;\n    const creditBack = parseFloat((invested + estCharges + realizedPnL).toFixed(2));`
);

code = code.replace(
  /riskStateRef\.current = loadRiskState\(\);\n\s+const nextRisk = onTradeClosed\(riskStateRef\.current, realizedPnL, activeConfig\.risk\);\n\s+riskStateRef\.current = nextRisk;\n\s+saveRiskState\(nextRisk\);/,
  `const nextRisk = onTradeClosed(riskStateRef.current, netRealizedPnL, activeConfig.risk, Date.now(), virtualBalanceRef.current, symbol || undefined);\n    riskStateRef.current = nextRisk;`
);

// Add missing state for riskWarnings and haltCode:
code = code.replace(
  /const \[cooldownRemainsMs,setCooldownRemainsMs\] = useState<number \| null>\(null\);/,
  `const [cooldownRemainsMs,setCooldownRemainsMs] = useState<number | null>(null);\n  const [riskWarnings, setRiskWarnings] = useState<string[]>([]);\n  const [haltCode, setHaltCode] = useState<string | undefined>(undefined);`
);

// 3, 4, 10: runAnalysisCycle edits
code = code.replace(
  /riskStateRef\.current = loadRiskState\(\);\n\s+const capCheck = checkRiskCaps\(riskStateRef\.current, activeConfig\.risk\);\n\s+if \(!capCheck\.allow\) \{\n\s+stabilityRef\.current = 0;\n\s+setStabilityCount\(0\);\n\s+setLastBlockReason\(\`RISK_CAP: \$\{capCheck\.reason\}\`\);\n\s+setPhase\(capCheck\.reason\?\.toLowerCase\(\)\.includes\('cooldown'\) \? 'COOLDOWN' : 'HALTED'\);\n\s+return;\n\s+\}/,
  `const capCheck = checkRiskCaps(riskStateRef.current, activeConfig.risk, Date.now(), virtualBalanceRef.current);\n      if (!capCheck.allow) {\n        stabilityRef.current = 0;\n        setStabilityCount(0);\n        setLastBlockReason(\`RISK_CAP: \$\{capCheck.reason\}\`);\n        setPhase(capCheck.code === 'COOLDOWN' ? 'COOLDOWN' : 'HALTED');\n        setHaltCode(capCheck.code);\n        return;\n      }\n      \n      const warnings = import_riskGuard.checkRiskWarnings(riskStateRef.current, activeConfig.risk, virtualBalanceRef.current);\n      setRiskWarnings(warnings.warning ? warnings.reasons : []);`
);

code = code.replace(
  /const decision = evaluateScalpSignal\(ohlc, \{ winner: result\.analysis\?\.judge\?\.winner \|\| 'NO_TRADE' \}, ctx as any, isAiConfident\);/,
  `const decision = evaluateScalpSignal(ohlc, { winner: result.analysis?.judge?.winner || 'NO_TRADE' }, ctx as any, isAiConfident, capCheck);`
);


// 5 & 6 Cooldown functionality
code = code.replace(
  /const state = loadRiskState\(\);\n\s+const remaining = state\.cooldownUntil > 0\n\s+\? Math\.max\(0, state\.cooldownUntil - Date\.now\(\)\)\n\s+: null;\n\s+setCooldownRemainsMs\(remaining\);\n\s+\/\/ Auto-exit cooldown when timer reaches zero\n\s+if \(remaining === 0\) \{\n\s+setPhase\('SCANNING'\);\n\s+setCooldownRemainsMs\(null\);\n\s+\}/,
  `const remaining = riskStateRef.current.cooldownUntil > 0\n        ? Math.max(0, riskStateRef.current.cooldownUntil - Date.now())\n        : null;\n      setCooldownRemainsMs(remaining);\n      \n      if (remaining === 0) {\n        setCooldownRemainsMs(null);\n        const postCooldownCheck = checkRiskCaps(riskStateRef.current, activeConfig.risk, Date.now(), virtualBalanceRef.current);\n        if (postCooldownCheck.allow) {\n          setPhase('SCANNING');\n        } else if (postCooldownCheck.code === 'COOLDOWN') {\n          \n        } else {\n          setPhase('HALTED');\n          setHaltCode(postCooldownCheck.code);\n          setLastBlockReason(postCooldownCheck.reason ?? 'RISK_CAP_ACTIVE');\n        }\n      }`
);

// 16. Reconcile daily PnL
code = code.replace(
  /if \(trades\) setTradeHistory\(trades\);/,
  `if (trades) {\n        setTradeHistory(trades);\n        const todayTrades = trades.filter(t => {\n          const effTime = t.closedAt ?? t.openedAt;\n          const tDate = new Date(effTime + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);\n          const today = new Date(Date.now()  + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);\n          return tDate === today && t.realizedPnL !== null;\n        });\n        const reconciledDailyPnL = reconcileDailyPnL(todayTrades.map(t => ({ pnl: t.realizedPnL! + (t.plan.brokerCharges ?? 0), brokerCharges: t.plan.brokerCharges ?? 0 })));\n        if (Math.abs(reconciledDailyPnL - riskStateRef.current.dailyPnL) > 10) {\n          console.log(\`[BotLoop] Reconciled daily PnL: \$\{riskStateRef.current.dailyPnL\} -> \$\{reconciledDailyPnL\}\`);\n          riskStateRef.current.dailyPnL = reconciledDailyPnL;\n          import_riskGuard.saveRiskState(riskStateRef.current);\n        }\n      }`
);

// Add missing exports to UseBotLoopResult
code = code.replace(
  /export interface UseBotLoopResult \{([\s\S]*?)\}/,
  `export interface UseBotLoopResult {$1  riskWarnings?: string[];\n  haltCode?: string;\n  riskSummary?: any;\n  activeConfig?: any;\n}`
);

code = code.replace(
  /cooldownRemainsMs,\n\s+techniqueCount:\s+techniquesList\.length,/,
  `cooldownRemainsMs,\n    techniqueCount:    techniquesList.length,\n    riskWarnings,\n    haltCode,\n    activeConfig,\n    riskSummary: {\n      dailyPnL: riskStateRef.current.dailyPnL,\n      tradesToday: riskStateRef.current.tradesToday,\n      consecutiveLosses: riskStateRef.current.consecutiveLosses,\n      maxTradesPerDay: activeConfig.risk.maxTradesPerDay,\n      dailyLossCapRupees: activeConfig.risk.dailyLossCapRupees,\n      maxConsecutiveLosses: activeConfig.risk.maxConsecutiveLosses\n    }`
);

fs.writeFileSync('src/hooks/useBotLoop.ts', code);
