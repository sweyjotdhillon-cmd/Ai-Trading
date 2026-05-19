# ChartLens: Deterministic Point-Based Chart Analyzer

ChartLens is a highly specialized, 100% offline, fully local browser-based platform engineered to process real-time chart images/camera feeds. It extracts geometrical pricing structures via a machine vision pipeline and applies a point-based quantitative AI rule engine to generate predictive trading signals for short-term time horizons.

---

## 1. System Architecture

*   **100% Offline Execution**: Designed to operate without external dependencies, API keys (no Google/Firebase), or network requests during the core analysis. Ensures deterministic, point-in-time verifiable outcomes.
*   **Web Worker Concurrency**: The CPU-bound Vision and Quantitative pipelines execute inside dedicated Web Workers (`src/workers/analysisWorker.ts`), preventing the primary UI thread from freezing and maintaining application responsiveness.
*   **Event Loop Stabilization**: To combat aggressive modern browser throttling of inactive background tabs (specifically impacting background bulk testing), a silent base64 looping audio element (`useWakeLock` equivalent mechanism) forces the JavaScript event loop to remain high-priority.
*   **Memory Management**: Performance-sensitive quantitative math functions (e.g., inside `src/quant/`) strictly allocate and utilize `Float64Array` buffers rather than standard dynamic Javascript `number[]` arrays. This provides deterministic memory layout and enhances iteration performance for deeply recursive or math-heavy indicator logic.

---

## 2. Vision Pipeline (`src/vision/`)

The core extraction process relies on transforming raw pixels into structured temporal data (OHLC).

1.  **Rectification & Centering (`rectifyOrCenterCrop`)**: Handles image transformations, including Sobel/Canny edge detection and Homography transforms, to flatten and align skewed source images (e.g., from camera feeds) prior to parsing.
2.  **Color Space Calibration (`EPSILON`)**: Establishes strict dynamic ranges for distinguishing background noise from bullish/bearish candle structures via manual user calibration.
3.  **Pixel Scanning (`extractOHLCFromPixels`)**: Identifies candlestick boundary boxes within the rectified image, isolating open, high, low, and close (OHLC) coordinates dynamically.
4.  **Axis Reader (Y-Axis OCR mapping)**: Maps the raw vertical pixel distances to real-world monetary values via `PriceAxisTransform`. If OCR validation fails, the system safely falls back to a normalized proportional scale (`NORMALIZED_FALLBACK`), keeping indicator arithmetic valid based on relative percentage movements.

---

## 3. Quantitative Rule Engine (`src/quant/`)

Operates entirely deterministically on the output of the vision pipeline. The engine evaluates multiple conditions concurrently, outputting a scored prediction.

*   **Scoring Rubric (4-Judge Matrix)**:
    *   **Judge 1 (Trend/Momentum)**: Correlates parsed user techniques (e.g., Engulfing, Marubozu) with the underlying trend via `PATTERN_WEIGHTS_BY_HORIZON`.
    *   **Judge 2 (Oscillator Consensus)**: Aggregates RSI divergence, MACD histogram velocity, and Stochastic boundaries for confirmation logic.
    *   **Judge 3 (Boundary/Reversal)**: Employs percentile mapping (`yPercent`) of the current close against local highs/lows combined with wick-to-body ratio analysis.
    *   **Judge 4 (The Skeptic Multiplier)**: A gating penalty. Evaluates high-order derivatives (Z-Scores, Volatility Regimes, ATR, RQA Determinism/Laminarity) and heavily dampens the final confidence score if erratic market chop or explosive skips are detected.
*   **Strict 10-Technique Rule**: Implemented within `evaluateSignal`, a strict guardrail mandates that `techniquesList` contains *at least 10 valid techniques*, and at least 10 must mathematically match the current parsed slice. Failure defaults the system to `'NO_TRADE'`. (Exception: Tests passing `__TEST_BYPASS__`).
*   **Hurst Exponent Balancer**: A Hurst Exponent (`rescaledRangeHurst`) dynamically adjusts scoring logic mid-execution, scaling momentum weights upwards during `H > 0.55` (Trending Regimes) and boundary/reversal weights during `H < 0.45` (Mean-Reverting Regimes).

---

## 4. Execution Modes

### A. Live Analysis
Triggered via `runSingleAnalysis`, it translates a live canvas capture into an active prediction payload (`BULL`, `BEAR`, or `NO_TRADE`) based on a point threshold. Ties (margins < 3 or raw wins < 7) enforce an explicit neutral outcome.

### B. Bulk Test Mode
When `isTestMode` is asserted:
1.  **Image Slicing**: The pipeline structurally divides the source frame.
2.  **Left Slice (History)**: Fed into the main quantitative pipeline.
3.  **Right Slice (Future)**: Used exclusively to resolve the predicted closing position against the expected outcome duration, grading the model implicitly (`WIN`, `LOSS`, `NEUTRAL`).

---

## 5. Stability Gating

To account for image noise from raw hardware cameras:
*   **Pipeline Guards**: Employs `runEpsilonGuard` and `runDeterminismGuard` immediately inside the Web Worker initialization context to fail securely if floating point or environment instability is present.
*   **Stability Filtering**: Emits `STABLE_SIGNAL` events dynamically via `emitStability` only after rapid successive frames match identical or close point configurations, blocking noisy, singular 'flash' signals from rendering in the UI.

---

## 6. Development & Test Infrastructure

*   **Testing Setup**: Vitest handles execution. The mock frameworks specifically inject linear congruential generators via `vi.spyOn(Math, 'random')` to guarantee synthetic series mock generators evaluate deterministically without brittle assertions.
*   **Commands**:
    *   **Dev**: `npm run dev`
    *   **Build**: `npm run build`
    *   **Test**: `npx vitest run`
    *   **Lint**: `npm run lint` (Use scoped fix params, e.g., `-- --fix path/to/file` to avoid global disruption).
*   **Vercel Deployment**: Utilizes a Vite SPA routing fallback structure within `vercel.json` routing `/(.*)` to `/index.html`.
