# ChartLens

A high-performance, 100% offline-first quantitative trading simulation engine and paper terminal. It processes clean, text-based market data feeds (structured JSON) through a multi-layered deterministic 4-judge rules engine to support modular portfolio testing, balance syncing, and strict performance metrics in a client-side sandbox environment backed by Firebase Firestore.

---

## 1. Project Overview

ChartLens acts as a robust sandbox for testing algorithmic trading theories. By stripping away real-money risk, it allows traders and quants to validate scalping and trend-following strategies against mathematical constraints.

### Core Features

*   **Offline-First Architecture**: Runs almost entirely client-side using `Float64Array` buffers for high-speed computation, bypassing traditional garbage collection overhead.
*   **Scalping Engine**: Replaces traditional binary options with a deterministic Scalping Engine that evaluates trades as strictly `LONG` or `NO_TRADE`.
*   **Deterministic Mathematical Models**: Utilizes hard-coded, formulaic evaluations (like Z-Score, Wasserstein-2, and Recurrence Quantification Analysis) rather than black-box AI.
*   **Isolated Thread Pool**: Heavy math and technical indicator loops compute on dedicated Web Workers (`src/workers/analysisWorker.ts`) to avoid UI render jitter or thread blockages.
*   **Sync Architecture**: State persistence is driven by a hybrid cache-first scheme matching client storage to a fast cloud backup on Firebase Firestore.
*   **Throttle Guard**: Incorporates a continuous, low-overhead browser wake-lock mechanism preventing background CPU sleep states on inactive tabs.

---

## 2. Technical Architecture & Data Flow

The system ingests raw market JSON, which is then serialized and passed to a background web worker.

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
                   (Rolling Buffers)       (LONG / NO_TRADE)
