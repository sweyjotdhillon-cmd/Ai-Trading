import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Activity, Shield, Settings, TrendingUp, AlertCircle, CheckCircle, 
  RefreshCw, DollarSign, Target, Award, Plus, Minus, Info, Clipboard, Play, RefreshCcw
} from 'lucide-react';
import { ScalpConfig, RiskState, ScalpingPlan } from '../types';
import { loadScalpConfig, getDefaultScalpConfig } from '../config/scalpConfig';
import { loadRiskState, resetRiskState, checkRiskCaps } from '../quant/riskGuard';
import { featureFlags } from '../config/featureFlags';
import { getScalpBuyRate, scalpOverTradingPenalty } from '../quant/neutralityGuard';

interface ScalpCopilotHUDProps {
  analysis: any;
  onConfigChanged: (cfg: ScalpConfig) => void;
  onResetRiskState: () => void;
}

export const ScalpCopilotHUD: React.FC<ScalpCopilotHUDProps> = ({
  analysis,
  onConfigChanged,
  onResetRiskState
}) => {
  const [config, setConfig] = useState<ScalpConfig>(() => loadScalpConfig());
  const [risk, setRisk] = useState<RiskState>(() => loadRiskState());
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCopilotEnabled, setIsCopilotEnabled] = useState(() => featureFlags.USE_SCALPING_MODE);
  const [buyMins, setBuyMins] = useState(0);

  // Poll for risk state and metrics changes to keep HUD absolutely live
  useEffect(() => {
    const handler = setInterval(() => {
      setRisk(loadRiskState());
    }, 1000);
    return () => clearInterval(handler);
  }, []);

  const saveConfig = (updated: ScalpConfig) => {
    setConfig(updated);
    if (typeof window !== 'undefined') {
      localStorage.setItem('chartlens_scalp_config_v1', JSON.stringify(updated));
    }
    onConfigChanged(updated);
  };

  const toggleCopilot = () => {
    const nextVal = !isCopilotEnabled;
    setIsCopilotEnabled(nextVal);
    featureFlags.USE_SCALPING_MODE = nextVal;
    
    // Auto-update other relevant flags to maximize correctness
    if (nextVal) {
      featureFlags.SHOW_LEGACY_BINARY_UI = false;
      featureFlags.ENABLE_RISK_CAPS = true;
      featureFlags.ENABLE_TRAILING_SL = true;
      featureFlags.ENABLE_PARTIAL_TP = true;
      featureFlags.ENABLE_VWAP_PROXY = true;
      featureFlags.ENABLE_PREDICTABILITY_GATE = true;
      featureFlags.ENABLE_MARKET_HOURS_GATE = true;
      featureFlags.ENABLE_BROKER_CHARGES_NET = true;
    } else {
      featureFlags.SHOW_LEGACY_BINARY_UI = true;
    }
    
    // Save to config triggers
    saveConfig({ ...config });
  };

  const handleResetState = () => {
    onResetRiskState();
    setRisk(loadRiskState());
  };

  const overtradingPenalty = scalpOverTradingPenalty();
  const buyRateMetrics = getScalpBuyRate();
  const capCheck = checkRiskCaps(risk, config);

  // Identify last calculated plan
  const scalpAddon = analysis; // Spreads contain it
  const isScalpBuy = scalpAddon?.isScalpTrade && scalpAddon?.scalpSignal === 'BUY';
  const plan: ScalpingPlan | null = scalpAddon?.plan || null;

  return (
    <div className="w-full mt-4 bg-[#0A0A0B]/80 backdrop-blur-md rounded-2xl border border-zinc-800/60 p-4 shadow-xl relative overflow-hidden">
      {/* Decorative cyber line */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] transition-colors duration-500 ${isCopilotEnabled ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500' : 'bg-gradient-to-r from-zinc-700 to-zinc-800'}`} />

      {/* Header section */}
      <div className="flex flex-row justify-between items-center mb-4 pb-3 border-b border-zinc-800/50">
        <div className="flex flex-row items-center gap-2.5">
          <div className={`p-2 rounded-xl border transition-colors ${isCopilotEnabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-zinc-800/10 border-zinc-800 text-zinc-500'}`}>
            <Activity className={isCopilotEnabled ? 'animate-pulse' : ''} size={18} />
          </div>
          <div>
            <div className="flex flex-row items-center gap-2">
              <span className="font-sans font-black text-sm text-zinc-200 tracking-tight">SCALPING CO-PILOT</span>
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black tracking-widest uppercase transition-colors ${isCopilotEnabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-500'}`}>
                {isCopilotEnabled ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
            <p className="font-mono text-[10px] text-zinc-500 mt-0.5">Dual-Mode High-Frequency Confluence Engine</p>
          </div>
        </div>

        <div className="flex flex-row items-center gap-2">
          {/* Main Switch */}
          <button 
            id="toggle_copilot_btn"
            onClick={toggleCopilot}
            className={`px-3 py-1.5 rounded-lg font-black text-[10px] uppercase tracking-wider transition-all border ${isCopilotEnabled ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/30' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'}`}
          >
            {isCopilotEnabled ? 'Deactivate' : 'Activate'}
          </button>

          {/* Drawer Settings Trigger */}
          <button 
            id="open_scalp_settings_btn"
            onClick={() => setIsDrawerOpen(true)}
            className="p-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/50 text-zinc-400 transition-colors"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Main Grid View */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Risk Limits/Symmetry Guards (Left) */}
        <div className="md:col-span-4 bg-zinc-900/40 rounded-xl border border-zinc-800/40 p-3.5">
          <div className="flex flex-row justify-between items-center mb-2.5">
            <h4 className="font-sans font-black text-[11px] text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
              <Shield size={12} className="text-zinc-500" /> State Limits & Caps
            </h4>
            <button 
              onClick={handleResetState}
              className="text-[9px] font-bold text-zinc-500 hover:text-amber-400 transition-colors flex items-center gap-1"
              title="Reset trade counts & losses for a fresh session"
            >
              <RefreshCw size={10} /> Reset
            </button>
          </div>

          <div className="space-y-2 font-mono text-[11px]">
            <div className="flex flex-row justify-between border-b border-zinc-800/30 pb-1.5">
              <span className="text-zinc-500">Daily PnL:</span>
              <span className={`font-bold ${risk.dailyPnL < 0 ? 'text-rose-400' : (risk.dailyPnL > 0 ? 'text-emerald-400' : 'text-zinc-400')}`}>
                ₹{risk.dailyPnL.toFixed(1)} / -₹{config.risk.dailyLossCapRupees}
              </span>
            </div>

            <div className="flex flex-row justify-between border-b border-zinc-800/30 pb-1.5">
              <span className="text-zinc-500">Trades executed:</span>
              <span className={`font-bold ${risk.tradesToday >= config.risk.maxTradesPerDay ? 'text-red-400' : 'text-zinc-300'}`}>
                {risk.tradesToday} / {config.risk.maxTradesPerDay}
              </span>
            </div>

            <div className="flex flex-row justify-between border-b border-zinc-800/30 pb-1.5">
              <span className="text-zinc-500">Consecutive Losses:</span>
              <span className={`font-bold ${risk.consecutiveLosses >= config.risk.maxConsecutiveLosses ? 'text-red-400' : 'text-zinc-300'}`}>
                {risk.consecutiveLosses} / {config.risk.maxConsecutiveLosses}
              </span>
            </div>

            <div className="flex flex-row justify-between border-b border-zinc-800/30 pb-1.5">
              <span className="text-zinc-500">Over-trading penalty:</span>
              <span className={`font-bold ${overtradingPenalty > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {overtradingPenalty > 0 ? `+${(overtradingPenalty * 10).toFixed(1)} Confluence` : 'No penalty'}
              </span>
            </div>

            <div className="flex flex-row justify-between pt-0.5">
              <span className="text-zinc-500">Risk status:</span>
              <span className={`font-sans font-black text-[9px] uppercase px-1.5 py-0.5 rounded ${capCheck.allow ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-500'}`}>
                {capCheck.allow ? 'READY' : (capCheck.reason || 'BLOCKED')}
              </span>
            </div>
          </div>
        </div>

        {/* Current Active Plan (Middle/Right) */}
        <div className="md:col-span-8 bg-zinc-900/40 rounded-xl border border-zinc-800/40 p-3.5 flex flex-col justify-between">
          <div>
            <h4 className="font-sans font-black text-[11px] text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 mb-2.5">
              <Target size={12} className="text-zinc-500" /> Active Scalping Plan & Confluence
            </h4>

            {isCopilotEnabled ? (
              isScalpBuy && plan ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-zinc-300">
                  <div className="bg-zinc-800/30 p-2 rounded-lg border border-zinc-800/30">
                    <span className="block text-[9px] font-mono text-[#D9B382]/80 uppercase tracking-wider">ENTRY PRICE</span>
                    <span className="font-mono text-xs font-black">₹{plan.entry.toFixed(2)}</span>
                  </div>
                  <div className="bg-zinc-800/30 p-2 rounded-lg border border-zinc-800/30">
                    <span className="block text-[9px] font-mono text-[#D9B382]/80 uppercase tracking-wider">SL MODE ({plan.slMode})</span>
                    <span className="font-mono text-xs font-black text-rose-400">₹{plan.stopLoss.toFixed(2)}</span>
                  </div>
                  <div className="bg-zinc-800/30 p-2 rounded-lg border border-zinc-800/30">
                    <span className="block text-[9px] font-mono text-[#D9B382]/80 uppercase tracking-wider">TP1 Target</span>
                    <span className="font-mono text-xs font-black text-emerald-400">₹{plan.takeProfit1.toFixed(2)}</span>
                  </div>
                  <div className="bg-zinc-800/30 p-2 rounded-lg border border-zinc-800/30">
                    <span className="block text-[9px] font-mono text-[#D9B382]/80 uppercase tracking-wider">TP2 Target ({plan.rrRatio}R)</span>
                    <span className="font-mono text-xs font-black text-teal-400">₹{plan.takeProfit2.toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center py-4 bg-zinc-950/20 border border-dashed border-zinc-800/60 rounded-xl">
                  {scalpAddon?.blockers && scalpAddon.blockers.length > 0 ? (
                    <div className="flex flex-col items-center px-4">
                      <AlertCircle className="text-zinc-600 mb-1.5" size={18} />
                      <span className="font-mono text-[10px] text-zinc-500 text-center uppercase tracking-wide">Signal wait / filter active</span>
                      <p className="font-mono text-[9px] text-[#D9B382] bg-[#D9B382]/5 border border-[#D9B382]/10 px-2 py-0.5 rounded-full mt-1.5 max-w-full truncate">
                        Blockers Filtered: {scalpAddon.blockers.join(', ')}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <Activity className="text-zinc-700 mb-1.5 animate-pulse" size={18} />
                      <span className="font-mono text-[10px] text-zinc-500 tracking-wide">WAITING FOR SCALPING SIGNAL TRIGGER...</span>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="flex-1 flex items-center justify-center py-6 bg-zinc-950/20 border border-dashed border-zinc-800/60 rounded-xl">
                <span className="text-zinc-600 font-bold text-[11px] uppercase tracking-widest text-center px-4">
                  Scalping Co-Pilot deactivated. Toggle "Activate" above to unlock.
                </span>
              </div>
            )}
          </div>

          {/* Quick Stats Summary / Charges */}
          {isCopilotEnabled && isScalpBuy && plan && (
            <div className="flex flex-row justify-between items-center pt-2 mt-2 border-t border-zinc-800/30 text-[10px] font-mono text-zinc-500">
              <span className="flex items-center gap-1">
                <Award size={10} className="text-[#D9B382]" />
                Confluence score: <strong className="text-emerald-400 font-extrabold">{plan.confluenceScore}/10</strong>
              </span>
              <span>
                Position size: <strong className="text-zinc-300 font-extrabold">{plan.positionSize} Shares ({plan.instrument})</strong>
              </span>
              <span className="text-zinc-300 font-extrabold">
                Est Round-Trip Charges: <strong className="text-rose-400 font-bold">₹{plan.brokerCharges.toFixed(1)}</strong>
              </span>
              <span>
                Net expected P&L: <strong className="text-emerald-400 font-extrabold">₹{plan.netExpectedPnL.toFixed(1)}</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Slide-out Settings Drawer / Dialog Backdrop */}
      {isDrawerOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex justify-end" id="drawer_backdrop_layer">
          <motion.div 
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            className="w-full max-w-md h-full bg-[#09090B] border-l border-zinc-800/70 p-6 flex flex-col justify-between shadow-2xl relative overflow-y-auto"
          >
            <div>
              {/* Drawer Header */}
              <div className="flex items-center justify-between border-b border-zinc-800/50 pb-4 mb-6">
                <div className="flex items-center gap-2">
                  <Settings className="text-[#D9B382]" size={18} />
                  <span className="font-sans font-black text-sm text-zinc-200 tracking-tight uppercase">CO-PILOT ADVANCED CONTROLS</span>
                </div>
                <button 
                  onClick={() => setIsDrawerOpen(false)}
                  className="px-2.5 py-1 text-xs font-black text-zinc-400 hover:text-white uppercase tracking-wider bg-zinc-900 border border-zinc-800 rounded-lg"
                >
                  Close
                </button>
              </div>

              {/* Form elements */}
              <div className="space-y-5">
                {/* Leverage */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="font-sans font-extrabold text-[11px] text-zinc-300 uppercase tracking-wider flex items-center gap-1">Leverage Multiplier <Info size={10} title="Leverage ratio for trading margin" /></span>
                    <span className="font-mono text-xs font-bold text-[#D9B382]">{config.leverage}x</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => saveConfig({ ...config, leverage: Math.max(1, config.leverage - 1) })}
                      className="px-3 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 rounded text-zinc-400 font-bold"
                    >
                      -
                    </button>
                    <input 
                      type="range" 
                      min="1" 
                      max="10" 
                      value={config.leverage}
                      onChange={(e) => saveConfig({ ...config, leverage: Number(e.target.value) })}
                      className="flex-1 accent-[#D9B382]"
                    />
                    <button 
                      onClick={() => saveConfig({ ...config, leverage: Math.min(10, config.leverage + 1) })}
                      className="px-3 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 rounded text-zinc-400 font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* NSE Lot Size */}
                <div>
                  <label className="block font-sans font-extrabold text-[11px] text-zinc-300 uppercase tracking-wider mb-2">NSE Instrument Lot Size</label>
                  <select 
                    value={config.lotSize}
                    onChange={(e) => saveConfig({ ...config, lotSize: Number(e.target.value) })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs text-zinc-200 outline-none font-mono"
                  >
                    <option value="1">1 (Equity Stocks)</option>
                    <option value="25">25 (NIFTY Index Options)</option>
                    <option value="15">15 (BANKNIFTY Index Options)</option>
                    <option value="40">40 (FINNIFTY Index Options)</option>
                  </select>
                </div>

                {/* STOP LOSS PRESETS */}
                <div>
                  <label className="block font-sans font-extrabold text-[11px] text-zinc-300 uppercase tracking-wider mb-2">Stop-Loss Detection Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['AUTO', 'ATR', 'PERCENT', 'STRUCTURE'] as const).map(m => (
                      <button 
                        key={m}
                        onClick={() => saveConfig({ ...config, slMode: m })}
                        className={`py-2 px-3 rounded-lg font-mono text-[10px] border transition-colors ${config.slMode === m ? 'bg-[#D9B382]/10 text-[#D9B382] border-[#D9B382]/30' : 'bg-transparent text-zinc-500 border-zinc-800 hover:border-zinc-700'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Target RR Ratio */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="font-sans font-extrabold text-[11px] text-zinc-300 uppercase tracking-wider">Target Profit (R:R Multiple)</span>
                    <span className="font-mono text-xs font-bold text-emerald-400">{config.rrRatio}x Risk</span>
                  </div>
                  <input 
                    type="range" 
                    min="1.5" 
                    max="5.0" 
                    step="0.1"
                    value={config.rrRatio}
                    onChange={(e) => saveConfig({ ...config, rrRatio: Number(e.target.value) })}
                    className="w-full accent-[#D9B382]"
                  />
                </div>

                {/* Trailing Multiplier */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="font-sans font-extrabold text-[11px] text-zinc-300 uppercase tracking-wider">Trailing Trigger (ATR Multiple)</span>
                    <span className="font-mono text-xs font-bold text-sky-400">{config.trailMultiplier}x Current ATR</span>
                  </div>
                  <input 
                    type="range" 
                    min="1.0" 
                    max="3.0" 
                    step="0.1"
                    value={config.trailMultiplier}
                    onChange={(e) => saveConfig({ ...config, trailMultiplier: Number(e.target.value) })}
                    className="w-full accent-[#D9B382]"
                  />
                </div>

                {/* Administrative regulatory caps */}
                <div className="mt-4 p-4 rounded-xl border border-zinc-800/40 bg-zinc-950/40 space-y-4">
                  <h5 className="font-sans font-black text-[10px] text-zinc-400 uppercase tracking-widest">Administrative Regulatory Caps</h5>
                  
                  <div className="flex flex-row justify-between items-center">
                    <label className="font-sans font-extrabold text-[10px] text-zinc-400 uppercase">Daily Loss Cap (₹)</label>
                    <input 
                      type="number" 
                      value={config.risk.dailyLossCapRupees}
                      onChange={(e) => saveConfig({ ...config, risk: { ...config.risk, dailyLossCapRupees: Number(e.target.value) } })}
                      className="w-24 bg-zinc-900 border border-zinc-800 rounded p-1.5 text-xs font-mono text-zinc-200 text-right outline-none"
                    />
                  </div>

                  <div className="flex flex-row justify-between items-center">
                    <label className="font-sans font-extrabold text-[10px] text-zinc-400 uppercase">Max Trades Per Day</label>
                    <input 
                      type="number" 
                      value={config.risk.maxTradesPerDay}
                      onChange={(e) => saveConfig({ ...config, risk: { ...config.risk, maxTradesPerDay: Number(e.target.value) } })}
                      className="w-16 bg-zinc-900 border border-zinc-800 rounded p-1.5 text-xs font-mono text-zinc-200 text-right outline-none"
                    />
                  </div>

                  <div className="flex flex-row justify-between items-center">
                    <label className="font-sans font-extrabold text-[10px] text-zinc-400 uppercase">Daily Stop-Losses Cap</label>
                    <input 
                      type="number" 
                      value={config.risk.maxConsecutiveLosses}
                      onChange={(e) => saveConfig({ ...config, risk: { ...config.risk, maxConsecutiveLosses: Number(e.target.value) } })}
                      className="w-16 bg-zinc-900 border border-zinc-800 rounded p-1.5 text-xs font-mono text-zinc-200 text-right outline-none"
                    />
                  </div>
                </div>

              </div>
            </div>

            {/* Bottom buttons */}
            <div className="border-t border-zinc-800 pb-2 pt-4 mt-6">
              <button 
                onClick={() => {
                  saveConfig(getDefaultScalpConfig());
                  setIsDrawerOpen(false);
                }}
                className="w-full py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 text-xs font-bold border border-zinc-800 transition-colors uppercase"
              >
                Reset to Defaults
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
