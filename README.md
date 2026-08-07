# ChartLens

A high-performance, 100% offline-first quantitative trading simulation engine and paper terminal. It processes clean, text-based market data feeds (structured JSON) through a multi-layered deterministic 4-judge rules engine to support modular portfolio testing, balance syncing, and strict performance metrics in a client-side sandbox environment backed by Firebase Firestore.

---

## Technical Architecture

```text
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

## Analysis Pipelines & Modes

ChartLens operates through distinct operational pipelines optimized for specific trading and testing methodologies:

### Single Image Analysis (Test Mode)
The frontend flow begins in `useBotLoop.ts` where the image is converted to Base64. It is passed via the `runSingleAnalysis` function in `src/utils/singleAnalysis.ts`, dispatching data to the background `analysisWorker.ts`.
- **OCR Fallback Mechanism**: When the Y-Axis OCR fails to extract real-world prices in the vision pipeline, the system resorts to a `NORMALIZED_FALLBACK`, utilizing percentage-based calculations instead of absolute pricing to guarantee uninterrupted analysis.

### Continuous Bot Mode / Scalping Engine
ChartLens features an autonomous "bot mode" utilizing a deterministic Scalping Engine for continuous execution.
- Driven by `evaluateScalpSignal` focusing exclusively on long-only setups.
- Employs dynamic features such as `findSwingPivots`, Average True Range (`atr`), and Volume Weighted Average Price (`vwapProxy`).

---

## Web Worker Integration

The system leverages parallel background execution strictly decoupled from the main thread.
- **Granular Streaming via `JUDGE_LOG`**: The web worker (`analysisWorker.ts`) communicates real-time live analysis progress and detailed judge evaluation logs back to the frontend using the `JUDGE_LOG` message type.
- **Sleep Prevention Hack**: To prevent browser throttling or suspension of background execution (critical during bulk testing via Web Workers), the application utilizes a "silent audio" hack. A looping, silent base64 `Audio` element is maintained within the `useWakeLock` hook, centralized in `src/hooks/useWakeLock.ts`.

---

## Frontend Architecture

- **React Native Web Alignment**: The Vite configuration uses strictly enforced aliases to support React Native Web, mapping `react-native` to `react-native-web` and pointing native component logic to custom shims.
- **Global Error Handling Overlay**: Application errors—including uncaught exceptions, unhandled promise rejections, and Web Worker faults—are globally intercepted in `src/main.tsx`. They are dispatched as custom `app-console-error` events and explicitly rendered via a global error overlay displaying full scrollable stack traces. No silent failures are permitted.
- **UI & Accessibility**: The codebase standardizes exclusively on `lucide-react` for UI icons. For strict screen reader support, all icon-only `<Pressable>` elements must always include descriptive `accessibilityLabel` and `accessibilityRole="button"` props.

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
│   ├── workers/     # Multi-threaded background data tasks
│   └── utils/       # Timezone mappings (IST) and browser storage adapters
```

---

## Quantitative Engine Deep Dive

The core analysis pipeline is deterministic and rigorously enforced, processing structured OCR-extracted OHLC data.

### Pipeline Orchestration (`analysisWorker.ts`)
1. Constructs a `HorizonContext` for chronological stability.
2. Extracts `ohlcSeries` and `axis` dimensions via `buildPipelineResult`.
3. Applies pre-quantitative feature extraction filtered by specific stability managers (e.g., `PatternStabilityManager`, `GapStabilityManager`).
4. Invokes the `evaluateSignal` rules engine.
5. Emits normalized output via `emitStability(decision)`.

### Rule Engine Validation (`evaluateSignal`)
`evaluateSignal` inside `src/quant/ruleEngine.ts` enforces deterministic constraints via a precise 7-argument signature:
`ohlcSeries`, `techniquesList`, `horizonCtx`, `_confirmedPatterns`, `_confirmedGaps`, an optional `onLog` callback, and `neutralityConfig`.
- **Temporal Filter**: A `NO_TRADE` signal (representing bearish or indeterminate trends in the long-only approach) forces a low baseline or early return to prevent poisoning active EMAs.
- **Test Mode Bypasses**: Unit tests bypass specific signal validation rules by passing the `"__TEST_BYPASS__"` string inside the `techniquesList` mock array.
- **Flexible Minimums**: The engine evaluates patterns based on the provided `techniquesList` but no longer enforces a strict 10-technique minimum count, preventing silent timeouts.

### 4-Judge Quantitative Core

Decisions are computed through strict pointwise inequalities inside `ruleEngine.ts`:

#### Judge 1 (Candlestick Formations)
Identifies core candle patterns (Engulfing, Pinbars, Hammers) by mapping wick ratios against total height:
$$\text{RejectionRatio} = \frac{|High - \max(Open, Close)|}{High - Low}$$
Requires a $\ge 0.55$ threshold to qualify as wick exhaustion.

#### Judge 2 (Mathematical Trend Lines)
Monitors core system dynamics:
- **EMA Intersections**: Compares short EMA(9) against long EMA(21).
- **Bollinger Extensions**: Measures rolling standard deviations to identify extreme price borders.
- **Oscillators & MACD**: Supports RSI, Stochastic, and explicitly `macd` / `getmacd` divergence tracking.

#### Judge 3 (Volatility Boundary Positioning)
Projects the relative closing height against Bollinger bounds ($yPercent$ scale):
$$yPercent = \frac{Close_{current} - Boll_{Lower}}{Boll_{Upper} - Boll_{Lower}}$$
Triggers reversals on boundary boundaries ($yPercent < 0.15$ or $yPercent > 0.85$).

#### Judge 4 (Skeptic Veto)
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

## Infrastructure & Deployment

- **Backend Express Server**: The application uses a custom Express backend (`server.ts`) compiled to CommonJS via esbuild into `dist/server.cjs` during the Vite build process.
- **Render Deployment**: Render sets `NODE_ENV=production` causing package managers to skip `devDependencies`. The server dynamically binds to `process.env.PORT` to satisfy Render health checks.
- **Vite & Render Compatibility**: To support deployment as a Web Service on Render, Vite's `preview` server is configured to bind to host `0.0.0.0` (using `host: true`) and dynamically listens to `process.env.PORT`.
- **Cloudflare Integration**: SPA routing is supported natively via the `wrangler.jsonc` file for Cloudflare Pages.
- **Firebase Configuration**: Firebase secrets and environments must be securely injected via Vite environment variables (e.g., `VITE_FIREBASE_API_KEY`) accessed through `import.meta.env`, never hardcoded.

---

## Quickstart & Terminal Operations

Ensure Node.js `>= 18.0.0` is configured on your workspace machine. The project strictly utilizes `pnpm` (no `npm` or `yarn`).

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
Launches high-performance local web interfaces with instant state reload configurations.

### 3. Verification Suite
```bash
# Run strict code pattern linter
pnpm run lint

# Run structural Vitest units (Expected to contain pre-existing failures in quant systems)
npx vitest run

# Run dry-run type checking
pnpm exec tsc --noEmit
```

### 4. Compiling & Production Bundling
```bash
# Bundle frontend static build and production CJS server
pnpm run build

# Boot native, self-contained standalone server
pnpm run start
```