```

The web worker executes the heavy computation via `src/quant/ruleEngine.ts` and emits `JUDGE_LOG` messages back to the UI, guaranteeing a responsive dashboard even under heavy backtesting loads.

---

## 3. Deep Dive: The 4-Judge Quantitative Core (`src/quant/ruleEngine.ts`)

Decisions are computed through strict pointwise inequalities and complex indicator combinations. The final ruling determines if the market conditions support a `LONG` position, or if they mandate a `NO_TRADE` stance.

### Judge 1 (Candlestick Formations & Momentum)
Evaluates base candlestick structures (Engulfing, Pinbars) and integrates directional consensus from trend strength indicators like ADX.

*   **Wick Rejection Ratio**: Identifies exhaustion by mapping wick sizes against total height:
    $$ \text{RejectionRatio} = \frac{|High - \max(Open, Close)|}{High - Low} $$
*   **ADX Confirmation**: If $ADX > 20$, the trend direction is confirmed by comparing $+DI$ and $-DI$, adding to intrinsic momentum scoring.

### Judge 2 (Oscillator & Trend Vehicle Consensus)
Monitors core system dynamics and divergence:
*   **RSI Divergence**: Uses mathematical divergence detection algorithms against price action.
*   **Z-Score Breakouts**: Evaluates normalized Z-scores across closing prices. A breakout is detected when $|Z| > 2.0$.
*   **MACD Divergence**: Evaluates rate transitions relative to current price behavior.

### Judge 3 (Boundary Reversal & Volatility)
Projects relative closing height against Bollinger boundaries to detect reversals:
*   **$yPercent$ Scale**:
    $$ yPercent = \frac{Close_{current} - Boll_{Lower}}{Boll_{Upper} - Boll_{Lower}} $$
    Triggers reversals on boundary touches ($yPercent < 0.15$ or $yPercent > 0.85$).
*   **Triple Wick Rejection**: If 3 consecutive candles exhibit highs (or lows) within a $0.3\%$ spread while in an extreme boundary zone, rejection is strongly confirmed.
*   **Fair Value Gaps (FVG)**: Detects 3-candle imbalance zones where gap sizes exceed $0.3 \times ATR$.

### Judge 4 (The Skeptic Veto)
Acts as a dynamic risk-gating mechanism. It heavily penalizes confidence scores or forces `NO_TRADE` verdicts if:
*   Historical ATR drifts past $2.5\sigma$.
*   Sensors detect physics violations (e.g. $High < Low$).

### Hurst Regime Balancer
Analyzes Rescaled Range (R/S) limits to automatically adjust scoring coefficients:
*   **Trending ($H \ge 0.55$)**: Scales continuation metrics up by $1.35\times$.
*   **Mean-Reverting ($H \le 0.45$)**: Prioritizes boundary setups by adjusting weights $1.5\times$.

---

## 4. Advanced Mathematics (`src/quant/mathEngine.ts`)

ChartLens implements cutting-edge quantitative mathematics to model series behavior:

### Z-Score Candle Significance
Moving beyond simple body calculations, the Z-Score engine evaluates the *total range* (high - low) of candles against a 21-period history, implementing an absolute floor (0.1% of mean price) to prevent micro-moves from artificially inflating significance during flat markets.

### Wasserstein-2 Distance (Sinkhorn Algorithm)
Used for pattern recognition by measuring geometric similarity between the current chart segment and historical prototypes. Both series are normalized to $[0, 1]$, and iterative Sinkhorn iterations calculate the cost matrix (Euclidean distance squared).

### Recurrence Quantification Analysis (RQA)
Quantifies deterministic chaos and market memory. It computes:
*   **Recurrence Rate**: The baseline density of similar price structures.
*   **Determinism (DET)**: The percentage of recurrence points forming diagonal lines.
*   **Laminarity (LAM)**: The percentage of recurrence points forming vertical lines (price stalls).

---

## 5. Directory Structure

```
├── src/
│   ├── components/  # React Native Web UI, HUDs, Dashboards
│   ├── quant/       # Mathematical Models & Deterministic Engines
│   │   ├── indicators.ts      # Standard Indicators (RSI, Bollinger)
│   │   ├── mathEngine.ts      # RQA, Wasserstein, Z-Scores
│   │   ├── ruleEngine.ts      # The 4-Judge evaluation matrix
│   │   └── marketStructure.ts # Swings, BOS, CHoCH
│   ├── services/    # Ticker feeds and Firebase Bindings
│   ├── workers/     # Web Worker Thread Pool (analysisWorker.ts)
│   └── vision/      # Price geometry and pipeline alignment
```

---

## 6. Setup & Installation

**Prerequisites:** Node.js `>= 18.0.0`, `pnpm` package manager.

### 1. Installation
Clone the repository and install dependencies specifically using `pnpm`:

```bash
git clone https://github.com/sweyjotdhillon-cmd/Ai-Trading.git c-chartlens
cd c-chartlens
pnpm install
```

### 2. Environment Configuration
For live persistence, configure Firebase securely in your root `.env` file (never hardcode these in source files!):

```
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 3. Local Development Terminal
Boot the local Vite instance on `0.0.0.0` (port dynamically mapped if deployed):

```bash
pnpm run dev
```

---

## 7. Verification & Deployment Scripts

ChartLens uses `Vitest` and `ESLint`.

```bash
# Run the structural test suite
npx vitest run

# Run strict code pattern linter
pnpm run lint

# Bundle frontend static build and compile production CJS server
pnpm run build

# Boot the native, standalone express server (dist/server.cjs)
pnpm run start
```

### Deployment Specifications

*   **Render Web Service**: Render overrides standard settings. The express server must dynamically bind to `process.env.PORT`. Additionally, `NODE_ENV=production` skips devDependencies, so critical tools (like `vite`) must be in standard dependencies. A clean build via `pnpm build` is required.
*   **Cloudflare Pages**: Supported via SPA routing definitions in `wrangler.jsonc`. Run `pnpm run deploy:cf`.
*   **Vercel**: Execute `pnpm run deploy:vercel`.
