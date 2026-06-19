import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ScalpConfig, RiskConfig, ScalpInstrument, SLMode, TPMode } from '../types';
import { getDefaultScalpConfig } from '../config/scalpConfig';
import { searchNSEStocks as searchSymbols } from '../services/stockPriceFeed';
import { initVirtualBalance, setVirtualBalanceValue } from '../services/virtualBalanceService';
import { auth } from '../services/firebase';
import { onAuthStateChanged } from 'firebase/auth';

export interface StockSearchResult {
  symbol:   string;   // e.g. 'RELIANCE.NS'
  name:     string;   // e.g. 'Reliance Industries Limited'
  exchange: string;   // 'NSE' | 'BSE'
}

export interface BotStartPayload {
  symbol:           string;
  config:           ScalpConfig;
  capital:          number;
  timeframeMinutes: number;
  minConfidence:    number;
  techniquesList:   any[];      // ← ADD: user-uploaded techniques, empty if none loaded
  techFileName:     string | null; // ← ADD: display name for the loaded file
}

interface BotSetupScreenProps {
  onStart: (payload: BotStartPayload) => void;
}

type RiskPreset = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

function buildConfigFromPreset(
  preset:           RiskPreset,
  capital:          number,
  instrument:       ScalpInstrument,
  timeframeMinutes: number,
  marketHoursGate:  boolean
): ScalpConfig {
  const base = getDefaultScalpConfig();

  const presets: Record<RiskPreset, Partial<ScalpConfig & { risk: Partial<RiskConfig> }>> = {
    CONSERVATIVE: {
      riskPerTradePct:      0.5,
      rrRatio:              1.5,
      tp1RMultiple:         1.0,
      atrMultiplierSL:      1.0,
      slPercent:            0.3,
      minConfluence:        6,
      minRR:                1.5,
      maxHoldingMinutes:    timeframeMinutes * 2,
      risk: {
        dailyLossCapRupees:     capital * 0.01,   // 1% of capital
        maxTradesPerDay:        5,
        maxConsecutiveLosses:   2,
        cooldownMinutes:        15,
        slippageTicks:          1,
      },
    },
    BALANCED: {
      riskPerTradePct:      1.0,
      rrRatio:              2.0,
      tp1RMultiple:         1.0,
      atrMultiplierSL:      1.2,
      slPercent:            0.4,
      minConfluence:        5,
      minRR:                1.5,
      maxHoldingMinutes:    timeframeMinutes * 2,
      risk: {
        dailyLossCapRupees:     capital * 0.02,   // 2% of capital
        maxTradesPerDay:        10,
        maxConsecutiveLosses:   3,
        cooldownMinutes:        10,
        slippageTicks:          1,
      },
    },
    AGGRESSIVE: {
      riskPerTradePct:      2.0,
      rrRatio:              2.5,
      tp1RMultiple:         1.0,
      atrMultiplierSL:      1.5,
      slPercent:            0.6,
      minConfluence:        4,
      minRR:                1.5,
      maxHoldingMinutes:    timeframeMinutes * 3,
      risk: {
        dailyLossCapRupees:     capital * 0.04,   // 4% of capital
        maxTradesPerDay:        25,
        maxConsecutiveLosses:   6,
        cooldownMinutes:        5,
        slippageTicks:          2,
      },
    },
  };

  const chosen = presets[preset];
  return {
    ...base,
    ...chosen,
    capitalRupees: capital,
    instrument,
    enableMarketHoursGate: marketHoursGate,
    risk: {
      ...base.risk,
      ...(chosen.risk ?? {}),
    },
  };
}

