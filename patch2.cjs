const fs = require('fs');

let typesContent = fs.readFileSync('src/types/backtest.ts', 'utf8');
if (!typesContent.includes('export interface PortfolioState')) {
  let typesAppend = `
export interface OpenPosition {
  id: string;
  symbol: string;
  entryTime: number;
  entryPrice: number;
  positionSize: number;
  riskPerShare: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp1Hit: boolean;
  tp1Qty: number;
  remainderQty: number;
  tp1ExitPrice: number;
  currentStop: number;
  runningMaxHigh: number;
  runningMinLow: number;
  investmentAmount: number;
  breakEvenPrice: number;
  tradeContext: Partial<BacktestTrade>;
  instrument: string;
  useFixedRR: boolean;
  useTrailAfterTP1: boolean;
  trailDistanceR: number;
}

export interface PortfolioState {
  initialCapital: number;
  availableCash: number;
  realizedPnL: number;
  totalInvestedCapital: number;
  openPositions: OpenPosition[];
}
`;
  fs.writeFileSync('src/types/backtest.ts', typesContent + typesAppend, 'utf8');
}

let backtestEngine = fs.readFileSync('src/quant/backtestEngine.ts', 'utf8');
backtestEngine = backtestEngine.replace(
  "import { BacktestConfig, BacktestResult, BacktestTrade } from '../types/backtest';",
  "import { BacktestConfig, BacktestResult, BacktestTrade, PortfolioState, OpenPosition } from '../types/backtest';"
);
backtestEngine = backtestEngine.replace(/decision\.bearJ1/g, "decision.cases.bear.j1");
backtestEngine = backtestEngine.replace(/decision\.bearJ2/g, "decision.cases.bear.j2");

fs.writeFileSync('src/quant/backtestEngine.ts', backtestEngine, 'utf8');
