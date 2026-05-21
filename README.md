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

### C. Deployment (Vercel)
*   The project uses Vercel for deployment instead of Netlify.
*   SPA routing is explicitly configured for Vite via a `vercel.json` file. It contains a rewrite rule pointing `/(.*)` to `/index.html` to ensure direct links and refreshes on sub-routes do not 404.
