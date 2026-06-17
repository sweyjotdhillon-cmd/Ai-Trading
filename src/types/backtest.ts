import { TradeOutcome, ScalpConfig } from '../types';

export interface BacktestTrade {
  id:               string;
  entryTime:        number;       // ms epoch of entry candle
  exitTime:         number | null;
  entryPrice:       number;
  exitPrice:        number | null;
  outcome:          Extract<TradeOutcome, 'SL_HIT' | 'TP2_HIT' | 'TIME_EXIT'> | null;
  pnl:              number;       // ₹, gross
  rMultiple:        number;
  durationMinutes:  number;
  bullScore:        number;
  bearScore:        number;
  margin:           number;       // bullScore - bearScore at signal time
}

export interface BacktestResult {
  symbol:             string;
  timeframeMinutes:   number;
  totalCandlesUsed:   number;
  trades:             BacktestTrade[];
  totalTrades:        number;
  wins:               number;
  losses:             number;
  winRate:            number;     // 0–1
  totalPnL:           number;
  avgRMultiple:       number;
  maxDrawdown:        number;     // ₹, always >= 0
  maxConsecutiveLosses: number;
  avgDurationMinutes: number;
  startDate:          string;     // IST date string of first candle used
  endDate:            string;     // IST date string of last candle used
}

export interface BacktestConfig {
  symbol:            string;
  marginThreshold:   number;      // default 2.5
  maxTradesPerDay:   number;      // default 2
  warmupCandles:     number;      // default 30
  scalpConfig:       ScalpConfig; // reused for SL/TP and position sizing
  techniquesList:    any[];       // same uploaded techniques as the live bot, [] if none
}
