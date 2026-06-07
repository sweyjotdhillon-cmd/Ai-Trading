import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ScalpConfig, RiskConfig, ScalpInstrument, SLMode, TPMode } from '../types';
import { getDefaultScalpConfig } from '../quant/scalpingEngine';

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
  timeframeMinutes: number
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
    risk: {
      ...base.risk,
      ...(chosen.risk ?? {}),
    },
  };
}

const BASE_URL = 'https://military-jobye-haiqstudios-14f59639.koyeb.app';

async function searchStocks(query: string): Promise<StockSearchResult[]> {
  if (query.trim().length < 2) return [];
  const res = await fetch(
    `${BASE_URL}/search?q=${encodeURIComponent(query.trim())}`,
    { signal: AbortSignal.timeout(6000) }
  );
  if (!res.ok) throw new Error(`Search failed ${res.status}`);
  const data = await res.json();

  if (!Array.isArray(data)) return [];
  return data.slice(0, 8).map((item: any) => ({
    symbol:   String(item.symbol ?? ''),
    name:     String(item.shortname ?? item.longname ?? item.symbol ?? ''),
    exchange: String(item.exchange ?? item.quoteType ?? ''),
  })).filter((r: any) => r.symbol.length > 0);
}

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
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const results = await searchStocks(query);
        setSearchResults(results);
        if (results.length === 0) setSearchError('No results found');
      } catch (e: any) {
        setSearchError('Search failed — check your connection');
      } finally {
        setIsSearching(false);
      }
    }, 400);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [query]);

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

    const config = buildConfigFromPreset(preset, parsedCapital, instrument, timeframe);

    onStart({
      symbol:           selectedStock!.symbol,
      config,
      capital:          parsedCapital,
      timeframeMinutes: timeframe,
      minConfidence,
      techniquesList,
      techFileName,
    });
  }, [selectedStock, capitalInput, preset, instrument, timeframe, minConfidence, techniquesList, techFileName, onStart]);

  const previewConfig = buildConfigFromPreset(preset, Number(capitalInput) || 100000, instrument, timeframe);

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
              <div className="absolute top-full left-0 right-0 bg-gray-800 border border-gray-600 rounded mt-1 max-h-48 overflow-y-auto z-10">
                {searchResults.map(res => (
                  <button 
                    key={res.symbol}
                    onClick={() => handleSelectStock(res)}
                    className="w-full text-left p-2 hover:bg-gray-700 border-b border-gray-700 last:border-0"
                  >
                    <div className="font-bold text-sm">{res.symbol}</div>
                    <div className="text-xs text-gray-400 truncate">{res.name} | {res.exchange}</div>
                  </button>
                ))}
              </div>
            )}
            {searchError && <div className="text-red-400 text-sm mt-1">{searchError}</div>}
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
