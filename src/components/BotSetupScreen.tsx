import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ScalpConfig, RiskConfig, ScalpInstrument, SLMode, TPMode } from '../types';
import { getDefaultScalpConfig } from '../quant/scalpingEngine';
import { searchNSEStocks as searchSymbols } from '../services/stockPriceFeed';

interface StockSearchResult {
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
        maxTradesPerDay:        3,
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
        maxTradesPerDay:        5,
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
        maxTradesPerDay:        8,
        maxConsecutiveLosses:   4,
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

const POPULAR_STOCKS: StockSearchResult[] = [
  { symbol: 'RELIANCE:NSE',   name: 'Reliance Industries',       exchange: 'NSE' },
  { symbol: 'TCS:NSE',        name: 'Tata Consultancy Services', exchange: 'NSE' },
  { symbol: 'HDFCBANK:NSE',   name: 'HDFC Bank',                 exchange: 'NSE' },
  { symbol: 'INFY:NSE',       name: 'Infosys',                   exchange: 'NSE' },
  { symbol: 'ICICIBANK:NSE',  name: 'ICICI Bank',                exchange: 'NSE' },
  { symbol: 'SBIN:NSE',       name: 'State Bank of India',       exchange: 'NSE' },
  { symbol: 'BHARTIARTL:NSE', name: 'Bharti Airtel',             exchange: 'NSE' },
  { symbol: 'ITC:NSE',        name: 'ITC Limited',               exchange: 'NSE' },
  { symbol: 'LT:NSE',         name: 'Larsen & Toubro',           exchange: 'NSE' },
  { symbol: 'MARUTI:NSE',     name: 'Maruti Suzuki',             exchange: 'NSE' },
  { symbol: 'BAJFINANCE:NSE', name: 'Bajaj Finance',             exchange: 'NSE' },
  { symbol: 'TITAN:NSE',      name: 'Titan Company',             exchange: 'NSE' },
  { symbol: 'HINDUNILVR:NSE', name: 'Hindustan Unilever',        exchange: 'NSE' },
  { symbol: 'WIPRO:NSE',      name: 'Wipro',                     exchange: 'NSE' },
  { symbol: 'ADANIENT:NSE',   name: 'Adani Enterprises',         exchange: 'NSE' },
];

export function BotSetupScreen({ onStart }: BotSetupScreenProps) {
  const [query,          setQuery]          = useState('');
  const [searchResults,  setSearchResults]  = useState<StockSearchResult[]>([]);
  const [selectedStock,  setSelectedStock]  = useState<StockSearchResult | null>(null);
  const [isSearching,    setIsSearching]    = useState(false);
  const [searchError,    setSearchError]    = useState<string | null>(null);

  const [capital,           setCapital]           = useState(100000);
  const [timeframe,         setTimeframe]         = useState(3);
  const [preset,            setPreset]            = useState<RiskPreset>('BALANCED');
  const [instrument,        setInstrument]        = useState<ScalpInstrument>('EQUITY_INTRADAY');
  const [minConfidence,     setMinConfidence]     = useState(70);
  const [capitalInput,      setCapitalInput]      = useState('100000');
  const [marketHoursGate,   setMarketHoursGate]   = useState(false);

  const [errors, setErrors] = useState<string[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [techniquesList, setTechniquesList] = useState<any[]>([]);
  const [techFileName,   setTechFileName]   = useState<string | null>(null);
  const [techError,      setTechError]      = useState<string | null>(null);

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
  };

  useEffect(() => {
    if (query.length < 2) {
      // Show popular stocks when nothing is typed yet
      if (query.length === 0 && !selectedStock) {
        setSearchResults(POPULAR_STOCKS);
        setSearchError(null);
      } else {
        setSearchResults([]);
        setSearchError(null);
      }
      return;
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const results = await searchSymbols(query);
        setSearchResults(results);
        if (results.length === 0) setSearchError('No NSE/BSE results found — try manual entry below');
      } catch (e: any) {
        const msg = e.message?.startsWith('TIMEOUT') ? e.message
          : `Search failed: ${e.message ?? 'Unknown error'}`;
        setSearchError(msg);
      } finally {
        setIsSearching(false);
      }
    }, 400);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [query, selectedStock]);

  const handleSelectStock = useCallback((result: StockSearchResult) => {
    setSelectedStock(result);
    setQuery('');
    setSearchResults([]);
  }, []);

  const handleStart = useCallback(() => {
    const errs: string[] = [];
    const parsedCapital = Number(capitalInput.replace(/,/g, ''));

    if (!selectedStock) errs.push('Select a stock to trade');
    if (!isFinite(parsedCapital) || parsedCapital < 5000)
      errs.push('Capital must be at least ₹5,000');
    if (parsedCapital > 10_000_000)
      errs.push('Capital cannot exceed ₹1,00,00,000');

    setErrors(errs);
    if (errs.length > 0) return;

    const config = buildConfigFromPreset(preset, parsedCapital, instrument, timeframe, marketHoursGate);

    onStart({
      symbol:           selectedStock!.symbol,
      config,
      capital:          parsedCapital,
      timeframeMinutes: timeframe,
      minConfidence,
      techniquesList,
      techFileName,
    });
  }, [selectedStock, capitalInput, preset, instrument, timeframe, minConfidence, techniquesList, techFileName, marketHoursGate, onStart]);

  const previewConfig = buildConfigFromPreset(preset, Number(capitalInput) || 100000, instrument, timeframe, marketHoursGate);

