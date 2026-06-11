import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity, TrendingUp, TrendingDown, Shield,
  AlertTriangle, CheckCircle, Clock, Target,
  Zap, BarChart2, List, Wifi, WifiOff, Pause, Square
} from 'lucide-react';
import { UseBotLoopResult, BotPhase, BotTradeRecord } from '../hooks/useBotLoop';
import { filterTradesByRange } from '../services/botTradeService';
import { auth } from '../services/firebase';
import { useEODSettlement } from '../hooks/useEODSettlement';
import { fetchLivePrice } from '../services/stockPriceFeed';

interface BotDashboardProps {
  bot:      UseBotLoopResult;
  capital:  number;
  symbol:   string;
  onStop:   () => void;
  onPause:  () => void;
}

const PHASE_CONFIG: Record<BotPhase, {
  label:    string;
  color:    string;
  bg:       string;
  border:   string;
  pulse:    boolean;
}> = {
  IDLE:            { label: 'IDLE',             color: 'text-zinc-500',   bg: 'bg-zinc-800/40',     border: 'border-zinc-700',    pulse: false },
  SCANNING:        { label: 'SCANNING',         color: 'text-sky-400',    bg: 'bg-sky-500/10',      border: 'border-sky-500/30',  pulse: true  },
  SIGNAL_FORMING:  { label: 'SIGNAL FORMING',   color: 'text-amber-400',  bg: 'bg-amber-500/10',    border: 'border-amber-500/30',pulse: true  },
  ARMED:           { label: 'ARMED',            color: 'text-emerald-300',bg: 'bg-emerald-500/15',  border: 'border-emerald-400', pulse: true  },
  IN_TRADE:        { label: 'IN TRADE',         color: 'text-emerald-400',bg: 'bg-emerald-500/10',  border: 'border-emerald-500', pulse: true  },
  COOLDOWN:        { label: 'COOLDOWN',         color: 'text-orange-400', bg: 'bg-orange-500/10',   border: 'border-orange-500/30',pulse: false },
  HALTED:          { label: 'HALTED',           color: 'text-rose-400',   bg: 'bg-rose-500/10',     border: 'border-rose-500/30', pulse: false },
};

const OUTCOME_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  TP2_HIT:     { label: 'TP2 ✓',    color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  TP1_HIT:     { label: 'TP1 ✓',    color: 'text-teal-400',    bg: 'bg-teal-500/10'    },
  TRAIL_HIT:   { label: 'TRAIL ✓',  color: 'text-sky-400',     bg: 'bg-sky-500/10'     },
  BREAK_EVEN:  { label: 'B/E',      color: 'text-zinc-400',    bg: 'bg-zinc-700/40'    },
  SL_HIT:      { label: 'SL ✗',     color: 'text-rose-400',    bg: 'bg-rose-500/10'    },
  TIME_EXIT:   { label: 'TIME',     color: 'text-orange-400',  bg: 'bg-orange-500/10'  },
  MANUAL_EXIT: { label: 'MANUAL',   color: 'text-zinc-400',    bg: 'bg-zinc-700/40'    },
};

interface Toast {
  id:      string;
  message: string;
  type:    'win' | 'loss' | 'info' | 'warning';
}

