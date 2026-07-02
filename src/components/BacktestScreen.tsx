import React, { useState } from 'react';
import { BarChart2, Download, AlertTriangle, Loader2 } from 'lucide-react';
import { POPULAR_STOCKS, StockSearchResult } from './BotSetupScreen';
import { fetchBacktestHistory } from '../services/backtestDataService';
import { runBacktest } from '../quant/backtestEngine';
import { BacktestConfig, BacktestResult, BacktestTrade } from '../types/backtest';
import { getDefaultScalpConfig } from '../config/scalpConfig';

const MARGIN_THRESHOLD = 2.5;
const MAX_TRADES_PER_DAY = 5;
const WARMUP_CANDLES = 30;

function fmt(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function downloadTradesCSV(trades: BacktestTrade[], symbol: string) {
  const headers = ['Entry Time', 'Exit Time', 'Entry Price', 'Exit Price', 'Outcome', 'PnL', 'R-Multiple', 'Duration (min)', 'Bull Score', 'Bear Score', 'Margin'];
  const rows = trades.map(t => [
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
  ]);
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

  const handleRun = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);
    setStatusMessage('Loading bundled historical data...');

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
        techniquesList: [],
      };
      const res = runBacktest(candles, config);
      setResult(res);
    } catch (e: any) {
      setError(e.message ?? 'Backtest engine failed');
    } finally {
      setIsRunning(false);
      setStatusMessage('');
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
            const found = POPULAR_STOCKS.find(s => s.symbol === e.target.value);
            if (found) setSelectedStock(found);
          }}
          disabled={isRunning}
          className="w-full bg-zinc-800 text-white border border-zinc-700 rounded-lg p-2.5 text-sm font-mono focus:outline-none focus:border-[#D9B382]/50"
        >
          {POPULAR_STOCKS.map(s => (
            <option key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}</option>
          ))}
        </select>

        <div className="flex flex-wrap gap-2 text-[9px] font-mono text-zinc-500 mt-1">
          <span className="bg-zinc-950/60 border border-zinc-850 rounded px-2 py-1">Margin ≥ {MARGIN_THRESHOLD}</span>
          <span className="bg-zinc-950/60 border border-zinc-850 rounded px-2 py-1">Max {MAX_TRADES_PER_DAY} trades/day</span>
          <span className="bg-zinc-950/60 border border-zinc-850 rounded px-2 py-1">5-minute candles</span>
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
              {result.symbol} · {result.startDate} → {result.endDate}
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
