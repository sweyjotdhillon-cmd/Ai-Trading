const fs = require('fs');

let typesContent = fs.readFileSync('src/types/backtest.ts', 'utf8');
typesContent = typesContent.replace('requestedInvestment?: number;', 'requestedInvestment?: number;\n  actualInvestment?: number;\n  availableCashBefore?: number;\n  availableCashAfter?: number;\n  allocationPct?: number;');
typesContent = typesContent.replace('export interface BacktestResult {', 'export interface BacktestResult {\n  initialCapital?: number;\n  finalCapital?: number;\n  availableCash?: number;\n  totalInvestedCapital?: number;\n  openPositionValue?: number;\n  unrealizedPnL?: number;');
typesContent = typesContent.replace('export interface BacktestConfig {', 'export interface BacktestConfig {\n  initialCapital?: number;');

// Since I appended OpenPosition at the end and it might have redefined it, let's fix instrument type in OpenPosition
typesContent = typesContent.replace('instrument: string;', "instrument: import('../types').ScalpInstrument;");

fs.writeFileSync('src/types/backtest.ts', typesContent, 'utf8');

let backtestEngine = fs.readFileSync('src/quant/backtestEngine.ts', 'utf8');
backtestEngine = backtestEngine.replace('const compositeDir = config.compositeSeries?.get(signalCandle.timestamp) ?? \'N/A\';', 'const compositeDir = config.compositeSeries?.get(signalCandle.timestamp ?? 0) ?? \'N/A\';');
fs.writeFileSync('src/quant/backtestEngine.ts', backtestEngine, 'utf8');
