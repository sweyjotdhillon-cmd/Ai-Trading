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
*   **Flexible Custom Content Verification**: For user custom uploaded lists, ChartLens accepts any count of custom rules down to 1. For default configurations, standard consensus requires 10 matching rules.
*   **Scoring Rubric (4-Judge Matrix)**:
    *   **Judge 1 (Reasoning)**: Correlates parsed user techniques (e.g., Engulfing, Marubozu, Hammer) with the underlying trend and price structures in the pattern repository.
    *   **Judge 2 (Vehicle)**: Aggregates technical Indicators, trend momentum, and bullish/bearish vehicles for confirmation.
    *   **Judge 3 (Reversal)**: Employs percentile mapping (`yPercent`) of the current close against local highs/lows combined with wick/volatility analysis to gauge statistical reversal boundaries.
    *   **Skeptic Veto (The Judge 4 Penalty)**: A gating penalty mechanism. Evaluates high-order derivatives (Z-Scores, Volatility Regimes, ATR, RQA Determinism) and applies veto multipliers to dampen standard confidence scores in hyper-volatile environments.
*   **Hurst Exponent Balancer**: A Hurst Exponent (`rescaledRangeHurst`) dynamically adjusts scoring logic mid-execution, scaling momentum weights upwards during `H > 0.55` (Trending Regimes) and boundary/reversal weights during `H < 0.45` (Mean-Reverting Regimes).
*   **Pattern Recognition & Stability**:
    *   **`patternAdapter.ts`**: Extracts raw candlestick geometries using the `candlestick` library against the synthesized OHLC data.
    *   **`patternStability.ts`**: Filters raw patterns across sequential frames to ensure a pattern isn't just a brief flash of noise, upgrading them to 'confirmed' evidence only if they persist.
*   **Stability Gating (`emitStability` in `stabilityFilter.ts`)**: Emits `STABLE_SIGNAL` events dynamically only after rapid successive frames match identical or close point configurations, blocking noisy, singular 'flash' signals from rendering in the UI.

---

## 4. Deep Dive: Vision Pipeline (`src/vision/`)

The core extraction process relies on transforming raw pixels from an image or live webcam feed into structured temporal data (OHLC series) that the Quant pipeline can read.

*   **Image Processing**: Handles image transformations including edge detection (Sobel/Canny) and Homography transforms to flatten and align skewed source images (e.g., from camera feeds) prior to parsing. Establishes strict dynamic ranges for distinguishing background noise from bullish/bearish candle structures.
*   **Pixel Scanning & Color Calibration**: Identifies candlestick boundary boxes within the rectified image, isolating open, high, low, and close (OHLC) coordinates dynamically. Relies on relative calibration tolerances rather than absolute color definitions.
*   **Chart Axis Extraction**: Maps the raw vertical pixel distances to real-world monetary values via OCR mapping. If OCR validation fails, the Y-Axis fallback dynamically scales pixel spans within a positive relative range (10.0 to 110.0) preventing negative coordinate anomalies.

---

## 5. Web Workers & Performance Guardrails

*   **Concurrency Model**: Communication between the UI (`LiveAnalysis.tsx` / `runSingleAnalysis.ts`) and the background pipeline relies on asynchronous messaging. The `techniquesList` and image data are passed dynamically in payloads to `src/workers/analysisWorker.ts`.
*   **Determinism Guards (`runEpsilonGuard`, `runDeterminismGuard`)**: Implemented immediately inside the Web Worker initialization context to fail securely if floating point math is inaccurate or environment instability is present. Guarantees consistency across mathematical operations before processing any user data.

---

## 6. Execution Modes

### A. Live Analysis
Triggered via `runSingleAnalysis`, it translates a live canvas capture into an active prediction payload (`BULL`, `BEAR`, or `NO_TRADE`) based on a point threshold. The frontend flow begins in `LiveAnalysis.tsx` where the image is converted to Base64 via `FileReader`, then passed to `runSingleAnalysis.ts`, which dispatches the data to the background `analysisWorker.ts`.

### B. Bulk Test Mode
When `isTestMode` is asserted, the application simulates real-time chart data ingestion for forward-testing by dividing full historical images into sequential sub-slices using canvas methods (`cropRatio`, `toDataURL`).
1.  **Left Slice (History)**: Fed into the main quantitative pipeline.
2.  **Right Slice (Future)**: Used exclusively to resolve the predicted closing position against the expected outcome duration, grading the model implicitly (`WIN`, `LOSS`, `NEUTRAL`).

---

## 7. Development, Deployment, & Test Infrastructure

### A. Testing Setup (Vitest)
*   Vitest handles execution alongside ESLint for linting. Tests are typically located in `__tests__` subdirectories.

### B. Standard Commands
Always use `pnpm` in this repository. Never use `npm` or `yarn`.

*   **Start Dev Server**: `pnpm dev`
*   **Type Checking**: `npx tsc --noEmit`
*   **Linting**: `pnpm lint`
*   **Run Tests**: `npx vitest run`
*   **Build Production**: `pnpm build`

---

## 8. Stateless Isolated Analysis & Scaled Dynamic Gates

Recent architectural updates have further refined the mathematical integrity and user control surfaces:

### A. Stateless Worker Isolated Manual Runs
To prevent temporal smoothing or EMA history leakage across separate manual analysis attempts, the system automatically invokes `resetWorkerStability()` at the start of:
- Initiating any new manual analysis run in `handleAnalyze`
- Selected image changes or document uploads
- Pressing the "Reset" button in the control interface

