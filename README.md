# ChartLens

A high-performance, 100% offline-first quantitative trading simulation engine and paper terminal. It processes clean, text-based market data feeds (structured JSON) and visual chart data via offline optical extraction through a multi-layered deterministic 4-judge rules engine to support modular portfolio testing, balance syncing, and strict performance metrics in a client-side sandbox environment backed by Firebase Firestore.

---

## 📖 Overview

ChartLens is designed to simulate advanced algorithmic trading without relying on constant server-side processing. It leverages modern web technologies (Web Workers, Float64Arrays, WebGL via Three.js) to perform computationally expensive quantitative analysis directly in the browser. It features a React Native Web UI, supporting cross-platform accessibility, and implements a robust "vision" pipeline capable of reading standard financial charts optically when direct API data isn't available.

## ✨ Core Features

*   **100% Offline-First Architecture**: Runs heavy quantitative models in the browser using Web Workers.
*   **Deterministic Rule Engine**: A strict 4-judge validation matrix for signal generation (Candlesticks, Trend, Volatility, Risk).
*   **Vision Pipeline**: Client-side optical extraction of OHLC (Open, High, Low, Close) data from chart images using custom OCR and pixel scanning techniques.
*   **Long-Only Scalping Engine**: Evaluates `LONG` or `NO_TRADE` signals using technical indicators like VWAP, ATR, and swing pivots.
*   **Cross-Platform UI**: Built with React Native Web, utilizing `motion/react` for fluid animations and Lucide for iconography.
*   **Cloud Sync**: Hybrid cache-first state persistence backed by Firebase Firestore.
*   **Throttle Guard**: Employs continuous low-overhead browser wake-locks to prevent background CPU sleep on inactive tabs.

## 🛠️ Technology Stack

*   **Frontend**: React 18, React Native Web, TailwindCSS, Motion (Framer Motion), Vite.
*   **Quantitative Engine**: Custom Float64Array-based indicators, Math/Stat libraries (Simple-Statistics, D3).
*   **Vision & Graphics**: Three.js (@react-three/fiber), postprocessing, raw Canvas API.
*   **Backend / Server**: Custom Express server compiled to CJS via esbuild.
*   **Database**: Firebase Firestore.
*   **Testing**: Vitest (Unit), Playwright (E2E).
*   **Package Manager**: `pnpm` (Strictly enforced).

---

## 🏗️ Technical Architecture

```
                       [ RAW TEXT DATA FEEDS (JSON) / VISION IMAGES ]
                                      │
                                      ▼
                        Chronological Series Ingestion / OCR Extraction
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
                   (Rolling Buffers)     (LONG / NO_TRADE)
```

- **Isolated Thread Pool**: Heavy math and technical indicator loops compute on dedicated Web Workers (`src/workers/analysisWorker.ts`) to avoid UI render jitter or thread blockages. Progress and judge evaluation logs are communicated back to the frontend via `JUDGE_LOG` messages.
- **GC Optimization**: High-speed backtests operate over contiguous physical memory blocks (`Float64Array` buffers) to bypass normal garbage-collection overhead.
- **Vision Pipeline (`src/vision/pipeline.ts`)**: When image data is provided, `buildPipelineResult` runs pixel extraction (`extractOHLCFromPixels`) and axis reading to generate `ohlcSeries`. It handles normalized fallbacks if axis reading lacks confidence.
- **Sync Architecture**: State persistence is driven by a hybrid cache-first scheme matching client storage to a fast cloud backup on Firebase Firestore.

---

## 📂 Core Directory Map

