# ChartLens: Pure Text-Based Quantitative Market Analysis Terminal

ChartLens is a high-performance, 100% offline-first quantitative trading simulation terminal. It ingests pure text-based market data (structured JSON feeds) via high-fidelity proxy pipelines and utilizes a multi-layered deterministic rule engine to run granular trade simulations, pattern corroboration, and paper portfolios entirely in a client-side environment with persistent Firebase cloud storage.

---

## 1. System Architecture & Tech Stack

```
                              [ YAHOO FINANCE PROXY PIPELINES ]
                                              │
                                              ▼
                                 Pure Text JSON API Ingestion
                                              │
                                              ▼
                         Chronological Series Assembly & Clean up
                                              │
                                              ▼  (100% Isolated Thread Interface)
   ┌──────────────────────────────────────────┴──────────────────────────────────────────┐
   │                                WEB WORKER TASK SCHEDULER                            │
   │                              (`src/workers/analysisWorker.ts`)                      │
   │                                                                                     │
   │   ┌────────────────────┐     ┌─────────────────────┐     ┌──────────────────────┐   │
   │   │  SERIES PARSING    │     │ METRIC CALIBRATION  │     │ 4-JUDGE RULE MATRIX  │   │
   │   │ (Float64Array)     │     │ (Price Alignment)   │     │ (`ruleEngine.ts`)    │   │
   │   └─────────┬──────────┘     └──────────┬──────────┘     └──────────┬───────────┘   │
   └─────────────┼───────────────────────────┼───────────────────────────┼───────────────┘
                 │                           │                           │
                 ▼                           ▼                           ▼
        [ Temporal Series ]       [ Base Scale Normalization ] [ Quantitative Verdict ]
        (Rolling buffers)           (Interval Coordinate Sync)   (BULL / BEAR / NO_TRADE)
```

*   **Asynchronous Engine**: Intense technical indicators, market structures, and regulatory rulesets are evaluated inside concurrent Web Workers (`src/workers/analysisWorker.ts`). This guarantees fluid UI interaction at 60 FPS by freeing the main execution thread.
*   **Buffer Optimizations**: Utilizes contiguous memory segments and specialized arrays (`Float64Array`) for rapid mathematical iterations over historical lookback buffers without garbage collection spikes.
*   **Persistent Sync Layer**: Binds local cache configurations with an active Firebase Firestore DB (`src/services/firebase.ts`) to manage virtual balances, custom client indicators, running trades, and historic audit logs.
*   **Anti-Throttling Guard**: Incorporates a background audio wake-lock controller (`src/hooks/useWakeLock.ts`) to maintain live update cycles when page tabs undergo aggressive browser sleep cycles.
*   **Visual Interface**: Engineered with styled Tailwind CSS layouts, Lucide icons, and a low-latency WebGL canvas driven by Three.js (`src/components/HeroScene.tsx`) rendering responsive particle compositions.

---

## 2. Low-Latency File Structure

*   `src/components/`: Viewholders, active trade dashboards, portfolio charts, and `LossAutopsyModal.tsx`.
*   `src/quant/`: Technical and algorithmic components including:
    *   `indicators.ts`: Wilder’s ADX (+DI/-DI), RSI, Bollinger Bands, and HLC/3 VWAP computations.
    *   `marketStructure.ts`: Swings, pivots, structures (BOS, CHoCH), and structural stop-losses.
    *   `ruleEngine.ts` / `scalpingEngine.ts`: Direct 4-Judge arbitration pipeline and positional gating.
    *   `riskGuard.ts` / `neutralityGuard.ts`: Trailing drawdowns, automatic cooling periods, and bias mitigation.
*   `src/services/`: Core real-time price feeds, Yahoo Finance multi-proxy fallback chains, and Firestore sync.
*   `src/utils/`: High-resolution timezone utilities (`istUtils.ts`), data serializations, and logging adapters.

---

## 3. Pure Text Data Ingestion & Calibration Pipeline

Rather than relying on noisy camera feeds or imprecise OCR models, ChartLens processes high-quality, pure-text stock feeds:

1.  **Multi-Proxy Request Traversal**: Employs an active fallback proxy chain (AllOrigins, Codetabs, and local-server fallbacks) to fetch clean historical JSON endpoints directly from Yahoo Finance without CORS blocks or API key overheads.
2.  **Series Validation**: Sanitizes data arrays to filter undefined timestamps or missing OHLC fields. If a feed is unavailable, the engine generates mathematical fallback candlesticks using Brownian motion scaled to the asset's last known trade price.
3.  **Coordinate Mapping**: Converts raw JSON candlestick structures into normalized UI chart coordinate scales, tracking exact mathematical parameters for geometric canvas rendering.

---

## 4. The Client-Side 4-Judge Quantitative Rules Engine

Analyses sequential, text-based data arrays through strict, pointwise mathematical inequalities in `ruleEngine.ts`:

### Judge 1 (Anatomical Candlestick Patterns)
Analyzes candle shapes relative to their neighbors. Validates structural formations (e.g., Hammer, Pinbar, Bullish/Bearish Engulfing, Shooting Star) by evaluating wick ratios against total body length:
$$RejectionRatio = \frac{|High - \max(Open, Close)|}{High - Low}$$
Requires $RejectionRatio \ge 0.55$ to qualify for wick exhaustion setups.

### Judge 2 (Mathematical Crossings & Volatility Boundaries)
Tracks trend-following indicators:
*   **EMA Golden / Death Crosses**: Compares short-term EMA(9) against long-term EMA(21).
*   **Bollinger Band Extensions**: Computes rolling standard deviations to determine deviation bands $BB_{Upper, Lower} = \mu(Price) \pm k \cdot \sigma(Price)$.
*   **MACD Divergence**: Monitors the correlation divergence between price actions and MACD signal differentials.

### Judge 3 (Volatility Boundary & Boundary Reversal)
Calculates localized price coordinates within normalized boundaries. The primary variable is $yPercent$:
$$yPercent = \frac{Close_{current} - Boll_{Lower}}{Boll_{Upper} - Boll_{Lower}}$$
High-probability reversals require $yPercent < 0.15$ (Bullish) or $yPercent > 0.85$ (Bearish).

### Judge 4 (Skeptic Veto / Vol Gating)
A safety valve monitoring dynamic volatility anomalies. Rejects signals if the ATR (Average True Range) exceeds the upper $2.5 \sigma$ bound on lookbacks or if the Z-score indicates hyper-extended outlier territory.

### Hurst Exponent Regime Balancer
Dynamically scales scoring weights based on the Rescaled Range (R/S) Hurst calculation:
*   **Trending ($H \ge 0.55$)**: Multiplies Judge 1 & 2 (Continuation) scores by $1.35x$; dampens Judge 3 scores.
*   **Mean-Reverting ($H \le 0.45$)**: Multiplies Judge 3 (Exhaustion Reversals) scores by $1.5x$; dampens Continuation signals.

---

## 5. Clock-Synchronized EOD Settlement & Physical Candlestick Geometry

To eliminate simulation drift and ensure perfect mathematical alignment with real market rules, the validation engine runs under strict, physical execution bounds:

```
  BULLISH CANDLESTICK                       BEARISH CANDLESTICK
  
       High                                      High
        │                                         │
    ┌───┴───┐ ◄─── Close (Exit Price Limit)   ┌───┴───┐ ◄─── Open (Entry Level)
    │       │                                 │       │      (Physical Broad Top)
    │       │                                 │       │
    │       │                                 │       │
    └───┬───┘ ◄─── Open (Entry Level)         └───┬───┘ ◄─── Close (Exit Price Limit)
        │          (Physical Broad Bottom)        │
       Low                                       Low
```

### True Physical Candlestick Entry Boundary
Entry and validation levels are derived from the physical opening coordinate of the entry candle body:
*   **Bullish Close**: Opening entry price is fixed at `candle.open` of the physical broad bottom.
*   **Bearish Close**: Opening entry price is fixed at `candle.open` of the physical broad top.

### Sequential Lookback Timeline
To eliminate systemic forward-looking prediction bias (lookahead fallacy):
1.  **Cutoff Identification**: Locate the precise temporal marker coinciding with the trade's entry boundary.
2.  **Historical Parsing**: Extract exactly 1 to 5 preceding absolute candlestick records from the JSON history series based on selected timeframes.
3.  **Analysis Slicing**: Evaluates directional targets using preceding historical values only, preventing future outcomes from leaking into the active decision pipeline.

---

