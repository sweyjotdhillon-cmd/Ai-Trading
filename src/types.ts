export interface AutopsyCategory {
  severity: 0 | 1 | 2 | 3;
  label: string;
  explanation: string;
}

export interface AutopsyResult {
  tradeSignal: 'LONG' | 'NO_TRADE';
  actualOutcome: string;
  contrarianSignal?: 'LONG' | 'NO_TRADE';
  contrarianConfidence: number;
  contrarianRuling: string;
  rebutScores: {
    originalJudge:   { j1: number; j2: number; j4: number; total: number; winner: 'BULL'|'BEAR'|'NO_TRADE' };
    contrarianJudge: { j1: number; j2: number; j4: number; total: number; winner: 'BULL'|'BEAR' };
  };
  judgeFlaws: string[];
  categories: Record<string, AutopsyCategory>;
  primaryRootCause: string[];
  systemRecommendation: string;
  autopsyVerdict: string;
}

export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AgentResult {
  reasoning: string;
  confidence: number;
  occlusionResult?: string;
}

export interface JudgeVerdict {
  winner: 'BULL' | 'BEAR' | 'NO_TRADE';
  finalConfidence: number;
  ruling: string;
  bullArgumentQuality: number;
  bearArgumentQuality: number;
  symmetryScore?: number;
  physicsConsistencyScore?: number;
  nextCandleGating?: {
    confirmationCriteria: string;
    invalidationCriteria: string;
  };
  tradeDetails: Partial<TradeAnalysis>;
}

export interface Technique {
  id: string;
  name: string;
  description: string;
  code?: string;
}

export interface StockNoteEntry {
  id: string;
  analysis: string;
  createdAt: number;
}

export interface StockNote {
  uid: string;
  stock: string;
  notes: string;
  entries?: StockNoteEntry[];
  points?: number;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: number;
}

export interface SystemSettings {
  aiAccessMode: boolean;
  aiAccessModeEnabledAt: number | null;
}

export interface StructuredInsight {
  setupType: string;
  marketCondition: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'UNKNOWN';
  keyLevels: string[];
  whatWorked: string[];
  whatFailed: string[];
  finalLesson: string;
  qualityScore: number;
}

export interface BehaviorProfile {
  currentStreak: number;
  maxStreak: number;
  totalWins: number;
  totalLosses: number;
  lastResult: 'WIN' | 'LOSS' | null;
  commonMistakes: Record<string, number>;
}

export interface TradeAnalysis extends TradeAnalysisScalpAddon {
  executionTimeMs?: number;
  predictedDirection?: 'LONG' | 'NO_TRADE';
  actualDirection?: 'LONG' | 'FLAT';
  id: string;
  uid: string;


