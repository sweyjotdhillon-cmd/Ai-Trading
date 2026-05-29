# ChartLens: Deterministic Point-Based Chart Analyzer

ChartLens is a highly specialized, 100% offline, local browser-based platform engineered to process real-time chart images and camera feeds. It extracts geometrical pricing structures via a machine vision pipeline and applies a point-based quantitative rule engine to generate trading signals (e.g., binary options, 3-5 minute durations).

---

## 1. System Architecture & Tech Stack

*   **100% Offline Execution**: Runs entirely inside the client browser without external API services or network requests to ensure deterministic performance and privacy.
*   **Core UI & Styling**: React 18, React Native Web, and Vite styled with Tailwind CSS (`twrnc`) to preserve cross-platform layout compatibility.
*   **Performance Concurrency**: High-intensity CPU-bound computer vision and indicator mathematics execute in background thread pools using Web Workers (`src/workers/analysisWorker.ts`).
*   **Performance Guardrails**: Supports memory-optimized `Float64Array` buffers for fast series iterations, real-time audio wake-locks to counter aggressive background tab throttling, and native environment determinism guards (`runEpsilonGuard`).
*   **Visualization**: Lucide icons (`lucide-react`) and Three.js (`@react-three/fiber`) for high-fidelity 3D layer compositions.

---

## 2. Directory Architecture (`src/`)

*   `components/`: Modular React components (e.g., `LiveAnalysis.tsx`, dashboard controls, autopsy modal).
*   `quant/`: Technical indicator engines, pattern stability filters, the 4-judge quantitative rules engine, and custom rules interpreter.
*   `vision/`: Homography solvers, coordinate digit classifiers, and raw DOM canvas axis readers.
*   `workers/`: Background task manager executing concurrent pipeline iterations asynchronously.
*   `utils/`: Sequential slicing math, local storage database persistence, and camera capture drivers.

---

## 3. Computer Vision & Quantitative Math Ingestion

### A. The Vision Pipeline
Translates raw static images and live camera captures into structured Temporal OHLC Series:
1.  **Rectification**: Employs spatial homography correction and Canny/Sobel filters to normalize and align skewed chart regions.
2.  **Calibrated Bounding**: Scans candle clusters and wick edges using dynamic color calibration bounds to prevent misidentifications in diverse lighting conditions.
3.  **Axis Price Scaling**: Maps relative pixel values to absolute prices through OCR. Evaluates a fallback range (10.0 to 110.0) if character recognition contains anomalies.

### B. The Quantitative 4-Judge Matrix
Analyzes sequential candlestick indicators strictly on point-based thresholds in `ruleEngine.ts`:
*   **Judge 1 (Patterns)**: Cross-references confirmed candle geometries (e.g. Hammers, Engulfing) against baseline trends.
*   **Judge 2 (Vehicles)**: Verifies dual EMA golden/death crosses, Bollinger Band extensions, and MACD accelerations.
*   **Judge 3 (Vol Boundaries)**: Maps the closing candle's relative height (`yPercent`) within mathematical extremums.
*   **Judge 4 (Skeptic Veto)**: A volatility-gating safety mechanism applying dampening multipliers under extreme ATR/Z-score expansions.
*   **Hurst Exponent Balancer**: Adjusts scoring weights dynamically (`H > 0.55` scales trend momentum upwards; `H < 0.45` prioritizes mean-reverting indicators).
*   **Proportional Custom Gates**: Scales scoring and confidence parameters dynamically based on the volume of custom-uploaded JSON techniques, preventing `'NO_TRADE'` locks.

---

## 4. Execution Channels & Simulation Slicing

### A. Live Analysis Ingestion
Feeds active canvas captures from the camera module into the model pipelines, applying stability filters to prevent short-term visual artifacts from rendering false positives.

### B. Bulk Forward-Testing Splicer
Simulates post-entry forward performance by slicing historical chart images using dynamic margins:
1.  **Analyzed Space (Past)**: Feeds the pre-split left section of the chart to the indicators pipeline.
2.  **Outcome Timeline (Future)**: Resolves predictions using relative coordinates on the rightmost slice.
3.  **Boundary Cut Trajectory**: Leveraged by both Single-Test and Bulk Batch testing environments to project coordinate trends directly on raw pixel dimensions:
    - Draws precise horizontal tickers marking the entry level and subsequent nearest close values.
    - Automatically maps SVG trajectories against detected price extremes (`absoluteMin` / `absoluteMax`).
    - Highlights final decisions using readable, glow-enabled verdicts: **WORTH IT 💰** (for matched directional targets) or **LOSS ⚠️** (for Contrary outcomes).

---

## 5. Development & Test Infrastructure

### System Scripts
Always utilize standard `pnpm` workspace bindings:

*   **Launch Workspace**: `pnpm dev`
*   **Type Evaluation**: `npx tsc --noEmit`
*   **Code Linting**: `pnpm lint`
*   **Model Harness (Vitest)**: `npx vitest run`
*   **Production Compiling**: `pnpm build`
