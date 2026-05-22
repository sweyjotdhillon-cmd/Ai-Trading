# 🌊 ChartLens Image Analysis Architecture: A Deep Dive Pipeline

> **Abstract**: This document provides a *highly detailed*, *highly precise*, and *comprehensive* breakdown of the complete image analysis pipeline within ChartLens. It traces the lifecycle of raw pixel data—from the moment of frontend capture through deterministic machine vision transformations, culminating in the complex algorithmic 4-Judge Matrix scoring model and frontend resolution.

---

## 📸 Phase 1: Frontend Capture & Serialization (`LiveAnalysis.tsx`)

The initial sequence involves capturing user input (live feed or static file) and preparing it for deep processing without blocking the React render thread.

### 1.1 Image Acquisition
The user initiates the sequence by providing an image source.
- **Live Mode:** Captures a frame directly from the device's camera stream via an HTML5 `<canvas>` snapshot.
- **Test Mode:** Reads an uploaded historical chart image.

### 1.2 Serialization & Payload Construction
Raw pixel data is voluminous. To efficiently cross the boundary from UI to Web Worker, it is serialized.
- Using the `FileReader` API (for uploads) or `.toDataURL()` (for live streams), the image is encoded into a **Base64 string payload**.
- The `LiveAnalysis` component gathers the required context:
  - `stockTicker`
  - `timeframe` (e.g., 1m, 5m, 15m)
  - `duration`
  - `techniquesList` (An array of user-selected techniques, e.g., `[{name: 'Doji', description: '...'}]`)

### 1.3 Asynchronous Invocation
The frontend dispatches the serialized payload by calling the asynchronous utility `runSingleAnalysis(params)` located in `src/utils/singleAnalysis.ts`.

---

## 🚀 Phase 2: Web Worker Dispatch (`runSingleAnalysis.ts`)

To maintain buttery-smooth UI performance (specifically for the React Three Fiber animations), ChartLens strictly isolates heavy computation inside a dedicated Web Worker.

### 2.1 Payload Decoding
Before dispatching to the worker, the Base64 `imageDataUrl` must be parsed back into an intermediate representation, `ImageData`, using `dataUrlToImageData()`.

### 2.2 Thread Communication Protocol
`runSingleAnalysis` interfaces with the background thread via the `Worker.postMessage` API.
- It posts a strongly-typed message: `{ type: 'ANALYZE', payload: { ... } }`.
- Crucially, the `techniquesList` is dynamically included in this payload, allowing the backend to process only user-selected trading patterns.

### 2.3 Bulk Test Mode Slicing (Forward-Testing Simulation)
If **Bulk Test Mode** is active, the image is programmatically bifurcated:
- **Left Slice (Historical Context):** Processed by the pipeline to generate a prediction.
- **Right Slice (Future Outcome):** Withheld from the pipeline. Kept exclusively for post-analysis grading against the predicted direction. This slicing is achieved via precise canvas `cropRatio()` calculations.

---

## 🛡️ Phase 3: Worker Initialization & Determinism Guards (`analysisWorker.ts`)

Upon receiving the `ANALYZE` message, the worker thread (`src/workers/analysisWorker.ts`) boots up and enforces strict environment stability rules.

### 3.1 The Determinism Guards
Because mathematical operations can vary slightly across different CPU architectures or browser engines, ChartLens enforces rigorous consistency checks before analyzing any user data.
- **`runEpsilonGuard()`**: Verifies that floating-point operations do not deviate beyond an acceptable micro-threshold.
- **`runDeterminismGuard()`**: Ensures baseline mathematical functions yield exact, expected outcomes. Failure here aborts the analysis entirely.


### 3.2 Horizon Context Initialization
The worker calculates the `HorizonContext`, a critical parameter for weighting momentum vs. mean-reversion.
- It evaluates the `graphTimeframeMinutes` against the `investmentDurationMinutes` to determine a structural timeframe ratio `H`.

### 3.3 Advanced Feature Instantiation & Stability Managers
Prior to processing image payloads, the worker thread spins up highly specialized stateful managers to filter noise from raw mathematical structures:
- **`PatternStabilityManager`**: Initializes a rolling temporal buffer. It exists to track candlestick formations (e.g., Doji, Hammer) over sequential frames.
- **`GapStabilityManager`**: Initializes state to monitor structural price gaps between adjacent candlesticks.

Both managers ensure that transient visual artifacts or brief camera glitches do not prematurely trigger signals; an anomaly must persist across multiple ticks to be upgraded to "confirmed evidence."

---

## 🔬 Phase 3.5: Pre-Quantitative Feature Extraction

Between the raw vision output and the final quantitative matrix, the pipeline performs deep structural analysis on the NumericOHLC array if feature flags permit.

### 3.5.1 Candlestick Pattern Extraction
If `featureFlags.enableCandlestickRepoPatterns` is true:
- **`extractCandlestickPatterns(ohlcSeries)`**: Scans the numerical series against known geometric definitions (e.g., Engulfing, Marubozu).
- The raw output is immediately piped into the `patternStabilityManager.processFrame(rawPatterns)`.
- The output is an array of PatternEvidence, representing only the geometrically sound and temporally stable structures.

### 3.5.2 Gap Detection
If `featureFlags.enableGapDetection` is true:
- **`detectLatestGap(ohlcSeries)`**: Scans the most recent temporal blocks for significant disconnections between closing and opening prices (Fair Value Gaps, Runaway Gaps).
- Raw gaps are similarly filtered through `gapStabilityManager.processFrame(latestGap)`.
- The output is an array of GapEvidence.

