import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Activity, TrendingUp, TrendingDown, Shield,
  AlertTriangle, CheckCircle, Clock, Target,
  Zap, BarChart2, List, Wifi, WifiOff, Pause, Square
} from 'lucide-react';
import { UseBotLoopResult, BotPhase, BotTradeRecord } from '../hooks/useBotLoop';
import { TradeOutcome } from '../types';

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
  const prevPhaseRef    = useRef<string>('');
  const prevOutcomeRef  = useRef<string | null>(null);

  const addToast = (message: string, type: Toast['type']) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    setToasts(prev => [{ id, message, type }, ...prev].slice(0, 4));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // Fire toasts on key state changes
  useEffect(() => {
    const phaseValue = bot.phase;

    // Trade opened
    if (phaseValue === 'IN_TRADE' && prevPhaseRef.current !== 'IN_TRADE') {
      addToast(`LONG entered at ₹${bot.activePlan?.entry?.toFixed(2) ?? '—'}`, 'info');
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
  }, [bot.phase, bot.tradeHistory, bot.tp1Hit, bot.activePlan, bot.lastBlockReason]);

  const phase  = PHASE_CONFIG[bot.phase];
  const pnlPos = (bot.sessionStats.totalPnL ?? 0) >= 0;

  // Format price with 2 decimals
  const fmt = (n: number | null) =>
    n == null ? '—' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Stability dots — 3 dots, filled based on stabilityCount
  const StabilityDots = () => (
    <div className="flex gap-1 items-center">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className={`w-2 h-2 rounded-full transition-colors ${
            i < bot.stabilityCount ? 'bg-amber-400' : 'bg-zinc-700'
          }`}
        />
      ))}
      <span className="text-[9px] font-mono text-zinc-500 ml-1">{bot.stabilityCount}/3</span>
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col gap-3 bg-[#0A0B0E] p-4 overflow-y-auto pb-24">

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
          {bot.phase === 'IN_TRADE' && bot.activePlan && bot.currentPrice && (() => {
            const plan     = bot.activePlan;
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
      <div className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
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

          {/* Stale warning */}
          {bot.isStale && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full">
              <AlertTriangle size={9} /> STALE FEED
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <StabilityDots />
          <button
            onClick={onPause}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 transition-colors"
            title="Pause bot"
          >
            <Pause size={14} />
          </button>
          <button
            onClick={onStop}
            className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 transition-colors"
            title="Stop bot"
          >
            <Square size={14} />
          </button>
        </div>
      </div>

      {/* Feed error */}
      {bot.feedError && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs font-mono">
          <AlertTriangle size={12} />
          {bot.feedError}
          <span className="ml-auto text-rose-600">({bot.consecutiveFailures} failures)</span>
        </div>
      )}

      {/* Last block reason */}
      {bot.lastBlockReason && bot.phase !== 'IN_TRADE' && (
        <div className="px-4 py-2 bg-zinc-900/40 border border-zinc-800/40 rounded-xl text-[10px] font-mono text-zinc-500">
          <span className="text-zinc-600">LAST BLOCK:</span> {bot.lastBlockReason}
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

      {/* ── SECTION 2: Live Price + Last Signal ──────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
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

      {/* ── SECTION 3: Active Position (IN_TRADE only) ───────────────── */}
      {bot.phase === 'IN_TRADE' && bot.activePlan && (
        <div className="bg-zinc-900/40 border border-emerald-500/20 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-black text-xs text-zinc-300 uppercase tracking-widest flex items-center gap-1.5">
              <Target size={12} className="text-emerald-400" /> Active Position
            </h3>
            {/* Unrealized P&L */}
            <span className={`font-mono text-sm font-black ${
              (bot.unrealizedPnL ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {bot.unrealizedPnL != null
                ? `${bot.unrealizedPnL >= 0 ? '+' : ''}₹${bot.unrealizedPnL.toFixed(2)}`
                : '—'}
              {bot.unrealizedPnLPct != null && (
                <span className="text-[10px] ml-1 font-mono opacity-70">
                  ({bot.unrealizedPnLPct >= 0 ? '+' : ''}{bot.unrealizedPnLPct.toFixed(2)}%)
                </span>
              )}
            </span>
          </div>

          {/* THE CORE — Entry / SL / TP1 / TP2 */}
          <div className="grid grid-cols-4 gap-2">
            {/* Entry */}
            <div className="bg-zinc-800/40 rounded-lg p-2.5 border border-zinc-700/40">
              <span className="block text-[9px] font-mono text-[#D9B382]/80 uppercase tracking-wider mb-1">
                ENTRY
              </span>
              <span className="font-mono text-xs font-black text-zinc-200">
                {fmt(bot.activePlan.entry)}
              </span>
            </div>

            {/* Stop Loss — shows trailing SL, red */}
            <div className="bg-rose-500/5 rounded-lg p-2.5 border border-rose-500/20">
              <span className="block text-[9px] font-mono text-rose-400/80 uppercase tracking-wider mb-1 flex items-center gap-1">
                SL
                {bot.tp1Hit && (
                  <span className="text-[8px] text-sky-400 bg-sky-500/10 px-1 rounded">B/E</span>
                )}
              </span>
              <span className="font-mono text-xs font-black text-rose-400">
                {fmt(bot.trailSL || bot.activePlan.stopLoss)}
              </span>
              <span className="block text-[8px] font-mono text-zinc-600 mt-0.5">
                {bot.activePlan.slMode}
              </span>
            </div>

            {/* TP1 */}
            <div className={`rounded-lg p-2.5 border ${
              bot.tp1Hit
                ? 'bg-teal-500/10 border-teal-500/30'
                : 'bg-zinc-800/40 border-zinc-700/40'
            }`}>
              <span className="block text-[9px] font-mono text-teal-400/80 uppercase tracking-wider mb-1 flex items-center gap-1">
                TP1 {bot.tp1Hit && <CheckCircle size={9} className="text-teal-400" />}
              </span>
              <span className={`font-mono text-xs font-black ${bot.tp1Hit ? 'text-teal-400 line-through opacity-60' : 'text-teal-400'}`}>
                {fmt(bot.activePlan.takeProfit1)}
              </span>
              <span className="block text-[8px] font-mono text-zinc-600 mt-0.5">1.0R</span>
            </div>

            {/* TP2 */}
            <div className="bg-emerald-500/5 rounded-lg p-2.5 border border-emerald-500/20">
              <span className="block text-[9px] font-mono text-emerald-400/80 uppercase tracking-wider mb-1">
                TP2
              </span>
              <span className="font-mono text-xs font-black text-emerald-400">
                {fmt(bot.activePlan.takeProfit2)}
              </span>
              <span className="block text-[8px] font-mono text-zinc-600 mt-0.5">
                {bot.activePlan.rrRatio}R
              </span>
            </div>
          </div>

          {/* Trade meta */}
          <div className="flex justify-between items-center mt-3 text-[10px] font-mono text-zinc-500">
            <span>Size: <strong className="text-zinc-300">{bot.activePlan.positionSize ?? 1} shares</strong></span>
            <span>Risk: <strong className="text-rose-400">₹{bot.activePlan.riskRupees?.toFixed(0) ?? '—'}</strong></span>
            <span>Reward: <strong className="text-emerald-400">₹{((bot.activePlan.riskRupees ?? 0) * bot.activePlan.rrRatio).toFixed(0)}</strong></span>
          </div>

          {/* Time remaining bar */}
          <TimeBar
            timeRemainingMs={bot.timeRemainingMs}
            maxHoldingMinutes={bot.activePlan.maxHoldingMinutes}
          />

          {/* Force exit button */}
          <button
            onClick={bot.forceExit}
            className="mt-3 w-full py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-xs font-black uppercase tracking-wider transition-colors"
          >
            Force Exit Now
          </button>
        </div>
      )}

      {/* ── SECTION 4: Session Stats ──────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
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

      {/* ── SECTION 5: Equity Curve ───────────────────────────────────── */}
      {bot.tradeHistory.length >= 2 && (
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3.5">
          <h3 className="font-black text-[10px] text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 mb-3">
            <BarChart2 size={11} /> Equity Curve
          </h3>
          <EquityCurve trades={bot.tradeHistory} />
        </div>
      )}

      {/* ── SECTION 6: Trade Log ──────────────────────────────────────── */}
      {bot.tradeHistory.length > 0 && (
        <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3.5">
          <h3 className="font-black text-[10px] text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 mb-3">
            <List size={11} /> Trade Log
            <span className="ml-auto text-zinc-600 font-mono normal-case">{bot.tradeHistory.length} trades</span>
          </h3>

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 text-zinc-300">
            {bot.tradeHistory.map(trade => {
              const oc  = OUTCOME_CONFIG[trade.outcome ?? ''] ?? OUTCOME_CONFIG['MANUAL_EXIT'];
              const pos = (trade.realizedPnL ?? 0) >= 0;
              return (
                <div key={trade.id} className="flex items-center justify-between bg-zinc-950/60 border border-zinc-800/20 rounded-lg p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-500">
                      {new Date(trade.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
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
      )}
    </div>
  );
}
