# ChartLens: Deterministic Client-Side Point-Based Quantitative Chart Analyzer

ChartLens is a high-performance, 100% offline-first, client-side quantitative chart analysis terminal. It combines edge computer vision pipelines with a multi-layered deterministic rule engine to run high-fidelity trading simulation, pattern corroboration, and paper portfolios inside a sandboxed browser environment with Firebase cloud integration.

---

## 1. System Architecture & Tech Stack

```
                                  [ RAW USER CHARTS / CAPTURES ]
                                                │
                                                ▼
                                    Line / Axis Normalization
                                                │
                                                ▼  (Color Space Calibration)
                                     [ homography / OCR / wick ]
                                                │
                                                ▼  (100% Isolated Thread Interface)
   ┌────────────────────────────────────────────┴────────────────────────────────────────────┐
   │                                  WEB WORKER TASK SCHEDULER                              │
   │                                (`src/workers/analysisWorker.ts`)                        │
   │                                                                                         │
   │   ┌────────────────────┐     ┌─────────────────────┐     ┌──────────────────────────┐   │
   │   │  PIXEL RECTIFIER   │     │  CANDLE DIGITIZER   │     │   4-JUDGE RULE MATRIX    │   │
   │   │ (Canny/Sobel/Otsu) │     │ (Axis Price OCR)    │     │   (`ruleEngine.ts`)      │   │
   │   └─────────┬──────────┘     └──────────┬──────────┘     └────────────┬─────────────┘   │
   └─────────────┼───────────────────────────┼─────────────────────────────┼─────────────────┘
                 │                           │                             │
                 ▼                           ▼                             ▼
         [ Temporal Series ]      [ Normalized Coordinates ]     [ Quantitative Verdict ]
         (Float64Array Buffers)     (Real Price Calibration)       (BULL / BEAR / NO_TRADE)
```

*   **Concurrency Engine**: Intense computer vision and indicator math run asynchronously inside dedicated Web Workers (`src/workers/analysisWorker.ts`). The thread pool uses zero-shared memory patterns to prevent cross-symbol signal pollution.
*   **Performance Optimization**: Utilizes `Float64Array` buffers to prevent GC/allocation lags during rapid microsecond-scale historical series iterations.
*   **Persistent Sync Layer**: Bound locally to client-side caches, backed up by a persistent Firebase Firestore instance (`src/services/firebase.ts`) for real-time portfolio balance syncing, risk configuration, and permanent trade history logs.
*   **Hardware Lock-in prevention**: Integrated background Audio Wake-Locks (`src/hooks/useWakeLock.ts`) to bypass modern browser background CPU throttling, keeping backtests and active loops running at precise intervals.
*   **Visual Interface**: Built with styled Tailwind CSS layouts, Lucide icons, and an immersive 3D WebGL background powered by Three.js (`src/components/HeroScene.tsx`) to render low-latency particle system compositions.

---

## 2. Low-latency File Structure

*   `src/components/`: Render layer. Contains HUD overlays, active trade monitor cards, and `LossAutopsyModal.tsx`.
*   `src/quant/`: Algorithmic core containing:
    *   `indicators.ts`: Wilder's ADX (DI+/DI-), RSI, Bollinger Bands, and HLC/3 VWAP calculations.
    *   `marketStructure.ts`: Swings, Structure pivot counters, BOS, CHoCH tracking.
    *   `ruleEngine.ts` / `scalpingEngine.ts`: Standard 4-Judge arbitration and risk criteria gating.
    *   `riskGuard.ts` / `neutralityGuard.ts`: Dynamic drawdown checks, cool-down states, bias buffers.
*   `src/vision/`: Image processing engines (Otsu binarization, wick tracing, OCR, homography matrix).
*   `src/workers/`: Thread-level workers isolating compute workloads from the UI thread.
*   `src/services/`: Core persistence services (trade logging, Firestore sync, Live price feeds).

---

## 3. Pixel Vision Pipeline & Mathematical Data Calibration

Translates static images and raw camera capture matrices into verified `TemporalOHLC` coordinate blocks:

1.  **Spatial Rectification**: Applies homography matrix operations, Otsu binarization, Canny edge detection, and Sobel kernels to project warped chart bounds into standard orthographic flat matrices.
2.  **Color Space Calibration & Wick Tracing**: Isolates bullish/bearish blocks in HSLA space (`src/vision/colorSpace.ts`), using recursive wick tracing algorithms to capture thin candle extremities under varying illumination.
3.  **Dynamic Coordinate Scaling**: Extracts absolute numerical limits from coordinates. Falls back to a localized standard envelope `[10.0, 110.0]` if OCR encounters extreme noise or digit anomalies.

---

## 4. The Client-Side 4-Judge Quantitative Rules Engine

Analyses sequential data arrays through strict, pointwise mathematical inequalities in `ruleEngine.ts`:

### Judge 1 (Anatomical Candlestick Patterns)
Analyzes candle shapes relative to their neighbors. Validates structural formations (e.g. Hammer, Pinbar, Bullish/Bearish Engulfing, Shooting Star) by evaluating wick ratios against total body length:
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
1.  **Cutoff Identification**: Locate the precise temporal marker coinciding with the yellow entry boundary line.
2.  **Historical Parsing**: Extract exactly 3 absolute candlestick objects preceding the start point.
3.  **Analysis Slicing**: Evaluates directional targets using preceding historical values only, preventing future outcomes from entering the decision pipeline.

### Double-Step Confirmation EOD Settlement
Performs clock-synchronized paper trade settlement at IST 15:30.
*   **High-Fidelity Intraday Backfill**: Pulls historical 1-minute candlestick data to resolve Stop-Loss (SL) and Take-Profit (TP) conditions on a granular scale.
*   **Fallback Resolution Rules**: Computes daily High/Low bounds to resolve outcomes in volatile regimes. Marks trades as **Ambiguous** and skips automatic P&L adjustment if both boundaries were breached during the same day.

---

## 6. Mathematical Neutrality & Strict Directional Agnosticism

ChartLens maintains an unbiased, symmetric directional approach to prevent structural market skewing (e.g. Call/Put pricing imbalances under neutral drift):

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
