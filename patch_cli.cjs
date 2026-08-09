const fs = require('fs');

let cli = fs.readFileSync('runBacktestsCli.ts', 'utf8');

cli = cli.replace(
  "import { runBacktest } from './src/quant/backtestEngine';",
  "import { runBacktest, runPortfolioBacktest } from './src/quant/backtestEngine';"
);

const oldRunLoop = `  let output = \`[BUILD_VERSION] commit=\${gitCommit} generatedAt=\${new Date().toISOString()} useFixedRR=true useTrailAfterTP1=false rrRatio=2.5\\n\\n\`;
  for (const stock of POPULAR_STOCKS) {
    console.log(\`Running backtest for \${stock.symbol}...\`);
    const stockCandles = allStockCandles[stock.symbol];

    const scalpConfig = getDefaultScalpConfig();
    scalpConfig.useFixedRR = true;
    scalpConfig.useTrailAfterTP1 = false;
    scalpConfig.rrRatio = 2.5;

    const config: BacktestConfig = {
      symbol: stock.symbol,
      marginThreshold: 2.5,
      maxTradesPerDay: Infinity,
      warmupCandles: 30,
      scalpConfig,
      techniquesList: [],
      exitMode: 'DYNAMIC',
      fixedRRRatio: 2.0,
      fixedSLPct: 0.5,
      fixedTPPct: 1.0,
      compositeSeries,
    };

    const res = runBacktest(stockCandles, config);
    output += \`=== BACKTEST LOGS FOR \${stock.symbol} ===\\n\`;
    output += res.logs.join('\\n') + '\\n\\n';
  }`;

const newRunLoop = `  let output = \`[BUILD_VERSION] commit=\${gitCommit} generatedAt=\${new Date().toISOString()} useFixedRR=true useTrailAfterTP1=false rrRatio=2.5\\n\\n\`;

  console.log(\`Running portfolio backtest across \${POPULAR_STOCKS.length} stocks...\`);

  const scalpConfig = getDefaultScalpConfig();
  scalpConfig.useFixedRR = true;
  scalpConfig.useTrailAfterTP1 = false;
  scalpConfig.rrRatio = 2.5;

  const config: BacktestConfig = {
    symbol: 'ALL_STOCKS',
    initialCapital: 100000,
    marginThreshold: 2.5,
    maxTradesPerDay: Infinity,
    warmupCandles: 30,
    scalpConfig,
    techniquesList: [],
    exitMode: 'DYNAMIC',
    fixedRRRatio: 2.0,
    fixedSLPct: 0.5,
    fixedTPPct: 1.0,
    compositeSeries,
  };

  const res = runPortfolioBacktest(allStockCandles, config);
  output += \`=== PORTFOLIO BACKTEST LOGS ===\\n\`;
  if (res.logs) {
    output += res.logs.join('\\n') + '\\n\\n';
  }`;

cli = cli.replace(oldRunLoop, newRunLoop);

fs.writeFileSync('runBacktestsCli.ts', cli, 'utf8');
