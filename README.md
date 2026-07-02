# ChartLens

ChartLens is a high-performance, 100% offline-first quantitative trading simulation engine, paper terminal, and chart image analysis tool. It processes clean, text-based market data feeds (structured JSON) and analyzes chart screenshots through a deterministic 4-judge rules engine to support modular portfolio testing, balance syncing, and strict performance metrics in a client-side sandbox environment backed by Firebase Firestore. It can also act as an autonomous bot utilizing a scalping engine.

---

## Key Features

- **Offline-First Analysis**: Perform full quantitative trading simulations and pattern analysis directly in the browser using client-side processing.
- **Vision Pipeline (Chart OCR)**: Upload raw chart screenshots. The engine scans the pixels, calibrates color spaces, extracts structural components via morphological processing (e.g. wick tracing), and reconstructs standard numeric OHLC data to pipe into the quant engine.
- **4-Judge Rules Engine**: A mathematically deterministic system validating signals across multiple quantitative dimensions (candlestick formations, trend lines, volatility positioning, and skeptic/risk vetting).
- **Scalping Engine / Bot Mode**: Automates short-term trading signals utilizing swing pivots, ATR, and VWAP proxies.
- **Isolated Web Workers**: Heavy mathematical processing, image scanning, and matrix evaluation are offloaded to dedicated background threads (Web Workers) to preserve UI frame rates.
- **State Synchronization**: Cache-first state persistence in the browser matching to a swift cloud backup on Firebase Firestore.
- **Responsive Terminal UI**: Offers detailed dashboards for simulated balances, open trades, bot setups, and real-time backtest visualizers built with React and Tailwind CSS.
- **Performance Optimization**: Employs continuous memory management with `Float64Array` buffers to bypass normal GC overhead during high-speed backtests. Includes a Wake-Lock guard to prevent browser background throttling.

---

## Technical Architecture

### 1. Data Ingestion Pathways

ChartLens supports dual modes of data ingestion:
*   **Direct Feeds:** Raw JSON historical datasets are ingested and parsed.
*   **Vision Pipeline:** Chart screenshots undergo computer vision processing to yield identical numeric OHLC arrays.

### 2. Multi-Threaded Execution Model

