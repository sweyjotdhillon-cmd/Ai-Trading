# ChartLens

A high-performance, 100% offline-first quantitative trading simulation engine and paper terminal. It processes clean, text-based market data feeds (structured JSON) through a multi-layered deterministic 4-judge rules engine to support modular portfolio testing, balance syncing, and strict performance metrics in a client-side sandbox environment backed by Firebase Firestore.

ChartLens is designed for speed and reliability, prioritizing a seamless user experience devoid of latency typically associated with server-side processing. By moving the computational heavy lifting to the client, it guarantees maximum responsiveness even on lower-end devices.

---

## Technical Architecture

The architecture of ChartLens is built around a highly optimized, single-page application (SPA) model where the client browser assumes the role of a powerful computational node.

```
                       [ RAW TEXT DATA FEEDS (JSON) ]
                                      │
                                      ▼
                        Chronological Series Ingestion
                                      │
                                      ▼ (Isolated Thread Pool)
              ┌────────────────────────────────────────────────┐
              │             WEB WORKER TASK SCHEDULER          │
              │         (`src/workers/analysisWorker.ts`)      │
              │                                                │
              │    ┌──────────────────┐    ┌────────────────┐  │
              │    │ SERIES PARSING   │    │ 4-JUDGE MATRIX │  │
              │    │ (Float64Array)   │    │ (ruleEngine)   │  │
              │    └────────┬─────────┘    └────────┬───────┘  │
              └─────────────┼───────────────────────┼──────────┘
                            ▼                       ▼
                   [ Temporal Series ]     [ Verdict Decision ]
                   (Rolling Buffers)     (BULL / BEAR / NO_TRADE)
```

### Core Architectural Pillars

- **Isolated Thread Pool**: Heavy math and technical indicator loops compute on dedicated Web Workers (`src/workers/analysisWorker.ts`) to avoid UI render jitter or thread blockages. The main thread remains exclusively responsible for rendering the UI and handling user interactions.
- **GC Optimization**: High-speed backtests operate over contiguous physical memory blocks (`Float64Array` buffers) to bypass normal garbage-collection overhead. This prevents micro-stutters during massive historical data processing.
- **Sync Architecture**: State persistence is driven by a hybrid cache-first scheme matching client storage (IndexedDB) to a fast cloud backup on Firebase Firestore. This ensures that a user's paper trading balance, history, and settings are available across devices without sacrificing the offline-first capability.
- **Throttle Guard**: Incorporates a continuous, low-overhead browser wake-lock mechanism preventing background CPU sleep states on inactive tabs. This is crucial for long-running backtests that might otherwise be suspended by aggressive browser resource management.

---

## Core Directory Map

The codebase is strictly organized to separate concerns between UI, quantitative logic, background processing, and external services.

```
├── src/
│   ├── components/  # Responsive HUDs, dashboards, and portfolio stats models. Contains all React components.
│   ├── quant/       # Indicators, 4-judge matrix, market structure, risk guards. Pure mathematical functions.
│   │   ├── indicators.ts      # ADX (DI+/DI-), RSI, Bollinger Bands, HLC/3 VWAP
│   │   ├── marketStructure.ts # BOS (Break of Structure), CHoCH (Change of Character), and Swing Pivot tracking
│   │   ├── ruleEngine.ts      # Multi-judge validation & scoring invariants. The core decision maker.
│   │   └── riskGuard.ts       # Drawdown controls and cooldown mechanisms to protect paper capital.
│   ├── services/    # Live ticker feeds, historical proxies, and Firestore database bindings.
│   ├── workers/     # Multi-threaded background data tasks (Web Workers).
│   └── utils/       # Timezone mappings (IST) and browser storage adapters.
```

---

## 4-Judge Quantitative Core

Decisions are computed through strict pointwise inequalities inside `ruleEngine.ts`. The system uses a consensus model across four independent "judges" to emit a final trading signal.

### Judge 1 (Candlestick Formations)
Identifies core candle patterns (Engulfing, Pinbars, Hammers) by mapping wick ratios against total height. It assesses the immediate price action rejection at key levels.
$$\text{RejectionRatio} = \frac{|High - \max(Open, Close)|}{High - Low}$$
Requires a $\ge 0.55$ threshold to qualify as wick exhaustion, indicating strong buying or selling pressure.

