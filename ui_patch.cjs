const fs = require('fs');

let ui = fs.readFileSync('src/components/BacktestScreen.tsx', 'utf8');

// 1. Add state for initialCapital
ui = ui.replace(
  "const [fixedSLPct, setFixedSLPct]       = useState<string>('0.5');\n  const [fixedTPPct, setFixedTPPct]       = useState<string>('1.0');",
  "const [fixedSLPct, setFixedSLPct]       = useState<string>('0.5');\n  const [fixedTPPct, setFixedTPPct]       = useState<string>('1.0');\n  const [initialCapital, setInitialCapital] = useState<string>('100000');"
);

// 2. Add runPortfolioBacktest to imports
ui = ui.replace(
  "import { runBacktest } from '../quant/backtestEngine';",
  "import { runBacktest, runPortfolioBacktest } from '../quant/backtestEngine';"
);

// 3. Update the handleRunBacktest to use runPortfolioBacktest
// Replace the block for ALL_STOCKS
const allStocksOld = `
        for (const stock of POPULAR_STOCKS) {
          setStatusMessage(\`Loading history for \${stock.symbol}...\`);
          // Let the UI repaint the status message before continuing
          await new Promise(resolve => setTimeout(resolve, 50));

          const stockCandles = allStockCandles[stock.symbol];
          totalCandlesUsed += stockCandles.length;

          setStatusMessage(\`Running backtest for \${stock.symbol}...\`);
          // Let UI update
          await new Promise(resolve => setTimeout(resolve, 50));

          const scalpConfig = getDefaultScalpConfig();
          scalpConfig.useFixedRR = true;
          scalpConfig.useTrailAfterTP1 = false;
          scalpConfig.rrRatio = 2.5;

          const config: BacktestConfig = {
            symbol: stock.symbol,
            marginThreshold: MARGIN_THRESHOLD,
            maxTradesPerDay: MAX_TRADES_PER_DAY,
            warmupCandles: WARMUP_CANDLES,
            scalpConfig,
            techniquesList: techniquesList,
            exitMode,
            fixedRRRatio: parseFloat(fixedRRRatio) || 2.0,
            fixedSLPct: parseFloat(fixedSLPct) || 0.5,
            fixedTPPct: parseFloat(fixedTPPct) || 1.0,
            compositeSeries,
          };
          const res = runBacktest(stockCandles, config);
          // Attach symbol to each trade
          const tradesWithSymbol = res.trades.map(t => ({ ...t, symbol: stock.symbol }));
          res.trades = tradesWithSymbol;
          results.push(res);

          if (res.logs) {
            allLogs.push(\`=========================================\`);
            allLogs.push(\`=== BACKTEST LOGS FOR \${stock.symbol} ===\`);
            allLogs.push(\`=========================================\`);
            allLogs.push(...res.logs);
            allLogs.push('\\n');
          }
        }

        // Aggregate results
        const allTrades = results.flatMap(r => r.trades).sort((a, b) => a.entryTime - b.entryTime);
        const totalTrades = allTrades.length;
        const wins = allTrades.filter(t => t.pnl > 0).length;
        const losses = allTrades.filter(t => t.pnl <= 0).length;
        const winRate = totalTrades > 0 ? wins / totalTrades : 0;
        const totalPnL = allTrades.reduce((s, t) => s + t.pnl, 0);
        const avgRMultiple = totalTrades > 0 ? allTrades.reduce((s, t) => s + t.rMultiple, 0) / totalTrades : 0;
        const avgDurationMinutes = totalTrades > 0 ? allTrades.reduce((s, t) => s + t.durationMinutes, 0) / totalTrades : 0;

        let cumPnL = 0;
        let peak = 0;
        let maxDrawdown = 0;
        let consecLosses = 0;
        let maxConsecutiveLosses = 0;

        for (const t of allTrades) {
          cumPnL += t.pnl;
          if (cumPnL > peak) peak = cumPnL;
          const dd = peak - cumPnL;
          if (dd > maxDrawdown) maxDrawdown = dd;

          if (t.pnl <= 0) {
            consecLosses++;
            if (consecLosses > maxConsecutiveLosses) maxConsecutiveLosses = consecLosses;
          } else {
            consecLosses = 0;
          }
        }

        const aggregatedResult: BacktestResult = {
          symbol: 'ALL_STOCKS',
          timeframeMinutes: 5,
          totalCandlesUsed,
          trades: allTrades,
          totalTrades,
          wins,
          losses,
          winRate,
          totalPnL,
          avgRMultiple,
          maxDrawdown,
          maxConsecutiveLosses,
          avgDurationMinutes,
          startDate: results.length > 0 ? results[0].startDate : '',
          endDate: results.length > 0 ? results[0].endDate : '',
          logs: allLogs
        };
        setResult(aggregatedResult);
`;

const allStocksNew = `
        for (const stock of POPULAR_STOCKS) {
          setStatusMessage(\`Loading history for \${stock.symbol}...\`);
          await new Promise(resolve => setTimeout(resolve, 50));
          totalCandlesUsed += allStockCandles[stock.symbol].length;
        }

        setStatusMessage(\`Running portfolio backtest across \${POPULAR_STOCKS.length} stocks...\`);
        await new Promise(resolve => setTimeout(resolve, 50));

        const scalpConfig = getDefaultScalpConfig();
        scalpConfig.useFixedRR = true;
        scalpConfig.useTrailAfterTP1 = false;
        scalpConfig.rrRatio = 2.5;

        const config: BacktestConfig = {
          symbol: 'ALL_STOCKS',
          initialCapital: parseFloat(initialCapital) || 100000,
          marginThreshold: MARGIN_THRESHOLD,
          maxTradesPerDay: MAX_TRADES_PER_DAY,
          warmupCandles: WARMUP_CANDLES,
          scalpConfig,
          techniquesList: techniquesList,
          exitMode,
          fixedRRRatio: parseFloat(fixedRRRatio) || 2.0,
          fixedSLPct: parseFloat(fixedSLPct) || 0.5,
          fixedTPPct: parseFloat(fixedTPPct) || 1.0,
          compositeSeries,
        };

        const res = runPortfolioBacktest(allStockCandles, config);

        if (res.logs) {
          allLogs.push(...res.logs);
        }
        res.logs = allLogs;

        setResult(res);
`;