```
├── src/
│   ├── components/  # Responsive HUDs, dashboards, and portfolio stats models (React Native Web)
│   ├── quant/       # Indicators, 4-judge matrix, market structure, risk guards
│   │   ├── indicators.ts      # ADX (DI+/DI-), RSI, Bollinger Bands, HLC/3 VWAP
│   │   ├── marketStructure.ts # BOS, CHoCH, and Swing Pivot tracking
│   │   ├── ruleEngine.ts      # Multi-judge validation & scoring invariants
│   │   └── riskGuard.ts       # Drawdown controls and cooldown mechanisms
│   ├── services/    # Live ticker feeds, Firebase Firestore bindings, Bot Trade management
│   │   ├── botTradeService.ts # Manages automated trade executions
│   │   └── firebase.ts        # Firebase initialization and auth
│   ├── vision/      # Offline Optical Price Extraction Pipeline
│   │   ├── pipeline.ts        # Core `buildPipelineResult` orchestrator
│   │   ├── ocr.ts             # Optical Character Recognition for price labels
│   │   └── pixelScanner.ts    # Extracts raw candle geometry from images
│   ├── workers/     # Multi-threaded background data tasks (`analysisWorker.ts`)
│   └── utils/       # Timezone mappings (IST) and browser storage adapters
```

---

## ⚖️ 4-Judge Quantitative Core

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

## 📐 Geometry Alignment & Synchronizations

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

## ⚙️ Environment Configuration

ChartLens requires environment variables to connect to Firebase and other services. Create a `.env` file in the root directory (never commit this file).

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```
*Note: Ensure all Firebase configuration variables are prefixed with `VITE_` to be exposed to the client-side code.*

---

## 🚀 Quickstart & Terminal Operations

Ensure Node.js `>= 18.0.0` is configured on your workspace machine. This project **strictly uses `pnpm`**. Never use `npm` or `yarn`.

### 1. Installation
```bash
git clone https://github.com/sweyjotdhillon-cmd/Ai-Trading.git c-chartlens
cd c-chartlens
pnpm install
```
*Note: Running `pnpm install` locally may update `pnpm-lock.yaml`. If `package.json` was not modified, revert the lockfile before committing. If `package.json` was modified, the updated lockfile must be committed.*

### 2. Live Development Terminal
```bash
pnpm run dev
```
Launches high-performance local web interfaces on port `3000` (or dynamically assigned) with instant state reload configurations.

### 3. Compiling & Production Bundling
```bash
# Bundle frontend static build and production CJS server (dist/server.cjs)
pnpm run build

# Boot native, self-contained standalone server
pnpm run start
```

---

## 🧪 Testing Strategy

ChartLens uses Vitest for unit testing quantitative algorithms and Playwright for frontend verification.

### Running Unit Tests
```bash
# Run structural Vitest units across quant systems
npx vitest run
```
*Note: Expect some pre-existing failures in certain quant modules (`evaluateSignal.test.ts`, `scalpingEngine.test.ts`, etc.) which are known issues. UI components in `src/components/` do not currently have dedicated Vitest tests.*

### Linting & Type Checking
```bash
# Scope linting specifically to modified files to prevent global format changes
pnpm lint

# Strict type checking
pnpm exec tsc --noEmit
```

---

## ☁️ Deployment

ChartLens is designed to deploy on Render (Web Service) and Cloudflare Pages (SPA).

### Render Deployment
Render automatically sets `NODE_ENV=production`, causing package managers to skip `devDependencies`.
1.  **Build Command:** `pnpm install && pnpm run build`
2.  **Start Command:** `pnpm run start` (or `node dist/server.cjs`)
3.  **Port Binding:** Render injects the `PORT` environment variable. The Express backend (`server.ts`) and Vite preview server (`vite.config.ts`) must dynamically bind to `process.env.PORT` to pass health checks and prevent 502 Bad Gateway errors. Do not hardcode ports in production.
4.  **Settings:** Render Dashboard settings (Build Command, Start Command) override `render.yaml` configurations.

### Cloudflare Pages
SPA routing is supported via the `wrangler.jsonc` file for Cloudflare Pages.
```bash
# Deploy to Cloudflare Pages
pnpm run deploy:cf
```
