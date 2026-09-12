
# ChartLens

A high-performance, 100% offline-first quantitative trading simulation engine and paper terminal. It processes clean, text-based market data feeds (structured JSON) through a multi-layered deterministic 4-judge rules engine to support modular portfolio testing, balance syncing, and strict performance metrics in a client-side sandbox environment backed by Firebase Firestore.

---

## Table of Contents

- [Features](#features)
- [Technical Architecture](#technical-architecture)
- [Core Directory Map](#core-directory-map)
- [4-Judge Quantitative Core](#4-judge-quantitative-core)
- [Geometry Alignment & Synchronizations](#geometry-alignment--synchronizations)
- [Quickstart & Terminal Operations](#quickstart--terminal-operations)
- [Scripts & Development](#scripts--development)
- [Tech Stack](#tech-stack)

---

## Features

- **High-Performance Backtesting**: Leverages `Float64Array` buffers to avoid standard garbage-collection overhead.
- **Isolated Math Pool**: Moves heavy mathematical indicators onto dedicated Web Workers for completely unblocked UI.
- **Cloud State Synchronization**: Real-time Firestore sync with a cache-first approach using indexedDB for full offline capabilities.
- **Automated Geometry Bounds**: Physical modeling of candle bounds specifically handles broad bottoms and tops for extreme precision.
- **Deeper Risk Controls**: Includes a built in 4-judge matrix filtering with auto-detecting Hurst regime balancers to scale signals relative to trend behaviors.

---

## Technical Architecture

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

- **Isolated Thread Pool**: Heavy math and technical indicator loops compute on dedicated Web Workers (`src/workers/analysisWorker.ts`) to avoid UI render jitter or thread blockages.
- **GC Optimization**: High-speed backtests operate over contiguous physical memory blocks (`Float64Array` buffers) to bypass normal garbage-collection overhead.
- **Sync Architecture**: State persistence is driven by a hybrid cache-first scheme matching client storage to a fast cloud backup on Firebase Firestore.
- **Throttle Guard**: Incorporates a continuous, low-overhead browser wake-lock mechanism preventing background CPU sleep states on inactive tabs.

---

## Core Directory Map

```
├── src/
│   ├── components/  # Responsive HUDs, dashboards, and portfolio stats models
│   ├── config/      # Configuration defaults (Feature flags, rulesets)
│   ├── hooks/       # React Custom hooks driving global application state
│   ├── quant/       # Indicators, 4-judge matrix, market structure, risk guards
│   │   ├── indicators.ts      # ADX (DI+/DI-), RSI, Bollinger Bands, HLC/3 VWAP
│   │   ├── marketStructure.ts # BOS, CHoCH, and Swing Pivot tracking
│   │   ├── ruleEngine.ts      # Multi-judge validation & scoring invariants
│   │   └── riskGuard.ts       # Drawdown controls and cooldown mechanisms
│   ├── services/    # Live ticker feeds, historical proxies, and Firestore bindings
│   ├── vision/      # Visual analytics and pattern extraction pipelines
│   ├── workers/     # Multi-threaded background data tasks
│   └── utils/       # Timezone mappings (IST) and browser storage adapters
```

---

## 4-Judge Quantitative Core

Decisions are computed through strict pointwise inequalities inside `ruleEngine.ts`:

### Judge 1 (Candlestick Formations)
Identifies core candle patterns (Engulfing, Pinbars, Hammers) by mapping wick ratios against total height:
$$\text{RejectionRatio} = \frac{|High - \max(Open, Close)|}{High - Low}$$
Requires a $\ge 0.55$ threshold to qualify as wick exhaustion.

### Judge 2 (Mathematical Trend Lines)
Monitors core system dynamics:
- **EMA Intersections**: Compares short EMA(9) against long EMA(21).
- **Bollinger Extensions**: Measures rolling standard deviations to identify extreme price borders.
- **MACD Divergence**: Evaluates rate transitions relative to current price behavior.

### Judge 3 (Volatility Boundary Positioning)
Projects the relative closing height against Bollinger bounds ($yPercent$ scale):
$$yPercent = \frac{Close_{current} - Boll_{Lower}}{Boll_{Upper} - Boll_{Lower}}$$
Triggers reversals on boundary boundaries ($yPercent < 0.15$ or $yPercent > 0.85$).

### Judge 4 (Skeptic Veto)
Acts as a dynamic risk-gating mechanism. Rejects potential trades if historical ATR drifts past $2.5\sigma$ or if price Z-scores identify overextended conditions.

### Hurst Regime Balancer
Analyzes Rescaled Range (R/S) limits to automatically adjust scoring coefficients:
- **Trending ($H \ge 0.55$)**: Scales continuation metrics (J1 & J2) up by $1.35\times$.
- **Mean-Reverting ($H \le 0.45$)**: Prioritizes boundary setups (J3) by adjusting weights $1.5\times$.

---

## Geometry Alignment & Synchronizations

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
- **Clock-Synchronized EOD Settlement**: Implements secure automated settlement of active trades at **IST 15:30**. Calculates daily boundaries to log granular Stop-Loss (SL) or Take-Profit (TP) conditions correctly.

---

## Quickstart & Terminal Operations

Ensure Node.js `>= 18.0.0` is configured on your workspace machine. (It is recommended to use `pnpm`).

### 1. Installation
```bash
git clone https://github.com/sweyjotdhillon-cmd/Ai-Trading.git c-chartlens
cd c-chartlens
pnpm install
```

### 2. Live Development Terminal
```bash
pnpm run dev
```
Launches high-performance local web interfaces on port `3000` with instant state reload configurations.

### 3. Verification Suite
```bash
# Run structural Vitest units
pnpm exec vitest run

# Run strict code pattern linter
pnpm run lint
```

### 4. Compiling & Production Bundling
```bash
# Bundle frontend static build and production CJS server
pnpm run build

# Boot native, self-contained standalone server
pnpm run start
```

---

## Scripts & Development

- `pnpm run dev` - Boot dev servers (TSX hot reload)
- `pnpm run build` - Vite build & CommonJS node output for `server.ts`
- `pnpm run lint` - Lint source code
- `pnpm run preview` - Builds and previews the Cloudflare deployment using Wrangler.
- `pnpm run deploy:cf` - Deploys straight to Cloudflare.
- `pnpm run deploy:vercel` - Deploys to Vercel production.

---

## Tech Stack

- **Frontend**: React (18.2.0), Vite, TailwindCSS
- **Native Support**: React Native Web (`react-native-web`) for robust cross platform capabilities.
- **Backend / APIs**: Express (5.x), ESBuild
- **State & Database**: Firebase Firestore (Cache First implementation using `idb-keyval`)
- **Analysis / Quant Engine**: WebWorkers, Custom Typed Float64Array structures
- **Testing**: Vitest & Playwright