```
                       [ DATA INGESTION (Text or Pixel OCR) ]
                                      │
                                      ▼
                        Chronological Series Construction
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

- **Task Scheduler**: `analysisWorker.ts` receives segmented chunks and delegates them through the analysis pipeline without blocking the main React render thread.

### 3. Vision Pipeline Dissection (Chart Image Analysis)

ChartLens incorporates a custom client-side vision pipeline (`src/vision/`) to process chart screenshots:
1.  **Preprocessing**: Normalizes image inputs, applies contrast adjustments, and handles binarization (`otsu.ts`).
2.  **Color Space Calibration**: Evaluates pixel color density (`colorSpace.ts`, `colorCalibration.ts`) to differentiate bullish/bearish entities from backgrounds.
3.  **Entity Extraction**: Identifies and bounds connected components (`connectedComponents.ts`).
4.  **Morphological Processing**: Traces thin vertical lines for wicks (`wickTracer.ts`) and detects geometric shapes via Hough transforms (`hough.ts`).
5.  **Axis Reader & OCR**: Scans the Y-axis to map pixel coordinates to real-world price values using template matching (`ocr.ts`, `digitTemplates.ts`). Employs a `NORMALIZED_FALLBACK` (percentage-based) if exact prices cannot be read.
6.  **Pipeline Construction**: The `pipeline.ts` orchestrates these steps to emit standard `NumericOHLC` records.

---

## 4-Judge Quantitative Core

Decisions are computed through strict pointwise inequalities inside `src/quant/ruleEngine.ts`. The system evaluates signals (e.g., `LONG` or `NO_TRADE`) utilizing extracted OHLC data.

### Judge 1 (Candlestick Formations)
Identifies core candle patterns (Engulfing, Pinbars, Hammers) by mapping wick ratios against total height:
$$\text{RejectionRatio} = \frac{|High - \max(Open, Close)|}{High - Low}$$
Requires a $\ge 0.55$ threshold to qualify as wick exhaustion.

### Judge 2 (Mathematical Trend Lines)
Monitors core system dynamics:
- **EMA Intersections**: Compares short EMA(9) against long EMA(21).
- **Bollinger Extensions**: Measures rolling standard deviations to identify extreme price borders.
- **MACD Divergence**: Evaluates rate transitions relative to current price behavior (supports MACD, RSI, and Stochastic oscillators).

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

## Core Directory Map

```
├── src/
│   ├── components/  # Responsive HUDs, dashboards, and portfolio stats models
│   ├── config/      # Feature flags, weights, and application constants
│   ├── hooks/       # React hooks, including Wake-Lock and Firestore syncing
│   ├── quant/       # Indicators, 4-judge matrix, market structure, risk guards
│   │   ├── indicators.ts      # ADX, RSI, MACD, Bollinger Bands, HLC/3 VWAP
│   │   ├── marketStructure.ts # BOS, CHoCH, and Swing Pivot tracking
│   │   ├── ruleEngine.ts      # Multi-judge validation & scoring invariants
│   │   └── riskGuard.ts       # Drawdown controls and cooldown mechanisms
│   ├── services/    # Live ticker feeds, historical proxies, and Firestore bindings
│   ├── vision/      # Client-side Image OCR pipeline and pixel analysis modules
│   ├── workers/     # Multi-threaded background data tasks (analysisWorker.ts)
│   └── utils/       # Timezone mappings, data formatters, storage adapters
├── server.ts        # Express backend entry point
└── vite.config.ts   # Build configuration (handles React Native Web aliases)
```

---

## Setup & Terminal Operations

Ensure Node.js `>= 18.0.0` is configured on your workspace machine. This project strictly utilizes `pnpm` as its package manager.

### 1. Installation
```bash
git clone https://github.com/sweyjotdhillon-cmd/Ai-Trading.git c-chartlens
cd c-chartlens
pnpm install
```
*Note: Do not use `npm` or `yarn`. If modifying dependencies, ensure `pnpm-lock.yaml` is committed to prevent deployment lockfile errors.*

### 2. Live Development Terminal
```bash
pnpm run dev
```
Launches the high-performance local web interfaces on port `3000` with instant state reload configurations.

### 3. Verification Suite
```bash
# Run structural Vitest unit test suites
npx vitest run

# Run strict code pattern linter
pnpm run lint

# Perform TypeScript type-checking without emitting files
pnpm exec tsc --noEmit
```

### 4. Compiling & Production Bundling
```bash
# Bundle frontend static build and compile the production CJS server
pnpm run build
```
*For testing the production build locally:*
```bash
NODE_ENV=production pnpm run build
pnpm run start
```
This boots the native, self-contained standalone server using the generated `dist/server.cjs`.

### 5. Deployment Environments
- **Render**: The application is configured to deploy as a Web Service on Render. The `server.ts` dynamically binds to `process.env.PORT` and handles health checks. Ensure `NODE_ENV=production` constraints are met (all required build tools must be in `dependencies`).
- **Cloudflare Pages**: SPA routing and static hosting are supported via `wrangler.jsonc`.

---

## Design Philosophy & Directives

- **Robust Error Handling**: Uncaught exceptions, unhandled rejections, and Worker faults are actively trapped and broadcasted to the UI via global overlays, rather than silent console logs.
- **Accessibility**: UI elements utilizing React Native Web strictly define `accessibilityLabel` attributes.
- **Configurability**: Application behavior toggles and thresholds are heavily parameterized in `src/config/` (e.g., `featureFlags.ts`) for seamless live updates without deep code refactors.
- **Environment Parity**: Local testing scripts (`.cjs`) reflect the production ESM-to-CJS compilation paths specified in `package.json`. Firebase credentials must be handled strictly through environment variables.
