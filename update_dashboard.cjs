const fs = require('fs');

let code = fs.readFileSync('src/components/BotDashboard.tsx', 'utf8');

// 1. Extract haltCode, riskSummary, activeConfig from useBotLoop
code = code.replace(
  /isAnalyzing,[\s\t\n]+lastAnalysisResult,[\s\t\n]+techniqueWarning,[\s\t\n]+cooldownRemainsMs,/,
  `isAnalyzing, lastAnalysisResult, techniqueWarning, cooldownRemainsMs, haltCode, riskSummary, activeConfig, riskWarnings,`
);

// We need to double check the exact syntax extracted from useBotLoop in BotDashboard
code = code.replace(
  /const bot = useBotLoop\([\s\S]*?\);/,
  function(match) {
     return match;
  }
)

// 2. Cooldown progress bar logic update (Fix 7)
code = code.replace(
  /const w \= bot\.cooldownRemainsMs \? Math\.min\(100, \(bot\.cooldownRemainsMs \/ 600000\) \* 100\)\.toFixed\(0\) \+ '%' : '0%';/,
  `const cooldownTotalMs = (bot.activeConfig?.risk?.cooldownMinutes ?? 10) * 60_000;
  const w = bot.cooldownRemainsMs ? Math.min(100, (bot.cooldownRemainsMs / cooldownTotalMs) * 100).toFixed(0) + '%' : '0%';`
);

// 3. Add Risk Summary UI for SCANNING, ARMED, COOLDOWN (Fix 12)
const riskSummaryHtml = `
      {bot.riskSummary && ['SCANNING', 'ARMED', 'COOLDOWN', 'HALTED', 'IN_TRADE'].includes(bot.phase) && (
        <details className="mt-2 bg-zinc-900 border border-zinc-800 rounded-lg group">
          <summary className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider px-3 py-2 cursor-pointer outline-none flex items-center justify-between">
            <div className="flex items-center gap-1.5"><Shield className="w-3 h-3 text-zinc-600"/> Risk Summary</div>
            <span className="group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <div className="px-3 pb-3 flex items-center justify-between text-[11px] font-mono border-t border-zinc-800/50 pt-2">
            <div className="flex flex-col">
              <span className="text-zinc-500">Trades</span>
              <span className="text-zinc-300">{bot.riskSummary.tradesToday}/{bot.riskSummary.maxTradesPerDay}</span>
            </div>
            <div className="flex flex-col text-center">
              <span className="text-zinc-500">Daily PnL</span>
              <span className={bot.riskSummary.dailyPnL >= 0 ? "text-emerald-400" : "text-rose-400"}>
                {bot.riskSummary.dailyPnL >= 0 ? '+' : ''}₹{bot.riskSummary.dailyPnL.toFixed(0)}
              </span>
            </div>
            <div className="flex flex-col text-right">
              <span className="text-zinc-500">Loss Streak</span>
              <span className={bot.riskSummary.consecutiveLosses > 0 ? "text-rose-400" : "text-zinc-400"}>
                {bot.riskSummary.consecutiveLosses}/{bot.riskSummary.maxConsecutiveLosses}
              </span>
            </div>
          </div>
        </details>
      )}
`;

code = code.replace(
  /\{\/\* MAIN STATUS BADGE \*\/\}[\s\S]*?className="flex items-center justify-between"[\s\S]*?\>[\s\S]*?\<\/div\>/,
  (match) => match + riskSummaryHtml
);

// 4. Update HALTED reason UI (Fix 11)
code = code.replace(
  /\{bot\.phase === 'HALTED' && \([\s\S]*?\)\}/,
  `{bot.phase === 'HALTED' && (
          <div className="mt-2 text-xs">
            {bot.haltCode === 'DAILY_LOSS_CAP' ? (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded p-2">
                <strong>Daily loss limit reached.</strong><br/>
                Trading locked until tomorrow IST midnight. Current: ₹{bot.riskSummary?.dailyPnL?.toFixed(0)}
              </div>
            ) : bot.haltCode === 'MAX_TRADES' ? (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded p-2">
                <strong>Maximum trades for today reached.</strong><br/>
                Trading resumes tomorrow.
              </div>
            ) : bot.haltCode === 'CONSECUTIVE_LOSSES' ? (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded p-2">
                <strong>Too many losses in a row.</strong><br/>
                Take a break. The bot will resume after cooldown.
              </div>
            ) : (
              <div className="bg-rose-500/20 text-rose-200 border border-rose-500/30 rounded p-2 break-words">
                {bot.lastBlockReason ?? 'Trading halted automatically'}
              </div>
            )}
          </div>
        )}`
);

// 5. Add Risk Alerts amber panel (Fix 10)
const riskAlertsHtml = `
      {bot.riskWarnings && bot.riskWarnings.length > 0 && (
        <details open className="mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg group">
          <summary className="text-[10px] uppercase font-bold text-amber-500 tracking-wider px-3 py-2 cursor-pointer outline-none flex items-center justify-between">
            <div className="flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 text-amber-500"/> Risk Alerts</div>
          </summary>
          <div className="px-3 pb-3 flex flex-col gap-1 text-[11px] text-amber-400 font-mono">
            {bot.riskWarnings.map((w: string, i: number) => <div key={i}>{w}</div>)}
          </div>
        </details>
      )}
`;

code = code.replace(
  /\{\/\* PnL TICKER \*\/}/,
  riskAlertsHtml + '\n\n      {/* PnL TICKER */}'
);

fs.writeFileSync('src/components/BotDashboard.tsx', code);
