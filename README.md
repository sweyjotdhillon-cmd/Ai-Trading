# ChartLens

A high-performance, 100% offline-first quantitative trading simulation engine and paper terminal. It processes clean, text-based market data feeds (structured JSON) through a multi-layered deterministic 4-judge rules engine to support modular portfolio testing, balance syncing, and strict performance metrics in a client-side sandbox environment backed by Firebase Firestore.

The application has recently been expanded with a robust **Vision Pipeline** for analyzing image-based chart structures and a **Scalping Engine** tailored to identify micro-trend opportunities autonomously.

---

## Technical Architecture

```
                       [ RAW DATA (JSON / IMAGES) ]
                                      │
                                      ▼
             ┌────────────────────────────────────────────────┐
             │                 INGESTION HUB                  │
             │                                                │
             │  [ Image Vision/OCR ]      [ Data Extractor ]  │
             │  (src/vision/pipeline.ts)  (src/quant/...)     │
             └────────────────────────┬───────────────────────┘
                                      │
                                      ▼ (Isolated Thread Pool)
              ┌────────────────────────────────────────────────┐
              │             WEB WORKER TASK SCHEDULER          │
              │         (`src/workers/analysisWorker.ts`)      │
              │                                                │
              │    ┌──────────────────┐    ┌────────────────┐  │
              │    │ SERIES PARSING   │    │ QUANT PIPELINE │  │
              │    │ (Float64Array)   │    │ (ruleEngine &  │  │
              │    │                  │    │ scalpingEngine)│  │
              │    └────────┬─────────┘    └────────┬───────┘  │
              └─────────────┼───────────────────────┼──────────┘
                            ▼                       ▼
                   [ Temporal Series ]     [ Verdict Decision ]
                   (Rolling Buffers)     (LONG / NO_TRADE)
```

- **Isolated Thread Pool**: Heavy mathematical evaluations, technical indicator loops, and matrix processing compute on dedicated Web Workers (`src/workers/analysisWorker.ts`). This ensures the UI remains responsive, entirely preventing render jitter or main-thread blockages.
- **GC Optimization**: High-speed backtests operate over contiguous physical memory blocks (`Float64Array` buffers) to bypass normal garbage-collection overhead.
- **Sync Architecture**: State persistence is driven by a hybrid cache-first scheme matching client storage to a fast cloud backup on Firebase Firestore.
- **Throttle Guard**: Incorporates a continuous, low-overhead browser wake-lock mechanism preventing background CPU sleep states on inactive tabs.

---

## Core Directory Map

```
├── src/
│   ├── components/  # Responsive HUDs, dashboards, portfolio stats models, and WebGL charts
│   ├── config/      # Feature flags, timeouts, and temporal filter configurations
│   ├── quant/       # Indicators, multi-judge matrix, market structure, risk guards, scalping
│   │   ├── ruleEngine.ts        # Multi-judge validation & scoring invariants
│   │   ├── scalpingEngine.ts    # Autonomous bot engine targeting micro-trend reversals
│   │   ├── patternAdapter.ts    # Candlestick pattern detection (Engulfing, Pinbars)
│   │   ├── patternStability.ts  # State management for confirmed patterns across ticks
│   │   ├── gapDetector.ts       # Locates and grades fair value gaps (FVG)
│   │   ├── temporalFilter.ts    # Time-based cooldowns preventing over-trading
│   │   └── riskGuard.ts         # Drawdown controls and margin cooldown mechanisms
│   ├── services/    # Live ticker feeds, historical proxies, and Firestore bindings
│   ├── vision/      # Client-side Chart OCR, pixel scanning, and hough transforms
│   │   ├── pipeline.ts          # Core orchestrator translating pixels to OHLC data
│   │   ├── colorCalibration.ts  # Adaptive thresholds for extracting specific UI color modes
│   │   └── __audit__/           # Epsilon determinism guards testing OCR drift
│   ├── workers/     # Multi-threaded background data tasks (`analysisWorker.ts`)
│   └── utils/       # Timezone mappings (IST) and browser storage adapters
```

---

## Quantitative Core & Analysis Pipeline

Decisions are computed through strict pointwise mathematical models. The engine now heavily emphasizes long-only positional strategies (BULL/LONG or NO_TRADE) managed by the Scalping Engine.

