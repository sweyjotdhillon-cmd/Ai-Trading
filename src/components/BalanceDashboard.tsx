import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Wallet, RefreshCw, ArrowUpRight, ArrowDownRight, Award, ShieldAlert, List, TrendingUp, TrendingDown, Clock, Info } from 'lucide-react';
import { auth } from '../services/firebase';
import { initVirtualBalance } from '../services/virtualBalanceService';
import { loadStats, loadTodayTrades } from '../services/botTradeService';
import { computeRoundTripCharges } from '../quant/brokerCharges';
import { BotSessionStats, BotTradeRecord } from '../hooks/useBotLoop';

interface BalanceDashboardProps {
  onRefreshTriggered?: () => void;
}

export function BalanceDashboard({ onRefreshTriggered }: BalanceDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(100000);
  const [allTimeStats, setAllTimeStats] = useState<BotSessionStats | null>(null);
  const [todayTrades, setTodayTrades] = useState<BotTradeRecord[]>([]);
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);

  const fetchAllData = async (userId: string) => {
    setLoading(true);
    try {
      const liveBal = await initVirtualBalance(userId);
      setBalance(liveBal);

      const stats = await loadStats(userId);
      setAllTimeStats(stats);

      const today = await loadTodayTrades(userId);
      setTodayTrades(today);
    } catch (e) {
      console.error('[BalanceDashboard] Failed to fetch metrics:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      setUid(user?.uid ?? null);
      if (user?.uid) {
        fetchAllData(user.uid);
      } else {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const handleManualRefresh = () => {
    if (uid) {
      fetchAllData(uid);
    }
    if (onRefreshTriggered) {
      onRefreshTriggered();
    }
  };

  const fmt = (v: number | null | undefined) => {
    if (v == null) return '₹0.00';
    return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fmtPercent = (v: number) => {
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  };

  // Derived today's statistics
  const closedToday = todayTrades.filter(t => t.exitPrice != null);
  const todayPnL = closedToday.reduce((sum, t) => sum + (t.realizedPnL ?? 0), 0);
  const todayTradesCount = closedToday.length;
  const todayWins = closedToday.filter(t => (t.realizedPnL ?? 0) > 0).length;
  const todayWinRate = todayTradesCount > 0 ? (todayWins / todayTradesCount) * 100 : 0;
  const todayAvgR = todayTradesCount > 0 
    ? (closedToday.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / todayTradesCount) 
    : 0;

  const initialAllocation = 100000;
  const totalPnL = balance - initialAllocation;
  const totalPnLPct = (totalPnL / initialAllocation) * 100;

  // Broker charges breakdown for last closed trade
  const lastClosedTrade = closedToday[0];
  const chargesBreakdown = lastClosedTrade 
    ? computeRoundTripCharges(
        lastClosedTrade.entryPrice,
        lastClosedTrade.exitPrice!,
        lastClosedTrade.plan?.positionSize ?? 1,
        lastClosedTrade.plan?.instrument ?? 'EQUITY_INTRADAY'
      )
    : null;

  if (loading) {
    return (
      <div className="flex-1 flex flex-col justify-center items-center bg-[#0A0B0E] p-8 gap-4" id="balance-loader">
        <ActivityIndicator color="#D9B382" size="large" />
        <span className="text-[#D9B382] font-mono text-xs uppercase tracking-widest animate-pulse">
          Synchronizing Cloud Ledger...
        </span>
      </div>
    );
  }

  return (
    <ScrollView className="flex-1 bg-[#0A0B0E]" contentContainerStyle={{ padding: 16, paddingBottom: 100 }} id="balance-dashboard">
      <div className="max-w-3xl mx-auto w-full flex flex-col gap-6">
        
        {/* Header Block */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div>
            <h1 className="text-xl font-black text-white tracking-widest uppercase">
              Pro Ledger Log
            </h1>
            <p className="text-[10px] text-zinc-500 font-mono tracking-wider uppercase mt-1">
              Synchronized with Cloud secure authentication
            </p>
          </div>
          <button
            onClick={handleManualRefresh}
            id="btn-ledger-refresh"
            className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-[#D9B382] transition-colors flex items-center justify-center active:scale-95"
            title="Force ledger sync"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Section 1 — Balance card */}
        <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-6 relative overflow-hidden flex flex-col gap-4" id="ledger-balance-card">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#D9B382] bg-opacity-[0.015] rounded-full blur-2xl pointer-events-none" />
          
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Wallet size={16} className="text-[#D9B382]" />
              <span className="text-[10px] text-[#D9B382] font-black uppercase tracking-widest font-mono">
                Virtual Balance
              </span>
            </div>
            <span className="text-[9px] font-mono text-zinc-500 uppercase">
              Persistent Margin Mode
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <h2 className="text-3xl font-black text-white tracking-tight leading-none">
              {fmt(balance)}
            </h2>
            <div className="flex items-center gap-2">
              {totalPnL >= 0 ? (
                <div className="flex items-center text-emerald-400 gap-0.5">
                  <ArrowUpRight size={14} />
                  <span className="text-xs font-bold font-mono">
                    +{fmt(totalPnL).slice(1)} ({fmtPercent(totalPnLPct)})
                  </span>
                </div>
              ) : (
                <div className="flex items-center text-rose-400 gap-0.5">
                  <ArrowDownRight size={14} />
                  <span className="text-xs font-bold font-mono">
                    -{fmt(Math.abs(totalPnL)).slice(1)} ({fmtPercent(totalPnLPct)})
                  </span>
                </div>
              )}
              <span className="text-[10px] text-zinc-500 font-mono">vs Initial ₹1,00,000</span>
            </div>
          </div>

          <div className="border-t border-zinc-900 pt-4 flex justify-between text-[10px] text-zinc-400 font-mono">
            <span>Core Account Allocation: <strong>{fmt(initialAllocation)}</strong></span>
            <span>Ledger Type: <strong className="text-[#D9B382]">Virtual Paper</strong></span>
          </div>
        </div>

        {/* Section 2 — Today's stats row (4 tiles) */}
        <div className="flex flex-col gap-3" id="ledger-session-stats">
          <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest font-sans flex items-center gap-1.5">
            <Clock size={12} className="text-zinc-500" /> Today's Session Metrics
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Tile 1: TODAY P&L */}
            <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-3 flex flex-col justify-between h-20">
              <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest">Today P&L</span>
              <p className={`text-base font-black ${todayPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {todayPnL >= 0 ? '+' : ''}{fmt(todayPnL)}
              </p>
            </div>

            {/* Tile 2: WIN RATE */}
            <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-3 flex flex-col justify-between h-20">
              <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest">Win Rate</span>
              <p className="text-base font-black text-zinc-100 font-mono">
                {todayWinRate.toFixed(0)}%
              </p>
            </div>

            {/* Tile 3: TRADES */}
            <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-3 flex flex-col justify-between h-20">
              <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest">Trades</span>
              <p className="text-base font-black text-[#D9B382] font-mono">
                {todayTradesCount}
              </p>
            </div>

            {/* Tile 4: AVG R */}
            <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-3 flex flex-col justify-between h-20">
              <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest">Avg R</span>
              <p className="text-base font-black text-zinc-100 font-mono">
                {todayAvgR.toFixed(1)}R
              </p>
            </div>
          </div>
        </div>

        {/* Section 3 — All-time stats row (4 tiles) */}
        <div className="flex flex-col gap-3" id="ledger-all-time-stats">
          <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest font-sans flex items-center gap-1.5">
            <Award size={12} className="text-[#D9B382]" /> All-Time Cloud Totals
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Tile 1: TOTAL P&L */}
            <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-3 flex flex-col justify-between h-24">
              <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest">Total P&L</span>
              <p className={`text-base font-black ${allTimeStats && allTimeStats.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {allTimeStats ? `${allTimeStats.totalPnL >= 0 ? '+' : ''}${fmt(allTimeStats.totalPnL)}` : '₹0.00'}
              </p>
            </div>

            {/* Tile 2: TOTAL TRADES */}
            <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-3 flex flex-col justify-between h-24">
              <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest">Total Trades</span>
              <p className="text-base font-black text-[#D9B382] font-mono">
                {allTimeStats ? allTimeStats.totalTrades : '0'}
              </p>
            </div>

            {/* Tile 3: BEST TRADE */}
            <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-3 flex flex-col justify-between h-24">
              <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest">Best Trade</span>
              <p className="text-sm font-black text-emerald-400 font-mono leading-tight">
                {allTimeStats ? '+' + fmt(allTimeStats.bestTrade) : '₹0.00'}
              </p>
            </div>

            {/* Tile 4: WORST TRADE */}
            <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-3 flex flex-col justify-between h-24">
              <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest">Worst Trade</span>
              <p className="text-sm font-black text-rose-400 font-mono leading-tight">
                {allTimeStats ? fmt(allTimeStats.worstTrade) : '₹0.00'}
              </p>
            </div>
          </div>
        </div>

        {/* Section 4 — Trade history list (today's trades, most recent first) */}
        <div className="flex flex-col gap-3" id="ledger-trade-history">
          <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest font-sans flex items-center gap-1.5">
            <List size={12} className="text-[#D9B382]" /> Today's Trade Records
          </h3>

          {closedToday.length > 0 ? (
            <div className="flex flex-col gap-3">
              {closedToday.map((trade) => {
                const entry = trade.entryPrice;
                const exit = trade.exitPrice || entry;
                const shares = trade.plan?.positionSize ?? 1;
                const invested = trade.plan?.investmentRupees ?? (entry * shares);
                const isPnLPos = (trade.realizedPnL ?? 0) >= 0;
                const dateStr = new Date(trade.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const holdSec = Math.max(0, Math.round(((trade.closedAt ?? Date.now()) - trade.openedAt) / 1000));
                const estCharges = trade.plan?.brokerCharges ?? (invested * 0.0005);

                return (
                  <div key={trade.id} className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-4 flex flex-col gap-3 font-mono">
                    {/* Trade Info Header */}
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-sky-500/10 text-sky-400 px-1.5 py-0.5 rounded font-black tracking-widest font-sans">
                          {trade.symbol}
                        </span>
                        
                        {trade.outcome === 'SL_HIT' || trade.outcome === 'TP2_HIT' ? (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-black font-sans ${
                            isPnLPos ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-450'
                          }`}>
                            {isPnLPos ? 'WIN' : 'LOSS'}
                          </span>
                        ) : (
                          <span className="text-[9px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded font-black font-sans">
                            TIME EXIT
                          </span>
                        )}
                      </div>

                      <div className="text-right">
                        <strong className={`text-sm font-black ${isPnLPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isPnLPos ? '+' : ''}{fmt(trade.realizedPnL)}
                        </strong>
                        <p className="text-[9px] text-zinc-500 mt-0.5">
                          {trade.rMultiple ? trade.rMultiple.toFixed(2) + 'R' : '--'}
                        </p>
                      </div>
                    </div>

                    {/* Entry / Exit details */}
                    <div className="grid grid-cols-2 text-[11px] text-zinc-400 leading-normal">
                      <div>
                        Entry: <strong className="text-zinc-200">{fmt(entry)}</strong> → Exit: <strong className="text-zinc-200">{fmt(exit)}</strong>
                      </div>
                      <div className="text-right text-zinc-500">
                        SL: {fmt(trade.plan?.stopLoss)} · TP: {fmt(trade.plan?.takeProfit2)}
                      </div>
                    </div>

                    {/* Investment metrics */}
                    <div className="flex flex-wrap justify-between text-[10px] text-zinc-500 border-t border-zinc-900/60 pt-2 pb-1">
                      <span>{shares} shares · {fmt(invested)} invested</span>
                      <span>Opened {dateStr} · Held {holdSec >= 60 ? `${Math.floor(holdSec / 60)}m` : `${holdSec}s`}</span>
                    </div>

                    {/* Broker charges line */}
                    <div className="flex justify-between items-center text-[10px] text-zinc-500">
                      <span>Charges (brokerage+taxes+GST)</span>
                      <strong className="text-[#D9B382]">{fmt(trade.realizedPnL != null ? (trade.entryPrice - trade.exitPrice!) * shares - trade.realizedPnL : estCharges)}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border border-dashed border-zinc-800 rounded-xl p-8 text-center text-zinc-500 bg-zinc-950/20 flex flex-col items-center justify-center gap-1.5">
              <Info size={16} className="text-zinc-600" />
              <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest font-bold">
                No active session records found today
              </p>
              <p className="text-[9px] text-zinc-700 font-mono">
                Launch the bot to execute test or real paper trades.
              </p>
            </div>
          )}
        </div>

        {/* Section 5 — Broker charges breakdown for last trade */}
        {chargesBreakdown && (
          <div className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-5 flex flex-col gap-3 font-mono" id="charges-breakdown-panel">
            <h4 className="text-[10px] text-[#D9B382] font-black uppercase tracking-widest border-b border-zinc-900 pb-2 flex items-center gap-1">
              Brokerage & Charge Autopsy (Last Trade)
            </h4>
            <div className="flex flex-col gap-1.5 text-xs text-zinc-400">
              <div className="flex justify-between">
                <span>Brokerage:</span>
                <span className="text-zinc-300">{fmt(chargesBreakdown.brokerage)}</span>
              </div>
              <div className="flex justify-between">
                <span>GST (18% on Brokerage+Exchange+SEBI):</span>
                <span className="text-zinc-300">{fmt(chargesBreakdown.gst)}</span>
              </div>
              <div className="flex justify-between">
                <span>STT:</span>
                <span className="text-zinc-300">{fmt(chargesBreakdown.stt)}</span>
              </div>
              <div className="flex justify-between">
                <span>Exchange Transaction Fee:</span>
                <span className="text-zinc-300">{fmt(chargesBreakdown.exchangeTxn)}</span>
              </div>
              <div className="flex justify-between">
                <span>Stamp Duty:</span>
                <span className="text-zinc-300">{fmt(chargesBreakdown.stampDuty)}</span>
              </div>
              <div className="flex justify-between">
                <span>SEBI Turnover Charge:</span>
                <span className="text-zinc-300">{fmt(chargesBreakdown.sebi)}</span>
              </div>
              <div className="border-t border-zinc-900 pt-2 flex justify-between font-bold text-white mt-1.5">
                <span>Total Statutory Charges:</span>
                <strong className="text-[#D9B382]">{fmt(chargesBreakdown.total)}</strong>
              </div>
            </div>
          </div>
        )}

      </div>
    </ScrollView>
  );
}