### Judge 2 (Mathematical Trend Lines)
Monitors core system dynamics using moving averages and standard deviations to establish the current trend vector:
- **EMA Intersections**: Compares short EMA(9) against long EMA(21) to detect momentum shifts.
- **Bollinger Extensions**: Measures rolling standard deviations to identify extreme price borders and expansion/contraction phases.
- **MACD Divergence**: Evaluates rate transitions relative to current price behavior to spot hidden weakness or strength.

### Judge 3 (Volatility Boundary Positioning)
Projects the relative closing height against Bollinger bounds ($yPercent$ scale) to detect overbought or oversold conditions dynamically.
$$yPercent = \frac{Close_{current} - Boll_{Lower}}{Boll_{Upper} - Boll_{Lower}}$$
Triggers reversals on boundary boundaries ($yPercent < 0.15$ or $yPercent > 0.85$), fading extreme moves.

### Judge 4 (Skeptic Veto)
Acts as a dynamic risk-gating mechanism. Even if Judges 1-3 align, Judge 4 can veto the trade based on macro risk factors. Rejects potential trades if historical Average True Range (ATR) drifts past $2.5\sigma$ (extreme volatility) or if price Z-scores identify overextended conditions likely to mean-revert violently.

### Hurst Regime Balancer
Analyzes Rescaled Range (R/S) limits to automatically adjust scoring coefficients based on the current market regime:
- **Trending ($H \ge 0.55$)**: Scales continuation metrics (J1 & J2) up by $1.35\times$.
- **Mean-Reverting ($H \le 0.45$)**: Prioritizes boundary setups (J3) by adjusting weights $1.5\times$.

---

## Geometry Alignment & Synchronizations

ChartLens uses rigorous geometric alignment to ensure backtesting results mirror live execution as closely as possible.

```
  BULLISH CANDLE                      BEARISH CANDLE
       High                                High
        │                                   │
    ┌───┴───┐ ◄─── Close (Exit)         ┌───┴───┐ ◄─── Open (Entry) - [Broad Top]
    │       │                           │       │
    └───┬───┘ ◄─── Open (Entry)         └───┬───┘ ◄─── Close (Exit)
        │          [Broad Bottom]           │
       Low                                 Low
```

- **Physical Entry Modeling**: Normalizes entry price coordinates to align specifically on physical candle boundaries: uses the broad bottom (`candle.open`) for green structures, and the broad top (`candle.open`) for red structures.
- **Deterministic Historical Lookbacks**: Isolates exact pre-entry frames (1 to 5 candles trailing lookback based on user parameter intervals). Avoids lookahead errors by completely excluding entry-phase and postseason metrics from the active analyzer loop.
- **Clock-Synchronized EOD Settlement**: Implements secure automated settlement of active trades at **IST 15:30**. Calculates daily boundaries to log granular Stop-Loss (SL) or Take-Profit (TP) conditions correctly, mimicking standard Indian market timings.

---

## Quickstart & Terminal Operations

Ensure Node.js `>= 18.0.0` is configured on your workspace machine. The project strictly uses `pnpm` for package management and workspace resolution.

### 1. Installation
Clone the repository and install dependencies using `pnpm`:
```bash
git clone https://github.com/sweyjotdhillon-cmd/Ai-Trading.git c-chartlens
cd c-chartlens
pnpm install
```

### 2. Live Development Terminal
Start the development server with Hot Module Replacement (HMR):
```bash
pnpm run dev
```
Launches high-performance local web interfaces with instant state reload configurations.

### 3. Verification Suite
The project maintains a strict testing and linting standard to ensure deterministic behavior.
```bash
# Run structural Vitest units (unit tests for quant logic and utils)
npx vitest run

# Run strict code pattern linter
pnpm run lint
```

### 4. Compiling & Production Bundling
Build the application for deployment. This bundles the Vite frontend and compiles the backend server via esbuild.
```bash
# Bundle frontend static build and production CJS server
pnpm run build

# Boot native, self-contained standalone server
pnpm run start
```
