import fs from 'fs';
import path from 'path';
import { runBacktest } from './src/quant/backtestEngine';
import { BacktestConfig, BacktestTrade } from './src/types/backtest';
import { getDefaultScalpConfig } from './src/config/scalpConfig';
import { OHLCV } from './src/types';
import { getISTMinutes, getISTDateString } from './src/utils/istUtils';
import { featureFlags } from './src/config/featureFlags';

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

interface BucketStats {
  tradeCount: number;
  winRate: number;
  avgPnL: number;
  avgR: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalPnL: number;
}

function computeBucketStats(trades: BacktestTrade[]): BucketStats {
  const tradeCount = trades.length;
  if (tradeCount === 0) {
    return {
      tradeCount: 0,
      winRate: 0,
      avgPnL: 0,
      avgR: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      totalPnL: 0
    };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
  const winRate = wins.length / tradeCount;
  const avgPnL = totalPnL / tradeCount;
  const avgR = trades.reduce((sum, t) => sum + t.rMultiple, 0) / tradeCount;

  const totalWinPnL = wins.reduce((sum, t) => sum + t.pnl, 0);
  const totalLossPnL = losses.reduce((sum, t) => sum + t.pnl, 0);

  const avgWin = wins.length > 0 ? totalWinPnL / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLossPnL / losses.length : 0;

  const profitFactor = Math.abs(totalLossPnL) > 0 ? totalWinPnL / Math.abs(totalLossPnL) : (totalWinPnL > 0 ? Infinity : 0);

  return {
    tradeCount,
    winRate,
    avgPnL,
    avgR,
    avgWin,
    avgLoss,
    profitFactor,
    totalPnL
  };
}

async function runAnalysis() {
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

  // Gather and sort all unique IST trading days across all candles
  console.log("Determining trading days...");
  const allDatesSet = new Set<string>();
  for (const symbol of Object.keys(allStockCandles)) {
    for (const c of allStockCandles[symbol]) {
      const dateStr = getISTDateString(c.timestamp ?? 0);
      allDatesSet.add(dateStr);
    }
  }
  const sortedDates = Array.from(allDatesSet).sort((a, b) => {
    return new Date(a).getTime() - new Date(b).getTime();
  });

  console.log(`Total unique trading days found: ${sortedDates.length}`);
  const devDates = new Set(sortedDates.slice(0, 40));
  const holdoutDates = new Set(sortedDates.slice(40));

  console.log(`Development window: ${sortedDates[0]} to ${sortedDates[39]} (${devDates.size} days)`);
  if (sortedDates.length > 40) {
    console.log(`Holdout window: ${sortedDates[40]} to ${sortedDates[sortedDates.length - 1]} (${holdoutDates.size} days)`);
  } else {
    console.log("Warning: Not enough trading days to make a full 20-day holdout window!");
  }

  // Force disable the gate to run baseline and generate slices
  featureFlags.enableATRCompressionBreakoutGate = false;

  // We will collect all trades for analysis
  const runBaselineForThreshold = (compressionPctile: number): BacktestTrade[] => {
    const allTrades: BacktestTrade[] = [];
    for (const stock of POPULAR_STOCKS) {
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
        atrCompressionPctileMax: compressionPctile,
        microRangeLookback: 8,
      };
      const res = runBacktest(allStockCandles[stock.symbol], config);
      for (const t of res.trades) {
        t.symbol = stock.symbol; // Ensure symbol is attached
        allTrades.push(t);
      }
    }
    return allTrades;
  };

  console.log("\n--- RUNNING BASELINE SIMULATION (Threshold = 30) ---");
  const baselineTrades = runBaselineForThreshold(30);

  // Helper to split trades into Dev and Holdout windows
  const splitTrades = (trades: BacktestTrade[]) => {
    const dev: BacktestTrade[] = [];
    const holdout: BacktestTrade[] = [];
    for (const t of trades) {
      const dateStr = getISTDateString(t.entryTime);
      if (devDates.has(dateStr)) {
        dev.push(t);
      } else if (holdoutDates.has(dateStr)) {
        holdout.push(t);
      }
    }
    return { dev, holdout };
  };

  const { dev: devBaseline, holdout: holdoutBaseline } = splitTrades(baselineTrades);

  // Slices for threshold 30
  const getBuckets = (trades: BacktestTrade[]) => {
    const baseline = trades;
    const compression_only = trades.filter(t => t.gateIsCompressed === true);
    const breakout_only = trades.filter(t => t.gateIsBreakout === true);
    const compression_and_breakout = trades.filter(t => t.gateIsCompressed === true && t.gateIsBreakout === true);
    const non_compression_breakout = trades.filter(t => t.gateIsBreakout === true && t.gateIsCompressed === false);

    return {
      baseline,
      compression_only,
      breakout_only,
      compression_and_breakout,
      non_compression_breakout
    };
  };

  const devBuckets = getBuckets(devBaseline);
  const holdoutBuckets = getBuckets(holdoutBaseline);

  // Print results
  let report = "============================================================\n";
  report += "                ATR COMPRESSION BREAKOUT ANALYSIS\n";
  report += "============================================================\n\n";

  report += "1. CONFIGURATION SUMMARY:\n";
  report += `- Development Window: ${sortedDates[0]} to ${sortedDates[39]} (${devDates.size} days)\n`;
  report += `- Holdout Window:     ${sortedDates[40] || 'N/A'} to ${sortedDates[sortedDates.length - 1] || 'N/A'} (${holdoutDates.size} days)\n`;
  report += "- Candidates & Parameters:\n";
  report += "  - MICRO_RANGE_LOOKBACK = 8 (prior candles closed before signal)\n";
  report += "  - ATR_COMPRESSION_PCTILE_MAX = 30% (for core candidate)\n\n";

  report += "2. METRIC TABLES BY BUCKET AND WINDOW (Threshold = 30%)\n";
  report += "------------------------------------------------------------\n";

  const renderTable = (windowName: string, buckets: Record<string, BacktestTrade[]>) => {
    let s = `--- ${windowName.toUpperCase()} WINDOW METRICS ---\n`;
    s += String("Bucket").padEnd(26) + " | Count | WinRate | AvgPnL   | AvgR   | AvgWin   | AvgLoss  | ProfFactor | TotalPnL\n";
    s += "-".repeat(110) + "\n";
    for (const [name, list] of Object.entries(buckets)) {
      const stats = computeBucketStats(list);
      s += `${name.padEnd(26)} | ` +
           `${String(stats.tradeCount).padStart(5)} | ` +
           `${(stats.winRate * 100).toFixed(1).padStart(6)}% | ` +
           `₹${stats.avgPnL.toFixed(0).padStart(7)} | ` +
           `${stats.avgR.toFixed(2).padStart(6)} | ` +
           `₹${stats.avgWin.toFixed(0).padStart(7)} | ` +
           `₹${stats.avgLoss.toFixed(0).padStart(7)} | ` +
           `${stats.profitFactor === Infinity ? 'Infinity'.padStart(10) : stats.profitFactor.toFixed(2).padStart(10)} | ` +
           `₹${stats.totalPnL.toFixed(0).padStart(8)}\n`;
    }
    s += "\n";
    return s;
  };

  report += renderTable("Development (First 40 Days)", devBuckets);
  report += renderTable("Holdout (Last 20 Days)", holdoutBuckets);

  report += "3. SENSITIVITY CHECK (MICRO_RANGE_LOOKBACK = 8, Holdout Window)\n";
  report += "------------------------------------------------------------\n";
  report += "Threshold | Count | WinRate | AvgPnL   | AvgR   | AvgWin   | AvgLoss  | ProfFactor | TotalPnL\n";
  report += "-".repeat(110) + "\n";

  const thresholds = [20, 25, 30, 35];
  const sensResults: Record<number, BucketStats> = {};

  for (const pct of thresholds) {
    const tradesForPct = runBaselineForThreshold(pct);
    const { holdout: holdoutTradesForPct } = splitTrades(tradesForPct);
    const candTrades = holdoutTradesForPct.filter(t => t.gateIsCompressed === true && t.gateIsBreakout === true);
    const stats = computeBucketStats(candTrades);
    sensResults[pct] = stats;

    report += `${String(pct).padStart(9)} | ` +
         `${String(stats.tradeCount).padStart(5)} | ` +
         `${(stats.winRate * 100).toFixed(1).padStart(6)}% | ` +
         `₹${stats.avgPnL.toFixed(0).padStart(7)} | ` +
         `${stats.avgR.toFixed(2).padStart(6)} | ` +
         `₹${stats.avgWin.toFixed(0).padStart(7)} | ` +
         `₹${stats.avgLoss.toFixed(0).padStart(7)} | ` +
         `${stats.profitFactor === Infinity ? 'Infinity'.padStart(10) : stats.profitFactor.toFixed(2).padStart(10)} | ` +
         `₹${stats.totalPnL.toFixed(0).padStart(8)}\n`;
  }
  report += "\n";

  report += "4. HOLDOUT SYMBOL BREAKDOWN (compression_and_breakout @ 30%)\n";
  report += "------------------------------------------------------------\n";
  report += "Symbol".padEnd(20) + " | Count | WinRate | AvgPnL   | AvgR   | TotalPnL\n";
  report += "-".repeat(70) + "\n";

  const holdoutCandTrades = holdoutBuckets.compression_and_breakout;
  const symbols = Array.from(new Set(holdoutCandTrades.map(t => t.symbol)));
  for (const sym of symbols) {
    const symTrades = holdoutCandTrades.filter(t => t.symbol === sym);
    const stats = computeBucketStats(symTrades);
    report += `${sym!.padEnd(20)} | ` +
         `${String(stats.tradeCount).padStart(5)} | ` +
         `${(stats.winRate * 100).toFixed(1).padStart(6)}% | ` +
         `₹${stats.avgPnL.toFixed(0).padStart(7)} | ` +
         `${stats.avgR.toFixed(2).padStart(6)} | ` +
         `₹${stats.totalPnL.toFixed(0).padStart(8)}\n`;
  }
  report += "\n";

  report += "5. HOLDOUT DAILY BREAKDOWN (compression_and_breakout @ 30%)\n";
  report += "------------------------------------------------------------\n";
  report += "Date".padEnd(15) + " | Count | WinRate | AvgPnL   | TotalPnL\n";
  report += "-".repeat(55) + "\n";

  const dates = Array.from(new Set(holdoutCandTrades.map(t => getISTDateString(t.entryTime)))).sort();
  for (const date of dates) {
    const dateTrades = holdoutCandTrades.filter(t => getISTDateString(t.entryTime) === date);
    const stats = computeBucketStats(dateTrades);
    report += `${date.padEnd(15)} | ` +
         `${String(stats.tradeCount).padStart(5)} | ` +
         `${(stats.winRate * 100).toFixed(1).padStart(6)}% | ` +
         `₹${stats.avgPnL.toFixed(0).padStart(7)} | ` +
         `₹${stats.totalPnL.toFixed(0).padStart(8)}\n`;
  }
  report += "\n";

  // Compute decision verdict
  report += "6. DECISION VERDICT & ANALYTICAL ASSESSMENT:\n";
  report += "------------------------------------------------------------\n";

  const baselineHoldoutStats = computeBucketStats(holdoutBuckets.baseline);
  const candHoldoutStats = computeBucketStats(holdoutBuckets.compression_and_breakout);

  report += `- Baseline Holdout Trades: ${baselineHoldoutStats.tradeCount} | Win Rate: ${(baselineHoldoutStats.winRate * 100).toFixed(1)}% | Avg PnL: ₹${baselineHoldoutStats.avgPnL.toFixed(0)} | Avg R: ${baselineHoldoutStats.avgR.toFixed(2)} | Total PnL: ₹${baselineHoldoutStats.totalPnL.toFixed(0)}\n`;
  report += `- Candidate Holdout Trades: ${candHoldoutStats.tradeCount} | Win Rate: ${(candHoldoutStats.winRate * 100).toFixed(1)}% | Avg PnL: ₹${candHoldoutStats.avgPnL.toFixed(0)} | Avg R: ${candHoldoutStats.avgR.toFixed(2)} | Total PnL: ₹${candHoldoutStats.totalPnL.toFixed(0)}\n\n`;

  let verdict = "FAIL";
  const pnlImproved = candHoldoutStats.avgPnL > baselineHoldoutStats.avgPnL;
  const rImproved = candHoldoutStats.avgR > baselineHoldoutStats.avgR;
  const lossSizeImproved = Math.abs(candHoldoutStats.avgLoss) < Math.abs(baselineHoldoutStats.avgLoss);
  const countTooLow = candHoldoutStats.tradeCount < 40;

  report += `Evaluation Checks (Pass Criteria):\n`;
  report += `- Avg PnL per trade improves: ${pnlImproved ? 'PASS' : 'FAIL'} (₹${candHoldoutStats.avgPnL.toFixed(0)} vs ₹${baselineHoldoutStats.avgPnL.toFixed(0)})\n`;
  report += `- Avg R per trade improves:   ${rImproved ? 'PASS' : 'FAIL'} (${candHoldoutStats.avgR.toFixed(2)} vs ${baselineHoldoutStats.avgR.toFixed(2)})\n`;
  report += `- Avg losing trade size improves: ${lossSizeImproved ? 'PASS' : 'FAIL'} (₹${candHoldoutStats.avgLoss.toFixed(0)} vs ₹${baselineHoldoutStats.avgLoss.toFixed(0)})\n`;
  report += `- Trade count in holdout is sufficient (>= 40): ${!countTooLow ? 'YES' : 'NO'} (${candHoldoutStats.tradeCount} trades)\n`;

  // Check if either simpler filter captures the full improvement
  const compOnlyStats = computeBucketStats(holdoutBuckets.compression_only);
  const breakOnlyStats = computeBucketStats(holdoutBuckets.breakout_only);
  const compAndBreakBetterThanSimpler = candHoldoutStats.avgPnL > compOnlyStats.avgPnL && candHoldoutStats.avgPnL > breakOnlyStats.avgPnL;
  report += `- Combination outperforms single filters alone: ${compAndBreakBetterThanSimpler ? 'PASS' : 'FAIL'} (Avg PnL: ₹${candHoldoutStats.avgPnL.toFixed(0)} vs CompressionOnly: ₹${compOnlyStats.avgPnL.toFixed(0)}, BreakoutOnly: ₹${breakOnlyStats.avgPnL.toFixed(0)})\n`;

  // Sensitivity stability check
  const sensPass = sensResults[25].avgPnL > 0 && sensResults[30].avgPnL > 0 && sensResults[35].avgPnL > 0;
  report += `- Sensitivity analysis is stable (positive across neighboring thresholds): ${sensPass ? 'PASS' : 'FAIL'}\n\n`;

  if (countTooLow) {
    verdict = "INCONCLUSIVE";
    report += "VERDICT: INCONCLUSIVE (The candidate trade count in the holdout window is under 40, which is too low to prove statistical validity without overfit risk.)\n";
  } else if (pnlImproved && rImproved && lossSizeImproved && compAndBreakBetterThanSimpler && sensPass) {
    verdict = "PASS";
    report += "VERDICT: PASS (The candidate meets all performance, out-of-sample holdout, combination significance, and parameter stability constraints.)\n";
  } else {
    verdict = "FAIL";
    report += "VERDICT: FAIL (The candidate failed one or more critical constraints - see evaluation checks above.)\n";
  }

  console.log(report);

  // Write report to file
  const reportPath = path.join(process.cwd(), 'public', 'compression_breakout_report.txt');
  fs.writeFileSync(reportPath, report);
  console.log(`\nDetailed report written to ${reportPath}`);
}

runAnalysis().catch(err => {
  console.error("Error running analysis script:", err);
  process.exit(1);
});
