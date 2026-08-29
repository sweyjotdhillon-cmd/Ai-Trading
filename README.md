# ChartLens

A high-performance, 100% offline-first quantitative trading simulation engine and paper terminal. It uses a long-only scalping model, relying on deterministic mathematical models utilizing OCR-extracted OHLC data. The system processes text-based market data feeds (structured JSON) through a multi-layered deterministic 4-judge rules engine to support modular portfolio testing, balance syncing, and strict performance metrics in a client-side sandbox environment backed by Firebase Firestore.

---

## System Overview & Features

- **Long-Only Scalping Model**: Optimized for intraday scaling and quantitative trend-following strategies, assessing `LONG` or `NO_TRADE` scenarios dynamically.
- **Deterministic Math Engine**: Evaluates strict patterns using robust OCR-extracted OHLC data through dedicated Web Workers, avoiding LLM hallucinations.
- **Isolated Thread Pool**: Heavy math and technical indicator loops compute on dedicated Web Workers (`src/workers/analysisWorker.ts`) to avoid UI render jitter or thread blockages.
- **GC Optimization**: High-speed backtests operate over contiguous physical memory blocks (`Float64Array` buffers) to bypass normal garbage-collection overhead.
- **Sync Architecture**: State persistence is driven by a hybrid cache-first scheme matching client storage to a fast cloud backup on Firebase Firestore.
- **Throttle Guard**: Incorporates a continuous, low-overhead browser wake-lock mechanism preventing background CPU sleep states on inactive tabs.
- **Custom Backend & Vision Pipeline**: Uses a custom Express backend for direct ticker feeds, proxying through external APIs with Vite. Features a 3D visualization layer using Three.js for deeper market insights.

---

## Tech Stack

**Frontend**:
- React 18 & Vite
- React Native Web (with `twrnc` and `lucide-react` / `lucide-react-native`)
- Three.js (`@react-three/fiber`, `@react-three/drei`) for 3D visualizations
- D3.js & Recharts for advanced charting
- Tailwind CSS

**Backend & Data Processing**:
- Node.js & Express (Custom CommonJS backend bundled via esbuild to `dist/server.cjs`)
- Firebase & Firestore (Client-side sync & auth)
- Papaparse (CSV parsing) & Simple Statistics
- `@google/genai` (For OCR extraction elements)

---

## Technical Architecture

```
                       [ OCR EXTRACTED OHLC DATA / JSON ]
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
                   (Rolling Buffers)     (LONG / NO_TRADE)
```

### Core Directory Map

```text
├── src/
│   ├── components/  # Responsive HUDs, dashboards, and portfolio stats models (React Native Web / React)
│   ├── quant/       # Indicators, 4-judge matrix, market structure, risk guards
│   │   ├── indicators.ts      # ADX (DI+/DI-), RSI, Bollinger Bands, HLC/3 VWAP
│   │   ├── marketStructure.ts # BOS, CHoCH, and Swing Pivot tracking
│   │   ├── ruleEngine.ts      # Multi-judge validation & scoring invariants (`evaluateSignal`)
│   │   ├── mathEngine.ts      # Hurst Exponent, Z-Score Breakout, Volatility Regime
│   │   └── riskGuard.ts       # Drawdown controls and cooldown mechanisms
│   ├── services/    # Live ticker feeds, historical proxies, and Firestore bindings
│   ├── vision/      # Vision pipeline & 3D render abstractions
│   ├── workers/     # Multi-threaded background data tasks
│   └── utils/       # Timezone mappings (IST) and browser storage adapters
```

---

## 4-Judge Quantitative Core (Scalping Engine)

Decisions are computed through strict pointwise inequalities inside `src/quant/ruleEngine.ts` utilizing the `evaluateSignal` function. The process strictly enforces a minimum of 10 techniques for non-bypassed analysis to ensure strong consensus.

### Judge 1 (Candlestick Formations)
Identifies core candle patterns (Engulfing, Pinbars, Hammers) by mapping wick ratios against total height:
$$\text{RejectionRatio} = \frac{|High - \max(Open, Close)|}{High - Low}$$
Requires a $\ge 0.55$ threshold to qualify as wick exhaustion.

### Judge 2 (Oscillators & Mathematical Trend Lines)
Monitors core system dynamics:
- **EMA Intersections**: Compares short EMA(9) against long EMA(21).
- **Bollinger Extensions**: Measures rolling standard deviations to identify extreme price borders.
- **Oscillators**: Uses MACD divergence, RSI, and Stochastic metrics to evaluate rate transitions relative to current price behavior.

### Judge 3 (Volatility Boundary Positioning)
Projects the relative closing height against Bollinger bounds ($yPercent$ scale):
$$yPercent = \frac{Close_{current} - Boll_{Lower}}{Boll_{Upper} - Boll_{Lower}}$$
Triggers setups based on boundary limits and mean-reverting structures.

### Judge 4 (Skeptic Veto)
Acts as a dynamic risk-gating mechanism. Rejects potential trades if historical ATR drifts past $2.5\sigma$ or if price Z-scores identify overextended conditions.

### Hurst Regime Balancer
Analyzes Rescaled Range (R/S) limits to automatically adjust scoring coefficients:
- **Trending ($H \ge 0.55$)**: Scales continuation metrics (J1 & J2) up by $1.35\times$.
- **Mean-Reverting ($H \le 0.45$)**: Prioritizes boundary setups (J3) by adjusting weights $1.5\times$.

---

## Environment Variables

Firebase configuration and other secrets must be provided securely via Vite environment variables and never hardcoded in version-controlled configuration files.

Create a `.env` file in the root directory:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

Access them in the app using `import.meta.env.VITE_FIREBASE_API_KEY`.

---

## Quickstart & Terminal Operations

The project strictly uses **`pnpm`**. Do not use `npm` or `yarn`.
Ensure Node.js `>= 18.0.0` is configured on your workspace machine.

### 1. Installation
```bash
git clone https://github.com/sweyjotdhillon-cmd/Ai-Trading.git c-chartlens
cd c-chartlens
pnpm install
```

### 2. Live Development Terminal
```bash
# Starts Vite frontend and custom Express backend
pnpm run dev
```

### 3. Verification Suite
```bash
# Run structural Vitest units
pnpm exec vitest run

# Run strict code pattern linter
pnpm run lint
```

### 4. Compiling & Production Bundling
```bash
# Bundle frontend static build and production CJS server (esbuild)
pnpm run build

# Boot native, self-contained standalone server
pnpm run start
```

---

## Deployment

ChartLens supports multiple deployment strategies depending on the environment.

### 1. Render (Web Service)
- **Build Command**: `pnpm run build`
- **Start Command**: `pnpm run start`
- **Environment Variables**: Render automatically injects `PORT`. The custom Express server correctly binds to `process.env.PORT` dynamically during runtime. Ensure all `devDependencies` needed for the build (like Vite) are either moved to `dependencies` or the `NODE_ENV` is managed properly during the install phase.

### 2. Cloudflare Pages
SPA routing and Cloudflare Pages deployment is supported via the `wrangler.jsonc` file.
```bash
pnpm run deploy:cf
```

### 3. Vercel
Vercel deployment is configured out of the box using `vercel.json` and package scripts.
```bash
pnpm run deploy:vercel
```