These strictly confirmed PatternEvidence and GapEvidence arrays are then injected directly into the quantitative `evaluateSignal` payload as fundamental contexts for the 4-Judge Matrix.


---

## 👁️ Phase 4: The Vision Extraction Pipeline (`src/vision/pipeline.ts`)

This phase converts raw color pixels into a structured, chronological array of mathematical OHLC points.

### 4.1 Rectification & Centering
Source images, particularly from live cameras, are often skewed or unaligned.
- `rectifyOrCenterCrop(imageData)` performs advanced transformations, including Sobel/Canny edge detection and Homography transforms.
- This ensures the chart grid is flattened and orthogonal (vertical and horizontal lines are true to axis).

### 4.2 Pixel Coordinate Extraction & Color Calibration
- **`extractOHLCFromPixels(rectifiedFrame)`** scans the grid for candlestick geometries.
- **Color Calibration (`EPSILON`):** Uses calibrated RGB tolerances to reliably differentiate bullish bodies (green/white) from bearish bodies (red/black) regardless of ambient monitor glare.
- It precisely maps pixel boundaries to determine the Open, High, Low, and Close for every identified candle.

### 4.3 OCR Y-Axis Translation
- **`readYAxis(rectifiedFrame)`** attempts to run Optical Character Recognition on the right-hand boundary.
- **Success:** Maps vertical pixel distances to real-world monetary values using a `PriceAxisTransform` slope/intercept model.
- **Failure (`NORMALIZED_FALLBACK`):** If text is unreadable, it falls back to a normalized proportional scale, allowing relative percentage calculations to proceed flawlessly.

### 4.4 The Output: `NumericOHLC` Array
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

## 🧠 Phase 5: The Quantitative Rule Engine (`src/quant/ruleEngine.ts`)

This is the cognitive core of ChartLens. The `evaluateSignal` function ingests the `NumericOHLC[]` and executes a deterministic, matrix-based analysis.

### 5.1 The Strict 10-Technique Rule
A non-negotiable safety guard:
- The `techniquesList` must contain **at least 10 valid techniques**.
- **At least 10 techniques must mathematically match** the chart data.
- If these conditions are unmet, the engine immediately yields a `'NO_TRADE'` default. *(Note: Unit tests can bypass this via `__TEST_BYPASS__`)*.

### 5.2 Mathematical Indicator Generation
The engine leverages Typed Arrays (`Float64Array`) exclusively for deep recursive math (RSI, MACD, Bollinger Bands, ATR, Z-Scores). This avoids standard `number[]` array memory allocation overhead, ensuring blazing-fast, deterministic execution.

### 5.3 The 4-Judge Matrix Scoring System
The algorithm evaluates market conditions through four independent, specialized "Judges", tallying Bull and Bear points:

1. **🧑‍⚖️ Judge 1 (Trend & Momentum):** Analyzes prevailing slope and matched candlestick configurations (e.g., Engulfing, Marubozu). Weights are adjusted based on `PATTERN_WEIGHTS_BY_HORIZON`.
2. **🧑‍⚖️ Judge 2 (Oscillator Consensus):** Evaluates momentum oscillators. Looks for RSI divergence, MACD histogram velocity spikes, and Stochastic boundary crossings.
3. **🧑‍⚖️ Judge 3 (Boundary & Reversal):** Focuses on structural geometry. Uses `yPercent` to determine the close's percentile placement relative to local highs/lows, and assesses wick-to-body ratios to identify exhaustion.
4. **🧑‍⚖️ Judge 4 (The Skeptic Multiplier):** The crucial gating mechanism. It analyzes advanced derivatives like Volatility Regimes, ATR, and Recurrence Quantification Analysis (RQA) Laminarity. If it detects extreme erratic chop, it severely penalizes overall confidence.

### 5.4 The Hurst Exponent Balancer
During matrix execution, the **Hurst Exponent (`rescaledRangeHurst`)** dynamically modulates scoring weights:
- **`H > 0.55` (Trending):** Amplifies Judge 1 (Momentum).
- **`H < 0.45` (Mean-Reverting):** Amplifies Judge 3 (Reversals).

### 5.5 Verdict Rendering
Points are aggregated. The side with the most points wins (`BULL` or `BEAR`). However, if the point difference is marginal (< 3) or total conviction is low (< 7 points), it explicitly renders a `NO_TRADE` verdict.

---

## ⚖️ Phase 6: Stability Filtering & UI Resolution

Before the verdict reaches the user, it undergoes temporal stabilization.

### 6.1 The Stability Filter
To prevent rapid UI flickering due to camera noise or transient glitches, the signal passes through `emitStability(decision)` (in `patternStability.ts`).
- A `STABLE_SIGNAL` is only emitted if multiple sequential frames report the exact same mathematical configuration.

### 6.2 Worker Response Payload
The worker packages the final `FRAME_RESULT`:
- `signal` (`UP`, `DOWN`, `NO_TRADE`)
- `confidence` percentage
- The point `margin`
- A detailed debug `trace` of Judge scores.

### 6.3 Frontend Verdict & Grading (Test Mode)
The `runSingleAnalysis` Promise resolves, returning data to `LiveAnalysis.tsx`:
- Raw Judge logs are piped into the UI debugger streams (`onJudgeLogs`).
- If in **Bulk Test Mode**, the withheld Right Slice is now compared against the predicted signal. The system automatically grades the run as a `WIN` or `LOSS`.
- The final state updates React, visually rendering the prediction, confidence gauge, and 3D UI overlays to the user.