### Core Signal Pipeline (`analysisWorker.ts` & `ruleEngine.ts`)
The analysis worker is the orchestrator. It executes a comprehensive sequence per tick:
1. **Horizon Construction:** Builds rolling context buffers for the current and prior ticks.
2. **Pre-Quant Extraction:** Utilizes stability managers (`PatternStabilityManager`, `GapStabilityManager`) alongside core detector modules to pre-calculate evident patterns and Fair Value Gaps (FVG) reliably.
3. **Determinism and Guard Checks:** Validates sequences via `determinismGuard` and `epsilonGuard` to ensure mathematical purity across different JS engine environments.
4. **Signal Evaluation:** Forwards processed OHLC matrices and extracted features into the `evaluateSignal` and `evaluateScalpSignal` models.
5. **Stability & Temporal Filtering:** Results are smoothed by `emitStability` and gated by `temporalFilter` to respect cooldowns.

### The 4-Judge Matrix (Legacy/Core)
When executing traditional system checks inside `ruleEngine.ts`:

- **Judge 1 (Candlestick Formations)**: Identifies core candle patterns (Engulfing, Pinbars, Hammers) by mapping wick ratios against total height:
$$\text{RejectionRatio} = \frac{|High - \max(Open, Close)|}{High - Low}$$
Requires a $\ge 0.55$ threshold to qualify as wick exhaustion.
- **Judge 2 (Mathematical Trend Lines)**: Evaluates core dynamics: EMA Intersections (EMA9 vs EMA21), Bollinger band expansions, and MACD divergence vectors.
- **Judge 3 (Volatility Boundary Positioning)**: Projects the relative closing height against Bollinger bounds ($yPercent$ scale). Triggers boundary reactions at extremes.
- **Judge 4 (Skeptic Veto)**: A dynamic risk-gating mechanism. Rejects setups if historical ATR drifts past $2.5\sigma$ or Z-scores identify overextended/unstable conditions.

### Autonomous Bot Mode (Scalping Engine)
The application incorporates a fully autonomous loop using the `evaluateScalpSignal` engine (`src/quant/scalpingEngine.ts` and `src/config/scalpConfig.ts`). It relies on short-horizon microstructure details:
- **Swing Pivots (`findSwingPivots`)**: Maps localized higher-highs and lower-lows.
- **Volatility Proxy (`vwapProxy` & `atr`)**: Normalizes entry urgency against real-time micro-volume estimations.

---

## Vision OCR Pipeline (`src/vision/`)

ChartLens is capable of analyzing physical chart images natively entirely within the browser via its Vision pipeline.
- **Offline OCR**: Parses raw candlestick charts into structured `NumericOHLC` arrays.
- **Adaptive Calibration**: Translates chart color palettes (`colorCalibration.ts`) into mathematical masks to discern green/red candle bodies and wicks (`wickTracer.ts`).
- **Resilience**: The system falls back to a `NORMALIZED_FALLBACK` calculation mode using percentage-based movements if actual axis prices fail to extract clearly, ensuring analysis continuity.

---

## Deployment & Hosting Environment

The application natively supports deployment to **Render**, **Cloudflare Pages**, and **Vercel**.

- **Vite Configuration (`vite.config.ts`)**: Defines aliases (e.g., swapping `react-native` with `react-native-web`), and sets up a robust build pipeline. In environments like Render, the Vite `preview` server is configured to bind to `0.0.0.0` dynamically assigning `process.env.PORT` to bypass 502 Bad Gateway checks.
- **Cloudflare Pages (`wrangler.jsonc`)**: Configures necessary SPA routing paradigms for robust history API routing on the edge.
- **Vercel (`vercel.json`)**: Predefined SPA rewrite rules for instantaneous Vercel deployments.

*(Note: In production environments like Render, Node `devDependencies` are pruned. Ensure critical tools, such as `vite` or `esbuild`, are defined correctly in the `package.json` `dependencies` block if required by the build script).*

---

## Quickstart & Terminal Operations

Ensure Node.js `>= 18.0.0` and `pnpm` (version 10+) are configured on your workspace machine. This repository strictly utilizes `pnpm`.

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
Launches the Express backend utilizing TSX on the specified port.

### 3. Verification Suite
```bash
# Run structural Vitest units
npx vitest run

# Run strict code pattern linter
pnpm run lint

# TypeScript verification
pnpm exec tsc --noEmit
```

### 4. Compiling & Production Bundling
```bash
# Bundle frontend static build and production CJS server
pnpm run build

# Boot native, self-contained standalone server
pnpm run start
```
