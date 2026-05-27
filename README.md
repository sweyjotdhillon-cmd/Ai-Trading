# ChartLens: Deterministic Point-Based Chart Analyzer

ChartLens is a highly specialized, 100% offline, fully local browser-based platform engineered to process real-time chart images and camera feeds. It extracts geometrical pricing structures via a machine vision pipeline and applies a point-based quantitative AI rule engine to generate predictive trading signals tailored specifically for short-term time horizons (e.g., binary options, 3-5 minute durations).

The core mission of ChartLens is to democratize quantitative analysis by bringing institutional-grade deterministic mathematical models to retail traders without requiring cloud computing, paid API keys, or remote servers. Everything runs entirely within the user's browser securely.

---

## 1. System Architecture & Tech Stack

The application is built to be a robust, high-performance offline Single Page Application (SPA).

*   **100% Offline Execution**: Designed to operate without external dependencies, API keys (no Google/Firebase/Firestore), or network requests during core analysis. Ensures deterministic, point-in-time verifiable privacy and outcomes.
*   **Core Frameworks**: React 18, React Native Web, and Vite for fast builds and optimized bundling.
*   **Styling**: Tailwind CSS via `twrnc` to maintain cross-platform styling compatibility with React Native conventions.
*   **Visualization & UI**: Three.js / React Three Fiber (`@react-three/fiber`, `@react-three/drei`) for 3D visual components, and Lucide (`lucide-react`) for iconography. UI components use `accessibilityLabel` and `accessibilityRole` instead of standard web ARIA attributes.
*   **Web Worker Concurrency**: The CPU-bound Vision and Quantitative pipelines execute inside dedicated Web Workers (`src/workers/analysisWorker.ts`), preventing the primary UI thread from freezing and maintaining buttery-smooth application responsiveness.
*   **Event Loop Stabilization**: To combat aggressive modern browser throttling of inactive background tabs (specifically impacting background bulk testing), a silent base64 looping audio element (`useWakeLock` equivalent mechanism) forces the JavaScript event loop to remain high-priority.
*   **Memory Management**: Performance-sensitive quantitative math functions (e.g., inside `src/quant/`) strictly allocate and utilize `Float64Array` buffers rather than standard dynamic Javascript `number[]` arrays. This provides deterministic memory layout and enhances iteration performance for deeply recursive or math-heavy indicator logic.

---

## 2. Detailed Codebase Structure (`src/`)

The repository is modularized strictly into logical domains:

*   **`src/components/`**: React UI components (e.g., `LiveAnalysis.tsx`, modals, layout pieces). Handles user interaction, camera access, and rendering results.
*   **`src/config/`**: Global configuration files and feature flags (e.g., `featureFlags.ts`, `patternWeights.ts`).
*   **`src/constants/`**: Immutable application constants and predefined rule thresholds (e.g., `indicators.ts`).
*   **`src/quant/`**: The core quantitative math and trading signal logic. Contains indicators, rule engine, stability filters, and pattern matchers.
*   **`src/shims/`**: Polyfills or compatibility layers (e.g., `codegenNativeComponent.ts`) to ensure smooth operation across different browser environments for React Native.
*   **`src/types/`**: Global TypeScript definitions and interfaces (e.g., `batchManifest.ts`, `types.ts`).
*   **`src/utils/`**: General helper functions, file parsing (`singleAnalysis.ts`), and mathematical utilities.
*   **`src/vision/`**: Image processing logic, OCR, and chart axis extraction. Handles DOM Canvas manipulation, edge detection, and converting pixels to OHLC data.
*   **`src/workers/`**: Contains the critical Web Worker files (`analysisWorker.ts`) which act as the asynchronous bridge between the UI thread and the heavy `quant`/`vision` pipelines.

---

## 3. Deep Dive: Quantitative Pipeline (`src/quant/`)

Operates entirely deterministically on the output of the vision pipeline. The engine evaluates multiple conditions concurrently, outputting a scored prediction based strictly on point-based mathematical models (e.g., Hurst Exponent, Z-Score breakouts, EMA higher-order derivatives).