  return (
    <div className="flex flex-col gap-6 p-6 bg-gray-900 h-full overflow-y-auto text-white max-w-lg mx-auto pb-24">
      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
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
              placeholder="Search symbol (e.g. RELIANCE)"
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
                      placeholder="e.g. RELIANCE:NSE or TCS:NSE"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim().toUpperCase();
                          if (val.length > 2) {
                            const symbol = val.includes(':')  ? val
                                         : val.includes('.NS') ? val.replace('.NS', ':NSE')
                                         : val.includes('.BO') ? val.replace('.BO', ':BSE')
                                         : `${val}:NSE`;
                            handleSelectStock({
                              symbol,
                              name:     symbol,
                              exchange: symbol.includes('BSE') ? 'BSE' : 'NSE',
                            });
                          }
                        }
                      }}
                    />
                    <button
                      onClick={(e) => {
                        const input = (e.currentTarget.previousSibling as HTMLInputElement);
                        const val   = input.value.trim().toUpperCase();
                        if (val.length > 2) {
                          const symbol = val.includes(':')  ? val
                                       : val.includes('.NS') ? val.replace('.NS', ':NSE')
                                       : val.includes('.BO') ? val.replace('.BO', ':BSE')
                                       : `${val}:NSE`;
                          handleSelectStock({
                            symbol,
                            name:     symbol,
                            exchange: symbol.includes('BSE') ? 'BSE' : 'NSE',
                          });
                        }
                      }}
                      className="px-3 py-2 bg-amber-500/20 border border-amber-500/40 rounded-lg text-amber-400 text-xs font-bold hover:bg-amber-500/30 transition-colors"
                    >
                      Use
                    </button>
                  </div>
                  <p className="text-zinc-400 text-[9px] font-mono mt-1.5">
                    NSE stocks: append :NSE (RELIANCE:NSE) · BSE stocks: append :BSE (RELIANCE:BSE)
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <h2 className="font-bold text-gray-300">CAPITAL</h2>
        <div className="flex items-center gap-2">
          <span className="text-gray-400">₹</span>
          <input 
            value={capitalInput}
            onChange={(e) => setCapitalInput(e.target.value)}
            className="flex-1 bg-gray-700 text-white border border-gray-600 rounded p-2 focus:outline-none focus:border-blue-500"
            type="text"
          />
        </div>
        <div className="text-xs text-gray-400 mt-1">
          Daily loss cap: ₹{previewConfig.risk.dailyLossCapRupees.toFixed(0)} (auto)
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

      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <h2 className="font-bold text-gray-300 flex justify-between">
          <span>MIN CONFIDENCE THRESHOLD</span>
          <span className="text-blue-400">{minConfidence}%</span>
        </h2>
        <input 
          type="range"
          min="50" max="90" step="5"
          value={minConfidence}
          onChange={(e) => setMinConfidence(Number(e.target.value))}
          className="w-full mt-2"
        />
        <div className="text-xs text-gray-400 mt-1">
          Bot will only trade signals above {minConfidence}%
        </div>
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
      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <label className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider font-bold">
          Technique File
        </label>

        {techFileName ? (
          // File loaded state
          <div className="flex items-center justify-between px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
            <div>
              <span className="text-xs font-mono font-bold text-emerald-400">
                ✓ {techFileName}
              </span>
              <span className="block text-[10px] font-mono text-emerald-600 mt-0.5">
                {techniquesList.length} techniques loaded
              </span>
            </div>
            <button
              onClick={handleClearTechniques}
              className="text-[10px] font-mono text-zinc-500 hover:text-rose-400 transition-colors"
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

      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2 font-mono text-xs">
        <h2 className="font-bold text-gray-300 font-sans mb-1">SL / TP PREVIEW</h2>
        <div className="flex justify-between">
          <span className="text-gray-400">SL:</span>
          <span>Entry − ATR × {previewConfig.atrMultiplierSL}</span>
        </div>
        <div className="flex justify-between text-gray-500 pl-4 mb-2">
          <span>(AUTO mode, structural floor)</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">TP1:</span>
          <span>Entry + {previewConfig.tp1RMultiple}R</span>
        </div>
        <div className="flex justify-between text-gray-500 pl-4 mb-2">
          <span>({previewConfig.tpMode === 'PARTIAL_1R' ? '50% booked' : 'Wait'}, SL → Break-even)</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">TP2:</span>
          <span>Entry + {previewConfig.rrRatio}R</span>
        </div>
        <div className="flex justify-between text-gray-500 pl-4 mb-2">
          <span>(full exit)</span>
        </div>
        <div className="h-px bg-gray-700 my-1"></div>
        <div className="flex justify-between text-gray-300">
          <span>Risk per trade:</span>
          <span>₹{(previewConfig.capitalRupees * (previewConfig.riskPerTradePct / 100)).toFixed(0)} ({previewConfig.riskPerTradePct}% of ₹{previewConfig.capitalRupees.toLocaleString()})</span>
        </div>
        <div className="flex justify-between text-gray-300">
          <span>Daily loss cap:</span>
          <span>₹{previewConfig.risk.dailyLossCapRupees.toFixed(0)}</span>
        </div>
        <div className="flex justify-between text-gray-300">
          <span>Max trades:</span>
          <span>{previewConfig.risk.maxTradesPerDay}/day</span>
        </div>
        <div className="flex justify-between text-gray-300">
          <span>Max hold:</span>
          <span>{previewConfig.maxHoldingMinutes} mins</span>
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
  );
}
