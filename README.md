# ChartLens

A high-performance, 100% offline-first quantitative trading simulation engine and paper terminal. It processes clean, text-based market data feeds (structured JSON) through a multi-layered deterministic 4-judge rules engine to support modular portfolio testing, balance syncing, and strict performance metrics in a client-side sandbox environment backed by Firebase Firestore.

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

- **Isolated Thread Pool**: Heavy math and technical indicator loops compute on dedicated Web Workers (`src/workers/analysisWorker.ts`) to avoid UI render jitter or thread blockages. The image analysis pipeline delegates heavy image processing tasks (like pixel extracting) to an isolated Web Worker pool.
- **GC Optimization**: High-speed backtests operate over contiguous physical memory blocks (`Float64Array` buffers) to bypass normal garbage-collection overhead.
- **Sync Architecture (Firebase)**: State persistence is driven by a hybrid cache-first scheme matching client storage to a fast cloud backup on Firebase Firestore. Configuration must be provided securely via Vite environment variables (e.g., `VITE_FIREBASE_API_KEY`) accessed through `import.meta.env`.
- **Throttle Guard**: Incorporates a continuous, low-overhead browser wake-lock mechanism preventing background CPU sleep states on inactive tabs.
- **Build System & Shims**: The project utilizes Vite for the frontend and esbuild for compiling the custom Express backend (`server.ts`) to CommonJS (`dist/server.cjs`). The Vite configuration uses aliases to support React Native Web, mapping `react-native` to `react-native-web` and pointing native component logic to custom shims.
- **Deployment Strategy**: Supports deployment to Cloudflare Pages (via `wrangler.jsonc`), Render, and Vercel. For Render (which sets `NODE_ENV=production`), Vite's `preview` server is configured to bind to host `0.0.0.0` and dynamically listen to `process.env.PORT` to satisfy health checks.

---

## Core Directory Map

```
├── src/
│   ├── components/  # Responsive HUDs, dashboards, and portfolio stats models
│   │   ├── cognitive/ # Reusable cognitive UI components (ConfidenceBadge, ReflectionCallout, RiskBoundaryCard)
│   ├── quant/       # Indicators, 4-judge matrix, market structure, risk guards
│   │   ├── indicators.ts      # ADX (DI+/DI-), RSI, Bollinger Bands, MACD, HLC/3 VWAP
│   │   ├── marketStructure.ts # BOS, CHoCH, and Swing Pivot tracking
│   │   ├── ruleEngine.ts      # Multi-judge validation & scoring invariants
│   │   └── riskGuard.ts       # Drawdown controls and cooldown mechanisms
│   ├── services/    # Live ticker feeds, historical proxies, and Firestore bindings
│   ├── workers/     # Multi-threaded background data tasks
│   └── utils/       # Timezone mappings (IST) and browser storage adapters
```

---

## 4-Judge Quantitative Core

Decisions are computed through strict pointwise inequalities inside `ruleEngine.ts`. The quantitative rule engine (`evaluateSignal`) enforces a minimum of 10 techniques for non-bypassed analysis to ensure strong consensus.

### Judge 1 (Candlestick Formations)
Identifies core candle patterns (Engulfing, Pinbars, Hammers) by mapping wick ratios against total height:
$$\text{RejectionRatio} = \frac{|High - \max(Open, Close)|}{High - Low}$$
Requires a $\ge 0.55$ threshold to qualify as wick exhaustion.

### Judge 2 (Mathematical Trend Lines & Oscillators)
Monitors core system dynamics using a suite of indicators:
- **EMA Intersections**: Compares short EMA(9) against long EMA(21).
- **Bollinger Extensions**: Measures rolling standard deviations to identify extreme price borders.
- **Oscillators**: Evaluates MACD (`macd`, `getmacd`) alongside RSI and Stochastic to determine momentum and divergence.

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

Ensure Node.js `>= 18.0.0` is configured on your workspace machine. The project uses `pnpm` as its primary package manager.

### 1. Installation
```bash
git clone https://github.com/sweyjotdhillon-cmd/Ai-Trading.git c-chartlens
cd c-chartlens
pnpm install
```

*Note: Render uses strict package installation commands (like `frozen-lockfile`). If `package.json` is modified, you must regenerate and commit the updated `pnpm-lock.yaml` (by running `pnpm install` locally) to prevent deployment failures.*

### 2. Live Development Terminal
```bash
pnpm run dev
```
Launches high-performance local web interfaces with instant state reload configurations.

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
*Note: To simulate Render's production build locally and verify build commands before submission, run `NODE_ENV=production pnpm run build`.*

---

## Testing & Quality Assurance

- **Vitest**: Run units using `pnpm exec vitest run`. Note: The test suite contains a known flaky test in `src/quant/__tests__/horizon.test.ts` involving random walk logic which can be safely ignored if it fails occasionally.
- **ESLint**: Run `pnpm run lint`. Avoid global `pnpm run lint --fix` executions to prevent unintentional formatting changes across the codebase; scope lint fixes only to modified files.
- **TypeScript Strictness**: Run `pnpm exec tsc --noEmit` for type checking. Safely rename unused variables to start with an underscore (e.g., `_analysisStep`) rather than deleting them if they are required.

---

## Development Workflow & Contributing

- **Component Standards**:
  - Standardize on using the `lucide-react` library for UI icons.
  - For React Native UI components, icon-only `<Pressable>` elements must always include descriptive `accessibilityLabel` and `accessibilityRole="button"` props to ensure proper screen reader support.
- **Vite Fast Refresh**: To prevent React Fast Refresh errors, never export hooks, constants, or non-component functions from files containing React components; extract them into dedicated modules.
- **No `npm` or `yarn`**: Never use `npm` or `yarn` in this repository. Avoid using `npx` for local packages to prevent resolution errors; always use `pnpm exec`.
- **Environment Settings**: If unable to make direct code changes for Render environment variables or dashboard settings, manual changes in 'Settings → Environment' or 'Settings → Build & Deploy' on the platform may be required.