export const POPULAR_STOCKS: StockSearchResult[] = [
  { symbol: 'TATASTEEL:NSE',  name: 'Tata Steel',              exchange: 'NSE' },
  { symbol: 'ITC:NSE',        name: 'ITC Ltd',                 exchange: 'NSE' },
  { symbol: 'POWERGRID:NSE',  name: 'Power Grid Corp',         exchange: 'NSE' },
  { symbol: 'LTF:NSE',        name: 'L&T Finance',             exchange: 'NSE' },
  { symbol: 'M&MFIN:NSE',     name: 'M&M Financial Services',  exchange: 'NSE' },
  { symbol: 'PETRONET:NSE',   name: 'Petronet LNG',            exchange: 'NSE' },
  { symbol: 'NATIONALUM:NSE', name: 'National Aluminium',      exchange: 'NSE' },
  { symbol: 'IEX:NSE',        name: 'Indian Energy Exchange',  exchange: 'NSE' },
  { symbol: 'CESC:NSE',       name: 'CESC Ltd',                exchange: 'NSE' },
  { symbol: 'FEDERALBNK:NSE', name: 'Federal Bank',            exchange: 'NSE' },
];

export function BotSetupScreen({ onStart }: BotSetupScreenProps) {
  const [query,          setQuery]          = useState('');
  const [searchResults,  setSearchResults]  = useState<StockSearchResult[]>([]);
  const [selectedStock,  setSelectedStock]  = useState<StockSearchResult | null>(() => {
    try {
      const stored = localStorage.getItem('chartlens_selected_stock');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (POPULAR_STOCKS.some(s => s.symbol === parsed.symbol)) {
          return parsed;
        }
      }
      return POPULAR_STOCKS[0];
    } catch {
      return POPULAR_STOCKS[0];
    }
  });
  const [isSearching,    setIsSearching]    = useState(false);
  const [searchError,    setSearchError]    = useState<string | null>(null);

  const [virtualBalance, setVirtualBalance] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('user_virtual_balance');
      return stored ? parseFloat(stored) : 100000;
    } catch {
      return 100000;
    }
  });
  const [loadingBalance, setLoadingBalance] = useState<boolean>(false);

  const [capital,           setCapital]           = useState(100000);
  const [timeframe,         setTimeframe]         = useState<number>(() => {
    try {
      const v = localStorage.getItem('chartlens_timeframe');
      return v ? parseInt(v, 10) : 3;
    } catch { return 3; }
  });
  const [preset,            setPreset]            = useState<RiskPreset>(() => {
    try {
      return (localStorage.getItem('chartlens_preset') as RiskPreset) || 'BALANCED';
    } catch { return 'BALANCED'; }
  });
  const [instrument,        setInstrument]        = useState<ScalpInstrument>(() => {
    try {
      return (localStorage.getItem('chartlens_instrument') as ScalpInstrument) || 'EQUITY_INTRADAY';
    } catch { return 'EQUITY_INTRADAY'; }
  });
  const [minConfidence,     setMinConfidence]     = useState<number>(() => {
    try {
      const v = localStorage.getItem('chartlens_min_confidence');
      return v ? parseInt(v, 10) : 70;
    } catch { return 70; }
  });
  const [capitalInput,      setCapitalInput]      = useState('100000');
  const [marketHoursGate,   setMarketHoursGate]   = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('chartlens_market_hours_gate');
      return v === 'true';
    } catch { return false; }
  });

  const [leverage, setLeverage] = useState<number>(() => {
    try {
      const v = localStorage.getItem('chartlens_leverage');
      return v ? parseInt(v, 10) : 1; // Default 1x margin for intraday
    } catch { return 1; }
  });

  const [investmentPerTrade, setInvestmentPerTrade] = useState<number>(() => {
    try {
      const v = localStorage.getItem('chartlens_investment_per_trade');
      return v ? parseInt(v, 10) : 10000;
    } catch { return 10000; }
  });
  const [rrRatioChoice,      setRrRatioChoice]      = useState<1.5 | 2 | 2.5 | 3 | 4>(() => {
    try {
      const v = localStorage.getItem('chartlens_rr_ratio_choice');
      return v ? parseFloat(v) as any : 2;
    } catch { return 2; }
  });
  const [useConfidenceThreshold, setUseConfidenceThreshold] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('chartlens_use_confidence_threshold');
      return v !== 'false';
    } catch { return true; }
  });
  const [maxConcurrentTrades, setMaxConcurrentTrades] = useState<number>(() => {
    try {
      const v = localStorage.getItem('chartlens_max_concurrent_trades');
      return v ? parseInt(v, 10) : 999;
    } catch { return 999; }
  });

  const [errors, setErrors] = useState<string[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('chartlens_timeframe', String(timeframe));
      localStorage.setItem('chartlens_preset', preset);
      localStorage.setItem('chartlens_instrument', instrument);
      localStorage.setItem('chartlens_min_confidence', String(minConfidence));
      localStorage.setItem('chartlens_market_hours_gate', String(marketHoursGate));
      localStorage.setItem('chartlens_investment_per_trade', String(investmentPerTrade));
      localStorage.setItem('chartlens_rr_ratio_choice', String(rrRatioChoice));
      localStorage.setItem('chartlens_use_confidence_threshold', String(useConfidenceThreshold));
      localStorage.setItem('chartlens_max_concurrent_trades', String(maxConcurrentTrades));
      if (selectedStock) {
        localStorage.setItem('chartlens_selected_stock', JSON.stringify(selectedStock));
      } else {
        localStorage.removeItem('chartlens_selected_stock');
      }
    } catch (e) {
      console.warn('Failed to save setup config to localStorage:', e);
    }
  }, [timeframe, preset, instrument, minConfidence, marketHoursGate, investmentPerTrade, rrRatioChoice, useConfidenceThreshold, maxConcurrentTrades, selectedStock]);

  const [techniquesList, setTechniquesList] = useState<any[]>(() => {
    try {
      const stored = localStorage.getItem('user_techniques_list');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [techFileName,   setTechFileName]   = useState<string | null>(() => {
    try {
      return localStorage.getItem('user_techniques_filename') || null;
    } catch {
      return null;
    }
  });
  const [techError,      setTechError]      = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user && active) {
        try {
          const bal = await initVirtualBalance(user.uid);
          if (active) {
            setVirtualBalance(bal);
            setCapitalInput(String(Math.floor(bal)));
            setInvestmentPerTrade(prev => Math.max(500, Math.min(prev, Math.floor(bal))));
          }
        } catch (e) {
          console.error('[BotSetupScreen] Failed to init balance:', e);
        }
      }
      if (active) {
        setLoadingBalance(false);
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

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
    // Reset input so the same file can be re-uploaded
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
      console.error('Failed to clear techniques from localStorage:', err);
    }
  };

  useEffect(() => {
    if (query.length < 2) {
      if (query.length === 0) {
        setSearchResults(POPULAR_STOCKS);
        setSearchError(null);
      } else {
        setSearchResults([]);
        setSearchError(null);
      }
      return;
    }
    setIsSearching(true);
    setSearchError(null);

    // Locally filter only from the 10 permitted stocks
    const queryLower = query.toLowerCase();
    const filtered = POPULAR_STOCKS.filter(stock =>
      stock.symbol.toLowerCase().includes(queryLower) ||
      stock.name.toLowerCase().includes(queryLower)
    );

    setSearchResults(filtered);
    if (filtered.length === 0) {
      setSearchError('No matching stocks found in the permitted list');
    }
    setIsSearching(false);
  }, [query, selectedStock]);

  const handleSelectStock = useCallback((result: StockSearchResult) => {
    setSelectedStock(result);
    setQuery('');
    setSearchResults([]);
  }, []);

  const handleStart = useCallback(() => {
    const errs: string[] = [];
    const parsedCapital = virtualBalance;

    if (!selectedStock) errs.push('Select a stock to trade');
    if (!isFinite(parsedCapital) || parsedCapital < 500)
      errs.push('Virtual balance is too low — at least ₹500 is needed');

    setErrors(errs);
    if (errs.length > 0) return;

    const config = buildConfigFromPreset(preset, parsedCapital, instrument, timeframe, marketHoursGate);
    config.investmentPerTrade = investmentPerTrade;
    config.leverage = leverage;
    config.rrRatioChoice = rrRatioChoice;
    config.rrRatio = rrRatioChoice;
    config.minRR = rrRatioChoice;
    config.useConfidenceThreshold = useConfidenceThreshold;
    config.maxConcurrentTrades = maxConcurrentTrades;

    onStart({
      symbol:           selectedStock!.symbol,
      config,
      capital:          parsedCapital,
      timeframeMinutes: timeframe,
      minConfidence,
      techniquesList,
      techFileName,
      investmentPerTrade,
      leverage,
      rrRatioChoice,
      useConfidenceThreshold,
      maxConcurrentTrades,
    } as any);
  }, [selectedStock, virtualBalance, preset, instrument, timeframe, minConfidence, techniquesList, techFileName, marketHoursGate, investmentPerTrade, rrRatioChoice, useConfidenceThreshold, maxConcurrentTrades, leverage, onStart]);

  const previewConfig = buildConfigFromPreset(preset, virtualBalance || 100000, instrument, timeframe, marketHoursGate);
  previewConfig.investmentPerTrade = investmentPerTrade;
  previewConfig.leverage = leverage;
  previewConfig.rrRatioChoice = rrRatioChoice;
  previewConfig.rrRatio = rrRatioChoice;
  previewConfig.minRR = rrRatioChoice;
  previewConfig.useConfidenceThreshold = useConfidenceThreshold;
  previewConfig.maxConcurrentTrades = maxConcurrentTrades;

  return (
    <div 
      className="flex-1 overflow-y-auto overflow-x-hidden bg-[#0E1014] text-white w-full max-w-full box-border"
      style={{ height: 'calc(100vh - 128px)' }}
      id="bot-setup-screen-scroll"
    >
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 max-w-lg mx-auto pb-32 w-full max-w-full box-border overflow-hidden">
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 w-full max-w-full overflow-hidden">
        <h1 className="text-2xl font-bold mb-2">🤖 BOT SETUP</h1>
        <p className="text-sm text-gray-400">Configure before starting automated mode</p>
      </div>

      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <h2 className="font-bold text-gray-300">STOCK SELECTION</h2>
        {selectedStock ? (
          <div className="flex justify-between items-center bg-gray-700 p-3 rounded">
            <div>
              <div className="font-bold">{selectedStock.symbol}</div>
              <div className="text-xs text-gray-400">{selectedStock.name}</div>
            </div>
            <span className="text-xs font-bold bg-blue-900 text-blue-200 px-2 py-1 rounded">
              {selectedStock.exchange}
            </span>
            <button 
              className="text-xs text-red-400 hover:text-red-300 ml-4"
              onClick={() => setSelectedStock(null)}
            >
              Change
            </button>
          </div>
        ) : (
          <div className="relative">
            <input 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol (e.g. TATASTEEL)"
              className="w-full bg-gray-700 text-white border border-gray-600 rounded p-2 focus:outline-none focus:border-blue-500"
            />
            {isSearching && <div className="absolute right-3 top-2 text-gray-400 text-sm">...</div>}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-gray-800 border border-gray-600 rounded mt-1 max-h-48 overflow-y-auto z-10 shadow-xl">
                {searchResults.map(result => (
                  <div
                    key={result.symbol}
                    onClick={() => handleSelectStock(result)}
                    className="flex items-center justify-between px-3 py-2.5 hover:bg-zinc-700/60 cursor-pointer transition-colors border-b border-zinc-800/40 last:border-0 text-left"
                  >
                    <div>
                      <span className="text-sm font-mono font-bold text-zinc-200 block">{result.symbol}</span>
                      <span className="block text-[10px] font-mono text-zinc-400 mt-0.5">{result.name}</span>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded shrink-0">
                      {result.exchange}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {searchError && (
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-rose-400 text-xs font-mono">{searchError}</p>

                {/* Manual symbol entry fallback — always available when search fails */}
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                  <p className="text-amber-400 text-[10px] font-mono font-bold uppercase tracking-wider mb-2">
                    ⚡ Manual Entry — Enter symbol directly
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. TATASTEEL:NSE or FEDERALBNK:NSE"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim().toUpperCase();
                          if (val.length > 2) {
                            const ticker = val.includes(':') ? val.split(':')[0] : val.replace('.NS', '').replace('.BO', '');
                            const matched = POPULAR_STOCKS.find(s => s.symbol.startsWith(ticker));
                            if (matched) {
                              handleSelectStock(matched);
                            } else {
                              alert(`Only the 10 configured liquid stocks are permitted: ${POPULAR_STOCKS.map(s => s.symbol.split(':')[0]).join(', ')}`);
                            }
                          }
                        }
                      }}
                    />
                    <button
                      onClick={(e) => {
                        const input = (e.currentTarget.previousSibling as HTMLInputElement);
                        const val   = input.value.trim().toUpperCase();
                        if (val.length > 2) {
                          const ticker = val.includes(':') ? val.split(':')[0] : val.replace('.NS', '').replace('.BO', '');
                          const matched = POPULAR_STOCKS.find(s => s.symbol.startsWith(ticker));
                          if (matched) {
                            handleSelectStock(matched);
                          } else {
                            alert(`Only the 10 configured liquid stocks are permitted: ${POPULAR_STOCKS.map(s => s.symbol.split(':')[0]).join(', ')}`);
                          }
                        }
                      }}
                      className="px-3 py-2 bg-amber-500/20 border border-amber-500/40 rounded-lg text-amber-400 text-xs font-bold hover:bg-amber-500/30 transition-colors"
                    >
                      Use
                    </button>
                  </div>
                  <p className="text-zinc-400 text-[9px] font-mono mt-1.5">
                    Only configured liquid under-₹300 stocks are permitted (e.g. TATASTEEL:NSE, FEDERALBNK:NSE)
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex flex-col gap-2">
        <h2 className="font-bold text-zinc-300 text-sm tracking-wider font-sans uppercase">Virtual Account Balance</h2>
        <div className="flex items-center justify-between py-2 bg-black/40 px-3.5 rounded-lg border border-[#D9B382]/20">
          <span className="text-[#D9B382] font-black text-lg font-mono">
            {loadingBalance ? 'Loading...' : `₹${virtualBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
          <span className="text-[10px] font-black px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-sans tracking-wide">
            LEDGER SYNCED ✓
          </span>
        </div>

        {/* Dynamic Money Processes: Custom Balance / Capital Adjustment */}
        <div className="mt-1 flex flex-col gap-1.5 bg-black/25 p-2.5 rounded border border-zinc-800">
          <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider font-sans">Set Custom Account Size</label>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center bg-zinc-800 px-2 rounded border border-zinc-700">
              <span className="text-zinc-500 font-mono text-xs pr-1">₹</span>
              <input
                type="number"
                value={capitalInput}
                onChange={(e) => setCapitalInput(e.target.value)}
                placeholder="100000"
                min="1000"
                max="10000000"
                className="w-full bg-transparent text-white font-mono text-xs focus:outline-none py-1"
              />
            </div>
            <button
              onClick={async () => {
                const val = parseFloat(capitalInput);
                if (!isNaN(val) && val >= 1000) {
                  setLoadingBalance(true);
                  const uid = auth.currentUser?.uid ?? null;
                  const newBal = await setVirtualBalanceValue(uid, val);
                  setVirtualBalance(newBal);
                  setInvestmentPerTrade(prev => Math.max(500, Math.min(prev, newBal)));
                  setLoadingBalance(false);
                }
              }}
              className="px-3 py-1 bg-[#D9B382] hover:bg-[#c49f71] text-zinc-950 rounded text-xs font-black transition-colors"
            >
              Apply
            </button>
          </div>
          <div className="flex gap-1.5 flex-wrap mt-0.5">
            {[10000, 50000, 100000, 500000, 1000000].map(amt => (
              <button
                key={amt}
                onClick={async () => {
                  setCapitalInput(String(amt));
                  setLoadingBalance(true);
                  const uid = auth.currentUser?.uid ?? null;
                  const newBal = await setVirtualBalanceValue(uid, amt);
                  setVirtualBalance(newBal);
                  setInvestmentPerTrade(prev => Math.max(500, Math.min(prev, amt)));
                  setLoadingBalance(false);
                }}
                className="text-[9px] font-mono text-zinc-400 bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700 rounded px-1.5 py-0.5 transition-colors"
              >
                ₹{amt.toLocaleString('en-IN')}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-zinc-400 font-sans mt-1">
          Daily max loss cap: <span className="font-mono font-bold text-zinc-300">₹{(virtualBalance * (previewConfig.risk.riskPerTradePct * 0.01 || 0.01)).toFixed(0)}</span> (scaled automatically)
        </div>
      </div>

      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <h2 className="font-bold text-gray-300">CANDLE TIMEFRAME</h2>
        <div className="flex gap-2">
          {[1, 3, 5].map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`flex-1 py-2 rounded font-bold transition-colors ${timeframe === tf ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              {tf}m
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <h2 className="font-bold text-gray-300">INSTRUMENT</h2>
        <div className="flex gap-2">
          {(['EQUITY_INTRADAY', 'INDEX_FUT'] as ScalpInstrument[]).map(inst => (
            <button
              key={inst}
              onClick={() => setInstrument(inst)}
              className={`flex-1 py-2 rounded text-sm font-bold transition-colors ${instrument === inst ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              {inst}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <h2 className="font-bold text-gray-300">RISK PROFILE</h2>
        <div className="flex gap-2 mb-2">
          {(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'] as RiskPreset[]).map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`flex-1 py-2 rounded text-xs font-bold transition-colors ${preset === p ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="text-xs text-gray-400">
          Risk per trade: {previewConfig.riskPerTradePct}% • Max {previewConfig.risk.maxTradesPerDay} trades/day
        </div>
      </div>

      {/* Control 1 — Investment per trade (₹) & Leverage */}
      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-300 text-sm md:text-base">INVESTMENT PER TRADE (₹)</h2>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-xs font-bold">Leverage:</span>
            <div className="flex bg-gray-900 rounded overflow-hidden border border-gray-700">
              {[1, 2, 5].map(lev => (
                <button
                  key={lev}
                  onClick={() => setLeverage(lev)}
                  className={`px-2 py-0.5 text-xs font-black transition-colors ${leverage === lev ? 'bg-amber-500 text-amber-950' : 'text-gray-400 hover:bg-gray-700'}`}
                >
                  {lev}x
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-zinc-400 font-mono">₹</span>
          <input 
            type="number"
            min="500"
            max={Number(capitalInput) || 100000}
            value={investmentPerTrade === 0 ? '' : investmentPerTrade}
            onChange={(e) => {
              const val = e.target.value;
              setInvestmentPerTrade(val === '' ? 0 : Number(val));
            }}
            onBlur={() => {
              setInvestmentPerTrade(prev => Math.max(500, Math.min(prev, Number(capitalInput) || 100000)));
            }}
            className="flex-1 bg-gray-700 text-white border border-gray-600 rounded p-2 focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>
        <p className="text-[10px] text-zinc-400 leading-normal mt-0.5">
          Effective Exposure: <span className="text-amber-400 font-bold font-mono">₹{(investmentPerTrade * leverage).toLocaleString('en-IN')}</span> (Buys ₹{(investmentPerTrade * leverage).toLocaleString('en-IN')} worth of stock considering {leverage}x broker margin)
        </p>
      </div>

      {/* Control 2 — R:R Ratio selector */}
      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <h2 className="font-bold text-zinc-300 text-sm md:text-base">RISK:REWARD RATIO</h2>
        <div className="flex divide-zinc-700 border border-zinc-700 bg-zinc-800/40 rounded-xl overflow-hidden mt-1 text-center">
          {([1.5, 2, 2.5, 3, 4] as const).map(ratio => (
            <button
              key={ratio}
              type="button"
              onClick={() => setRrRatioChoice(ratio)}
              className={`flex-1 py-1.5 text-xs font-mono font-bold transition-all ${
                rrRatioChoice === ratio
                  ? 'bg-blue-600 text-white shadow-inner font-extrabold'
                  : 'bg-gray-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80'
              }`}
            >
              {ratio.toFixed(1)}x
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-400 leading-normal mt-1">
          Target profit at <span className="text-blue-400 font-bold">{rrRatioChoice}×</span> your risk distance (single full take-profit exit, no partials).
        </p>
      </div>

      {/* Control 3 — Confidence gate */}
      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <label className="font-bold text-gray-300 text-sm md:text-base">CONFIDENCE GATE</label>
          <button
            onClick={() => setUseConfidenceThreshold(!useConfidenceThreshold)}
            className={`px-3 py-1 bg-gray-700 rounded text-xs font-bold font-mono transition-colors border ${
              useConfidenceThreshold 
                ? 'bg-blue-600 border-blue-500 text-white' 
                : 'bg-zinc-700/40 border-zinc-600/50 text-zinc-400 hover:bg-zinc-700/60'
            }`}
          >
            {useConfidenceThreshold ? 'ENABLED' : 'DISABLED'}
          </button>
        </div>

        {useConfidenceThreshold ? (
          <div className="mt-2 flex flex-col gap-2">
            <h3 className="font-bold text-zinc-300 flex justify-between text-xs">
              <span>MIN CONFIDENCE THRESHOLD</span>
              <span className="text-blue-400 font-mono font-bold">{minConfidence}%</span>
            </h3>
            <input 
              type="range"
              min="50" max="95" step="5"
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="w-full mt-1"
            />
            <div className="text-[10px] text-gray-400 leading-normal mt-0.5">
              Bot will only execute trade signals that score at or above {minConfidence}% from judges.
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-amber-400 font-mono leading-normal bg-amber-500/5 p-2 rounded-lg border border-amber-500/10 mt-1">
            ⚠ Confidence threshold bypassed. The bot will automatically execute trade setups on any valid Bull win signal, regardless of confidence scores or technique weights.
          </div>
        )}
      </div>

      {/* Control 4 — Max concurrent trades selector */}
      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <h2 className="font-bold text-zinc-300 text-sm md:text-base">MAX CONCURRENT TRADES</h2>
        <div className="flex divide-zinc-700 border border-zinc-700 bg-zinc-800/40 rounded-xl overflow-hidden mt-1 text-center">
          {([1, 3, 5, 10, 999] as const).map(num => (
            <button
              key={num}
              type="button"
              onClick={() => setMaxConcurrentTrades(num)}
              className={`flex-1 py-1.5 text-xs font-mono font-bold transition-all ${
                maxConcurrentTrades === num
                  ? 'bg-blue-600 text-white shadow-inner font-extrabold'
                  : 'bg-gray-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80'
              }`}
            >
              {num === 999 ? '∞' : num}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-400 leading-normal mt-1">
          Max active stock positions the bot will open simultaneously. Limit: <span className="text-blue-400 font-bold">{maxConcurrentTrades === 999 ? 'Unlimited' : `${maxConcurrentTrades} trades`}</span>.
        </p>
      </div>

      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2" id="market-hours-gate-container">
        <h2 className="font-bold text-gray-300 flex justify-between items-center text-sm md:text-base">
          <span>MARKET HOUR ENFORCEMENT</span>
          <span className={`text-[9px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider ${marketHoursGate ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
            {marketHoursGate ? 'ENFORCED' : 'ALLOW 24/7 (AFTER-HOURS MODE)'}
          </span>
        </h2>
        
        <div className="flex items-center justify-between mt-1.5 py-1">
          <div className="flex flex-col flex-1 pr-4">
            <span className="text-xs text-gray-200 font-semibold">Enforce Market Hours (09:15-15:30 IST)</span>
            <span className="text-[10px] text-gray-400 leading-normal mt-0.5">
              If OFF, the bot will trade 24/7. It will fetch previous historical candles from Twelve Data to pre-seed the indicators, and simulate micro-fluctuations so you can run and trade outside market hours.
            </span>
          </div>
          <button
            onClick={() => setMarketHoursGate(!marketHoursGate)}
            className={`px-3 py-1.5 rounded text-xs font-bold font-mono transition-colors border ${
              marketHoursGate 
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30' 
                : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/30'
            }`}
          >
            {marketHoursGate ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Technique File Upload */}
      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2 w-full max-w-full overflow-hidden">
        <label className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider font-bold">
          Technique File
        </label>

        {techFileName ? (
          // File loaded state
          <div className="flex items-center justify-between px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl w-full max-w-full overflow-hidden">
            <div className="flex-1 min-w-0 mr-4 overflow-hidden">
              <span className="block text-xs font-mono font-bold text-emerald-400 truncate" title={techFileName}>
                ✓ {techFileName}
              </span>
              <span className="block text-[10px] font-mono text-emerald-600 mt-0.5">
                {techniquesList.length} techniques loaded
              </span>
            </div>
            <button
              onClick={handleClearTechniques}
              className="text-[10px] font-mono text-zinc-500 hover:text-rose-400 transition-colors shrink-0"
            >
              Remove
            </button>
          </div>
        ) : (
          // No file state
          <label className="flex flex-col items-center justify-center px-4 py-5 bg-zinc-800/40 border border-dashed border-zinc-700 rounded-xl cursor-pointer hover:border-zinc-500 transition-colors">
            <span className="text-zinc-400 text-xs font-mono mb-1">Upload .json technique file</span>
            <span className="text-zinc-600 text-[10px] font-mono text-center">
              Without a technique file, J4 judge scores zero. Signal quality will be lower.
            </span>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleTechFileUpload}
            />
          </label>
        )}

        {techError && (
          <span className="text-[10px] font-mono text-rose-400">{techError}</span>
        )}
      </div>

      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2 font-mono text-xs w-full max-w-full overflow-hidden">
        <h2 className="font-bold text-gray-300 font-sans mb-1">SL / TP PREVIEW</h2>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <span className="text-gray-400">SL:</span>
          <span>Entry − ATR × {previewConfig.atrMultiplierSL}</span>
        </div>
        <div className="flex justify-between text-gray-500 pl-4 mb-2">
          <span>(AUTO mode, structural floor)</span>
        </div>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <span className="text-gray-400">TP1:</span>
          <span>Entry + {previewConfig.tp1RMultiple}R</span>
        </div>
        <div className="flex justify-between text-gray-500 pl-4 mb-2">
          <span>({previewConfig.tpMode === 'PARTIAL_1R' ? '50% booked' : 'Wait'}, SL → Break-even)</span>
        </div>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <span className="text-gray-400">TP2:</span>
          <span>Entry + {previewConfig.rrRatio}R</span>
        </div>
        <div className="flex justify-between text-gray-500 pl-4 mb-2">
          <span>(full exit)</span>
        </div>
        <div className="h-px bg-gray-700 my-1"></div>
        <div className="flex justify-between items-center gap-2 flex-wrap text-gray-300">
          <span>Risk per trade:</span>
          <span className="text-right">₹{(previewConfig.capitalRupees * (previewConfig.riskPerTradePct / 100)).toFixed(0)} ({previewConfig.riskPerTradePct}% of ₹{previewConfig.capitalRupees.toLocaleString()})</span>
        </div>
        <div className="flex justify-between items-center gap-2 flex-wrap text-gray-300">
          <span>Daily loss cap:</span>
          <span className="text-right">₹{previewConfig.risk.dailyLossCapRupees.toFixed(0)}</span>
        </div>
        <div className="flex justify-between items-center gap-2 flex-wrap text-gray-300">
          <span>Max trades:</span>
          <span className="text-right">{previewConfig.risk.maxTradesPerDay}/day</span>
        </div>
        <div className="flex justify-between items-center gap-2 flex-wrap text-gray-300">
          <span>Max hold:</span>
          <span className="text-right">{previewConfig.maxHoldingMinutes} mins</span>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-900 border border-red-500 rounded p-3">
          {errors.map((e, i) => <p key={i} className="text-red-300 text-sm">{e}</p>)}
        </div>
      )}

      <button
        onClick={handleStart}
        className="w-full py-4 bg-green-600 hover:bg-green-500 rounded-lg font-bold text-lg tracking-wide shadow-lg shadow-green-900/50 transition-colors"
      >
        START BOT
      </button>
      </div>
    </div>
  );
}
