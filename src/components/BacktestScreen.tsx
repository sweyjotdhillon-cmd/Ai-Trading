import React, { useState } from 'react';
import { BarChart2, Download, AlertTriangle, Loader2 } from 'lucide-react';
import { POPULAR_STOCKS, StockSearchResult } from './BotSetupScreen';
import { fetchBacktestHistory } from '../services/backtestDataService';
import { runBacktest } from '../quant/backtestEngine';
import { BacktestConfig, BacktestResult, BacktestTrade } from '../types/backtest';
import { getDefaultScalpConfig } from '../config/scalpConfig';

const MARGIN_THRESHOLD = 2.5;
const MAX_TRADES_PER_DAY = Infinity; // backtest: no daily cap, use every qualifying signal
const WARMUP_CANDLES = 30;

const ALL_STOCKS_OPTION: StockSearchResult = {
  symbol: 'ALL_STOCKS',
  name: 'All Stocks Together',
  exchange: 'NSE'
};

function fmt(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function downloadTradesCSV(trades: BacktestTrade[], symbol: string) {
  const isAll = symbol === 'ALL_STOCKS';
  const headers = isAll
    ? ['Stock', 'Entry Time', 'Exit Time', 'Entry Price', 'Exit Price', 'Outcome', 'PnL', 'R-Multiple', 'Duration (min)', 'Bull Score', 'Bear Score', 'Margin']
    : ['Entry Time', 'Exit Time', 'Entry Price', 'Exit Price', 'Outcome', 'PnL', 'R-Multiple', 'Duration (min)', 'Bull Score', 'Bear Score', 'Margin'];

  const rows = trades.map(t => {
    const baseFields = [
      new Date(t.entryTime).toLocaleString('en-IN'),
      t.exitTime ? new Date(t.exitTime).toLocaleString('en-IN') : '',
      t.entryPrice.toFixed(2),
      t.exitPrice !== null ? t.exitPrice.toFixed(2) : '',
      t.outcome ?? '',
      t.pnl.toFixed(2),
      t.rMultiple.toFixed(2),
      t.durationMinutes.toFixed(0),
      t.bullScore.toFixed(2),
      t.bearScore.toFixed(2),
      t.margin.toFixed(2),
    ];
    return isAll ? [t.symbol?.split(':')[0] ?? '', ...baseFields] : baseFields;
  });

  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backtest_${symbol.replace(':', '_')}_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadDetailedLog(logs: string[] | undefined, symbol: string) {
  if (!logs || logs.length === 0) return;
  const content = logs.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backtest_log_${symbol.replace(':', '_')}_${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function BacktestEquityCurve({ trades }: { trades: BacktestTrade[] }) {
  if (trades.length < 2) {
    return (
      <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
        Need 2+ trades to plot curve
      </div>
    );
  }

  const points: number[] = [];
  let cumulative = 0;
  trades.forEach(t => {
    cumulative += t.pnl;
    points.push(cumulative);
  });

  const W = 400, H = 80;
  const minP = Math.min(0, ...points);
  const maxP = Math.max(0, ...points);
  const range = maxP - minP || 1;

  const toX = (i: number) => (i / (points.length - 1)) * W;
  const toY = (v: number) => H - ((v - minP) / range) * (H - 8) - 4;

  const pathD = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`)
    .join(' ');

  const lastY      = toY(cumulative);
  const isPositive = cumulative >= 0;
  const lineColor  = isPositive ? '#34d399' : '#f87171';
  const zeroY      = toY(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
      <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#3f3f46" strokeWidth="1" strokeDasharray="4 4" />
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={toX(points.length - 1)} cy={lastY} r="3" fill={lineColor} />
    </svg>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'good' | 'bad' | 'neutral' }) {
  const color = accent === 'good' ? 'text-emerald-400' : accent === 'bad' ? 'text-rose-400' : 'text-white';
  return (
    <div className="bg-zinc-950/60 border border-zinc-850 rounded-xl p-3 flex flex-col gap-1">
      <span className="text-[9px] uppercase font-mono text-zinc-500 tracking-wider">{label}</span>
      <span className={`text-sm font-mono font-black ${color}`}>{value}</span>
    </div>
  );
}

export function BacktestScreen() {
  const [selectedStock, setSelectedStock] = useState<StockSearchResult>(POPULAR_STOCKS[0]);
  const [isRunning, setIsRunning]         = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [result, setResult]               = useState<BacktestResult | null>(null);
  const [error, setError]                 = useState<string | null>(null);

  const [exitMode, setExitMode]           = useState<'DYNAMIC' | 'FIXED_RR' | 'FIXED_PCT'>('DYNAMIC');
  const [fixedRRRatio, setFixedRRRatio]   = useState<string>('2.0');
  const [fixedSLPct, setFixedSLPct]       = useState<string>('0.5');
  const [fixedTPPct, setFixedTPPct]       = useState<string>('1.0');

  const [techniquesList, setTechniquesList] = useState<any[]>(() => {
    try {
      const stored = localStorage.getItem('user_techniques_list');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [techFileName, setTechFileName] = useState<string | null>(() => {
    try {
      return localStorage.getItem('user_techniques_filename') || null;
    } catch {
      return null;
    }
  });
  const [techError, setTechError] = useState<string | null>(null);

  const handleTechFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      setTechError('Only .json technique files are supported.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const parsed: any[] = Array.isArray(json)
          ? json
          : (json.techniques ?? json.list ?? []);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          setTechError('File parsed but contains zero techniques. Check the format.');
          return;
        }
        setTechniquesList(parsed);
        setTechFileName(file.name);
        setTechError(null);
        try {
          localStorage.setItem('user_techniques_list', JSON.stringify(parsed));
          localStorage.setItem('user_techniques_filename', file.name);
        } catch (err) {
          console.error('Failed to store techniques in localStorage:', err);
        }
      } catch {
        setTechError('Invalid JSON — could not parse the technique file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClearTechniques = () => {
    setTechniquesList([]);
    setTechFileName(null);
    setTechError(null);
    try {
      localStorage.removeItem('user_techniques_list');
      localStorage.removeItem('user_techniques_filename');
    } catch (err) {
      console.error('Failed to remove techniques from localStorage:', err);
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);

    const isAllStocks = selectedStock.symbol === 'ALL_STOCKS';

    if (isAllStocks) {
      setStatusMessage('Loading bundled historical data for all stocks...');
      const results: BacktestResult[] = [];
      const allLogs: string[] = [];
      let totalCandlesUsed = 0;

      try {
        // Pre-fetch all 9 stocks' candles once to build a composite market-direction series.
        setStatusMessage('Building composite market series...');
        const allStockCandles: Record<string, Awaited<ReturnType<typeof fetchBacktestHistory>>> = {};
        for (const stock of POPULAR_STOCKS) {
          allStockCandles[stock.symbol] = await fetchBacktestHistory(stock.symbol);
        }
        const byTimestamp: Record<number, number[]> = {};
        for (const symbol of Object.keys(allStockCandles)) {
          for (const c of allStockCandles[symbol]) {
            const ret = c.open ? (c.close - c.open) / c.open : 0;
            if (!byTimestamp[c.timestamp]) byTimestamp[c.timestamp] = [];
            byTimestamp[c.timestamp].push(ret);
          }
        }
        const FLAT_THRESHOLD = 0.0005; // 0.05% - tune later if needed, not a scoring parameter yet
        const compositeSeries = new Map<number, 'UP' | 'DOWN' | 'FLAT'>();
        for (const [ts, rets] of Object.entries(byTimestamp)) {
          const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
          compositeSeries.set(Number(ts), avg > FLAT_THRESHOLD ? 'UP' : avg < -FLAT_THRESHOLD ? 'DOWN' : 'FLAT');
        }

        for (const stock of POPULAR_STOCKS) {
          setStatusMessage(`Loading history for ${stock.symbol}...`);
          // Let the UI repaint the status message before continuing
          await new Promise(resolve => setTimeout(resolve, 50));

          const stockCandles = allStockCandles[stock.symbol];
          totalCandlesUsed += stockCandles.length;

          setStatusMessage(`Running backtest for ${stock.symbol}...`);
          // Let UI update
          await new Promise(resolve => setTimeout(resolve, 50));

          const config: BacktestConfig = {
            symbol: stock.symbol,
            marginThreshold: MARGIN_THRESHOLD,
            maxTradesPerDay: MAX_TRADES_PER_DAY,
            warmupCandles: WARMUP_CANDLES,
            scalpConfig: getDefaultScalpConfig(),
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
            allLogs.push(`=========================================`);
            allLogs.push(`=== BACKTEST LOGS FOR ${stock.symbol} ===`);
            allLogs.push(`=========================================`);
            allLogs.push(...res.logs);
            allLogs.push('\n');
          }
        }

        // Aggregate results
        const allTrades = results.flatMap(r => r.trades).sort((a, b) => a.entryTime - b.entryTime);
        const totalTrades = allTrades.length;
        const wins = allTrades.filter(t => t.pnl > 0).length;
        const losses = allTrades.filter(t => t.pnl <= 0).length;
        const winRate = totalTrades > 0 ? wins / totalTrades : 0;
        const totalPnL = allTrades.reduce((acc, t) => acc + t.pnl, 0);
        const avgRMultiple = totalTrades > 0 ? allTrades.reduce((acc, t) => acc + t.rMultiple, 0) / totalTrades : 0;
        const avgDurationMinutes = totalTrades > 0 ? allTrades.reduce((acc, t) => acc + t.durationMinutes, 0) / totalTrades : 0;

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

        const startDates = results.map(r => r.startDate).filter(Boolean);
        const endDates = results.map(r => r.endDate).filter(Boolean);
        const startDate = startDates.length > 0 ? startDates.sort()[0] : '';
        const endDate = endDates.length > 0 ? endDates.sort()[endDates.length - 1] : '';

        setResult({
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
          startDate,
          endDate,
          logs: allLogs,
        });

      } catch (e: any) {
        setError(e.message ?? 'Backtest engine failed for one of the stocks');
      } finally {
        setIsRunning(false);
        setStatusMessage('');
      }

    } else {
      setStatusMessage('Loading bundled historical data...');
      // Let UI update
      await new Promise(resolve => setTimeout(resolve, 50));

      let candles;
      try {
        candles = await fetchBacktestHistory(selectedStock.symbol);
      } catch (e: any) {
        setError(e.message ?? 'Failed to fetch historical data');
        setIsRunning(false);
        return;
      }

      setStatusMessage(`Fetched ${candles.length} candles. Running judges...`);
      // Let the UI repaint the status message before the synchronous engine runs
      await new Promise(resolve => setTimeout(resolve, 50));

      try {
        const config: BacktestConfig = {
          symbol: selectedStock.symbol,
          marginThreshold: MARGIN_THRESHOLD,
          maxTradesPerDay: MAX_TRADES_PER_DAY,
          warmupCandles: WARMUP_CANDLES,
          scalpConfig: getDefaultScalpConfig(),
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
      } catch (e: any) {
        setError(e.message ?? 'Backtest engine failed');
      } finally {
        setIsRunning(false);
        setStatusMessage('');
      }
    }
  };

  return (
    <div className="flex flex-col gap-5 p-4 pb-24 overflow-y-auto w-full max-w-7xl mx-auto" id="backtest-screen-container">
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <BarChart2 size={18} className="text-[#D9B382]" />
          <span className="text-lg font-black text-white tracking-wide">BACKTEST</span>
        </div>
        <p className="text-xs text-zinc-400 font-mono leading-relaxed">
          Runs the real judges (J1–J4) candle-by-candle over historical 5-minute data.
          No Firebase, no virtual balance, no EOD settlement involved — pure offline validation.
        </p>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-3">
        <span className="text-xs uppercase font-black text-white tracking-widest font-mono">Stock</span>
        <select
          value={selectedStock.symbol}
          onChange={(e) => {
            if (e.target.value === 'ALL_STOCKS') {
              setSelectedStock(ALL_STOCKS_OPTION);
            } else {
              const found = POPULAR_STOCKS.find(s => s.symbol === e.target.value);
              if (found) setSelectedStock(found);
            }
          }}
          disabled={isRunning}
          className="w-full bg-zinc-800 text-white border border-zinc-700 rounded-lg p-2.5 text-sm font-mono focus:outline-none focus:border-[#D9B382]/50"
        >
          <option value="ALL_STOCKS">[ALL STOCKS TOGETHER]</option>
          {POPULAR_STOCKS.map(s => (
            <option key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}</option>
          ))}
        </select>

        {/* Exit Strategy Controls */}
        <div className="flex flex-col gap-1.5 mt-1">
          <label className="text-xs uppercase font-black text-zinc-400 tracking-widest font-mono">
            Exit Strategy
          </label>
          <select
            value={exitMode}
            onChange={(e) => setExitMode(e.target.value as any)}
            disabled={isRunning}
            className="w-full bg-zinc-800 text-white border border-zinc-700 rounded-lg p-2.5 text-sm font-mono focus:outline-none focus:border-[#D9B382]/50"
          >
            <option value="DYNAMIC">Dynamic System Exits (TP1, TP2, Breakeven, Trailing SL)</option>
            <option value="FIXED_RR">Strict Fixed Risk-to-Reward Ratio (No partials, no breakeven)</option>
            <option value="FIXED_PCT">Strict Fixed % Stop Loss & Take Profit (No partials, no breakeven)</option>
          </select>
        </div>

        {exitMode === 'FIXED_RR' && (
          <div className="flex flex-col gap-1.5 p-3.5 bg-zinc-950/40 border border-zinc-800 rounded-xl mt-1">
            <span className="text-[10px] uppercase font-black text-[#D9B382] tracking-wider font-mono">
              Fixed R:R Settings
            </span>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-zinc-400">Target Reward-to-Risk (R-Multiple):</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="20"
                value={fixedRRRatio}
                onChange={(e) => setFixedRRRatio(e.target.value)}
                disabled={isRunning}
                className="bg-zinc-800 text-white border border-zinc-700 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D9B382]/50 w-full max-w-[200px]"
              />
            </div>
            <p className="text-[10px] text-zinc-500 font-mono leading-relaxed mt-1">
              Stop Loss is determined by your chosen SL Mode (e.g. ATR or Structure). The Take Profit is set strictly at <strong>{(parseFloat(fixedRRRatio) || 2.0).toFixed(1)}x</strong> the Stop Loss distance. There is no partial profit booking or moving stops to breakeven.
            </p>
          </div>
        )}

        {exitMode === 'FIXED_PCT' && (
          <div className="flex flex-col gap-3 p-3.5 bg-zinc-950/40 border border-zinc-800 rounded-xl mt-1">
            <span className="text-[10px] uppercase font-black text-[#D9B382] tracking-wider font-mono">
              Fixed Percentage Settings
            </span>
            <div className="grid grid-cols-2 gap-3.5">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-zinc-400">Stop Loss %:</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="100"
                    value={fixedSLPct}
                    onChange={(e) => setFixedSLPct(e.target.value)}
                    disabled={isRunning}
                    className="bg-zinc-800 text-white border border-zinc-700 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D9B382]/50 w-full"
                  />
                  <span className="text-zinc-500 text-xs font-mono">%</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-zinc-400">Take Profit %:</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="100"
                    value={fixedTPPct}
                    onChange={(e) => setFixedTPPct(e.target.value)}
                    disabled={isRunning}
                    className="bg-zinc-800 text-white border border-zinc-700 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D9B382]/50 w-full"
                  />
                  <span className="text-zinc-500 text-xs font-mono">%</span>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-zinc-500 font-mono leading-relaxed">
              Every trade uses a strict percentage-based Stop Loss at <strong>{parseFloat(fixedSLPct) || 0.5}%</strong> below entry, and a strict Take Profit at <strong>{parseFloat(fixedTPPct) || 1.0}%</strong> above entry. No technical SL checks or dynamic trailing are applied.
            </p>
          </div>
        )}

        {/* Technique File Upload Section */}
        <div className="flex flex-col gap-1.5 mt-1">
          <label className="text-xs uppercase font-black text-zinc-400 tracking-widest font-mono">
            Backtest Technique File
          </label>

          {techFileName ? (
            <div className="flex items-center justify-between px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl w-full max-w-full overflow-hidden">
              <div className="flex-1 min-w-0 mr-4 overflow-hidden">
                <span className="block text-xs font-mono font-bold text-emerald-400 truncate" title={techFileName}>
                  ✓ {techFileName}
                </span>
                <span className="block text-[10px] font-mono text-emerald-600 mt-0.5">
                  {techniquesList.length} custom techniques loaded & active for backtest
                </span>
              </div>
              <button
                onClick={handleClearTechniques}
                disabled={isRunning}
                className="text-[10px] font-mono text-zinc-500 hover:text-rose-400 disabled:opacity-50 transition-colors shrink-0"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className={`flex flex-col items-center justify-center px-4 py-5 bg-zinc-800/40 border border-dashed border-zinc-700 rounded-xl cursor-pointer hover:border-zinc-500 transition-colors ${isRunning ? 'pointer-events-none opacity-50' : ''}`}>
              <span className="text-zinc-400 text-xs font-mono mb-1">Upload .json technique file</span>
              <span className="text-zinc-600 text-[10px] font-mono text-center">
                Without a technique file, J4 judge scores zero. Signal quality will be lower.
              </span>
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleTechFileUpload}
                disabled={isRunning}
              />
            </label>
          )}

          {techError && (
            <span className="text-[10px] font-mono text-rose-400 mt-0.5">{techError}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 text-[9px] font-mono text-zinc-500 mt-1">
          <span className="bg-zinc-950/60 border border-zinc-850 rounded px-2 py-1">Margin ≥ {MARGIN_THRESHOLD}</span>
          <span className="bg-zinc-950/60 border border-zinc-850 rounded px-2 py-1">No daily trade cap</span>
          <span className="bg-zinc-950/60 border border-zinc-850 rounded px-2 py-1">5-minute candles</span>
          <span className="bg-[#D9B382]/15 border border-[#D9B382]/30 text-[#D9B382] rounded px-2 py-1 font-bold">
            {exitMode === 'DYNAMIC' && 'DYNAMIC EXITS'}
            {exitMode === 'FIXED_RR' && `STRICT FIXED R:R (1:${(parseFloat(fixedRRRatio) || 2.0).toFixed(1)})`}
            {exitMode === 'FIXED_PCT' && `STRICT FIXED % (SL ${parseFloat(fixedSLPct) || 0.5}%, TP ${parseFloat(fixedTPPct) || 1.0}%)`}
          </span>
        </div>

        <button
          onClick={handleRun}
          disabled={isRunning}
          className={`w-full py-2.5 rounded-xl border text-xs font-black uppercase tracking-widest transition-all active:scale-[0.98] ${
            isRunning
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-500 cursor-wait'
              : 'bg-[#D9B382] hover:bg-[#c9a171] text-zinc-950 border-transparent font-extrabold shadow-md'
          }`}
          id="btn-run-backtest"
        >
          {isRunning ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> {statusMessage || 'Running...'}
            </span>
          ) : (
            'Run Backtest'
          )}
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex items-start gap-2">
          <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <p className="text-xs text-rose-400 font-mono leading-relaxed">{error}</p>
        </div>
      )}

      {result && (
        <>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-3">
            <span className="text-xs uppercase font-black text-white tracking-widest font-mono">
              {result.symbol === 'ALL_STOCKS' ? '[ALL STOCKS TOGETHER]' : result.symbol} · {result.startDate} → {result.endDate}
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <StatCard label="Total Trades" value={String(result.totalTrades)} />
              <StatCard label="Win Rate" value={`${(result.winRate * 100).toFixed(1)}%`} accent={result.winRate >= 0.5 ? 'good' : 'bad'} />
              <StatCard label="Wins / Losses" value={`${result.wins} / ${result.losses}`} />
              <StatCard label="Total PnL" value={fmt(result.totalPnL)} accent={result.totalPnL >= 0 ? 'good' : 'bad'} />
              <StatCard label="Avg R-Multiple" value={result.avgRMultiple.toFixed(2)} accent={result.avgRMultiple >= 0 ? 'good' : 'bad'} />
              <StatCard label="Max Drawdown" value={fmt(result.maxDrawdown)} accent="bad" />
              <StatCard label="Max Consec. Losses" value={String(result.maxConsecutiveLosses)} />
              <StatCard label="Avg Duration" value={`${result.avgDurationMinutes.toFixed(0)} min`} />
              <StatCard label="Candles Used" value={String(result.totalCandlesUsed)} />
            </div>
          </div>

          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-2">
            <span className="text-xs uppercase font-black text-white tracking-widest font-mono">Equity Curve</span>
            <BacktestEquityCurve trades={result.trades} />
          </div>

          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase font-black text-white tracking-widest font-mono">Trade Log</span>
              <div className="flex gap-2">
                <button
                  onClick={() => downloadDetailedLog(result.logs, result.symbol)}
                  disabled={!result.logs || result.logs.length === 0}
                  className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-zinc-300 border border-zinc-600 rounded-lg px-2.5 py-1.5 hover:bg-zinc-800 transition-colors disabled:opacity-40"
                >
                  <Download size={12} /> Detailed Log
                </button>
                <button
                  onClick={() => downloadTradesCSV(result.trades, result.symbol)}
                  disabled={result.trades.length === 0}
                  className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-[#D9B382] border border-[#D9B382]/30 rounded-lg px-2.5 py-1.5 hover:bg-[#D9B382]/10 transition-colors disabled:opacity-40"
                  id="btn-download-csv"
                >
                  <Download size={12} /> CSV
                </button>
              </div>
            </div>

            {result.trades.length === 0 ? (
              <p className="text-xs text-zinc-500 font-mono">No trades qualified for this stock in the available history.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono text-zinc-300">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-800">
                      {result.symbol === 'ALL_STOCKS' && <th className="text-left py-1.5 pr-2">Stock</th>}
                      <th className="text-left py-1.5 pr-2">Entry</th>
                      <th className="text-left py-1.5 pr-2">Exit</th>
                      <th className="text-right py-1.5 pr-2">Entry ₹</th>
                      <th className="text-right py-1.5 pr-2">Exit ₹</th>
                      <th className="text-left py-1.5 pr-2">Outcome</th>
                      <th className="text-right py-1.5 pr-2">PnL</th>
                      <th className="text-right py-1.5">R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map(t => (
                      <tr key={t.id} className="border-b border-zinc-900/60 last:border-0">
                        {result.symbol === 'ALL_STOCKS' && (
                          <td className="py-1.5 pr-2 font-bold text-[#D9B382]">
                            {t.symbol?.split(':')[0] ?? ''}
                          </td>
                        )}
                        <td className="py-1.5 pr-2">{new Date(t.entryTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="py-1.5 pr-2">{t.exitTime ? new Date(t.exitTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        <td className="py-1.5 pr-2 text-right">{t.entryPrice.toFixed(2)}</td>
                        <td className="py-1.5 pr-2 text-right">{t.exitPrice !== null ? t.exitPrice.toFixed(2) : '—'}</td>
                        <td className={`py-1.5 pr-2 ${t.outcome === 'SL_HIT' ? 'text-rose-400' : t.outcome === 'TP2_HIT' ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {t.outcome ?? '—'}
                        </td>
                        <td className={`py-1.5 pr-2 text-right ${t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(t.pnl)}</td>
                        <td className="py-1.5 text-right">{t.rMultiple.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
