import { TradeOutcome, ScalpConfig } from '../types';

export interface BacktestTrade {
  id:               string;
  entryTime:        number;       // ms epoch of entry candle
  exitTime:         number | null;
  entryPrice:       number;
  exitPrice:        number | null;
  outcome:          Extract<TradeOutcome, 'SL_HIT' | 'TP2_HIT' | 'TIME_EXIT' | 'BREAK_EVEN'> | null;
  tp1Hit:           boolean;      // true if TP1 partial (50%) was booked before final exit
  pnl:              number;       // ₹, net, combined across both legs if TP1 was hit
  rMultiple:        number;
  durationMinutes:  number;
  bullScore:        number;
  bearScore:        number;
  margin:           number;       // bullScore - bearScore at signal time
  j1Score:          number;
  j2Score:          number;
  j3Score:          number;
  j4Verdict:        'ACCEPT' | 'CAUTION' | 'WEAK';
  j4PenaltyPct:     number;
  patternNames:     string;       // comma-joined bull patterns that fired, or 'NONE'
  atrAtEntry:        number;
  atrPercentile:     number;      // 0-100, this trade's ATR14 vs the trailing analysis window
  entryTimeBucket:   'OPEN' | 'MID' | 'CLOSE';
  dayOfWeek:         string;
  mfeR:              number;      // max favorable excursion in R, entry to final exit
  maeR:              number;      // max adverse excursion in R, entry to final exit
  lossReason:        'IMMEDIATE_REVERSAL' | 'PARTIAL_MOVE_REVERSAL' | 'POST_TP1_GIVEBACK' | null; // null for winning trades
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
  logs?:              string[];   // Detailed backtest event log
}

export interface BacktestConfig {
  symbol:            string;
  marginThreshold:   number;      // default 2.5
  maxTradesPerDay:   number;      // default 5
  warmupCandles:     number;      // default 30
  scalpConfig:       ScalpConfig; // reused for SL/TP and position sizing
  techniquesList:    any[];       // same uploaded techniques as the live bot, [] if none
}