This guarantees that each manual chart analysis operates on a clean, stateless canvas without carrying over residual memory from previous camera captures or runs.

### B. Explicit on-demand session recovery
Automated and silent state rehydration has been entirely removed to prevent stale outcomes from contaminating new trade sessions. The interface now boots clean but provides an explicit, highly-visible **amber notice banner** prompting the user if they'd like to manually "Restore" or "Dismiss" their pre-existing analysis state. Clicking "Restore" populates all settings, while "Dismiss" completely cleans persistent storage.

### C. Scaled scoring gates for upload techniques
When users upload custom `.json` technique portfolios of smaller sizes (e.g. 2 to 5 rules), traditional scoring margins (e.g., minimum margin 3.0, strength 4.0) easily locked predictions permanently into `'NO_TRADE'`. ChartLens now dynamically scales all scoring and confidence gates using a proportional technique ratio:
$$\text{ScaleFactor} = \max\left(0.08, \min\left(1.0, \frac{\text{Active Technique Count}}{12}\right)\right)$$
This mathematically maintains baseline strictness for standard 12-rule configurations while smoothly scaling thresholds down for smaller uploaded custom technique matrices, opening full functional upload capability.

### D. Volatility Veto Softening
Veto constraints have been isolated from complete deterministic overrides. The ATR volatility expansion check is treated as a high-volatility risk caution factor that dampens the candidate signal's confidence fraction and multiplies the skeptic penalty score, allowing option evaluations to be resolved proportionally rather than executing flat limits blocks.

### E. Persistent Trade Statistics and History
All live and batch/bulk trade statistics (wins, losses, predictions, confidences) are persistently stored within local storage (`stats_surface_data` in `localStorage`). This allows analysts to accumulate training records, trace prediction win rates over multiple days, and evaluate long-term models offline. To manage physical storage and state cleanups, users can use the **Clear Trade Stats** action under **System Settings** to permanently wipe local logs without requiring external database interactions.

### F. Structured Conditions Engine and Consensus Guard
- **Pure Math Techniques Integration**: Ensures that technique configurations uploaded from a JSON portfolio are passed downstream as full, lossless objects instead of getting prematurely mapped to string representations.
- **Structured JSON Conditions Interpreter**: Implements an advanced indicator interpreter within `evaluateShard` to parse custom mathematical conditions (including crossing thresholds, momentum ratios, oscillators range bounds, and delta variances) for both CALL and PUT criteria side-by-side, supporting dynamic `ema` calculations and complex delta comparisons.
- **Active Consensus Guard**: Aligns default standard configurations to require a minimum of 10 processed techniques with positive scores, returning `INSUFFICIENT_TECHNIQUES` to prevent high-noise low-consensus trade outcomes.
- **Custom Technique Engine Resilience**: Enhanced the `getFieldValue` engine inside the custom structured runner to resolve both deep nested paths (e.g. `oscillators.rsi`) and flat parameter nomenclature (e.g. `rsi`, `macd`, `stoch_k`) smoothly. Adapted the `minCandlesNeeded` gate to evaluate against the complete backdrop sequence rather than truncated focus candle windows to avoid data starvation bypasses.
- **Aligned High-Resolution Timeframes**: Synchronized all front-end selections, defaults, and backend parsers to native custom layout specifications:
  - **Graph Timeframe options**: `30:00` (default) and `15:00`
  - **Investment Duration options**: `3:00` (default) and `5:00`
  - **Robust Colon Parsers**: Extended the baseline duration string parser to correctly extract minutes from custom digital clock formats (e.g. `30:00` -> 30, `3:00` -> 3).
- **Comprehensive Candlestick Data Enrichment**: Every processed candlestick is now explicitly stuffed with both categorized indicators and raw numerical values (`ema9`, `ema21`, Bollinger bands `upper`/`middle`/`lower`/`width` prices, and `atr`).
- **Resilient Key Mapper and Neutral Fallbacks**: Built a powerful, multi-stage recursive keyword lookup to match custom naming patterns (e.g. `rsi_14`, `macd_line`) alongside a fallback solver that assigns neutral defaults (e.g., `50.0` for missing oscillators, `current close` for missing signals) rather than skipping uploaded techniques due to indicator misalignment.
- **Unbiased Math Standardizations**: Replaced the previous `pseudoRandom` seeding logic with native hardware `Math.random` across all math calculation systems and UI animation render layers, enhancing performance and unbiased entropy distribution.

### G. Dynamic Spliced Outcome Trajectory & Real-Price Visualizations
ChartLens now integrates a precision-engineered 100% dynamic math trajectory visualizer:
- **Boundary Cut Indicator**: Clearly identifies the transition point (representing the first 3 candles of the analysis window) where past context is separated from subsequent price action.
- **Dynamic Trajectory Computation**: Calculates the relative Y coordinates on the SVG frame directly using the detected extreme high/low prices (`absoluteMin` / `absoluteMax`), producing a pixel-perfect, proportional rendering of price changes.
- **Live Level Stickers**: Draws interactive horizontal stickers for the entry level closing price and nearest subsequent candle close price with standard trading application font alignment.
- **Visual Worth Indicator**: Dynamically color-codes trajectory overlays in glow-enabled emerald green (indicating "WORTH IT 💰" outcomes) or crimson red (indicating "LOSS ⚠️" outcomes), ensuring the generated technical outputs are instantly legible and human-scalable.

