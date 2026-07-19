import fs from 'fs';
import path from 'path';
import { runBacktest } from './src/quant/backtestEngine';
import { BacktestConfig } from './src/types/backtest';
import { getDefaultScalpConfig } from './src/config/scalpConfig';
import { OHLCV } from './src/types';
import { getISTMinutes } from './src/utils/istUtils';

const MARKET_OPEN_IST_MINUTES  = 9 * 60 + 15;  // 555
const MARKET_CLOSE_IST_MINUTES = 15 * 60 + 30; // 930

const POPULAR_STOCKS = [
  { symbol: 'TATASTEEL:NSE',  name: 'Tata Steel' },
  { symbol: 'ITC:NSE',        name: 'ITC Ltd' },
  { symbol: 'POWERGRID:NSE',  name: 'Power Grid Corp' },
  { symbol: 'LTF:NSE',        name: 'L&T Finance' },
  { symbol: 'PETRONET:NSE',   name: 'Petronet LNG' },
  { symbol: 'NATIONALUM:NSE', name: 'National Aluminium' },
  { symbol: 'IEX:NSE',        name: 'Indian Energy Exchange' },
  { symbol: 'CESC:NSE',       name: 'CESC Ltd' },
  { symbol: 'FEDERALBNK:NSE', name: 'Federal Bank' },
];

function fetchBacktestHistoryLocal(symbol: string): OHLCV[] {
  const ticker = symbol.split(':')[0];
  const filePath = path.join(process.cwd(), 'public', 'backtest-data', `${ticker}.json`);
  const text = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(text);
  const result = json?.chart?.result?.[0];
  if (!result) {
    throw new Error(`No chart result found for ${ticker}`);
  }

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) {
    throw new Error(`Empty quote data for ${ticker}`);
  }

  const opens   = quote.open   as (number | null)[];
  const highs   = quote.high   as (number | null)[];
  const lows    = quote.low    as (number | null)[];
  const closes  = quote.close  as (number | null)[];
  const volumes = quote.volume as (number | null)[];

  const candles: OHLCV[] = [];
  for (let j = 0; j < timestamps.length; j++) {
    const o = opens[j], h = highs[j], l = lows[j], c = closes[j];
    if (o == null || h == null || l == null || c == null) continue;
    if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    if (c <= 0) continue;

    const timestampMs = timestamps[j] * 1000;
    const istMinutes = getISTMinutes(timestampMs);
    if (istMinutes < MARKET_OPEN_IST_MINUTES || istMinutes > MARKET_CLOSE_IST_MINUTES) {
      continue;
    }

    candles.push({
      open:   Number(o.toFixed(2)),
      high:   Number(h.toFixed(2)),
      low:    Number(l.toFixed(2)),
      close:  Number(c.toFixed(2)),
      volume: Number(volumes?.[j] ?? 0),
      timestamp: timestampMs,
    });
  }

  candles.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  return candles;
}

async function runAll() {
  console.log("Pre-fetching candles...");
  const allStockCandles: Record<string, OHLCV[]> = {};
  for (const stock of POPULAR_STOCKS) {
    allStockCandles[stock.symbol] = fetchBacktestHistoryLocal(stock.symbol);
  }

  console.log("Building composite market series...");
  const byTimestamp: Record<number, number[]> = {};
  for (const symbol of Object.keys(allStockCandles)) {
    for (const c of allStockCandles[symbol]) {
      const ret = c.open ? (c.close - c.open) / c.open : 0;
      if (!byTimestamp[c.timestamp!]) byTimestamp[c.timestamp!] = [];
      byTimestamp[c.timestamp!].push(ret);
    }
  }

  const FLAT_THRESHOLD = 0.0005;
  const compositeSeries = new Map<number, 'UP' | 'DOWN' | 'FLAT'>();
  for (const [ts, rets] of Object.entries(byTimestamp)) {
    const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
    compositeSeries.set(Number(ts), avg > FLAT_THRESHOLD ? 'UP' : avg < -FLAT_THRESHOLD ? 'DOWN' : 'FLAT');
  }

  let output = '';
  for (const stock of POPULAR_STOCKS) {
    console.log(`Running backtest for ${stock.symbol}...`);
    const stockCandles = allStockCandles[stock.symbol];
    const config: BacktestConfig = {
      symbol: stock.symbol,
      marginThreshold: 2.5,
      maxTradesPerDay: Infinity,
      warmupCandles: 30,
      scalpConfig: getDefaultScalpConfig(),
      techniquesList: [],
      exitMode: 'DYNAMIC',
      fixedRRRatio: 2.0,
      fixedSLPct: 0.5,
      fixedTPPct: 1.0,
      compositeSeries,
    };

    const res = runBacktest(stockCandles, config);
    output += `=== BACKTEST LOGS FOR ${stock.symbol} ===\n`;
    output += res.logs.join('\n') + '\n\n';
  }

  fs.mkdirSync('/home/user/analysis', { recursive: true });
  fs.writeFileSync('/home/user/analysis/backtest_log.txt', output);
  console.log("Backtest logs written to /home/user/analysis/backtest_log.txt successfully!");
}

runAll().catch(err => {
  console.error("Error running backtests:", err);
  process.exit(1);
});
