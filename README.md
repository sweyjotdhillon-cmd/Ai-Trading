# ChartLens

A high-performance, offline-first & live-enabled quantitative trading simulation engine, vision-based chart analyzer, and paper trading terminal. ChartLens processes live stock feeds (via Express backend proxies and Twelve Data) as well as raw chart screenshots through an offline Computer Vision (OCR/OHLC) extraction pipeline and a multi-layered deterministic 4-Judge Quantitative Rules Engine backed by Firebase Firestore.

---

## Technical Architecture

```
  ┌───────────────────────────┐         ┌───────────────────────────┐
  │  Chart Image Screenshots  │         │  Live Data Feeds (JSON)   │
  │   (PNG / JPG / Canvas)    │         │ (Yahoo / Twelve Data API) │
  └─────────────┬─────────────┘         └─────────────┬─────────────┘
                │                                     │
                ▼                                     ▼
  ┌───────────────────────────┐         ┌───────────────────────────┐
  │   Vision Extraction Pipeline │         │ Chronological Feed Service│
  │ (OCR, Hough, Axis, OHLC)  │         │  (Yahoo / Twelve Data)    │
  └─────────────┬─────────────┘         └─────────────┬─────────────┘
                │                                     │
                └──────────────────┬──────────────────┘
                                   │
                                   ▼
             ┌───────────────────────────────────────────┐
             │       WEB WORKER TASK SCHEDULER           │
             │       (`src/workers/analysisWorker.ts`)   │
             │                                           │
             │  ┌───────────────────┐ ┌────────────────┐ │
             │  │ TECHNIQUE SHARDS  │ │ 4-JUDGE MATRIX │ │
             │  │ (Min 10 Consensus)│ │  (ruleEngine)  │ │
             │  └─────────┬─────────┘ └────────┬───────┘ │
             └────────────┼────────────────────┼─────────┘
                          ▼                    ▼
                [ Scalping Engine ]    [ Verdict Decision ]
                (LONG vs NO_TRADE)   (BULL / BEAR / NO_TRADE)
```

- **Vision-to-Quant Pipeline**: Processes chart screenshots through custom image segmentation, Hough line transforms, digit template OCR, and OHLC extraction (`src/vision/`) to generate numerical price series offline.
- **Isolated Thread Pool**: Heavy math, technical indicator loops, and image analysis compute on dedicated Web Workers (`src/workers/analysisWorker.ts`) to keep the 60fps 3D UI fluid.
- **Deterministic 4-Judge Matrix & Technique Shard Engine**: Evaluates technical indicators, candlestick geometries, volatility boundaries, and risk vetoes. Enforces a strict consensus of $\ge 10$ active technique shards for signal generation.
- **Long-Only Scalping Engine**: Micro-scalping algorithm utilizing swing pivots, ATR volatility ranges, and VWAP proxies to produce high-probability `LONG` or `NO_TRADE` execution signals.
- **Hybrid Data Architecture**: Operates with zero API keys required for stock price lookups (served via custom Express backend querying Yahoo Finance) alongside optional Twelve Data integration and simulated off-market micro-fluctuations for 24/7 terminal operation.
- **Modern 3D & Native Web UI**: Built with React 18, Vite, Three.js (`@react-three/fiber`), and React Native Web (`twrnc`, `lucide-react`).

---

## Core Directory Map

```
├── server.ts            # Custom Express server with Yahoo Finance price lookup proxies
├── src/
│   ├── components/      # UI Dashboards, Scalp Copilot HUD, Backtest & Balance views
│   │   └── hero/        # Three.js 3D particles, rings, and candle scenes
│   ├── config/          # Quant engine thresholds, scalp parameters, feature flags
│   ├── constants/       # Indicator default definitions and lot sizes
│   ├── hooks/           # `useBotLoop`, `useStockFeed`, `useScalpPositionWatcher`, wake lock
│   ├── quant/           # Quantitative mathematical engine & signal evaluators
│   │   ├── ruleEngine.ts        # Deterministic 4-Judge evaluation & scoring
│   │   ├── scalpingEngine.ts    # Long-only scalping execution engine
│   │   ├── techniqueEngine.ts   # Shard evaluator enforcing technique consensus
│   │   ├── mathEngine.ts        # Hurst Exponent, Z-Score, R/S regime balancer
│   │   ├── marketStructure.ts   # BOS, CHoCH, and Swing Pivot detection
│   │   ├── indicators.ts        # RSI, MACD, Stochastic, EMA, Bollinger, VWAP
│   │   └── riskGuard.ts         # Drawdown limits, trailing SL/TP, and cooldowns
│   ├── services/        # Twelve Data API, Yahoo proxy feed, Firestore persistence
│   ├── vision/          # Offline Computer Vision & OCR chart extraction engine
│   │   ├── ohlcExtractor.ts     # Candlestick extraction from image pixels
│   │   ├── axisReader.ts        # Axis digit detection and coordinate mapping
│   │   ├── ocr.ts               # Custom template-matching digit OCR
│   │   ├── hough.ts             # Line detection for grid lines and axes
│   │   └── pipeline.ts          # End-to-end vision processing pipeline
│   ├── utils/           # Single analysis runners, anti-imagination guards, storage
│   └── workers/         # Background Web Worker for multi-threaded analysis
```