ui = ui.replace(allStocksOld, allStocksNew);

// 4. Update the single stock to also use runPortfolioBacktest
const singleStockOld = `
        const config: BacktestConfig = {
          symbol: selectedStock.symbol,
          marginThreshold: MARGIN_THRESHOLD,
          maxTradesPerDay: MAX_TRADES_PER_DAY,
          warmupCandles: WARMUP_CANDLES,
          scalpConfig,
          techniquesList: techniquesList,
          exitMode,
          fixedRRRatio: parseFloat(fixedRRRatio) || 2.0,
          fixedSLPct: parseFloat(fixedSLPct) || 0.5,
          fixedTPPct: parseFloat(fixedTPPct) || 1.0,
        };
        const res = runBacktest(candles, config);
        // Attach symbol to single stock trade too
        res.trades = res.trades.map(t => ({ ...t, symbol: selectedStock.symbol }));
        setResult(res);
`;
const singleStockNew = `
        const config: BacktestConfig = {
          symbol: selectedStock.symbol,
          initialCapital: parseFloat(initialCapital) || 100000,
          marginThreshold: MARGIN_THRESHOLD,
          maxTradesPerDay: MAX_TRADES_PER_DAY,
          warmupCandles: WARMUP_CANDLES,
          scalpConfig,
          techniquesList: techniquesList,
          exitMode,
          fixedRRRatio: parseFloat(fixedRRRatio) || 2.0,
          fixedSLPct: parseFloat(fixedSLPct) || 0.5,
          fixedTPPct: parseFloat(fixedTPPct) || 1.0,
        };
        const allStockCandles = { [selectedStock.symbol]: candles };
        const res = runPortfolioBacktest(allStockCandles, config);
        setResult(res);
`;
ui = ui.replace(singleStockOld, singleStockNew);


// 5. Add UI Input for Starting Capital
const uiControlsOld = `
          <select
            value={exitMode}
            onChange={(e) => setExitMode(e.target.value as 'DYNAMIC' | 'FIXED_RR' | 'FIXED_PCT')}
            disabled={isRunning}
            className="bg-zinc-800 text-white border border-zinc-700 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D9B382]/50 w-full max-w-[200px]"
          >
`;

const uiControlsNew = `
          <div className="flex flex-col gap-1 mb-3">
            <label className="text-[10px] font-mono text-zinc-400">Initial / Deployment Capital (₹):</label>
            <input
              type="number"
              step="1000"
              min="1000"
              value={initialCapital}
              onChange={(e) => setInitialCapital(e.target.value)}
              disabled={isRunning}
              className="bg-zinc-800 text-white border border-zinc-700 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D9B382]/50 w-full max-w-[200px]"
            />
          </div>

          <label className="text-[10px] font-mono text-zinc-400">Exit Mode:</label>
          <select
            value={exitMode}
            onChange={(e) => setExitMode(e.target.value as 'DYNAMIC' | 'FIXED_RR' | 'FIXED_PCT')}
            disabled={isRunning}
            className="bg-zinc-800 text-white border border-zinc-700 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D9B382]/50 w-full max-w-[200px]"
          >
`;

ui = ui.replace(uiControlsOld, uiControlsNew);

// 6. Add Portfolio UI elements
const statsOld = `
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 mb-8">
              <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl p-4 flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Total P&L</span>
                <span className={\`text-2xl font-black \${result.totalPnL >= 0 ? 'text-[#00FF00]' : 'text-[#FF4444]'}\`}>
                  {fmt(result.totalPnL)}
                </span>
              </div>
`;

const statsNew = `
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 mb-4">
              <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl p-4 flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Starting Capital</span>
                <span className="text-xl font-bold text-white">
                  ₹{result.initialCapital?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '---'}
                </span>
              </div>
              <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl p-4 flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Final Capital</span>
                <span className="text-xl font-bold text-white">
                  ₹{result.finalCapital?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '---'}
                </span>
              </div>
              <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl p-4 flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Available Cash</span>
                <span className="text-xl font-bold text-white">
                  ₹{result.availableCash?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '---'}
                </span>
              </div>
              <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl p-4 flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Total P&L</span>
                <span className={\`text-2xl font-black \${result.totalPnL >= 0 ? 'text-[#00FF00]' : 'text-[#FF4444]'}\`}>
                  {fmt(result.totalPnL)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl p-4 flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Return %</span>
                <span className={\`text-xl font-bold \${result.totalPnL >= 0 ? 'text-[#00FF00]' : 'text-[#FF4444]'}\`}>
                  {result.initialCapital ? ((result.totalPnL / result.initialCapital) * 100).toFixed(2) + '%' : '---'}
                </span>
              </div>
`;

ui = ui.replace(statsOld, statsNew);

// Fix missing <label>
ui = ui.replace(
  '          <label className="text-[10px] font-mono text-zinc-400">Exit Mode:</label>\n          <select',
  '        <div className="flex flex-col gap-1">\n          <label className="text-[10px] font-mono text-zinc-400">Exit Mode:</label>\n          <select'
);

fs.writeFileSync('src/components/BacktestScreen.tsx', ui, 'utf8');