*   **The Rule Engine (`evaluateSignal` in `src/quant/ruleEngine.ts`)**: The heart of the decision matrix. It requires a parsed OHLC series, horizon context, user-selected techniques, and confirmed patterns.
*   **Strict 10-Technique Rule**: A minimum of 10 techniques (candlestick patterns/indicators) must be provided in `techniquesList` AND at least 10 must mathematically match the chart data to return a valid prediction. Failure defaults the system to `'NO_TRADE'`. (Exception: Unit tests passing `"__TEST_BYPASS__"` in the techniques list).
*   **Scoring Rubric (4-Judge Matrix)**:
    *   **Judge 1 (Trend/Momentum)**: Correlates parsed user techniques (e.g., Engulfing, Marubozu) with the underlying trend via `PATTERN_WEIGHTS_BY_HORIZON`.
    *   **Judge 2 (Oscillator Consensus)**: Aggregates RSI divergence, MACD histogram velocity, and Stochastic boundaries for confirmation logic.
    *   **Judge 3 (Boundary/Reversal)**: Employs percentile mapping (`yPercent`) of the current close against local highs/lows combined with wick-to-body ratio analysis.
    *   **Judge 4 (The Skeptic Multiplier)**: A gating penalty. Evaluates high-order derivatives (Z-Scores, Volatility Regimes, ATR, RQA Determinism/Laminarity) and heavily dampens the final confidence score if erratic market chop or explosive skips are detected.
*   **Hurst Exponent Balancer**: A Hurst Exponent (`rescaledRangeHurst`) dynamically adjusts scoring logic mid-execution, scaling momentum weights upwards during `H > 0.55` (Trending Regimes) and boundary/reversal weights during `H < 0.45` (Mean-Reverting Regimes).
*   **Pattern Recognition & Stability**:
    *   **`patternAdapter.ts`**: Extracts raw candlestick geometries using the `candlestick` library against the synthesized OHLC data.
    *   **`patternStability.ts`**: Filters raw patterns across sequential frames to ensure a pattern isn't just a brief flash of noise, upgrading them to 'confirmed' evidence only if they persist.
*   **Stability Gating (`emitStability` in `stabilityFilter.ts`)**: Emits `STABLE_SIGNAL` events dynamically only after rapid successive frames match identical or close point configurations, blocking noisy, singular 'flash' signals from rendering in the UI.

---

## 4. Deep Dive: Vision Pipeline (`src/vision/`)

The core extraction process relies on transforming raw pixels from an image or live webcam feed into structured temporal data (OHLC series) that the Quant pipeline can read.

*   **Image Processing**: Handles image transformations including edge detection (Sobel/Canny) and Homography transforms to flatten and align skewed source images (e.g., from camera feeds) prior to parsing. Establishes strict dynamic ranges for distinguishing background noise from bullish/bearish candle structures.
*   **Pixel Scanning & OCR**: Identifies candlestick boundary boxes within the rectified image, isolating open, high, low, and close (OHLC) coordinates dynamically.
*   **Chart Axis Extraction**: Maps the raw vertical pixel distances to real-world monetary values via OCR mapping. If OCR validation fails, the system safely falls back to a normalized proportional scale, keeping indicator arithmetic valid based on relative percentage movements rather than absolute dollars.

---

## 5. Web Workers & Performance Guardrails

*   **Concurrency Model**: Communication between the UI (`LiveAnalysis.tsx` / `runSingleAnalysis.ts`) and the background pipeline relies on asynchronous messaging. The `techniquesList` and image data are passed dynamically in payloads to `src/workers/analysisWorker.ts`. The `techniquesList` is parsed as an array of objects extracting both `name` and `description` properties.
*   **Determinism Guards (`runEpsilonGuard`, `runDeterminismGuard`)**: Implemented immediately inside the Web Worker initialization context (e.g., in `analysisWorker.ts`) to fail securely if floating point math is inaccurate or environment instability is present. Guarantees consistency across mathematical operations before processing any user data.

---

## 6. Execution Modes

### A. Live Analysis
Triggered via `runSingleAnalysis`, it translates a live canvas capture into an active prediction payload (`BULL`, `BEAR`, or `NO_TRADE`) based on a point threshold. The frontend flow begins in `LiveAnalysis.tsx` where the image is converted to Base64 via `FileReader`, then passed to `runSingleAnalysis.ts`, which dispatches the data to the background `analysisWorker.ts`. Ties (margins < 3 or raw wins < 7) enforce an explicit neutral outcome.

### B. Bulk Test Mode
When `isTestMode` is asserted, the application simulates real-time chart data ingestion for forward-testing by dividing full historical images into sequential sub-slices using canvas methods (`cropRatio`, `toDataURL`).
1.  **Left Slice (History)**: Fed into the main quantitative pipeline.
2.  **Right Slice (Future)**: Used exclusively to resolve the predicted closing position against the expected outcome duration, grading the model implicitly (`WIN`, `LOSS`, `NEUTRAL`).

