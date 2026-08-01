# ChartLens

A high-performance, 100% offline-first quantitative trading simulation engine and paper terminal. It processes clean, text-based market data feeds (structured JSON) through a multi-layered deterministic 4-judge rules engine to support modular portfolio testing, balance syncing, and strict performance metrics in a client-side sandbox environment backed by Firebase Firestore.

## Comprehensive Tech Stack Overview

- **Frontend Framework**: React 18 with Vite for lightning-fast HMR and optimized production builds.
- **UI & Styling**: React Native Web with `twrnc` (Tailwind CSS for React Native) ensuring a responsive, cross-platform mobile-first design, utilizing `lucide-react` and `lucide-react-native` for scalable iconography.
- **3D Visualizations**: Three.js integrated via `@react-three/fiber` and `@react-three/drei` to render immersive, hardware-accelerated market data and structural overlays.
- **2D Charting**: D3.js and Recharts for precise, performant SVG/Canvas based financial plotting.
- **Data Processing**: Papaparse for CSV ingestion and `simple-statistics` for robust quantitative metrics.
- **Backend/Services**: Custom Express backend compiled via ESBuild (`server.cjs`), with Vite proxy rules routing to external APIs (e.g., Koyeb backend services for live stock/search endpoints).

## Advanced Architecture & Data Flow

```text
                       [ RAW TEXT DATA FEEDS (JSON/CSV) ]
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
- **Data Flow & Pipeline Architecture**: Unstructured data becomes signal via a robust pipeline. The `buildPipelineResult` in `src/vision/pipeline.ts` extracts `ohlcSeries` and `axis`, while `HorizonContext` captures market constraints. The evaluated signal is passed through an `emitStability(decision)` filter.
- **Scalping Engine**: For automated 'bot mode', the system relies on a Scalping Engine (`evaluateScalpSignal`) utilizing features like `findSwingPivots`, Average True Range (`atr`), and Volume Weighted Average Price (`vwapProxy`) to evaluate short-term opportunities.
- **GC Optimization**: High-speed backtests operate over contiguous physical memory blocks (`Float64Array` buffers) to bypass normal garbage-collection overhead.
- **Sync Architecture**: State persistence is driven by a hybrid cache-first scheme matching client storage to a fast cloud backup on Firebase Firestore.
- **Throttle Guard**: Incorporates a continuous, low-overhead browser wake-lock mechanism preventing background CPU sleep states on inactive tabs.

---

## Core Directory Map

```text
├── src/
│   ├── components/  # Responsive HUDs, dashboards, and portfolio stats models
│   ├── quant/       # Indicators, 4-judge matrix, market structure, risk guards
│   │   ├── indicators.ts      # ADX (DI+/DI-), RSI, Bollinger Bands, HLC/3 VWAP
│   │   ├── marketStructure.ts # BOS, CHoCH, and Swing Pivot tracking
│   │   ├── ruleEngine.ts      # Multi-judge validation & scoring invariants
│   │   └── riskGuard.ts       # Drawdown controls and cooldown mechanisms
│   ├── services/    # Live ticker feeds, historical proxies, and Firestore bindings
│   ├── vision/      # Vision pipeline for rendering and axis mapping
│   ├── workers/     # Multi-threaded background data tasks (`analysisWorker.ts`)
│   └── utils/       # Timezone mappings (IST) and browser storage adapters
├── runATRBreakoutAnalysis.ts  # CLI tool for specialized ATR breakout backtesting
└── runBacktestsCli.ts         # Core CLI harness for running bulk terminal backtests
```

---

## 4-Judge Quantitative Core

Decisions are computed through strict pointwise inequalities inside `ruleEngine.ts`. The `evaluateSignal` function evaluates patterns based on the provided `techniquesList`. It strictly enforces a minimum of 10 techniques for non-bypassed analysis to ensure strong consensus. The output `DecisionResult` structure tracks `shardPassVotes`, `techEnginePassVotes`, and `bullJ3Raw`.

### Judge 1 (Candlestick Formations)
Identifies core candle patterns (Engulfing, Pinbars, Hammers) by mapping wick ratios against total height:
$$\text{RejectionRatio} = \frac{|High - \max(Open, Close)|}{High - Low}$$
Requires a $\ge 0.55$ threshold to qualify as wick exhaustion.

### Judge 2 (Mathematical Trend Lines - Oscillators)
Monitors core system dynamics:
- **EMA Intersections**: Compares short EMA(9) against long EMA(21).
- **MACD**: The J2 judge fully supports MACD (`macd`, `getmacd`) alongside RSI and Stochastic oscillators to evaluate momentum and rate transitions relative to current price behavior.
- **Bollinger Extensions**: Measures rolling standard deviations to identify extreme price borders.

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

```text
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