## 6. Mathematical Neutrality & Strict Directional Agnosticism

ChartLens maintains an unbiased, symmetric directional approach to prevent structural market skewing (e.g., Call/Put pricing imbalances under neutral drift):

*   **Pointwise Mirror Symmetry (Invariants I-1, I-6)**: Calculation algorithms evaluate relative properties (wick ratios, Z-score bounds, volatility variances) symmetrically. For inverted price vectors, the engine yields perfectly identical absolute score magnitudes.
*   **Central Neutrality Margin (Invariant I-5)**: Implements an inactive zone in `calculateBoundaryReversal`. Candle closures falling inside the $47.5\% \le yPercent \le 52.5\%$ range evaluate to 0, completely filtering noise in flat regimes.
*   **Zero-Sum Balancer (Invariant I-3)**: If a trending regime is identified ($H \ge 0.55$), the engine increases continuation weights while symmetrically reducing reversal scores, maintaining a standard mathematical scale-sum.
*   **Active Neutrality Enforcement Layer (NEL)**: Tracks output distributions and dynamically adapts bias coefficients if the trailing 20-run sequence starts leaking structural directional drift.

---

## 7. Regulatory Compliance (SEBI India Guidelines)

ChartLens is engineered to operate strictly within the boundaries of Indian market regulations (SEBI and domestic exchanges):

1.  **Educational Scope Only (Non-Advisory Portfolio)**: ChartLens is **NOT registered** with the Securities and Exchange Board of India (SEBI) as an Investment Adviser (IA) under SEBI (Investment Advisers) Regulations, 2013, or as a Research Analyst (RA) under SEBI (Research Analysts) Regulations, 2014. The platform serves purely as a closed-system paper validation utility.
2.  **No Automated Execution (Retail Algorithmic Execution Restrictions)**: In compliance with SEBI Circular `SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013` (governing computerized and API order routing for retail accounts), this app **contains no outbound execution APIs**, automated routing modules, or broker integrations. All activities are manual simulations.
3.  **Volume Proxy Modeling**: Because raw volume vectors cannot be accurately extracted from static images or webcam inputs, indicators requesting volume (e.g., VWAP) utilize an HLC/3 rolling proxy calculation:
$$VWAP_{Proxy} = \frac{\sum (High_t + Low_t + Close_t) / 3}{t_{period}}$$
This represents a volume-neutral estimate and is clearly disclaimed inside UI viewports.
4.  **Enforced Long-only Bias**: Although Short-Selling is structurally permitted under SEBI's intraday short selling guidelines (NSE Circular `CMPL60221`), ChartLens restricts active paper execution purely to long-only positions. Bearish signals are processed strictly as risk mitigation / vetoes.

---

## 8. Local Setup, Development, & Production Hosting

Follow the technical steps below to build, run, test, or host ChartLens natively.

### A. Environment Prerequisites
- **Node.js** >= `18.0.0`
- **npm** or **pnpm** >= `10.0.0`

### B. Quickstart Steps (Local Development)

1. **Clone and Navigate**:
   ```bash
   git clone <repository_url> c-chartlens
   cd c-chartlens
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file at the root level using `.env.example` as a template:
   ```env
   # .env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

4. **Launch Local Dev Server**:
   ```bash
   npm run dev
   ```
   *Runs the high-speed Express middleware with Vite hot module integrations, available locally at `http://localhost:3000`.*

### C. Testing & Validation

Run the comprehensive unit-testing harness verifying mathematical invariants, indicator calculation bounds, and quantitative judge logic:

```bash
# Run tests via Vitest
npx vitest run
```

Run ES-Linter to check strict code guidelines and typing patterns:
```bash
npm run lint
```

### D. Compiling & Production Build (Hosting)

To host the high-performance compiled artifact, execute the production bundling suite:

1. **Build Artifacts**:
   ```bash
   npm run build
   ```
   *This performs two operations sequentially:*
   - Packages the front-end SPA static pages into `/dist` via `vite build`.
   - Compiles and bundles the server-side TypeScript entrypoint into a single self-contained CommonJS target (`/dist/server.cjs`) via `esbuild`.

2. **Execute Production Server**:
   ```bash
   npm run start
   ```
   *Runs the bundled CJS server natively using Node.js without runtime transpilation latency, default port `3000`.*