*Note: The inputs `investmentAmount` and `profitabilityPercent` are strictly UI-level variables used for calculating simulated profit margins and displaying history/autopsy reports; they are explicitly excluded from the core mathematical analysis engine running in the web worker.*

---

## 7. Development, Deployment, & Test Infrastructure

### A. Testing Setup (Vitest)
*   Vitest handles execution alongside ESLint for linting. Tests are typically located in `__tests__` subdirectories.
*   **Deterministic Randomness**: Tests frequently deal with synthetic series generation. When tests fail due to unpredictable random values generated by synthetic series mock generators (e.g., `Math.random()` in `judgeVerdict.test.ts`), stabilize them by properly mocking `Math.random()` with a deterministic Linear Congruential Generator (LCG) via `vi.spyOn`, rather than weakening the test assertions.

### B. Standard Commands
Always use `pnpm` in this repository. Never use `npm` or `yarn`.

*   **Start Dev Server**: `pnpm dev`
*   **Type Checking**: `npx tsc --noEmit`
*   **Linting**: `pnpm lint` *(Note: Avoid running `--fix` globally to prevent unintentional formatting changes. Scope lint fixes only to modified files)*
*   **Run Tests**: `npx vitest run`
*   **Build Production**: `pnpm build`
*   **Preview Production Build**: `npx vite preview &` (Serves on http://localhost:4173)
*   **Execute Standalone Scripts**: Use `npx tsx <filename>.ts` for rapid execution during testing or debugging.

### C. Deployment (Cloudflare)
*   The project uses Cloudflare for deployment.
*   SPA routing is supported via the `wrangler.jsonc` file and Cloudflare Pages configuration.

---

## 8. Known Flaws, Limitations, and Inactive Features

While ChartLens is highly optimized, there are architectural limitations, inactive features, and technical debt that future iterations should address:

*   **Inactive Code Paths (Feature Flags)**: Several advanced analysis engines are fully written but disabled by default in `src/config/featureFlags.ts` (e.g., `enableCandlestickRepoPatterns` and `enableGapDetection`). They execute and pass tests but do not actively contribute to production quantitative signals unless explicitly enabled.
*   **OCR Extraction Fallbacks**: When the Vision Pipeline's Optical Character Recognition (OCR) fails to read the precise Y-axis values from a camera feed, it safely degrades to a `NORMALIZED_FALLBACK`. While proportional percentage changes remain accurate, absolute price point targets cannot be computed when this fallback is active.
*   **Test Mode Cropping Assumptions**: The Bulk Test Mode's automatic slicing mechanic (`cropRatio`) uses heuristics that assume a 1-minute chart timeframe. Forward-testing a 30-minute chart or other custom timeframes may require manual `candlesInView` overrides to prevent inaccurate temporal cropping.
*   **Production Engine / Test Coupling**: The core quantitative rule engine tightly couples testing logic with production via a `"__TEST_BYPASS__"` string embedded within the techniques list. This internally bypasses the strict 'minimum 10 technique' rule in the rule engine purely to facilitate unit test creation.


## 🌊 ChartLens Image Analysis Architecture: A Deep Dive Pipeline

> **Abstract**: This document provides a *highly detailed*, *highly precise*, and *comprehensive* breakdown of the complete image analysis pipeline within ChartLens. It traces the lifecycle of raw pixel data—from the moment of frontend capture through deterministic machine vision transformations, culminating in the complex algorithmic 4-Judge Matrix scoring model and frontend resolution.

---

### 📸 Phase 1: Frontend Capture & Serialization (`LiveAnalysis.tsx`)

The initial sequence involves capturing user input (live feed or static file) and preparing it for deep processing without blocking the React render thread.

#### 1.1 Image Acquisition
The user initiates the sequence by providing an image source.
- **Live Mode:** Captures a frame directly from the device's camera stream via an HTML5 `<canvas>` snapshot.
- **Test Mode:** Reads an uploaded historical chart image.

#### 1.2 Serialization & Payload Construction
Raw pixel data is voluminous. To efficiently cross the boundary from UI to Web Worker, it is serialized.
- Using the `FileReader` API (for uploads) or `.toDataURL()` (for live streams), the image is encoded into a **Base64 string payload**.
- The `LiveAnalysis` component gathers the required context:
  - `stockTicker`
  - `timeframe` (e.g., 1m, 5m, 15m)
  - `duration`
  - `techniquesList` (An array of user-selected techniques, e.g., `[{name: 'Doji', description: '...'}]`)

#### 1.3 Asynchronous Invocation
The frontend dispatches the serialized payload by calling the asynchronous utility `runSingleAnalysis(params)` located in `src/utils/singleAnalysis.ts`.

---

### 🚀 Phase 2: Web Worker Dispatch (`runSingleAnalysis.ts`)

To maintain buttery-smooth UI performance (specifically for the React Three Fiber animations), ChartLens strictly isolates heavy computation inside a dedicated Web Worker.

#### 2.1 Payload Decoding
Before dispatching to the worker, the Base64 `imageDataUrl` must be parsed back into an intermediate representation, `ImageData`, using `dataUrlToImageData()`.

#### 2.2 Thread Communication Protocol
`runSingleAnalysis` interfaces with the background thread via the `Worker.postMessage` API.
- It posts a strongly-typed message: `{ type: 'ANALYZE', payload: { ... } }`.
- Crucially, the `techniquesList` is dynamically included in this payload, allowing the backend to process only user-selected trading patterns.

#### 2.3 Bulk Test Mode Slicing (Forward-Testing Simulation)
If **Bulk Test Mode** is active, the image is programmatically bifurcated:
- **Left Slice (Historical Context):** Processed by the pipeline to generate a prediction.
- **Right Slice (Future Outcome):** Withheld from the pipeline. Kept exclusively for post-analysis grading against the predicted direction. This slicing is achieved via precise canvas `cropRatio()` calculations.

---

### 🛡️ Phase 3: Worker Initialization & Determinism Guards (`analysisWorker.ts`)

Upon receiving the `ANALYZE` message, the worker thread (`src/workers/analysisWorker.ts`) boots up and enforces strict environment stability rules.

#### 3.1 The Determinism Guards
Because mathematical operations can vary slightly across different CPU architectures or browser engines, ChartLens enforces rigorous consistency checks before analyzing any user data.
- **`runEpsilonGuard()`**: Verifies that floating-point operations do not deviate beyond an acceptable micro-threshold.
- **`runDeterminismGuard()`**: Ensures baseline mathematical functions yield exact, expected outcomes. Failure here aborts the analysis entirely.


#### 3.2 Horizon Context Initialization
The worker calculates the `HorizonContext`, a critical parameter for weighting momentum vs. mean-reversion.
- It evaluates the `graphTimeframeMinutes` against the `investmentDurationMinutes` to determine a structural timeframe ratio `H`.

#### 3.3 Advanced Feature Instantiation & Stability Managers
Prior to processing image payloads, the worker thread spins up highly specialized stateful managers to filter noise from raw mathematical structures:
- **`PatternStabilityManager`**: Initializes a rolling temporal buffer. It exists to track candlestick formations (e.g., Doji, Hammer) over sequential frames.
- **`GapStabilityManager`**: Initializes state to monitor structural price gaps between adjacent candlesticks.

Both managers ensure that transient visual artifacts or brief camera glitches do not prematurely trigger signals; an anomaly must persist across multiple ticks to be upgraded to "confirmed evidence."

---

### 🔬 Phase 3.5: Pre-Quantitative Feature Extraction

Between the raw vision output and the final quantitative matrix, the pipeline performs deep structural analysis on the NumericOHLC array if feature flags permit.

#### 3.5.1 Candlestick Pattern Extraction
If `featureFlags.enableCandlestickRepoPatterns` is true:
- **`extractCandlestickPatterns(ohlcSeries)`**: Scans the numerical series against known geometric definitions (e.g., Engulfing, Marubozu).
- The raw output is immediately piped into the `patternStabilityManager.processFrame(rawPatterns)`.
- The output is an array of PatternEvidence, representing only the geometrically sound and temporally stable structures.

#### 3.5.2 Gap Detection
If `featureFlags.enableGapDetection` is true:
- **`detectLatestGap(ohlcSeries)`**: Scans the most recent temporal blocks for significant disconnections between closing and opening prices (Fair Value Gaps, Runaway Gaps).
- Raw gaps are similarly filtered through `gapStabilityManager.processFrame(latestGap)`.
- The output is an array of GapEvidence.

These strictly confirmed PatternEvidence and GapEvidence arrays are then injected directly into the quantitative `evaluateSignal` payload as fundamental contexts for the 4-Judge Matrix.


---

### 👁️ Phase 4: The Vision Extraction Pipeline (`src/vision/pipeline.ts`)

This phase converts raw color pixels into a structured, chronological array of mathematical OHLC points.

#### 4.1 Rectification & Centering
Source images, particularly from live cameras, are often skewed or unaligned.
- `rectifyOrCenterCrop(imageData)` performs advanced transformations, including Sobel/Canny edge detection and Homography transforms.
- This ensures the chart grid is flattened and orthogonal (vertical and horizontal lines are true to axis).

#### 4.2 Pixel Coordinate Extraction & Color Calibration
- **`extractOHLCFromPixels(rectifiedFrame)`** scans the grid for candlestick geometries.
- **Color Calibration (`EPSILON`):** Uses calibrated RGB tolerances to reliably differentiate bullish bodies (green/white) from bearish bodies (red/black) regardless of ambient monitor glare.
- It precisely maps pixel boundaries to determine the Open, High, Low, and Close for every identified candle.

#### 4.3 OCR Y-Axis Translation
- **`readYAxis(rectifiedFrame)`** attempts to run Optical Character Recognition on the right-hand boundary.
- **Success:** Maps vertical pixel distances to real-world monetary values using a `PriceAxisTransform` slope/intercept model.
- **Failure (`NORMALIZED_FALLBACK`):** If text is unreadable, it falls back to a normalized proportional scale, allowing relative percentage calculations to proceed flawlessly.

#### 4.4 The Output: `NumericOHLC` Array
The culmination of the vision pipeline is an ordered array of `NumericOHLC` objects:
```typescript
export interface NumericOHLC {
  open: number;
  high: number;
  low: number;
  close: number;
}
```

---

### 🧠 Phase 5: The Quantitative Rule Engine (`src/quant/ruleEngine.ts`)

This is the cognitive core of ChartLens. The `evaluateSignal` function ingests the `NumericOHLC[]` and executes a deterministic, matrix-based analysis.

#### 5.1 The Strict 10-Technique Rule
A non-negotiable safety guard:
- The `techniquesList` must contain **at least 10 valid techniques**.
- **At least 10 techniques must mathematically match** the chart data.
- If these conditions are unmet, the engine immediately yields a `'NO_TRADE'` default. *(Note: Unit tests can bypass this via `__TEST_BYPASS__`)*.

#### 5.2 Mathematical Indicator Generation
The engine leverages Typed Arrays (`Float64Array`) exclusively for deep recursive math (RSI, MACD, Bollinger Bands, ATR, Z-Scores). This avoids standard `number[]` array memory allocation overhead, ensuring blazing-fast, deterministic execution.

#### 5.3 The 4-Judge Matrix Scoring System
The algorithm evaluates market conditions through four independent, specialized "Judges", tallying Bull and Bear points:

1. **🧑‍⚖️ Judge 1 (Trend & Momentum):** Analyzes prevailing slope and matched candlestick configurations (e.g., Engulfing, Marubozu). Weights are adjusted based on `PATTERN_WEIGHTS_BY_HORIZON`.
2. **🧑‍⚖️ Judge 2 (Oscillator Consensus):** Evaluates momentum oscillators. Looks for RSI divergence, MACD histogram velocity spikes, and Stochastic boundary crossings.
3. **🧑‍⚖️ Judge 3 (Boundary & Reversal):** Focuses on structural geometry. Uses `yPercent` to determine the close's percentile placement relative to local highs/lows, and assesses wick-to-body ratios to identify exhaustion.
4. **🧑‍⚖️ Judge 4 (The Skeptic Multiplier):** The crucial gating mechanism. It analyzes advanced derivatives like Volatility Regimes, ATR, and Recurrence Quantification Analysis (RQA) Laminarity. If it detects extreme erratic chop, it severely penalizes overall confidence.

#### 5.4 The Hurst Exponent Balancer
During matrix execution, the **Hurst Exponent (`rescaledRangeHurst`)** dynamically modulates scoring weights:
- **`H > 0.55` (Trending):** Amplifies Judge 1 (Momentum).
- **`H < 0.45` (Mean-Reverting):** Amplifies Judge 3 (Reversals).

#### 5.5 Verdict Rendering
Points are aggregated. The side with the most points wins (`BULL` or `BEAR`). However, if the point difference is marginal (< 3) or total conviction is low (< 7 points), it explicitly renders a `NO_TRADE` verdict.

---

### ⚖️ Phase 6: Stability Filtering & UI Resolution

Before the verdict reaches the user, it undergoes temporal stabilization.

#### 6.1 The Stability Filter
To prevent rapid UI flickering due to camera noise or transient glitches, the signal passes through `emitStability(decision)` (in `patternStability.ts`).
- A `STABLE_SIGNAL` is only emitted if multiple sequential frames report the exact same mathematical configuration.

#### 6.2 Worker Response Payload
The worker packages the final `FRAME_RESULT`:
- `signal` (`UP`, `DOWN`, `NO_TRADE`)
- `confidence` percentage
- The point `margin`
- A detailed debug `trace` of Judge scores.

#### 6.3 Frontend Verdict & Grading (Test Mode)
The `runSingleAnalysis` Promise resolves, returning data to `LiveAnalysis.tsx`:
- Raw Judge logs are piped into the UI debugger streams (`onJudgeLogs`).
- If in **Bulk Test Mode**, the withheld Right Slice is now compared against the predicted signal. The system automatically grades the run as a `WIN` or `LOSS`.
- The final state updates React, visually rendering the prediction, confidence gauge, and 3D UI overlays to the user.


## 10. Mathematical Quantitative Models for 3-5 Minute Binary Options

This document outlines six purely deterministic, mathematical models specifically adapted for the 3-5 minute binary options trading horizon. These models rely entirely on Open, High, Low, Close (OHLC) camera-extracted data and eschew subjective "allure" for strict statistical analysis.

### 1. Hurst Exponent (Local Mean Reversion)

The Hurst Exponent ($H$) quantifies the relative tendency of a price series either to regress strongly to the mean or to cluster in a direction.
In binary options, especially at the 3-5 minute horizon (where noise levels are extremely high), knowing if the market is trending or ranging is arguably more important than the signal itself.

#### Formula
We use the Rescaled Range (R/S) method. Over a rolling window of size $N$:

1. Calculate logarithmic returns: $R_i = \ln(P_i / P_{i-1})$
2. Calculate the mean of returns: $m = \frac{1}{N} \sum R_i$
3. Mean-adjusted series: $Y_t = R_t - m$
4. Cumulative deviate series: $Z_t = \sum_{i=1}^t Y_i$
5. Range: $R = \max(Z_1, \ldots, Z_N) - \min(Z_1, \ldots, Z_N)$
6. Standard deviation of returns: $S = \sqrt{\frac{1}{N} \sum (R_i - m)^2}$
7. Hurst Exponent: $H = \frac{\log(R/S)}{\log(N)}$

#### Thresholds & Horizon Application
*   **$H < 0.45$**: Market is strongly **mean-reverting**. Suppress all momentum signals (e.g., trend following) and favor mean reversion signals (e.g., fades from Bollinger Band edges).
*   **$H \approx 0.5$**: Random walk (Brownian motion). Market is noisy. Decrease confidence.
*   **$H > 0.55$**: Market is strongly **trending**. Suppress mean reversion signals.
*   **Window Size**: For 3-5 minute charts, we look back approx 1-1.5 hours of data. If each candle is 1 min, use $N = 30$ to $60$. If candles are 5-sec, use $N = 100$ to $300$. Let's assume a default window size of `30` candles for the local Hurst function.

### 2. Z-Score Breakout Significance

The Z-Score measures how many standard deviations a current price is from its rolling mean. It helps filter out normal market noise from statistically significant structural breaks.

#### Formula
$Z = \frac{P_{current} - \mu}{\sigma}$
where $\mu$ is the simple moving average (SMA) over lookback $L$, and $\sigma$ is the standard deviation over lookback $L$.

#### Thresholds & Horizon Application
*   **Lookback ($L$)**: $L = 20$ (standard for short horizons).
*   **$|Z| > 2.0$**: **Significant Breakout**. The price action has escaped the local noise band.
    *   If $Z > 2.0$, trade CALL (momentum).
    *   If $Z < -2.0$, trade PUT (momentum).
*   **$|Z| < 0.5$**: **Near Mean**. Price is chopping around the average. Trade mean-reversion if at boundaries, otherwise skip.

### 3. EMA Higher-Order Derivatives

Momentum isn't just speed; it's acceleration. By analyzing the discrete differences (derivatives) of the Exponential Moving Average (EMA), we can spot momentum dying before price physically reverses.

#### Formula
Let $E[n]$ be the EMA of price at candle $n$.
*   **Velocity (1st Derivative)**: $v[n] = E[n] - E[n-1]$
    *   Tells us the current direction and speed.
*   **Acceleration (2nd Derivative)**: $a[n] = v[n] - v[n-1]$
    *   Tells us if the speed is increasing or decreasing.
*   **Jerk (3rd Derivative)**: $j[n] = a[n] - a[n-1]$
    *   Tells us if the acceleration is changing. A sign flip in jerk is often the earliest mathematical warning of a trend exhaustion.

#### Thresholds & Horizon Application
*   We calculate these on a fast EMA (e.g., period 9).
*   If velocity > 0 but acceleration < 0, a bullish trend is slowing down.

### 4. Micro-Momentum Score

A composite indicator that builds a directional conviction score based purely on the alignment of the Z-score and EMA derivatives.

#### Formula & Logic
Score ranges from `-3` to `+3`. Start at 0.
1.  **Z-Score Component**: If $Z > 1.0$, Score $+1$. If $Z < -1.0$, Score $-1$.
2.  **Velocity Component**: If $v[n] > 0$, Score $+1$. If $v[n] < 0$, Score $-1$.
3.  **Acceleration Component**: If $a[n] > 0$, Score $+1$. If $a[n] < 0$, Score $-1$.

#### Thresholds & Horizon Application
*   **Score = +3**: Strong CALL confluence. Momentum is fully aligned upwards.
*   **Score = -3**: Strong PUT confluence. Momentum is fully aligned downwards.
*   **Score = 0**: Conflicting signals (noise). Skip trade.

### 5. Volatility Regime Filter

Volatility expands and contracts. A strategy that works in high volatility will fail in low volatility, and vice-versa. We use an ATR (Average True Range) ratio to define the current regime.

#### Formula
$Ratio_{ATR} = \frac{ATR_{current}}{ATR_{average\_over\_20\_candles}}$

#### Thresholds & Horizon Application
*   **$Ratio_{ATR} > 1.8$**: **HIGH VOLATILITY**. The market is wild. We must reduce overall confidence scores and widen thresholds to avoid getting stopped out by noise spikes.
*   **$Ratio_{ATR} < 0.6$**: **LOW VOLATILITY / COMPRESSION**. The market is coiling. A breakout is mathematically imminent. Flag this state so the engine prepares for a high-momentum Z-score breakout.
*   Otherwise: **NORMAL**.

### 6. RSI Divergence Math

Divergence between price action and momentum oscillators (like RSI) is a powerful leading indicator of reversals. We mathematically define it by comparing the slopes between the last two localized swing highs/lows.

#### Formula & Logic
Let $P_{H1}, P_{H2}$ be the last two swing highs in price (where $P_{H2}$ is more recent).
Let $R_{H1}, R_{H2}$ be the RSI values at those exact same candle indices.

*   **Bearish Divergence**: Price made a higher high ($P_{H2} > P_{H1}$) BUT RSI made a lower high ($R_{H2} < R_{H1}$).
    *   Return: `'BEARISH'` (Weight: -15 in rule engine)
*   **Bullish Divergence**: Price made a lower low ($P_{L2} < P_{L1}$) BUT RSI made a higher low ($R_{L2} > R_{L1}$).
    *   Return: `'BULLISH'` (Weight: +15 in rule engine)
*   Otherwise: `'NONE'`

### Integration: Scoring Weight Table (Rule Engine)

| Model | Bullish Condition (+ Points) | Bearish Condition (- Points) | Max Absolute Weight |
| :--- | :--- | :--- | :--- |
| **Micro-Momentum** | Score == +3 (+2 pts) | Score == -3 (-2 pts) | ±2.0 |
| **Z-Score Breakout** | $Z > 2.0$ (+1.5 pts) | $Z < -2.0$ (-1.5 pts) | ±1.5 |
| **RSI Divergence** | BULLISH Divergence (+2 pts) | BEARISH Divergence (-2 pts) | ±2.0 |

*Note: Total points modify `bullJ1` / `bearJ1` (momentum judge) or `bullJ2`/`bearJ2` depending on exact rule engine integration.*

### The "DO NOT TRADE" Checklist (Hard Blocks)

If any of these conditions are met, the engine must force `winner = 'NO_TRADE'` and drop confidence to 0%.

1.  **High Volatility + Mean Reverting**: $Ratio_{ATR} > 1.8$ AND $H < 0.45$. (Market is wildly whipping around with no trend. Unpredictable.)
2.  **Zero Volatility**: $ATR_{current} \approx 0$. (Market is dead. No liquidity.)
3.  **Complete Indecision**: Micro-Momentum Score = 0 AND $|Z| < 0.5$.

### Edge Cases and Failure Modes (3-5 Min Horizon)

*   **Hurst Calculation on Short Series**: The R/S calculation can be unstable if $N < 20$. We must ensure minimum data lengths.
*   **Flatlined RSI**: In extreme, persistent trends, RSI stays at 99 or 1 for many candles, causing false divergence signals. We must ensure swing points are actually "swings" (e.g., local max/min over a 3-candle window).
*   **Wick Noise**: A single massive wick can skew the ATR Ratio or Z-Score. Using median or capping max deviations could mitigate this, but for raw speed, we stick to the mathematical definitions and rely on the composite score to filter anomalies.


## 11. Test Mode Sandbox — Architecture Notes

### Objective
The Test Mode feature uses a synthetic "forward-test" mechanic. When you upload a past candlestick chart, it separates the "past" (left slice) from what actually "happened next" (right slice).

### Cropping & Calibration
A common bug in test modes is assuming `30 minutes == 30 candles` (which would only be true if each candle is 1m, and 30m is the total screenshot width, both assumptions being highly inaccurate). Real screenshots display an arbitrary number of candles regardless of the timeframes (e.g. 5m timeframe, 60 candles in view = 300 minutes).

To fix this:
- **`cropRatio`** depends entirely on the **total candles in view** and the **number of candles representing the investment duration**.
- If a user uploads a 5m timeframe chart (1 candle = 5m), and the duration is 5m, we need to cut `1` candle. Wait... My implementation assumed `N_candles_to_cut = parseInt(investmentDuration)` where 1 minute = 1 candle. The prompt said: `"where N = investmentDuration in minutes, and 1 candle = 1 minute → for 3m cut 3 candles, for 5m cut 5 candles"`. So we strictly assume the chart is a 1-minute chart in the prompt's heuristic.
- The user can overriding `candlesInView` using a new text input injected straight into the control panel.

### The Heuristic
If `duration` = `5m`, we cut `5` candles.
If `candlesInView` = `60` (default), the `cropRatio = Math.max(0.02, Math.min(0.4, 5 / 60)) = 0.083`.

### The Loss Autopsy Flow
Instead of needing to upload the exact right edge of the chart manually upon losing a test mode signal, the test-mode automatically retains the cropped right slice. When "RUN LOSS AUTOPSY" is clicked, we pass `prefilledResultImage` downstream into the `<LossAutopsyModal>` component. It initializes the resultImage state instantly, skipping the file picker.

### Verdict Engine
`/api/read-outcome` was hardened to use `jsonMode`. If the GPT-4o-mini is uncertain (Confidence < 60% or outcome is FLAT), we return `INCONCLUSIVE` and fallback to allowing the user to grade it manually, rather than forcing a mis-recorded outcome.


## 12. FIX NOTES: ActivityIndicator runtime crash in production

### What was wrong
- `src/components/LiveAnalysis.tsx` had split import blocks with runtime code between them, which can break ESM import evaluation order under production bundling/minification.
- `ActivityIndicator` relied on a destructured named import from `react-native`, which is occasionally brittle with RNW/CJS-ESM interop in production builds.
- Vite config did not explicitly prebundle `react-native-web` and did not enable mixed ESM transforms for CJS paths.
- A committed `dist/` artifact risked stale deploy assets being served.

### What changed
1. Reordered all imports in `LiveAnalysis.tsx` so every import is at the top before any runtime code.
2. Added resilient namespace fallback in both components:
   - `import * as RN from 'react-native'`
   - `const ActivityIndicator = RN.ActivityIndicator`
   - Removed `ActivityIndicator` from destructured react-native imports.
3. Hardened Vite build/deps behavior:
   - Added `optimizeDeps.include = ['react-native-web']` and `esbuildOptions.mainFields`.
   - Added `build.commonjsOptions.transformMixedEsModules = true`.
4. Added `errorStack` rendering in `TerminalErrorBoundary` (first 400 chars) for quicker production diagnosis.
5. Removed tracked `dist/` artifacts and ensured `dist/` is ignored.

### Why each change is necessary
- Top-level import ordering guarantees standards-compliant module initialization and avoids production-only symbol breakage.
- Namespace import fallback avoids fragile named-binding interop edge cases and keeps `ActivityIndicator` resolvable at runtime.
- Vite hardening improves consistency between dev/prod module resolution and CJS interop paths.
- Removing stale build output prevents accidental deployment of old broken bundles.
- Surface stack traces in boundary UI so future prod crashes are actionable immediately.

### How to verify locally
1. `npm run build`
2. `npm run preview` and open the preview URL, pass Hero intro, launch terminal, ensure LiveAnalysis renders (spinner visible where applicable) without boundary crash.
3. `npm test`