## Deep Dive into 3D Visualization Stack

The application incorporates a rich 3D visualization layer built on Three.js, wrapped within the React ecosystem using `@react-three/fiber` and `@react-three/drei`.
- **Purpose**: To provide immersive, interactive market data visualizations, transforming flat 2D candlestick charts into comprehensive topographical models of market sentiment, volume profiles, and liquidity zones.
- **Integration**: 3D components are seamlessly embedded within standard React views. The Web Workers process the heavy geometric alignment and data normalization before passing optimal `Float64Array` buffers to the main thread, ensuring the 60FPS WebGL render loop is never blocked.

---

## Comprehensive Deployment Guide

ChartLens supports multiple modern hosting environments.

### Render Web Service (Production)
- **Build Command**: `pnpm build`
- **Start Command**: `pnpm start`
- **Port Binding**: Render injects the `PORT` environment variable. The Express server (`dist/server.cjs`) dynamically binds to `process.env.PORT` to satisfy health checks.
- **Vite Preview**: In `vite.config.ts`, the `preview` block is configured to bind to host `0.0.0.0` (using `host: true`), sets `allowedHosts: true`, and listens dynamically to `process.env.PORT` to prevent 502 Bad Gateway errors.

### Cloudflare Pages
- SPA routing and deployment are configured via the included `wrangler.jsonc` file.
- **Deployment**: Run `pnpm run deploy:cf` (which executes `pnpm run build && wrangler deploy`).

### Vercel
- Uses the `vercel.json` configuration file for deployment.
- **Deployment**: Run `pnpm run deploy:vercel`.

---

## Detailed Configuration Guide

### Environment Variables
Firebase and other third-party configurations must be provided securely via Vite environment variables and accessed through `import.meta.env`. Never hardcode these in version-controlled files.
- `VITE_FIREBASE_API_KEY`: Your Firebase project API Key.
- `VITE_FIREBASE_AUTH_DOMAIN`: Firebase Auth Domain.
- `VITE_FIREBASE_PROJECT_ID`: Firebase Project ID.

### Vite Proxy Rules
The frontend Vite configuration uses proxy rules to elegantly route `/api/stock` and `/api/search` endpoints to an external Koyeb backend service (`https://military-jobye-haiqstudios-14f59639.koyeb.app`), bypassing CORS issues during local development.

---

## Complete Testing & Verification Guide

Ensure Node.js `>= 18.0.0` is configured on your workspace machine. The project standardizes on `pnpm` as the package manager. **Never use npm or yarn in this repository.**

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
Launches the development server via `tsx server.ts`.

### 3. Verification Suite
The project enforces strict testing and linting standards:
```bash
# Run structural Vitest units to execute the test suite
npx vitest run

# Run strict code pattern linter (avoid --fix globally)
pnpm run lint

# Run strict type checking without emitting files
pnpm exec tsc --noEmit
```

### 4. Running CLI Backtests
For offline, terminal-based heavy analysis:
```bash
# Run bulk terminal backtests
npx tsx runBacktestsCli.ts

# Run specialized ATR breakout backtesting
npx tsx runATRBreakoutAnalysis.ts
```

### 5. Compiling & Production Bundling
```bash
# Bundle frontend static build and production CJS server (requires NODE_ENV=production for Render simulation)
NODE_ENV=production pnpm run build

# Boot native, self-contained standalone server
pnpm run start
```
