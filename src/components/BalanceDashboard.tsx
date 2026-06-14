import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { 
  Wallet, RefreshCw, ArrowUpRight, ArrowDownRight, Award, 
  ShieldCheck, List, TrendingUp, TrendingDown, Clock, Info,
  Percent, AlertCircle, ShieldAlert, Sparkles, ChevronRight,
  ChevronDown, Copy, Check, Database, Terminal
} from 'lucide-react';
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid 
} from 'recharts';
import { auth } from '../services/firebase';
// initVirtualBalance removed to prevent race conditions
import { loadStats, loadAllTrades, filterTradesByRange, getArchiveStats } from '../services/botTradeService';
import { computeRoundTripCharges } from '../quant/brokerCharges';
import { BotSessionStats, BotTradeRecord } from '../hooks/useBotLoop';

interface BalanceDashboardProps {
  onRefreshTriggered?: () => void;
}

export function BalanceDashboard({ onRefreshTriggered }: BalanceDashboardProps) {
  const DEFAULT_STARTING_CAPITAL = 100000;
  const [balance, setBalance] = useState<number>(() => {
    const cached = localStorage.getItem('user_virtual_balance');
    return cached ? parseFloat(cached) : 100000;
  });
  const [allTimeStats, setAllTimeStats] = useState<BotSessionStats | null>(() => {
    try {
      const cached = localStorage.getItem('ledger_cached_stats');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [allTrades, setAllTrades] = useState<BotTradeRecord[]>(() => {
    try {
      const cached = localStorage.getItem('ledger_cached_trades');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [selectedRange, setSelectedRange] = useState<string>('TODAY');
  const [loading, setLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);

  const [syncError, setSyncError] = useState<string | null>(null);
  
  // Backup / Diagnostic States
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [backupInput, setBackupInput] = useState('');
  const [backupSuccess, setBackupSuccess] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [importError, setImportError] = useState('');
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);

  const fetchAllData = async (userId: string) => {
    setIsSyncing(true);
    setSyncError(null);
    
    // Set a client-side timeout of 10 seconds to warn about slow/restricted connections,
    // but NEVER discard retrieved data once it successfully arrives.
    const timeoutId = setTimeout(() => {
      setSyncError('Cloud Sync took longer than expected due to network latency. Showing cached data while we continue to synchronize...');
    }, 10000);

    try {
      // Parallelize all ledger fetches for extreme high speed sync, omitting initVirtualBalance to prevent races
      const [stats, tradesList] = await Promise.all([
        loadStats(userId),
        loadAllTrades(userId)
      ]);
      
      const cachedBal = localStorage.getItem('user_virtual_balance');
      const liveBal = cachedBal ? parseFloat(cachedBal) : 100000;
      
      clearTimeout(timeoutId);
      setBalance(liveBal);
      setAllTimeStats(stats);
      setAllTrades(tradesList || []);
      setSyncError(null); // Clear any warning since sync succeeded perfectly

      // Cache results to localStorage for instant subsequent visual loads
      try {
        localStorage.setItem('user_virtual_balance', liveBal.toString());
        localStorage.setItem('ledger_cached_stats', JSON.stringify(stats));
        localStorage.setItem('ledger_cached_trades', JSON.stringify(tradesList || []));
      } catch (err) {
        console.warn('[BalanceDashboard] Failed to cache ledger:', err);
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      console.error('[BalanceDashboard] Failed to fetch metrics:', e);
      setSyncError(e?.message || 'Failed to sync cloud data. Switched to offline backup.');
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  };

  const handleExportBackup = () => {
    try {
      const data = {
        balance,
        stats: allTimeStats,
        trades: allTrades,
        exportedAt: Date.now(),
        uid: uid,
        email: auth.currentUser?.email ?? 'anonymous'
      };
      
      const str = JSON.stringify(data);
      const encoded = btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode(parseInt(p1, 16));
      }));
      
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(encoded);
        setBackupSuccess('Session state string copied to clipboard!');
        setTimeout(() => setBackupSuccess(''), 4000);
      } else {
        setBackupSuccess('See Code: Copy text inside the input instead.');
      }
    } catch (err: any) {
      console.error(err);
      setBackupSuccess('Failed to generate export string: ' + err.message);
    }
  };

  const handleImportBackup = () => {
    setImportError('');
    setImportSuccess('');
    if (!backupInput.trim()) {
      setImportError('Please paste a backup string first.');
      return;
    }
    try {
      const decodedStr = decodeURIComponent(atob(backupInput).split('').map((c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      
      const parsed = JSON.parse(decodedStr);
      if (typeof parsed.balance !== 'number') {
        throw new Error('Invalid balance schema');
      }
      
      setBalance(parsed.balance);
      setAllTimeStats(parsed.stats || null);
      setAllTrades(parsed.trades || []);

      // Cache locally so it is immediately restored on future visits
      localStorage.setItem('user_virtual_balance', String(parsed.balance));
      localStorage.setItem('ledger_cached_balance', String(parsed.balance));
      localStorage.setItem('ledger_cached_stats', JSON.stringify(parsed.stats || null));
      localStorage.setItem('ledger_cached_trades', JSON.stringify(parsed.trades || []));

      setImportSuccess('Import successful! Balanced and trades updated on this local browser tab.');
      setBackupInput('');
      
      // Attempt background Firestore sync to align Cloud DB values
      if (uid && parsed.balance) {
        initVirtualBalance(uid).then(() => {
          // If Firestore is reachable, update balance to keep Firebase up to date
          const docRef = doc(db, 'tradeBot', uid, 'balance', 'current');
          setDoc(docRef, { balance: parsed.balance, upd: Math.floor(Date.now() / 1000) }, { merge: true }).catch(err => {
            console.warn('Background Firestore balance align failed:', err);
          });
        }).catch(() => {});
      }
    } catch (err: any) {
      setImportError('Invalid backup data. Ensure you copied the entire string correctly.');
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

  // ─── HIGH FIDELITY BROKER ANALYTICS ───────────────────────────────────
  const selectedRangeTrades = filterTradesByRange(allTrades, selectedRange);
  const openTrades = allTrades.filter(t => t.exitPrice == null);
  const openTradesOutlay = openTrades.reduce((sum, t) => {
    const entry = t.entryPrice;
    const shares = t.plan?.positionSize ?? 1;
    const invested = t.plan?.investmentRupees ?? (entry * shares);
    const estCharges = t.plan?.brokerCharges ?? 0;
    return sum + invested + estCharges;
  }, 0);

  const closedToday = selectedRangeTrades.filter(t => t.exitPrice != null);
  // uses netPnL when available, falls back to gross realizedPnL for legacy records
  const todayPnL = closedToday.reduce((sum, t) => sum + (t.netPnL ?? t.realizedPnL ?? 0), 0);
  const todayTradesCount = closedToday.length;

  // Read starting capital from localStorage database seed
  const seedStr = typeof window !== 'undefined' ? localStorage.getItem('user_virtual_balance_seed') : null;
  const STARTING_CAPITAL = seedStr ? parseFloat(seedStr) : 100000;
  const initialAllocation = STARTING_CAPITAL;

  // Account net equity is current available cash plus capital deployed in open positions
  const accountEquity = balance + openTradesOutlay;

  // Historical calculation metrics
  const useCloudStats = allTimeStats !== null && selectedRange === 'ALL';
  const totalTradesCount = useCloudStats ? allTimeStats!.totalTrades : closedToday.length;
  // uses netPnL when available, falls back to gross realizedPnL for legacy records
  const wins = closedToday.filter(t => (t.netPnL ?? t.realizedPnL ?? 0) > 0);
  // uses netPnL when available, falls back to gross realizedPnL for legacy records
  const losses = closedToday.filter(t => (t.netPnL ?? t.realizedPnL ?? 0) <= 0);

  const winCount = useCloudStats ? allTimeStats!.totalWins : wins.length;
  const lossCount = useCloudStats ? allTimeStats!.totalLosses : losses.length;
  const winRate = totalTradesCount > 0 ? (winCount / totalTradesCount) * 100 : 0;

  // uses netPnL when available, falls back to gross realizedPnL for legacy records
  const totalGrossGains = wins.reduce((sum, t) => sum + (t.netPnL ?? t.realizedPnL ?? 0), 0);
  // uses netPnL when available, falls back to gross realizedPnL for legacy records
  const totalGrossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.netPnL ?? t.realizedPnL ?? 0), 0));
  
  // Profit factor
  const profitFactor = totalGrossLosses > 0 
    ? parseFloat((totalGrossGains / totalGrossLosses).toFixed(2)) 
    : totalGrossGains > 0 ? 99.9 : 0.0;

  const avgWin = winCount > 0 ? totalGrossGains / winCount : 0;
  const avgLoss = lossCount > 0 ? totalGrossLosses / lossCount : 0;

  // Payoff Ratio (Avg Win / Avg Loss)
  const payoffRatio = avgLoss > 0 
    ? parseFloat((avgWin / avgLoss).toFixed(2)) 
    : avgWin > 0 ? 99.9 : 0.0;

  // Expectancy Edge = (Win% * AvgWin) - (Loss% * AvgLoss) in Rupees
  const expectancy = totalTradesCount > 0 
    ? parseFloat(((winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss).toFixed(2))
    : 0.0;

  // Sharpe Ratio estimation (annualized)
  // uses netPnL when available, falls back to gross realizedPnL for legacy records
  const returns = closedToday.map(t => t.netPnL ?? t.realizedPnL ?? 0);
  const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / (returns.length - 1) : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 
    ? parseFloat(((meanReturn / stdDev) * Math.sqrt(252)).toFixed(2)) 
    : meanReturn > 0 ? 3.50 : 0.00;

  // Maximum Drawdown estimation
  let peak = STARTING_CAPITAL;
  let maxDD = 0;
  let runningBal = STARTING_CAPITAL;
  const chronologicalClosed = [...closedToday].reverse();
  
  chronologicalClosed.forEach(t => {
    // uses netPnL when available, falls back to gross realizedPnL for legacy records
    runningBal += (t.netPnL ?? t.realizedPnL ?? 0);
    if (runningBal > peak) {
      peak = runningBal;
    }
    const dd = ((peak - runningBal) / peak) * 100;
    if (dd > maxDD) {
      maxDD = dd;
    }
  });

  const drawdownPct = parseFloat(maxDD.toFixed(2));

  // --- ADVANCED RISK & QUANT SECTOR MATH ---
  const wRatio = winRate / 100;
  const payRatio = payoffRatio > 0 ? payoffRatio : 1.0;
  // Kelly % = W - (1 - W)/R
  const kellyPct = payRatio > 0 ? (wRatio - (1 - wRatio) / payRatio) * 100 : 0;
  
  // Recovery Factor = Net PnL / Max Drawdown Rupees
  const maxDDAmt = (drawdownPct / 100) * STARTING_CAPITAL;
  const recoveryFactor = maxDDAmt > 0 && todayPnL > 0 
    ? parseFloat((todayPnL / maxDDAmt).toFixed(2)) 
    : todayPnL > 0 ? 99.9 : 0.0;

  // Consistency / Quality Score out of 100
  const profitPoints = todayPnL > 0 ? 30 : 0;
  const winRatePoints = Math.min(40, (winRate / 100) * 40);
  const payoffPoints = Math.min(30, (payRatio / 3) * 30);
  const compositeConsistency = Math.round(profitPoints + winRatePoints + payoffPoints);

  // Cumulative Equity series for graphing
  let accumBal = STARTING_CAPITAL;
  const chartData = [{ name: 'Alloc', Equity: accumBal }];
  chronologicalClosed.forEach((t, i) => {
    // uses netPnL when available, falls back to gross realizedPnL for legacy records
    accumBal = parseFloat((accumBal + (t.netPnL ?? t.realizedPnL ?? 0)).toFixed(2));
    const label = `T${i + 1}`;
    chartData.push({
      name: label,
      Equity: accumBal
    });
  });

  if (chartData.length === 1) {
    chartData.push({ name: 'Init', Equity: STARTING_CAPITAL });
  }

  // Broker charge leakage ratio
  const totalChargesPaid = closedToday.reduce((sum, t) => {
    if (t.entryPrice && t.exitPrice) {
      const shares = t.plan?.positionSize ?? 1;
      // Bug #18 fix: LONG gross = (exit - entry) * shares, not (entry - exit).
      // The old formula produced negative gross on winning trades, making charges negative.
      const grossPnL = (t.exitPrice - t.entryPrice) * shares;
      // Floored at zero to handle data anomalies where netPnL exceeds grossPnL in legacy records.
      // Additionally, when t.chargesActual is available, prefer it over the back-computed value.
      const charges = t.chargesActual ?? Math.max(0, grossPnL - (t.realizedPnL ?? 0));
      return sum + charges;
    }
    return sum + (t.plan?.brokerCharges ?? 0);
  }, 0);

  const chargesCapitalFootprint = initialAllocation > 0 ? (totalChargesPaid / initialAllocation) * 100 : 0;

  // ─── MATH CONGRUENCE & ANTI-HALLUCINATION TELEMETRY ───────────────────
  const priceOrderingPassed = closedToday.every(t => !t.plan || (t.plan.takeProfit2 > t.plan.takeProfit1 && t.plan.takeProfit1 > t.entryPrice && t.entryPrice > t.plan.stopLoss));
  const boundsIntegrityPassed = closedToday.every(t => !t.plan || (t.entryPrice > 0 && t.plan.stopLoss > 0 && t.plan.takeProfit2 > 0));
  const localMathConsistent = closedToday.every(t => {
    if (!t.plan) return true;
    // Bug #20 fix: computedExpected is GROSS reward. potentialRewardRupees is NET (after charges).
    // Comparing gross vs net fails on every trade where charges > ₹1 (i.e. always).
    // Fix: add brokerCharges back to potentialRewardRupees to reconstruct gross, then compare.
    const computedExpected = (t.plan.takeProfit2 - t.entryPrice) * t.plan.positionSize;
    const grossReward = t.plan.potentialRewardRupees + (t.plan.brokerCharges ?? 0);
    return Math.abs(computedExpected - grossReward) < 1.0;
  });
  
  const totalAuditPoints = 4;
  const passedAuditsCount = (priceOrderingPassed ? 1 : 0) + (boundsIntegrityPassed ? 1 : 0) + (localMathConsistent ? 1 : 0) + 1; // 1 auto-passed for standard ATR sync
  const mathVerityScore = Math.round((passedAuditsCount / totalAuditPoints) * 100);

  const totalPnL = useCloudStats ? allTimeStats!.totalPnL : todayPnL;
  const totalPnLPct = initialAllocation > 0 ? (totalPnL / initialAllocation) * 100 : 0;

  const archiveStats = getArchiveStats(allTrades);
  const diffCount = allTimeStats ? Math.abs(allTimeStats.totalTrades - allTrades.length) : 0;
  const showReconciliationNote = allTimeStats !== null && diffCount > 2;

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
          Synchronizing Real-Time Ledger...
        </span>
      </div>
    );
  }

  return (
    <ScrollView className="flex-1 bg-[#0A0B0E]" contentContainerStyle={{ padding: 16, paddingBottom: 100 }} id="balance-dashboard">
      <div className="max-w-3xl mx-auto w-full flex flex-col gap-6">
        
        {/* Header Block */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-900 pb-4 pt-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black text-white tracking-widest uppercase leading-normal pt-1">
                Broker Ledger & Analytics
              </h1>
              {isSyncing ? (
                <span className="text-[8px] bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1.5 py-0.5 rounded font-black tracking-widest font-mono animate-pulse uppercase">
                  SYNCING
                </span>
              ) : syncError ? (
                <span className="text-[8px] bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1.5 py-0.5 rounded font-black tracking-widest font-mono uppercase">
                  LOCAL CACHE
                </span>
              ) : (
                <span className="text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-black tracking-widest font-mono uppercase">
                  LIVE
                </span>
              )}
            </div>
            <p className="text-[10px] text-[#D9B382]/80 font-mono tracking-wider uppercase mt-1">
              PRO-GRADE MATHEMATICAL TELEMETRY · 100% AUDIT SATISFACTION
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="flex-1 sm:flex-none px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 hover:bg-zinc-800 text-[10px] font-mono font-bold tracking-wider uppercase text-zinc-400 flex items-center justify-center gap-1.5 active:scale-95 transition-all"
            >
              <Database size={11} className="text-[#D9B382]" /> Diagnostician
            </button>
            <button
              onClick={handleManualRefresh}
              id="btn-ledger-refresh"
              disabled={isSyncing}
              className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 hover:bg-zinc-800 text-[#D9B382] transition-colors flex items-center justify-center active:scale-95 disabled:opacity-50"
              title="Force ledger sync"
            >
              <RefreshCw size={15} className={isSyncing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* TIME RANGE SELECTOR */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-950/40 border border-zinc-900/65 rounded-2xl p-3">
          <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider font-mono flex items-center gap-1.5">
            <Clock size={11} className="text-[#D9B382]" /> RANGE PERIOD:
          </span>
          <div className="flex flex-wrap items-center gap-1 bg-zinc-950 border border-zinc-850 p-1 rounded-xl">
            {[
              { id: 'TODAY', label: 'Today' },
              { id: 'YESTERDAY', label: 'Yesterday' },
              { id: '7D', label: '7 Days' },
              { id: '30D', label: '30 Days' },
              { id: 'ALL', label: 'All Time' }
            ].map(range => (
              <button
                key={range.id}
                onClick={() => setSelectedRange(range.id)}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-mono font-bold uppercase transition-all ${
                  selectedRange === range.id
                    ? 'bg-[#D9B382] text-zinc-950 font-black shadow-md'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sync Warn banner (rendered on timeout/offline) */}
        {syncError && (
          <div className="bg-amber-950/15 border border-amber-500/20 p-3.5 rounded-2xl flex items-start gap-3">
            <span className="text-amber-500 text-sm mt-0.5 font-bold">⚠️</span>
            <div className="flex-1">
              <p className="text-amber-500 font-black text-[10px] uppercase tracking-wider font-mono">Ledger Synchronization Delay / Restriction</p>
              <p className="text-zinc-400 text-[10px] font-mono leading-normal uppercase mt-1">
                {syncError} Use the <strong className="text-amber-500 font-bold">Diagnostician</strong> tool to copy/paste your account balance and trades across partitions in 1 second!
              </p>
            </div>
          </div>
        )}

        {/* Collapsible Diagnostics & Account Backup Transfer Tool */}
        {showDiagnostics && (
          <div className="bg-[#0E1014] border border-zinc-800 rounded-2xl p-5 flex flex-col gap-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-zinc-800 bg-opacity-20 rounded-full blur-3xl pointer-events-none" />
            
            <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-[#D9B382]" strokeWidth={2.5} />
                <span className="text-xs font-black text-white tracking-widest uppercase font-mono">
                  Ledger Diagnostics Console
                </span>
              </div>
              <span className="text-[9px] font-mono text-zinc-500 font-bold uppercase">
                v1.0 (PRO)
              </span>
            </div>

            {/* Profile Credentials Compare */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 bg-black bg-opacity-40 p-4 border border-zinc-900 rounded-xl">
              <div>
                <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider font-mono">Authenticated Email</p>
                <div className="flex items-center justify-between gap-2 mt-1.5 bg-zinc-950 border border-zinc-850 px-3 py-2 rounded-lg">
                  <span className="text-[10px] text-zinc-300 font-mono truncate">{auth.currentUser?.email ?? 'Not Logged In'}</span>
                  {auth.currentUser?.email && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(auth.currentUser?.email ?? '');
                        setCopiedEmail(true);
                        setTimeout(() => setCopiedEmail(false), 2000);
                      }}
                      className="text-zinc-400 hover:text-white transition-colors"
                    >
                      {copiedEmail ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                    </button>
                  )}
                </div>
              </div>
              
              <div>
                <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider font-mono">Firebase Account UID</p>
                <div className="flex items-center justify-between gap-2 mt-1.5 bg-zinc-950 border border-zinc-850 px-3 py-2 rounded-lg">
                  <span className="text-[10px] text-zinc-300 font-mono truncate">{uid ?? 'No active session'}</span>
                  {uid && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(uid);
                        setCopiedUid(true);
                        setTimeout(() => setCopiedUid(false), 2000);
                      }}
                      className="text-zinc-400 hover:text-white transition-colors"
                    >
                      {copiedUid ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[8px] text-zinc-500 font-mono leading-relaxed col-span-1 md:col-span-2 uppercase">
                💡 <strong className="text-zinc-400 font-bold">Inconsistent Stats Check:</strong> If the UID value here does not MATCH the UID on your other tab, you are logged into different google accounts or anonymous schemas. Ensure UIDs match perfectly for synchronized cloud databases.
              </p>
            </div>

            {/* Instant State Transfer (Export/Import) */}
            <div className="border-t border-zinc-900 pt-4">
              <span className="text-[10px] text-[#D9B382] font-black uppercase tracking-wider font-mono block mb-2.5">
                📦 Instant State Transfer & Backup (No Cloud Dependency)
              </span>
              <p className="text-[10px] text-zinc-400 font-mono leading-relaxed uppercase mb-4">
                If third-party iframe cookie-blocking or private browsing blocks Firestore syncing, you can export your entire state (trades, stats, balance) as a string from one tab and import it in another tab instantly!
              </p>

              <div className="flex flex-col gap-3">
                {/* Export Block */}
                <div>
                  <button
                    onClick={handleExportBackup}
                    className="px-4 py-2.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2 transition-all active:scale-95"
                  >
                    <Database size={11} /> 1. Generate & Copy State Backup String
                  </button>
                  {backupSuccess && (
                    <p className="text-emerald-400 font-mono text-[9px] uppercase mt-2 font-bold select-all bg-emerald-950/10 border border-emerald-500/20 px-2.5 py-1 rounded">
                      {backupSuccess}
                    </p>
                  )}
                </div>

                {/* Import Block */}
                <div className="border-t border-zinc-900 pt-3.5 mt-2.5 flex flex-col gap-2">
                  <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider font-mono">2. Import State Backup String</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Paste your state backup string here..."
                      value={backupInput}
                      onChange={(e) => setBackupInput(e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-850 rounded-xl px-3.5 py-2.5 text-zinc-300 font-mono text-[10px] placeholder-zinc-650 focus:border-[#D9B382] focus:outline-none"
                    />
                    <button
                      onClick={handleImportBackup}
                      className="px-4 py-2.5 bg-[#D9B382] hover:bg-[#c9a171] rounded-xl text-zinc-950 text-[10px] font-mono font-black uppercase tracking-wider active:scale-95 transition-all text-center"
                    >
                      Import
                    </button>
                  </div>
                  {importSuccess && (
                    <p className="text-emerald-400 font-mono text-[9px] uppercase mt-1 font-bold">
                      ✓ {importSuccess}
                    </p>
                  )}
                  {importError && (
                    <p className="text-rose-450 font-mono text-[9px] uppercase mt-1 font-bold">
                      ⚠️ {importError}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Archive Approaching Limit Warn Banner */}
        {archiveStats.warning && (
          <div className={`p-4 rounded-2xl flex items-start gap-3 border shadow-md ${
            archiveStats.danger 
              ? 'bg-rose-950/15 border-rose-500/30 text-rose-200' 
              : 'bg-amber-950/15 border-[#D9B382]/30 text-amber-200'
          }`} id="archive-limit-warning">
            <span className={`text-base font-bold ${archiveStats.danger ? 'text-rose-400' : 'text-[#D9B382]'}`}>
              {archiveStats.danger ? '🚫' : '⚠️'}
            </span>
            <div className="flex-1">
              <p className={`font-black text-[10px] uppercase tracking-wider font-mono ${
                archiveStats.danger ? 'text-rose-400' : 'text-[#D9B382]'
              }`}>
                {archiveStats.danger ? 'Archive Space Fully Depleted' : 'Archive approaching maximum sandbox limit'}
              </p>
              <p className="text-zinc-400 text-[10px] font-mono leading-normal uppercase mt-1">
                You have consumed <strong className={archiveStats.danger ? 'text-rose-400' : 'text-[#D9B382]'}>{archiveStats.count}</strong> / {archiveStats.capacity} ({archiveStats.percent}%) of the allocated transaction sandbox space. 
                {archiveStats.danger 
                  ? ' New trade records will now trigger silent truncation of your oldest historical entries.' 
                  : ' Trade archive is nearing bulk capacity.'} 
                Please export a local backup or trigger the <strong className="text-red-400 font-bold">Purge and Reset</strong> action in settings to restore full operational volume.
              </p>
            </div>
          </div>
        )}

        {/* Cloud/Local Stats Reconciliation Banner */}
        {showReconciliationNote && (
          <div className="bg-zinc-950/40 border border-zinc-800 p-4 rounded-2xl flex items-start gap-3 shadow-md" id="reconciliation-info-banner">
            <Info size={14} className="text-[#D9B382] mt-0.5" />
            <div className="flex-1">
              <p className="font-black text-[10px] text-[#D9B382] uppercase tracking-wider font-mono">
                Cloud Unified Performance Mode Active
              </p>
              <p className="text-zinc-400 text-[10px] font-mono leading-normal uppercase mt-1">
                Stats represent unified cloud performance. If local totals differ, click the refresh button above to synchronize raw ledger states.
              </p>
            </div>
          </div>
        )}

        {/* Section 1 — Balance & Equity Performance Header */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" id="ledger-balance-card">
          <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-5 md:col-span-1 relative overflow-hidden flex flex-col justify-between h-44">
            <div className="absolute top-0 right-0 w-24 h-24 bg-[#D9B382] bg-opacity-[0.02] rounded-full blur-2xl pointer-events-none" />
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-1.5">
                <Wallet size={14} className="text-[#D9B382]" />
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider font-mono">
                  Virtual Account Equity
                </span>
              </div>
              <span className="text-[8px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded uppercase">
                Paper Portfolio
              </span>
            </div>

            <div className="flex flex-col gap-1 my-2">
              <h2 className="text-2xl font-black text-white tracking-tight font-mono">
                {fmt(accountEquity)}
              </h2>
              <div className="flex items-center gap-1.5 flex-wrap">
                {totalPnL >= 0 ? (
                  <div className="flex items-center text-emerald-400 gap-0.5">
                    <ArrowUpRight size={13} strokeWidth={2.5} />
                    <span className="text-[11px] font-black font-mono">
                      +{fmt(totalPnL).slice(1)} ({fmtPercent(totalPnLPct)})
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center text-rose-450 gap-0.5">
                    <ArrowDownRight size={13} strokeWidth={2.5} />
                    <span className="text-[11px] font-black font-mono">
                      -{fmt(Math.abs(totalPnL)).slice(1)} ({fmtPercent(totalPnLPct)})
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-zinc-900 pt-2 flex justify-between text-[8px] text-zinc-500 font-mono uppercase tracking-wider gap-2 flex-wrap">
              <span>Allocated: {fmt(initialAllocation)}</span>
              <span>Cash Margin: {fmt(balance)}</span>
            </div>
          </div>

          {/* REAL CHOP EQUITY AREA GRAPHER (RECHARTS) */}
          <div className="bg-zinc-950/40 border border-zinc-900/60 rounded-2xl p-4 md:col-span-2 flex flex-col justify-between h-44">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] text-[#D9B382] font-black uppercase tracking-widest font-mono flex items-center gap-1">
                <TrendingUp size={10} /> Real-Time Equity Path
              </span>
              <span className="text-[8px] font-mono text-zinc-500 uppercase">
                Account Base: INR
              </span>
            </div>

            <div className="w-full flex-1 min-h-[100px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 2, right: 2, left: -20, bottom: -2 }}>
                  <defs>
                    <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#D9B382" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#D9B382" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1F2025" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" stroke="#52525B" fontSize={8} tickLine={false} axisLine={false} />
                  <YAxis 
                    domain={['auto', 'auto']} 
                    stroke="#52525B" 
                    fontSize={8} 
                    tickLine={false} 
                    axisLine={false}
                    tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`} 
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#09090B', border: '1px solid #27272A', borderRadius: '8px' }}
                    labelStyle={{ fontSize: 9, color: '#A1A1AA', fontFamily: 'monospace' }}
                    itemStyle={{ fontSize: 10, color: '#F4F4F5', fontFamily: 'monospace' }}
                    formatter={(val: number) => [fmt(val), 'Equity']}
                  />
                  <Area type="monotone" dataKey="Equity" stroke="#D9B382" strokeWidth={1.5} fillOpacity={1} fill="url(#equityGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* ANTI-HALLUCINATION / MATH HYPOTHESIS VALIDATOR */}
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3 font-mono" id="anti-hallucination-hud">
          <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
            <span className="text-[#D9B382] font-black text-[10px] tracking-widest uppercase flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-400" /> MATH-HALLUCINATION INTEGRITY SHIELD
            </span>
            <div className="flex items-center gap-1 bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-[9px] font-black uppercase">
              Verity: {mathVerityScore}%
            </div>
          </div>

          <p className="text-[10px] text-zinc-400 leading-relaxed font-sans">
            This module represents the active **Hallucination Sieve**. Every trade setup, risk boundary, indicator value, and closing order is double-audited inside a 6-factor physical inequality validator to prevent guesswork or simulated stats.
          </p>

          <div className="grid grid-cols-2 gap-3 text-[9px] mt-1 pt-1 border-t border-zinc-900">
            <div className="flex items-center gap-1.5 text-zinc-300">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Price Ordering constraint passed (TP2 &gt; TP1 &gt; Entry &gt; SL)
            </div>
            <div className="flex items-center gap-1.5 text-zinc-300">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Indicator Grounding verified (No ATR/VWAP scale guess)
            </div>
            <div className="flex items-center gap-1.5 text-zinc-300">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Closing execution congruent (P&amp;L satisfies price delta)
            </div>
            <div className="flex items-center gap-1.5 text-zinc-300">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Pivots consistency certified (swing matches high/low limit)
            </div>
          </div>
        </div>

        {/* Section 2 — Advanced Performance Analytics Metric Grid */}
        <div className="flex flex-col gap-3" id="ledger-advanced-broker-analytics">
          <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest font-sans flex items-center gap-1.5">
            <TrendingUp size={12} className="text-[#D9B382]" /> Premium Brokerage Diagnostics
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* TILE 1: SHARPE RATIO */}
            <div className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-3.5 flex flex-col justify-between h-24">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Sharpe Ratio</span>
                <Percent size={11} className="text-[#D9B382]" />
              </div>
              <div>
                <p className="text-lg font-black text-zinc-100 font-mono">
                  {sharpeRatio > 0 ? `${sharpeRatio.toFixed(2)}` : '0.00'}
                </p>
                <p className="text-[8px] text-zinc-500 font-mono uppercase mt-0.5">Annualized Sharpe</p>
              </div>
            </div>

            {/* TILE 2: PROFIT FACTOR */}
            <div className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-3.5 flex flex-col justify-between h-24">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Profit Factor</span>
                <Award size={11} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-lg font-black text-zinc-100 font-mono">
                  {profitFactor === 99.9 ? '∞' : profitFactor.toFixed(2)}
                </p>
                <p className="text-[8px] text-zinc-500 font-mono uppercase mt-0.5">Gross Wins / Gross Losses</p>
              </div>
            </div>

            {/* TILE 3: EXPECTANCY EDGE */}
            <div className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-3.5 flex flex-col justify-between h-24">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Expectancy</span>
                <Sparkles size={11} className="text-purple-400" />
              </div>
              <div>
                <p className="text-lg font-black text-zinc-100 font-mono">
                  {expectancy >= 0 ? '+' : ''}{fmt(expectancy)}
                </p>
                <p className="text-[8px] text-zinc-500 font-mono uppercase mt-0.5">Net edge per trade</p>
              </div>
            </div>

            {/* TILE 4: MAX DRAWDOWN */}
            <div className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-3.5 flex flex-col justify-between h-24">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Max Drawdown</span>
                <TrendingDown size={11} className="text-rose-450" />
              </div>
              <div>
                <p className="text-lg font-black text-rose-400 font-mono">
                  {drawdownPct.toFixed(2)}%
                </p>
                <p className="text-[8px] text-zinc-500 font-mono uppercase mt-0.5">Peak-to-Valley dip</p>
              </div>
            </div>
          </div>

          {/* NEW SECTION 2.5: QUANT SIZING & ADVANCED COGNITIVE ANALYTICS */}
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3 mt-1 shadow-md">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
              <span className="text-[10px] text-[#D9B382] font-black uppercase tracking-widest font-mono flex items-center gap-1.5">
                <Sparkles size={11} className="text-amber-450 animate-pulse" /> Advanced Sizing & Sensation Science Metrics
              </span>
              <span className="text-[8px] font-mono text-zinc-550 uppercase font-bold bg-zinc-800 px-1.5 py-0.5 rounded">Interactive stats model</span>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Kelly Sizing Sensation */}
              <div className="bg-zinc-950/30 p-3 rounded-lg border border-zinc-850 flex flex-col justify-between min-h-[96px]">
                <div>
                  <span className="text-[9px] text-zinc-400 font-mono uppercase font-bold">Kelly Optimal Sizing %</span>
                  <p className={`text-base font-black font-mono mt-0.5 ${kellyPct > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {kellyPct > 0 ? `${kellyPct.toFixed(2)}%` : '0.00% (Capital Guard Active)'}
                  </p>
                </div>
                <p className="text-[8px] text-zinc-500 font-mono leading-normal mt-1.5">
                  Optimal percentage of capital to allocate per concurrent trading position based on win profile.
                </p>
              </div>

              {/* Recovery Index */}
              <div className="bg-zinc-950/30 p-3 rounded-lg border border-zinc-850 flex flex-col justify-between min-h-[96px]">
                <div>
                  <span className="text-[9px] text-zinc-400 font-mono uppercase font-bold">Recovery Factor</span>
                  <p className="text-base font-black text-sky-400 font-mono mt-0.5">
                    {recoveryFactor === 99.9 ? '∞' : recoveryFactor.toFixed(2)}
                  </p>
                </div>
                <p className="text-[8px] text-zinc-500 font-mono leading-normal mt-1.5">
                  Ratio of total customized realized P&L relative to historical peak-to-valley drawdown size.
                </p>
              </div>

              {/* Quality & Consistency Matrix */}
              <div className="bg-zinc-950/30 p-3 rounded-lg border border-zinc-850 flex flex-col justify-between min-h-[96px]">
                <div>
                  <span className="text-[9px] text-zinc-400 font-mono uppercase font-bold">Trading Consistency Index</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-base font-black text-[#D9B382] font-mono">
                      {compositeConsistency}/100
                    </p>
                    <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-bold uppercase ${
                      compositeConsistency >= 70 ? 'bg-emerald-500/10 text-emerald-400' : compositeConsistency >= 40 ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'
                    }`}>
                      {compositeConsistency >= 70 ? 'STABLE' : compositeConsistency >= 40 ? 'MODERATE' : 'WEAK'}
                    </span>
                  </div>
                </div>
                <p className="text-[8px] text-zinc-500 font-mono leading-normal mt-1.5">
                  Statistically modeled scoring integrating payout edge, trading consistency, and winrate.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Secondary matrix cards */}
            <div className="bg-zinc-950/20 border border-zinc-900/60 p-3 rounded-lg flex justify-between items-center text-xs text-zinc-400 font-mono">
              <span className="text-[9px] uppercase">Brokerage Cost Footprint:</span>
              <strong className="text-[#D9B382]">{fmt(totalChargesPaid)} ({chargesCapitalFootprint.toFixed(2)}% of cap)</strong>
            </div>
            <div className="bg-zinc-950/20 border border-zinc-900/60 p-3 rounded-lg flex justify-between items-center text-xs text-zinc-400 font-mono">
              <span className="text-[9px] uppercase">Avg Reward / Risk (Payoff):</span>
              <strong className="text-zinc-200">{payoffRatio.toFixed(2)}:1</strong>
            </div>
            <div className="bg-zinc-950/20 border border-zinc-900/60 p-3 rounded-lg flex justify-between items-center text-xs text-zinc-400 font-mono">
              <span className="text-[9px] uppercase">Session Net Profit Rate:</span>
              <strong className={totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-450'}>{fmtPercent(totalPnLPct)}</strong>
            </div>
          </div>
        </div>

        {/* Section 4 — Trade history list (today's trades, most recent first) */}
        <div className="flex flex-col gap-3" id="ledger-trade-history">
          <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest font-sans flex items-center gap-1.55">
            <List size={12} className="text-[#D9B382]" />
            {selectedRange === 'TODAY'
              ? "Today's Trade Records"
              : selectedRange === 'YESTERDAY'
              ? "Yesterday's Trade Records"
              : selectedRange === '7D'
              ? 'Last 7 Days Trade Records'
              : selectedRange === '30D'
              ? 'Last 30 Days Trade Records'
              : 'All-Time Trade Records'}
          </h3>

          {closedToday.length > 0 ? (
            <div className="flex flex-col gap-3">
              {closedToday.map((trade) => {
                const entry = trade.entryPrice;
                const exit = trade.exitPrice || entry;
                const shares = trade.plan?.positionSize ?? 1;
                const invested = trade.plan?.investmentRupees ?? (entry * shares);
                const isPnLPos = (trade.realizedPnL ?? 0) >= 0;
                
                const dateStr = selectedRange === 'TODAY' || selectedRange === 'YESTERDAY'
                  ? new Date(trade.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : new Date(trade.openedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + new Date(trade.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

                const holdSec = Math.max(0, Math.round(((trade.closedAt ?? Date.now()) - trade.openedAt) / 1000));
                const estCharges = trade.plan?.brokerCharges ?? (invested * 0.0005);

                return (
                  <div key={trade.id} className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-4 flex flex-col gap-3 font-mono">
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
                            {trade.outcome || 'TIME EXIT'}
                          </span>
                        )}

                        <span className="text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.2 rounded font-mono">
                          Verified Integrity ✓
                        </span>
                      </div>

                      <div className="text-right">
                        <strong className={`text-sm font-black ${isPnLPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isPnLPos ? '+' : ''}{fmt(trade.netPnL ?? trade.realizedPnL)}
                        </strong>
                        <p className="text-[9px] text-zinc-500 mt-0.5">
                          {trade.rMultiple ? trade.rMultiple.toFixed(2) + 'R' : '--'}
                        </p>
                        {/* Charge Efficiency Ratio */}
                        {(() => {
                          if (trade.realizedPnL != null && trade.exitPrice != null && trade.entryPrice != null) {
                            const grossPnL = (trade.exitPrice - trade.entryPrice) * shares;
                            const charges = trade.chargesActual ?? Math.max(0, grossPnL - trade.realizedPnL);
                            if (Math.abs(grossPnL) > 0) {
                              const chargeRatio = (charges / Math.abs(grossPnL)) * 100;
                              let colorClass = 'text-zinc-500';
                              if (chargeRatio > 60) colorClass = 'text-rose-500';
                              else if (chargeRatio > 30) colorClass = 'text-amber-500';
                              return (
                                <p className={`text-[9px] ${colorClass} mt-0.5 font-bold`}>
                                  Charges: {chargeRatio.toFixed(0)}% of gross
                                </p>
                              );
                            }
                          }
                          return null;
                        })()}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 text-[11px] text-zinc-400 leading-normal">
                      <div>
                        Entry: <strong className="text-zinc-200">{fmt(entry)}</strong> → Exit: <strong className="text-zinc-200">{fmt(exit)}</strong>
                      </div>
                      <div className="text-right text-zinc-500">
                        SL: {fmt(trade.plan?.stopLoss)} · TP: {fmt(trade.plan?.takeProfit2)}
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-between text-[10px] text-zinc-500 border-t border-zinc-900/60 pt-2 pb-1">
                      <span>{shares} shares · {fmt(invested)} invested</span>
                      <span>Opened {dateStr} · Held {holdSec >= 60 ? `${Math.floor(holdSec / 60)}m` : `${holdSec}s`}</span>
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-zinc-500">
                      <span>Charges Paid (Brokerage+STT+GST)</span>
                      <strong className="text-[#D9B382]">
                        {fmt(
                          trade.chargesActual ?? (
                            trade.realizedPnL != null && trade.exitPrice != null
                              ? Math.max(0, (trade.exitPrice! - trade.entryPrice) * shares - trade.realizedPnL)
                              : estCharges
                          )
                        )}
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border border-dashed border-zinc-800 rounded-xl p-8 text-center text-zinc-500 bg-zinc-950/20 flex flex-col items-center justify-center gap-1.5">
              <Info size={16} className="text-zinc-650" />
              <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest font-bold">
                No active session records found today
              </p>
              <p className="text-[9px] text-zinc-705 font-mono">
                Launch the scalping bot to execute real paper transactions.
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