function EquityCurve({ trades }: { trades: BotTradeRecord[] }) {
  const closed = trades.filter(t => t.realizedPnL !== null);
  if (closed.length < 2) {
    return (
      <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
        Need 2+ closed trades to plot curve
      </div>
    );
  }

  // Build cumulative P&L series
  const points: number[] = [];
  let cumulative = 0;
  [...closed].reverse().forEach(t => {
    cumulative += t.realizedPnL ?? 0;
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

  // Zero line y
  const zeroY = toY(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
      {/* Zero line */}
      <line
        x1="0" y1={zeroY} x2={W} y2={zeroY}
        stroke="#3f3f46" strokeWidth="1" strokeDasharray="4 4"
      />
      {/* Equity path */}
      <path
        d={pathD}
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* End dot */}
      <circle cx={toX(points.length - 1)} cy={lastY} r="3" fill={lineColor} />
    </svg>
  );
}

function TimeBar({
  timeRemainingMs,
  maxHoldingMinutes,
}: {
  timeRemainingMs:   number | null;
  maxHoldingMinutes: number;
}) {
  if (timeRemainingMs === null) return null;
  const totalMs  = maxHoldingMinutes * 60_000;
  const pct      = Math.max(0, Math.min(100, (timeRemainingMs / totalMs) * 100));
  const mins     = Math.floor(timeRemainingMs / 60_000);
  const secs     = Math.floor((timeRemainingMs % 60_000) / 1000);
  const urgent   = pct < 25;

  return (
    <div className="mt-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-1">
          <Clock size={10} /> Time remaining
        </span>
        <span className={`text-[10px] font-mono font-bold ${urgent ? 'text-orange-400' : 'text-zinc-400'}`}>
          {mins}m {secs}s
        </span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${urgent ? 'bg-orange-500' : 'bg-sky-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function BotDashboard({ bot, capital, symbol, onStop, onPause }: BotDashboardProps) {

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showTech, setShowTech] = useState(false);
  const [selectedRange, setSelectedRange] = useState<string>('TODAY');
  const prevPhaseRef    = useRef<string>('');
  const prevOutcomeRef  = useRef<string | null>(null);

  const addToast = useCallback((message: string, type: Toast['type']) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    setToasts(prev => [{ id, message, type }, ...prev].slice(0, 4));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const [isReEvaluatingLocal, setIsReEvaluatingLocal] = useState(false);

  const handleReEvaluate = useCallback(async () => {
    if (isReEvaluatingLocal || bot.isAnalyzing) return;
    setIsReEvaluatingLocal(true);
    addToast('Initiating chart and AI signal re-evaluation...', 'info');
    try {
      await bot.reEvaluate();
      addToast('Re-evaluation completed successfully.', 'info');
    } catch (err: any) {
      addToast(`Re-evaluation failed: ${err.message || err}`, 'warning');
    } finally {
      setIsReEvaluatingLocal(false);
    }
  }, [bot, addToast, isReEvaluatingLocal]);

  const [activeTradesPrices, setActiveTradesPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!bot.activeTrades || bot.activeTrades.length === 0) return;
    
    let active = true;
    const fetchPricesForActive = async () => {
      const symbols = Array.from(new Set(bot.activeTrades.map(t => t.symbol)));
      const nextPrices: Record<string, number> = {};
      
      await Promise.all(
        symbols.map(async (s) => {
          try {
            const result = await fetchLivePrice(s);
            if (result && result.price && active) {
              nextPrices[s] = result.price;
            }
          } catch (err) {
            console.error('[BotDashboard] failed to fetch live price for', s, err);
          }
        })
      );
      
      if (active && Object.keys(nextPrices).length > 0) {
        setActiveTradesPrices(prev => ({ ...prev, ...nextPrices }));
      }
    };

    fetchPricesForActive();
    const interval = setInterval(fetchPricesForActive, 10_000); // refresh active prices every 10s
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [bot.activeTrades]);

  const primaryPlan = bot.activePlans[0];
  const uid = auth.currentUser?.uid ?? null;
  const { state: eodState, triggerSettlement } = useEODSettlement(uid);
  const [eodBanner, setEodBanner] = useState<{ type: 'success' | 'error'; message: string; sub?: string } | null>(null);

  // Show persistent banner when settlement completes
  useEffect(() => {
    if (!eodState.lastResult) return;
    const r = eodState.lastResult;
    if (r.settled === 0 && r.skipped === 0) {
      setEodBanner({ type: 'success', message: 'No open trades to settle' });
    } else if (r.settled > 0) {
      const sign = r.totalNetPnL >= 0 ? '+' : '';
      setEodBanner({
        type: 'success',
        message: `Settlement done — ${r.settled} trade${r.settled > 1 ? 's' : ''} · Net P&L: ${sign}₹${Math.abs(r.totalNetPnL).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
        sub: r.ambiguous > 0 ? `${r.ambiguous} ambiguous (both TP & SL hit same day — closed at day's close price). Restart bot to see trades in log.` : 'Restart bot to see settled trades in trade log.',
      });
    } else {
      setEodBanner({ type: 'error', message: `Settlement failed for ${r.skipped} trade(s)` });
    }
  }, [eodState.lastResult]);

  const filteredTrades = useMemo(() => {
    return filterTradesByRange(bot.tradeHistory, selectedRange);
  }, [bot.tradeHistory, selectedRange]);

  // Fire toasts on key state changes
  useEffect(() => {
    const phaseValue = bot.phase;

    // Trade opened
    if (phaseValue === 'IN_TRADE' && prevPhaseRef.current !== 'IN_TRADE') {
      addToast(`LONG entered at ₹${primaryPlan?.entry?.toFixed(2) ?? '—'}`, 'info');
    }

    // Trade closed outcomes
    if (bot.tradeHistory.length > 0) {
      const latest  = bot.tradeHistory[0];
      const outcome = latest.outcome;
      if (outcome && outcome !== prevOutcomeRef.current) {
        prevOutcomeRef.current = outcome;
        if (outcome === 'TP2_HIT') addToast(`TP2 HIT ✓  +₹${latest.realizedPnL?.toFixed(0)}`, 'win');
        else if (outcome === 'TP1_HIT') addToast(`TP1 HIT ✓  +₹${latest.realizedPnL?.toFixed(0)}`, 'win');
        else if (outcome === 'TRAIL_HIT') addToast(`Trailing stop ✓  +₹${latest.realizedPnL?.toFixed(0)}`, 'win');
        else if (outcome === 'SL_HIT') addToast(`SL hit  −₹${Math.abs(latest.realizedPnL ?? 0).toFixed(0)}`, 'loss');
        else if (outcome === 'TIME_EXIT') addToast('Time exit — max hold reached', 'warning');
        else if (outcome === 'MANUAL_EXIT') addToast('Manual exit executed', 'info');
      }
    }

    // TP1 milestone
    if (bot.tp1Hit && prevPhaseRef.current === 'IN_TRADE') {
      addToast('TP1 reached — SL moved to break-even', 'info');
    }

    // Halted
    if (phaseValue === 'HALTED' && prevPhaseRef.current !== 'HALTED') {
      addToast(`Bot halted: ${bot.lastBlockReason ?? 'Unknown reason'}`, 'warning');
    }

    prevPhaseRef.current = phaseValue;
  }, [bot.phase, bot.tradeHistory, bot.tp1Hit, primaryPlan, bot.lastBlockReason, addToast]);

  const phase  = PHASE_CONFIG[bot.phase];
  const pnlPos = (bot.sessionStats.totalPnL ?? 0) >= 0;

  // Format price with 2 decimals
  const fmt = (n: number | null) =>
    n == null ? '—' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div 
      className="w-full flex flex-col gap-3 bg-[#0A0B0E] p-4 pb-32"
      style={{ height: 'calc(100vh - 128px)', overflowY: 'auto' }}
      id="bot-run-dashboard-scroll"
    >

      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-mono font-bold shadow-2xl backdrop-blur-sm transition-all animate-in slide-in-from-right ${
              t.type === 'win'     ? 'bg-emerald-900/90 border-emerald-500/50 text-emerald-300' :
              t.type === 'loss'    ? 'bg-rose-900/90 border-rose-500/50 text-rose-300' :
              t.type === 'warning' ? 'bg-orange-900/90 border-orange-500/50 text-orange-300' :
                                     'bg-zinc-900/90 border-zinc-600/50 text-zinc-300'
            }`}
          >
            {t.type === 'win'     ? '✓' :
             t.type === 'loss'    ? '✗' :
             t.type === 'warning' ? '⚠' : 'ℹ'} {t.message}
          </div>
        ))}
      </div>

      {/* ── SECTION 0: Chart Preview ───────────────────────────────── */}
      {bot.lastChartUrl && (
        <div className="relative bg-zinc-900/40 border border-zinc-800/40 rounded-xl overflow-hidden">
          {/* Chart image */}
          <img
            src={bot.lastChartUrl}
            alt="Last analyzed chart"
            className="w-full h-auto object-cover"
            style={{ imageRendering: 'pixelated', maxHeight: '180px' }}
          />

          {/* Analyzing overlay */}
          {bot.isAnalyzing && (
            <div className="absolute inset-0 bg-[#131722]/60 backdrop-blur-[1px] flex items-center justify-center">
              <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900/80 rounded-full border border-[#D9B382]/30">
                <div className="w-2 h-2 rounded-full bg-[#D9B382] animate-pulse" />
                <span className="text-[10px] font-mono font-bold text-[#D9B382] uppercase tracking-widest">
                  Analyzing...
                </span>
              </div>
            </div>
          )}

          {/* Entry / SL / TP overlays on chart — horizontal price lines */}
          {bot.phase === 'IN_TRADE' && bot.activePlans[0] && bot.currentPrice && (() => {
            const plan     = bot.activePlans[0];
            const priceMin = Math.min(plan.stopLoss, bot.currentPrice ?? plan.entry) * 0.998;
            const priceMax = Math.max(plan.takeProfit2, bot.currentPrice ?? plan.entry) * 1.002;
            const range    = priceMax - priceMin;
            const toY      = (price: number) =>
              `${(100 - ((price - priceMin) / range) * 100).toFixed(1)}%`;

            return (
              <div className="absolute inset-0 pointer-events-none">
                {/* SL line */}
                <div className="absolute left-0 right-0 border-t border-rose-500/70 border-dashed flex items-center"
                  style={{ top: toY(bot.trailSL || plan.stopLoss) }}>
                  <span className="bg-rose-500/80 text-white text-[8px] font-mono px-1 ml-1 rounded">
                    SL {plan.stopLoss.toFixed(1)}
                  </span>
                </div>
                {/* TP1 line */}
                {!bot.tp1Hit && (
                  <div className="absolute left-0 right-0 border-t border-teal-400/70 border-dashed flex items-center"
                    style={{ top: toY(plan.takeProfit1) }}>
                    <span className="bg-teal-500/80 text-white text-[8px] font-mono px-1 ml-1 rounded">
                      TP1 {plan.takeProfit1.toFixed(1)}
                    </span>
                  </div>
                )}
                {/* TP2 line */}
                <div className="absolute left-0 right-0 border-t border-emerald-400/70 border-dashed flex items-center"
                  style={{ top: toY(plan.takeProfit2) }}>
                  <span className="bg-emerald-500/80 text-white text-[8px] font-mono px-1 ml-1 rounded">
                    TP2 {plan.takeProfit2.toFixed(1)}
                  </span>
                </div>
                {/* Entry line */}
                <div className="absolute left-0 right-0 border-t border-[#D9B382]/60 border-dashed flex items-center"
                  style={{ top: toY(plan.entry) }}>
                  <span className="bg-[#D9B382]/80 text-[#1A1308] text-[8px] font-mono font-bold px-1 ml-1 rounded">
                    E {plan.entry.toFixed(1)}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Bottom metadata strip */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#0A0B0E]/90 to-transparent px-3 py-2 flex justify-between items-end">
            <span className="text-[9px] font-mono text-zinc-500">
              {bot.lastAnalyzedAt
                ? `Last scan ${Math.round((Date.now() - bot.lastAnalyzedAt) / 1000)}s ago`
                : 'Awaiting scan'}
            </span>
            <span className="text-[9px] font-mono text-zinc-600">
              {bot.candleCount} candles
            </span>
          </div>
        </div>
      )}

      {/* Warmup bar — when bot has no chart yet */}
      {!bot.lastChartUrl && bot.phase !== 'IDLE' && (
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-4 text-center">
          <div className="text-[10px] font-mono text-zinc-500 mb-2 uppercase tracking-wider">
            Building candle history...
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5">
            <div
              className="bg-[#D9B382] h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (bot.candleCount / 15) * 100).toFixed(0)}%` }}
            />
          </div>
          <div className="text-[10px] font-mono text-zinc-600 mt-1.5">
            {bot.candleCount}/15 candles
          </div>
        </div>
      )}

      {/* ── SECTION 1: Status Header ─────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          {/* Phase badge */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-black uppercase tracking-wider ${phase.color} ${phase.bg} ${phase.border}`}>
            <Activity size={12} className={phase.pulse ? 'animate-pulse' : ''} />
            {phase.label}
          </div>

          {/* Symbol */}
          <span className="font-mono text-sm font-bold text-zinc-300">{symbol}</span>

          {/* Techniques status */}
          <span className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border ${
            bot.techniqueCount > 0
              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
              : 'text-amber-500 bg-amber-500/10 border-amber-500/20'
          }`}>
            🚀 {bot.techniqueCount === 0 ? '0 TECHNIQUES LOADED' : `${bot.techniqueCount} TECHNIQUES`}
          </span>

          {/* Market status */}
          <span className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border ${
            bot.marketOpen
              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
              : 'text-zinc-500 bg-zinc-800/40 border-zinc-700'
          }`}>
            {bot.marketOpen ? <Wifi size={9} /> : <WifiOff size={9} />}
            {bot.marketOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
          </span>

          {/* EOD Settlement status pill */}
          {eodState.isSettling && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full animate-pulse">
              ⏳ Settling trades...
            </span>
          )}
          {!eodState.isSettling && eodState.alreadySettled && eodState.lastResult && eodState.lastResult.settled > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              ✓ EOD SETTLED
            </span>
          )}

          {/* Stale warning */}
          {bot.isStale && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full">
              <AlertTriangle size={9} /> STALE FEED
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-end gap-3 border-t border-zinc-800/40 md:border-t-0 pt-2.5 md:pt-0">
          <div className="flex items-center gap-2">
            <button
              onClick={onPause}
              className="p-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 transition-colors"
              title="Pause bot"
            >
              <Pause size={14} />
            </button>
            <button
              onClick={onStop}
              className="p-2.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 transition-colors"
              title="Stop bot"
            >
              <Square size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Market closed info — shown when outside trading hours */}
      {!bot.marketOpen && bot.phase !== 'IDLE' && !bot.feedError && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-800/60 border border-zinc-700/40 rounded-xl">
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
            <WifiOff size={12} />
            <span>Market closed — showing last known price</span>
          </div>
          {bot.currentPrice && (
            <span className="text-xs font-mono font-bold text-zinc-300">
              ₹{bot.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          )}
        </div>
      )}

      {/* EOD Settlement Banner */}
      {eodBanner && (
        <div className={`flex flex-col gap-1 px-4 py-3 border rounded-xl ${
          eodBanner.type === 'success'
            ? 'bg-emerald-500/8 border-emerald-500/20'
            : 'bg-rose-500/10 border-rose-500/30'
        }`}>
          <div className="flex items-center justify-between">
            <div className={`flex items-center gap-2 text-xs font-mono font-bold ${
              eodBanner.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              <span>{eodBanner.type === 'success' ? '✓' : '✗'}</span>
              <span>{eodBanner.message}</span>
            </div>
            <button
              onClick={() => setEodBanner(null)}
              className="text-zinc-500 hover:text-zinc-300 text-xs ml-3 shrink-0"
            >✕</button>
          </div>
          {eodBanner.sub && (
            <span className="text-[10px] font-mono text-zinc-500 pl-5">{eodBanner.sub}</span>
          )}
        </div>
      )}

      {/* EOD Settle Button */}
      {eodState.canSettle && (
        <button
          onClick={async () => {
            await triggerSettlement();
            await bot.syncFromCloud(); // Force state hydration to update bot phase to IDLE
          }}
          disabled={eodState.isSettling || !bot.activeTrades || bot.activeTrades.length === 0}
          className={`w-full py-2.5 rounded-xl border text-xs font-black uppercase tracking-widest transition-all active:scale-[0.98] ${
            !bot.activeTrades || bot.activeTrades.length === 0
              ? 'bg-zinc-900/40 border-zinc-850 text-zinc-600 cursor-not-allowed'
              : eodState.isSettling
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-500 cursor-wait animate-pulse'
              : 'bg-[#D9B382] hover:bg-[#c9a171] text-zinc-950 border-transparent font-extrabold shadow-md'
          }`}
        >
          {(!bot.activeTrades || bot.activeTrades.length === 0)
            ? '✓ No Open Trades to Settle'
            : eodState.isSettling
            ? '⏳ Settling Trades...'
            : '📋 Settle Today\'s Trades'}
        </button>
      )}

      {/* Feed error */}
      {bot.feedError && (() => {
        const err = bot.feedError;

        // Categorise error severity
        const isSymbolError   = err.includes('not found') || err.includes('404');
        const isAuthError     = err.includes('API key') || err.includes('AUTH');
        const isDailyLimit    = err.includes('Daily API limit') || err.includes('ALL_KEYS');
        const isRetrying      = err.includes('retrying');

        const bgColor    = isSymbolError || isAuthError || isDailyLimit
          ? 'bg-rose-500/10 border-rose-500/30'
          : isRetrying
          ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-rose-500/10 border-rose-500/30';

        const textColor  = isRetrying ? 'text-amber-400' : 'text-rose-400';
        const icon       = isSymbolError  ? '⊘'
                         : isAuthError    ? '🔑'
                         : isDailyLimit   ? '📊'
                         : isRetrying     ? '⟳'
                         : '⚠';

        const action     = isSymbolError  ? 'Go back and try a different symbol'
                         : isAuthError    ? 'Check your Twelve Data API key'
                         : isDailyLimit   ? 'Limit resets at midnight IST'
                         : isRetrying     ? 'Will retry automatically'
                         : `${bot.consecutiveFailures}/${3} failures before halt`;

        return (
          <div className={`flex flex-col gap-1 px-4 py-3 border rounded-xl ${bgColor}`}>
            <div className={`flex items-center gap-2 text-xs font-mono font-bold ${textColor}`}>
              <span>{icon}</span>
              <span className="flex-1">{err}</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 pl-5">{action}</span>
          </div>
        );
      })()}

      {/* Last block reason */}
      {bot.lastBlockReason && bot.phase !== 'IN_TRADE' && (
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1">
            <p className="text-[9px] text-amber-500 font-black uppercase tracking-widest mb-1 font-mono">
              Last Status / Block Reason
            </p>
            <p className="text-xs text-amber-300 font-mono break-all leading-normal">
              {bot.lastBlockReason}
            </p>
          </div>
          {bot.phase !== 'IDLE' && (
            <button
              onClick={handleReEvaluate}
              id="btn-re-evaluate-status"
              disabled={isReEvaluatingLocal || bot.isAnalyzing}
              className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-black uppercase tracking-wider transition-colors shrink-0 flex items-center gap-1.5 active:scale-[0.98] disabled:opacity-50"
            >
              🔄 {isReEvaluatingLocal || bot.isAnalyzing ? 'Evaluating...' : 'Re-evaluate'}
            </button>
          )}
        </div>
      )}

      {/* Cooldown countdown */}
      {bot.phase === 'COOLDOWN' && bot.cooldownRemainsMs != null && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl">
          <div className="flex items-center gap-2 text-orange-400 text-xs font-mono">
            <Clock size={12} />
            <span className="font-black uppercase tracking-wider">Cooldown</span>
          </div>
          <span className="font-mono text-sm font-black text-orange-300">
            {Math.floor(bot.cooldownRemainsMs / 60000)}m {Math.floor((bot.cooldownRemainsMs % 60000) / 1000)}s
          </span>
          <div className="w-24 bg-orange-900/40 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-orange-500 h-1.5 rounded-full transition-all duration-1000"
              style={{ width: `${Math.min(100, (bot.cooldownRemainsMs / 600_000) * 100).toFixed(0)}%` }}
            />
          </div>
        </div>
      )}

      {/* Virtual Balance Card */}
      {(() => {
        const balance = bot.virtualBalance ?? 100000;
        const openTrades = bot.activeTrades ?? [];
        const openTradesOutlay = openTrades.reduce((sum, t) => {
          const entry = t.entryPrice;
          const shares = t.plan?.positionSize ?? 1;
          const invested = t.plan?.investmentRupees ?? (entry * shares);
          const estCharges = t.plan?.brokerCharges ?? 0;
          return sum + invested + estCharges;
        }, 0);

        const totalRealizedPnL = (bot.tradeHistory ?? []).reduce((sum, t) => sum + (t.realizedPnL ?? 0), 0);
        const STARTING_BASE = balance + openTradesOutlay - totalRealizedPnL;
        const accountEquity = balance + openTradesOutlay;
        const delta = accountEquity - STARTING_BASE;
        const deltaPct = STARTING_BASE > 0 ? (delta / STARTING_BASE) * 100 : 0;

        return (
          <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold">Virtual Account Equity</span>
              <div className="mt-1 font-mono text-2xl font-black text-zinc-100">
                ₹{accountEquity.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-[9px] text-zinc-500 mt-0.5">
                Available Cash: ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="text-left sm:text-right font-mono text-xs">
              <span className={`font-bold ${
                delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-zinc-500'
              }`}>
                {delta > 0 ? '+' : ''}₹{delta.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({delta > 0 ? '+' : ''}{deltaPct.toFixed(2)}%)
              </span>
              <div className="text-[9px] text-zinc-500 mt-1">
                from starting ₹{STARTING_BASE.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── SECTION 2: Live Price + Last Signal ──────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Current Price</span>
          <div className="mt-1 font-mono text-xl font-black text-zinc-100">
            {fmt(bot.currentPrice)}
          </div>
          <div className="text-[10px] font-mono text-zinc-600 mt-0.5">
            {bot.candleCount} candles · last {bot.lastUpdated
              ? `${Math.round((Date.now() - bot.lastUpdated) / 1000)}s ago`
              : '—'}
          </div>
        </div>

        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Confidence</span>
          <div className="mt-2 relative">
            {/* Arc gauge — SVG */}
            <svg viewBox="0 0 80 48" className="w-full h-12">
              {/* Background arc */}
              <path
                d="M 8 44 A 32 32 0 0 1 72 44"
                fill="none" stroke="#27272a" strokeWidth="5"
                strokeLinecap="round"
              />
              {/* Filled arc based on confidence */}
              <path
                d="M 8 44 A 32 32 0 0 1 72 44"
                fill="none"
                stroke={
                  bot.lastConfidence >= 75 ? '#34d399' :
                  bot.lastConfidence >= 60 ? '#D9B382' : '#71717a'
                }
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${(bot.lastConfidence / 100) * 100.5} 100.5`}
              />
              {/* Value text */}
              <text x="40" y="43" textAnchor="middle"
                fontSize="11" fontWeight="900" fontFamily="monospace"
                fill={
                  bot.lastConfidence >= 75 ? '#34d399' :
                  bot.lastConfidence >= 60 ? '#D9B382' : '#71717a'
                }
              >
                {bot.lastConfidence.toFixed(0)}%
              </text>
            </svg>
          </div>
          <div className={`text-center text-[9px] font-mono font-bold mt-0.5 ${
            bot.lastSignal === 'LONG' ? 'text-emerald-400' : 'text-zinc-500'
          }`}>
            {bot.lastSignal ?? 'WAITING'}
          </div>
        </div>
      </div>

      {/* ── Live Analysis Judge Panel ── */}
      {bot.lastAnalysisResult && (() => {
        const judgeObj   = bot.lastAnalysisResult?.judge || {};
        const casesObj   = judgeObj.cases || null;
        const winner     = judgeObj.winner || 'NO_TRADE';
        const ruling     = judgeObj.ruling || '—';
        const confidence = judgeObj.finalConfidence ?? 0;
        const techEval   = judgeObj.techniquesEvaluation || null;

        return (
          <div className={`rounded-xl border p-4 ${
            winner === 'BULL' ? 'bg-emerald-950/40 border-emerald-500/30' :
            winner === 'BEAR' ? 'bg-red-950/40 border-red-500/30' :
            'bg-zinc-900/60 border-white/10'
          }`}>

            {/* Header */}
            <div className="flex flex-row items-center justify-between mb-3 pb-3 border-b border-white/10">
              <div className="flex flex-row items-center gap-2">
                <span className="text-[#D9B382] text-[10px] font-black uppercase tracking-widest">4-Judge Arbitrator</span>
              </div>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                winner === 'BULL' ? 'bg-emerald-500/20 text-emerald-400' :
                winner === 'BEAR' ? 'bg-red-500/20 text-red-400' :
                'bg-zinc-700/40 text-zinc-400'
              }`}>
                {winner}
              </span>
            </div>

            {/* J1/J2/J3 Bull vs Bear scorecards */}
            {casesObj && (
              <div className="flex flex-row gap-2 mb-3">
                {(['bull', 'bear'] as const).map(side => {
                  const data = casesObj[side] || { j1: 0, j2: 0, j3: 0, total: 0 };
                  const isWinner = side.toUpperCase() === winner;
                  const color = side === 'bull' ? '#22C55E' : '#EF4444';
                  return (
                    <div key={side} className={`flex-1 bg-black/30 rounded-xl p-3 border ${isWinner ? (side === 'bull' ? 'border-emerald-500/40' : 'border-red-500/40') : 'border-white/5'}`}>
                      <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${side === 'bull' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {side === 'bull' ? '🐂 Bull Case' : '🐻 Bear Case'}
                      </p>
                      {[
                        { label: 'J1 Pattern', val: data.j1, max: 4 },
                        { label: 'J2 Indicator', val: data.j2, max: 4 },
                        { label: 'J3 Reversal', val: data.j3, max: 3 },
                      ].map((j, i) => (
                        <div key={i} className="mb-1.5">
                          <div className="flex flex-row justify-between mb-0.5">
                            <span className="text-[8px] text-zinc-500 uppercase">{j.label}</span>
                            <span className="text-[8px] font-mono text-white">{j.val}/{j.max}</span>
                          </div>
                          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-1000"
                              style={{ width: `${(j.val / j.max) * 100}%`, backgroundColor: color }}
                            />
                          </div>
                        </div>
                      ))}
                      <div className="mt-2 pt-2 border-t border-white/10 flex flex-row justify-between">
                        <span className="text-[8px] text-[#D9B382] font-black uppercase">Total</span>
                        <span className={`text-[10px] font-black ${isWinner ? (side === 'bull' ? 'text-emerald-400' : 'text-red-400') : 'text-white'}`}>
                          {data.total}/12.0
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Ruling */}
            <div className="mb-3 bg-black/20 rounded-xl p-3 border border-[#D9B382]/15">
              <p className="text-[8px] text-[#D9B382] font-black uppercase tracking-widest mb-1">Arbitrator Ruling</p>
              <p className="text-white text-[10px] leading-4">{ruling}</p>
            </div>

            {/* Technique Scoring Panel */}
            {techEval && (
              <div className="bg-black/20 rounded-xl border border-dashed border-[#D9B382]/30 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowTech(!showTech)}
                  className="w-full flex flex-row items-center justify-between p-3"
                >
                  <div className="flex flex-row items-center gap-2">
                    <span className="text-[9px] font-black text-white uppercase tracking-wider">
                      Verification Engine — {techEval.totalTechniques} Techniques
                    </span>
                  </div>
                  <div className="flex flex-row items-center gap-2">
                    <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                      🐂 +{(techEval.bulldogPoints ?? 0).toFixed(1)} Bull
                    </span>
                    <span className="text-[8px] font-black text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
                      🐻 +{(techEval.peerPoints ?? 0).toFixed(1)} Bear
                    </span>
                    <span className="text-[8px] text-zinc-400">{showTech ? '▲' : '▼'}</span>
                  </div>
                </button>

                {showTech && (
                  <div className="px-3 pb-3 border-t border-white/10">
                    {/* Bull techniques */}
                    <p className="text-[8px] font-black text-emerald-400 uppercase mt-3 mb-2">🐂 Bullish Techniques</p>
                    {(techEval.bullList || []).map((tech: any, i: number) => (
                      <div key={i} className="flex flex-row items-start justify-between mb-2">
                        <div className="flex-1 mr-2">
                          <p className={`text-[9px] font-bold ${tech.matched ? 'text-white' : 'text-zinc-500'}`}>• {tech.name}</p>
                          <p className={`text-[7px] leading-3 pl-2 ${tech.matched ? 'text-zinc-300' : 'text-zinc-600'}`}>{tech.process}</p>
                        </div>
                        <div className="flex flex-row items-center gap-1 shrink-0">
                          <span className={`text-[9px] font-black ${tech.matched ? 'text-emerald-400' : 'text-zinc-600'}`}>
                            {tech.matched ? `+${tech.pointsEarned.toFixed(1)}` : '0.0'}
                          </span>
                          <span className="text-[9px]">{tech.matched ? '✅' : '⚪'}</span>
                        </div>
                      </div>
                    ))}

                    {/* Bear techniques */}
                    <p className="text-[8px] font-black text-red-400 uppercase mt-3 mb-2">🐻 Bearish Techniques</p>
                    {(techEval.bearList || []).map((tech: any, i: number) => (
                      <div key={i} className="flex flex-row items-start justify-between mb-2">
                        <div className="flex-1 mr-2">
                          <p className={`text-[9px] font-bold ${tech.matched ? 'text-white' : 'text-zinc-500'}`}>• {tech.name}</p>
                          <p className={`text-[7px] leading-3 pl-2 ${tech.matched ? 'text-zinc-300' : 'text-zinc-600'}`}>{tech.process}</p>
                        </div>
                        <div className="flex flex-row items-center gap-1 shrink-0">
                          <span className={`text-[9px] font-black ${tech.matched ? 'text-red-400' : 'text-zinc-600'}`}>
                            {tech.matched ? `+${tech.pointsEarned.toFixed(1)}` : '0.0'}
                          </span>
                          <span className="text-[9px]">{tech.matched ? '✅' : '⚪'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        );
      })()}

      {/* ── Buy Now button ────────────────────────────────────────── */}
      {bot.phase !== 'IDLE' && bot.phase !== 'IN_TRADE' && bot.phase !== 'HALTED' && bot.currentPrice != null && (
        <div className="flex flex-col gap-2 w-full">
          <div className="flex gap-3">
            <button
              onClick={() => bot.manualBuy(false)}
              id="btn-manual-buy"
              className="flex-1 py-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25
                         border border-emerald-500/40 text-emerald-400 text-xs font-black
                         uppercase tracking-widest transition-all shadow-lg active:scale-[0.98]"
            >
              ⚡ Buy Now
            </button>
            <button
              onClick={() => bot.manualBuy(true)}
              id="btn-force-buy"
              className="flex-1 py-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25
                         border border-amber-500/40 text-amber-400 text-xs font-black
                         uppercase tracking-widest transition-all shadow-lg active:scale-[0.98]"
            >
              🔥 Force Buy
            </button>
          </div>
          <p className="text-[9px] text-zinc-500 font-mono text-center">
            *Force Buy bypasses indicators, trend analysis, predictability, and risk gates.
          </p>
        </div>
      )}

      {/* ── SECTION 3: Active Positions & Settlement Control ───────────── */}
      <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-2xl p-5 flex flex-col gap-4 relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#D9B382] bg-opacity-[0.01] rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-zinc-900 pb-3 gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-sans font-black text-xs text-white uppercase tracking-widest flex items-center gap-1.5">
              <Target size={12} className="text-[#D9B382]" /> Active Cloud Positions &amp; Targets
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-400 font-bold px-2 py-0.5 rounded uppercase tracking-wider">
              ✓ Firebase Sync Active
            </span>
            {bot.activeTrades && bot.activeTrades.length > 0 && (
              <span className="text-[8px] font-mono bg-emerald-500/10 text-emerald-400 font-bold px-2 py-0.5 rounded uppercase animate-pulse">
                In-Flight Position
              </span>
            )}
          </div>
        </div>

        {/* Dynamic educational logic walk-through */}
        <div className="bg-zinc-900/40 border border-zinc-850 p-3.5 rounded-xl flex flex-col gap-2.5 text-left">
          <div className="flex items-start gap-2.5">
            <div className="w-5 h-5 rounded-full bg-[#D9B382]/10 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-[10px]">📊</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[9.5px] uppercase font-bold text-zinc-100 tracking-wider font-mono">Cloud Settlement Logic</span>
              <p className="text-[9px] text-[#A2A4AA] leading-normal font-mono uppercase">
                Active trades are evaluated using session data (High, Low, Close) to guarantee realistic pricing:
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 font-mono text-[9px] mt-1">
            <div className="p-2.5 bg-black/40 rounded-lg border border-zinc-900/60 flex items-start gap-1.5">
              <span className="text-emerald-400">✓</span>
              <div>
                <span className="text-zinc-300 font-bold block mb-0.5">PROFIT TARGET (TP)</span>
                If Day High ≥ TP Target, trade is credited at <strong className="text-emerald-400">{bot.activeTrades?.[0]?.plan?.takeProfit2 ? fmt(bot.activeTrades[0].plan.takeProfit2) : 'TP Level'}</strong>.
              </div>
            </div>
            <div className="p-2.5 bg-black/40 rounded-lg border border-zinc-900/60 flex items-start gap-1.5">
              <span className="text-rose-400">✗</span>
              <div>
                <span className="text-zinc-300 font-bold block mb-0.5">STOP LOSS GUARD (SL)</span>
                If Day Low ≤ SL Guard, trade is closed at <strong className="text-rose-400">{bot.activeTrades?.[0]?.plan?.stopLoss ? fmt(bot.activeTrades[0].plan.stopLoss) : 'SL Level'}</strong>.
              </div>
            </div>
            <div className="p-2.5 bg-black/40 rounded-lg border border-zinc-900/60 flex items-start gap-1.5 col-span-1 md:col-span-1">
              <span className="text-[#D9B382]">☕</span>
              <div>
                <span className="text-[#D9B382] font-bold block mb-0.5">TIME OUT / COINCIDENCE</span>
                If neither limit is hit OR both prices are crossed on the same day, trade is settled at the day's regular market session <strong className="text-zinc-200">Closing Price</strong>.
              </div>
            </div>
          </div>
        </div>

        {bot.activeTrades && bot.activeTrades.length > 0 ? (
          <div className="flex flex-col gap-4">
            {bot.activeTrades.map(trade => {
              if (!trade.plan) return null;
              const entry = trade.plan.entry;
              const tp = trade.plan.takeProfit2;
              const sl = trade.symbol === bot.symbol ? (bot.trailSL || trade.plan.stopLoss) : trade.plan.stopLoss;
              
              let currentPrice = activeTradesPrices[trade.symbol];
              if (trade.symbol === bot.symbol && bot.currentPrice) {
                currentPrice = bot.currentPrice;
              }
              if (!currentPrice) {
                currentPrice = entry;
              }

              const shares = trade.plan.positionSize ?? 1;
              const invested = trade.plan.investmentRupees ?? (shares * entry);
              
              const unrealizedPnL = (currentPrice - entry) * shares;
              const pnlPct = invested > 0 ? (unrealizedPnL / invested) * 100 : 0;
              const isPnLPos = unrealizedPnL >= 0;
              
              const progressPct = (tp - entry) !== 0
                ? Math.max(0, Math.min(100, ((currentPrice - entry) / (tp - entry)) * 100))
                : 0;
              
              const barColor = isPnLPos ? 'bg-emerald-500' : 'bg-rose-500';
              const textColor = isPnLPos ? 'text-emerald-400' : 'text-rose-400';
              const borderPnlColor = isPnLPos ? 'border-emerald-500/20 bg-emerald-950/20' : 'border-rose-500/20 bg-rose-950/20';

              const estCharges = trade.plan.brokerCharges ?? (invested * 0.0005);
              const elapsedSec = Math.max(0, Math.floor((Date.now() - trade.openedAt) / 1000));
              const durationStr = elapsedSec < 60 ? `${elapsedSec}s ago` : `${Math.floor(elapsedSec / 60)}m ago`;

              return (
                <div key={trade.id} className="bg-zinc-950/60 border border-zinc-850 rounded-xl overflow-hidden font-mono text-zinc-300 relative">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-[#D9B382]" />
                  
                  {/* Card Header */}
                  <div className="p-4 flex items-center justify-between border-b border-zinc-900 bg-zinc-950/40 pl-5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded font-black uppercase tracking-wider font-sans">
                          LONG
                        </span>
                        <strong className="text-white text-sm font-bold font-sans">{trade.symbol}</strong>
                        <span className="text-[8px] text-zinc-500 bg-zinc-900 border border-zinc-800 px-1 py-0.2 rounded">
                          ID: {trade.id}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400 mt-1">
                        {shares} shares · {fmt(invested)} deployed capital
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] text-emerald-400 font-extrabold tracking-widest uppercase">LIVE ON CLOUD</span>
                      </div>
                      <span className="text-[9px] text-zinc-500">Opened {durationStr}</span>
                    </div>
                  </div>

                  {/* Grid details */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4 border-b border-zinc-900/60 text-center">
                    <div className="bg-zinc-900/20 border border-zinc-900 p-2 rounded">
                      <span className="text-[8px] text-zinc-500 uppercase block mb-1 font-bold">Entry Price</span>
                      <strong className="text-zinc-200 text-xs">{fmt(entry)}</strong>
                    </div>
                    <div className="bg-zinc-900/20 border border-zinc-900 p-2 rounded">
                      <span className="text-[8px] text-zinc-500 uppercase block mb-1 font-bold">Current Price</span>
                      <strong className="text-zinc-200 text-xs">{fmt(currentPrice)}</strong>
                    </div>
                    <div className="bg-rose-950/15 border border-rose-950/30 p-2 rounded">
                      <span className="text-[8px] text-rose-400 uppercase block mb-1 font-black">Stop Loss Target</span>
                      <strong className="text-rose-400 text-xs">{fmt(sl)}</strong>
                    </div>
                    <div className="bg-emerald-950/15 border border-emerald-950/30 p-2 rounded">
                      <span className="text-[8px] text-emerald-400 uppercase block mb-1 font-black">Take Profit Target</span>
                      <strong className="text-emerald-400 text-xs">{fmt(tp)}</strong>
                    </div>
                  </div>

                  {/* Profit bar & details */}
                  <div className="p-4 border-b border-zinc-900/60 flex flex-col gap-3">
                    <div className="flex justify-between items-center text-[9px] font-bold uppercase">
                      <span className="text-zinc-400">Profit Target Limit Progress</span>
                      <span className={textColor}>{progressPct.toFixed(1)}% to Target</span>
                    </div>
                    <div className="h-2 bg-zinc-900 border border-zinc-850 rounded-full overflow-hidden relative">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-zinc-500">
                      <span className="text-rose-400 font-bold flex items-center gap-1">
                        🔴 STOP LOSS LIMIT: {fmt(sl)} 
                        <span className="text-[8px] font-normal text-zinc-650">({(((sl - entry)/entry)*100).toFixed(1)}%)</span>
                      </span>
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        🟢 TAKE PROFIT LIMIT: {fmt(tp)}
                        <span className="text-[8px] font-normal text-zinc-650">(+{(((tp - entry)/entry)*100).toFixed(1)}%)</span>
                      </span>
                    </div>
                  </div>

                  {/* Live calculations */}
                  <div className="p-4 grid grid-cols-2 gap-4 text-xs bg-zinc-950/30">
                    <div className="flex flex-col gap-1 border-r border-zinc-900 pr-2 text-left">
                      <span className="text-[8px] uppercase font-bold text-zinc-400 mb-0.5">LIVE UNREALIZED RETURN</span>
                      <div className="flex items-baseline gap-2">
                        <strong className={`text-sm font-sans font-black ${textColor}`}>
                          {isPnLPos ? '+' : ''}{fmt(unrealizedPnL)}
                        </strong>
                        <span className={`text-[9px] font-bold ${textColor}`}>
                          ({isPnLPos ? '+' : ''}{pnlPct.toFixed(2)}%)
                        </span>
                      </div>
                      <span className="text-[8px] text-zinc-500">Includes leverage calculations. charges approx {fmt(estCharges)}</span>
                    </div>
                    <div className="flex flex-col gap-1 text-right justify-between">
                      <div>
                        <span className="text-[8px] uppercase font-bold text-rose-500 mb-0.5 block">MAX RISK AT SL</span>
                        <strong className="text-rose-400 font-mono text-xs font-black">-{fmt(Math.abs((entry - sl) * shares))}</strong>
                      </div>
                      <div>
                        <span className="text-[8px] uppercase font-bold text-emerald-400 mb-0.5 block">MAX PROFIT AT TP</span>
                        <strong className="text-emerald-400 font-mono text-xs font-black">+{fmt(Math.abs((tp - entry) * shares))}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-zinc-950/50 flex gap-2 border-t border-zinc-900">
                    <button
                      onClick={() => bot.forceExit(trade.id)}
                      className="flex-1 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-xs font-black uppercase tracking-widest transition-all shadow-md active:scale-[0.98]"
                    >
                      Force Exit position at Market
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border border-dashed border-zinc-800/80 rounded-xl p-8 text-center text-zinc-500 bg-zinc-950/20 flex flex-col items-center justify-center gap-3">
            <div className="flex items-center justify-center gap-2 text-[#D9B382] font-black font-sans text-xs uppercase tracking-widest">
              <span className="w-2 h-2 rounded-full bg-[#D9B382] animate-ping" />
              <span>ACTIVE CLOUD TABLE INERT</span>
            </div>
            <p className="text-[9.5px] font-mono text-zinc-400 uppercase tracking-wider max-w-md">
              No live positions are currently open on the cloud database. Verify that the trading bot has been started and is scanning {symbol || '—'}.
            </p>
            {bot.phase !== 'IDLE' && (
              <button
                onClick={handleReEvaluate}
                id="btn-re-evaluate-scanning"
                disabled={isReEvaluatingLocal || bot.isAnalyzing}
                className="mt-1 px-4 py-2 rounded-xl bg-[#D9B382] hover:bg-[#c9a171] text-zinc-950 text-[10px] font-black uppercase tracking-widest transition-all shrink-0 flex items-center gap-1.5 active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-md"
              >
                🔄 {isReEvaluatingLocal || bot.isAnalyzing ? 'Evaluating System...' : 'Trigger Immediate Signal Scan'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── SECTION 4: Session Stats ──────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {/* Total P&L */}
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3 text-center">
          <span className="block text-[9px] font-mono text-zinc-500 uppercase tracking-wider mb-1">Session P&L</span>
          <span className={`font-mono text-sm font-black ${pnlPos ? 'text-emerald-400' : 'text-rose-400'}`}>
            {bot.sessionStats.totalPnL >= 0 ? '+' : ''}₹{bot.sessionStats.totalPnL.toFixed(0)}
          </span>
        </div>

        {/* Win rate */}
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3 text-center">
          <span className="block text-[9px] font-mono text-zinc-500 uppercase tracking-wider mb-1">Win Rate</span>
          <span className="font-mono text-sm font-black text-zinc-200">
            {(bot.sessionStats.winRate * 100).toFixed(0)}%
          </span>
          <span className="block text-[9px] font-mono text-zinc-600 mt-0.5">
            {bot.sessionStats.totalWins}W / {bot.sessionStats.totalLosses}L
          </span>
        </div>

        {/* Avg R */}
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3 text-center">
          <span className="block text-[9px] font-mono text-zinc-500 uppercase tracking-wider mb-1">Avg R</span>
          <span className={`font-mono text-sm font-black ${
            bot.sessionStats.avgRMultiple >= 0 ? 'text-teal-400' : 'text-rose-400'
          }`}>
            {bot.sessionStats.avgRMultiple >= 0 ? '+' : ''}{bot.sessionStats.avgRMultiple.toFixed(2)}R
          </span>
        </div>

        {/* Streak */}
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3 text-center">
          <span className="block text-[9px] font-mono text-zinc-500 uppercase tracking-wider mb-1">Streak</span>
          <span className={`font-mono text-sm font-black flex items-center justify-center gap-1 ${
            bot.sessionStats.currentStreak > 0
              ? 'text-emerald-400'
              : bot.sessionStats.currentStreak < 0
              ? 'text-rose-400'
              : 'text-zinc-500'
          }`}>
            {bot.sessionStats.currentStreak > 0
              ? <TrendingUp size={13} />
              : bot.sessionStats.currentStreak < 0
              ? <TrendingDown size={13} />
              : null}
            {Math.abs(bot.sessionStats.currentStreak)}
          </span>
        </div>
      </div>

      {/* ── TIME RANGE SELECTOR FOR BOT ANALYSIS ──────────────────────── */}
      {bot.tradeHistory.length > 0 && (
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider font-mono flex items-center gap-1.5">
            <Clock size={11} className="text-[#D9B382]" /> Filter Range:
          </span>
          <div className="flex flex-wrap items-center gap-1 bg-zinc-950 border border-zinc-850 p-0.5 rounded-lg">
            {[
              { id: 'TODAY', label: 'Today' },
              { id: 'YESTERDAY', label: 'Yesterday' },
              { id: '7D', label: '7D' },
              { id: '30D', label: '30D' },
              { id: 'ALL', label: 'All' }
            ].map(range => (
              <button
                key={range.id}
                onClick={() => setSelectedRange(range.id)}
                className={`px-2.5 py-1 rounded text-[8px] font-mono font-bold uppercase transition-all ${
                  selectedRange === range.id
                    ? 'bg-[#D9B382] text-zinc-950 font-black shadow'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── SECTION 5: Equity Curve ───────────────────────────────────── */}
      {filteredTrades.length >= 2 ? (
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3.5">
          <h3 className="font-black text-[10px] text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 mb-3">
            <BarChart2 size={11} /> Equity Curve ({selectedRange})
          </h3>
          <EquityCurve trades={filteredTrades} />
        </div>
      ) : bot.tradeHistory.length > 0 ? (
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3.5 text-center text-zinc-550 font-mono text-xs py-5">
          Need 2+ closed trades in {selectedRange} to plot curve
        </div>
      ) : null}

      {/* ── SECTION 6: Trade Log ──────────────────────────────────────── */}
      {filteredTrades.length > 0 ? (
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3.5">
          <h3 className="font-black text-[10px] text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 mb-3">
            <List size={11} /> Trade Log ({selectedRange})
            <span className="ml-auto text-zinc-600 font-mono normal-case">{filteredTrades.length} trades</span>
          </h3>

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 text-zinc-300 font-mono">
            {filteredTrades.map(trade => {
              const oc  = OUTCOME_CONFIG[trade.outcome ?? ''] ?? OUTCOME_CONFIG['MANUAL_EXIT'];
              const pos = (trade.realizedPnL ?? 0) >= 0;
              const dateStr = selectedRange === 'TODAY' || selectedRange === 'YESTERDAY'
                ? new Date(trade.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : new Date(trade.openedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + new Date(trade.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

              return (
                <div key={trade.id} className="flex items-center justify-between bg-zinc-950/60 border border-zinc-800/20 rounded-lg p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-500">
                      {dateStr}
                    </span>
                    <span className="text-xs font-mono font-bold text-zinc-300">{trade.symbol}</span>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono font-extrabold ${oc.bg} ${oc.color}`}>
                      {oc.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className={`text-xs font-mono font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {pos ? '+' : ''}₹{(trade.realizedPnL ?? 0).toFixed(2)}
                      </span>
                      {trade.rMultiple !== null && (
                        <span className="block text-[8px] font-mono text-zinc-500 text-right">
                          {trade.rMultiple >= 0 ? '+' : ''}{trade.rMultiple.toFixed(2)}R
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : bot.tradeHistory.length > 0 ? (
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3.5 text-center text-zinc-600 font-mono text-xs py-5">
          No records found in {selectedRange}
        </div>
      ) : null}
    </div>
  );
}