---

## Quantitative & Vision Core

### 1. Computer Vision Pipeline (`src/vision/`)
When a user uploads a chart image or triggers visual analysis:
1. **Preprocessing & Color Calibration**: Binarizes images using Otsu thresholding and isolates green/red candle color masks (`preprocess.ts`, `colorCalibration.ts`).
2. **Axis & Grid Detection**: Uses Hough transforms and connected components to locate horizontal/vertical price and temporal axes (`hough.ts`, `axisReader.ts`).
3. **Digit OCR**: Matches axis numbers against stored digit templates to calibrate coordinate-to-price ratios (`ocr.ts`, `digitTemplates.ts`).
4. **OHLC Extraction**: Traces candlestick wicks and bodies across pixel columns to construct a verified `ohlcSeries` array (`ohlcExtractor.ts`, `pixelScanner.ts`).

### 2. The 4-Judge Quantitative Matrix (`ruleEngine.ts`)
Price series are evaluated by four distinct deterministic judges:

- **Judge 1 (Candlestick Formations)**: Identifies bullish/bearish candle geometries (Engulfing, Pinbars, Hammers) by mapping wick ratios against total height ($\ge 0.55$ threshold for wick exhaustion).
- **Judge 2 (Oscillators & Indicators)**: Evaluates trend momentum across EMA(9)/EMA(21) intersections, Bollinger Bands, RSI momentum, MACD rate transitions, and Stochastic oscillators.
- **Judge 3 (Volatility Boundary Positioning)**: Projects relative closing price within Bollinger bounds ($yPercent = \frac{Close - Boll_{Lower}}{Boll_{Upper} - Boll_{Lower}}$) to flag reversal zones ($yPercent < 0.15$ or $> 0.85$).
- **Judge 4 (Skeptic Risk Veto)**: Rejects setups if historical ATR drifts past $2.5\sigma$, if price Z-scores signal extreme overextension, or if market condition gates fail.

### 3. Technique Shard Engine (`techniqueEngine.ts`)
Complementing the 4-Judge matrix, the Technique Engine evaluates a broad library of technical setup shards (`techniqueLibrary.ts`). A minimum consensus of **10 active techniques** must pass to validate a non-bypassed quantitative signal.

### 4. Long-Only Scalping Engine (`scalpingEngine.ts`)
Tailored for intraday momentum scalping:
- Identifies micro market structures (`findSwingPivots`, BOS/CHoCH).
- Uses VWAP proxies (`vwapProxy.ts`) and ATR expansion filters to compute structural Stop-Loss (SL) and resistance Take-Profit (TP) levels.
- Emits explicit `LONG` or `NO_TRADE` execution signals with exact position sizing and risk-reward metrics.

---

## Quickstart & Terminal Operations

Ensure Node.js `>= 18.0.0` and `pnpm` (`>= 10.0.0`) are installed on your machine.

### 1. Installation
```bash
git clone https://github.com/sweyjotdhillon-cmd/Ai-Trading.git c-chartlens
cd c-chartlens
pnpm install
```

### 2. Development Terminal
```bash
pnpm run dev
```
Launches the local Express backend server with Vite middleware hot-reloading.

### 3. Testing & Verification Suite
```bash
# Run structural Vitest unit test suite
pnpm exec vitest run

# Run strict ESLint checks
pnpm lint
```

### 4. Building & Production Deployment
```bash
# Bundle frontend static assets and compile standalone CJS Express server
pnpm run build

# Boot the production Express server
pnpm start
```

---

## Deployment Configuration

ChartLens supports multiple deployment targets:
- **Render Web Service**: Render executes `pnpm run build` and boots via `pnpm start`. The compiled server (`dist/server.cjs`) binds dynamically to `process.env.PORT`.
- **Cloudflare Pages**: Deployed via `pnpm run deploy:cf` using `wrangler.jsonc` SPA configuration.
- **Vercel**: Deployed via `pnpm run deploy:vercel`.