  timestamp: string;
  stock: string;
  signal: 'LONG' | 'NO_TRADE';
  market: 'CLEAN' | 'DEAD' | 'CHAOTIC';
  strength?: 'WEAK' | 'MODERATE' | 'STRONG';
  entry: 'NOW' | 'WAIT';
  probability: number;
  graphTimeframe?: string;
  result?: 'WIN' | 'LOSS';
  followedRules?: boolean;
  mistakeType?: 'late entry' | 'bad market' | 'overtrade' | 'none';
  notes?: string;
  analysisText: string; // Compressed raw AI response
  structuredInsight?: StructuredInsight; // The "SIO"
  bigInsight?: string;
  techniquesUsed?: string;
  repoPatternsDetected?: string;
  repoPatternCount?: number;
  notesUsed?: string;
  investmentAmount?: number;
  profitAmount?: number;
  lossAmount?: number;
  accountType?: 'REAL' | 'DEMO';
  expiresAt?: number;
  embedding?: number[];
  reason?: string;
  suggestedTrades?: number;
  framingType?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

// ─── Scalping types ──────────────────────────────────────────
export type ScalpSignal = 'LONG' | 'BUY' | 'NO_TRADE' | 'WAIT' | 'EXIT';

export type SLMode = 'ATR' | 'PERCENT' | 'STRUCTURE' | 'AUTO';
export type TPMode = 'RR' | 'ATR' | 'PARTIAL_RR';

export type TradeOutcome =
  | 'TP1_HIT' | 'TP2_HIT' | 'SL_HIT'
  | 'TIME_EXIT' | 'BREAK_EVEN' | 'TRAIL_HIT'
  | 'MANUAL_EXIT' | 'OPEN';

export type ScalpInstrument = 'EQUITY_INTRADAY' | 'EQUITY_DELIVERY' | 'INDEX_FUT' | 'STOCK_FUT' | 'INDEX_OPT';

export interface ScalpingPlan {
  entry: number;
  stopLoss: number;
  takeProfit1: number;          // 50% partial book
  takeProfit2: number;          // final exit
  trailingActivate: number;     // = takeProfit1 by default
  trailingDistance: number;     // = atr14 × trailMultiplier
  breakEvenAfter: number;       // = takeProfit1 (SL moves to entry after TP1)
  positionSize: number;         // shares OR lots×lotSize
  riskRupees: number;           // ₹ at risk = (entry-SL) × size
  potentialRewardRupees: number;// gross reward to TP2 in ₹
  rrRatio: number;              // TP2_R / SL_R (always positive, 1.0–4.0)
  maxHoldingMinutes: number;
  confluenceScore: number;      // 0–10
  brokerCharges: number;        // total round-trip estimate ₹
  netExpectedPnL: number;       // potentialRewardRupees − brokerCharges
  slMode: SLMode;
  tpMode: TPMode;
  instrument: ScalpInstrument;
  noteReasons: string[];        // human-readable confluence/blocker reasons
}

export interface PathEvent {
  barIndex: number;
  price: number;
  event: 'ENTRY' | 'TP1' | 'TP2' | 'SL' | 'TRAIL_UPDATE' | 'BE_SHIFT' | 'TIME_OUT';
  newSL?: number;
}

export interface ScalpSimResult {
  outcome: TradeOutcome;
  realizedPnL: number;          // ₹, net OR gross — see flag ENABLE_BROKER_CHARGES_NET
  realizedPnLGross: number;
  brokerCharges: number;
  events: PathEvent[];
  exitPrice: number;
  exitBarIndex: number;
  rMultiple: number;            // realized / risk
}

export interface ScalpFeatures {
  bullEngulfingAtSupport: boolean;
  hammerAtSupport: boolean;
  macdBullishDivergence: boolean;
  ema9_above_ema21: boolean;
  ema9_slope_up: boolean;
  adx_above_20: boolean;
  plusDI_dominant: boolean;
  adx_above_25: boolean;
  minusDI_dominant: boolean;
  bos_bull: boolean;
  choch_bull: boolean;
  rsi_recovering_from_oversold: boolean;
  volatility_normal: boolean;
  price_above_vwap: boolean;     // vwap-proxy (HLC/3 rolling)
  bear_engulfing_recent: boolean;
  predictabilityPassed: boolean;
  withinMarketHours: boolean;
}

export interface RiskState {
  dailyPnL: number;
  tradesToday: number;
  consecutiveLosses: number;
  lastTradeAt: number;          // ms epoch
  inCooldown: boolean;
  cooldownUntil: number;        // ms epoch
  dateKey: string;              // 'YYYY-MM-DD' IST — rolls over at midnight
}

export interface RiskConfig {
  dailyLossCapRupees: number;   // default 2000
  maxTradesPerDay: number;      // default 5
  maxConsecutiveLosses: number; // default 3
  cooldownMinutes: number;      // default 10
  slippageTicks: number;        // default 1
}

export interface ScalpConfig {
  // Capital
  capitalRupees: number;        // default 100000
  riskPerTradePct: number;      // default 1.0
  maxPositionPctCapital: number;// default 30
  leverage: number;             // default 1
  instrument: ScalpInstrument;  // default EQUITY_INTRADAY
  lotSize: number;              // default 1 (auto from symbol if INDEX_FUT)
  // SL / TP
  slMode: SLMode;               // default 'AUTO'
  atrMultiplierSL: number;      // default 1.2
  slPercent: number;            // default 0.4
  tpMode: TPMode;               // default 'PARTIAL_RR'
  rrRatio: number;              // default 2.0
  tp1RMultiple: number;         // default 1.0
  trailMultiplier: number;      // default 1.5
  // Filters
  minConfluence: number;        // default 5
  minRR: number;                // default 1.5
  longOnly: boolean;            // default true (no-op flag, always true in scalping mode)
  enableMarketHoursGate: boolean;
  enablePredictabilityGate: boolean;
  // Risk caps
  risk: RiskConfig;
  // Hold
  maxHoldingMinutes: number;    // default 5
}

// Extend TradeAnalysis non-breakingly
export interface TradeAnalysisScalpAddon {
  scalpingPlan?: ScalpingPlan;
  exitReason?: TradeOutcome;
  actualExitPrice?: number;
  realizedPnL?: number;
  pathEvents?: PathEvent[];
  scalpSignal?: ScalpSignal;
}
