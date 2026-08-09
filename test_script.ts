import { runPortfolioBacktest } from './src/quant/backtestEngine';
import { BacktestConfig } from './src/types/backtest';
import { OHLCV } from './src/types';

// Mock ruleEngine and indicators in vitest but here we just trace it manually
// I will just use vitest but add console.log in the test
