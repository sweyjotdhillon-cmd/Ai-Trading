# ChartLens: Deterministic Point-Based Chart Analyzer

ChartLens is a highly specialized, 100% offline, local browser-based platform engineered to process real-time chart images and camera feeds. It extracts geometrical pricing structures via a machine vision pipeline and applies a point-based quantitative rule engine to generate trading signals (e.g., binary options, 3-5 minute durations).

---

## 1. System Architecture & Tech Stack

The architecture of ChartLens is built to maximize performance, preserve client privacy, and ensure highly deterministic execution without reliance on external backend APIs.

*   **100% Offline Execution**: Runs entirely inside the client browser without external API services, database lookups, or network requests. This ensures deterministic performance, removes latency overhead, and guarantees user privacy.
*   **Core UI & Styling**: Built on top of **React 18** and **Vite** for rapid hot-module replacement and optimized builds. Cross-platform layout compatibility is achieved using **React Native Web** alongside **Tailwind CSS** (via `twrnc`), ensuring a unified design language that gracefully bridges web and native environments.
*   **Performance Concurrency**: High-intensity CPU-bound tasks, specifically computer vision processing and indicator mathematics, execute concurrently in background thread pools via **Web Workers** (`src/workers/analysisWorker.ts`). This guarantees the main UI thread remains fluid and responsive even during heavy frame analysis.
*   **Performance Guardrails**:
    *   Supports memory-optimized `Float64Array` buffers for fast series iterations, preventing garbage collection stutters.
    *   Employs a real-time audio wake-lock strategy (a silent, looping base64 audio element) to counter aggressive background tab throttling by modern browsers.
    *   Implements native environment determinism guards (`runEpsilonGuard()` and `runDeterminismGuard()`) to ensure floating-point math consistency across different client architectures.
*   **Visualization**: High-fidelity 3D layer compositions are rendered using **Three.js** via **React Three Fiber** (`@react-three/fiber` and `@react-three/drei`), augmented with crisp **Lucide icons** (`lucide-react`) for a modern, dashboard-style interface.

---

## 2. Directory Architecture (`src/`)

The application is structured modularly to separate concerns across vision processing, quantitative analysis, user interface components, and asynchronous task management.

*   **`components/`**: Houses modular React components. Key files include `LiveAnalysis.tsx` for real-time camera feed analysis, `BulkTestPanel.tsx` for batch forward-testing, and analytical overlays like `LossAutopsyModal.tsx` and `BatchAutopsyReport.tsx`.
*   **`quant/`**: The core mathematical engine. Contains technical indicator logic (`indicators.ts`), pattern stability filters (`patternStability.ts`, `gapStability.ts`), and the centralized 4-judge quantitative rules engine (`ruleEngine.ts`). It also handles custom user-defined JSON rule interpretation.
*   **`vision/`**: The machine vision pipeline. Includes spatial homography solvers for image skew correction, Canny/Sobel filter implementations, coordinate digit classifiers for OCR, and DOM canvas axis readers for raw pixel-to-price translation.
*   **`workers/`**: Manages background execution. The `analysisWorker.ts` file acts as the primary task manager, executing concurrent pipeline iterations asynchronously without blocking the main thread.
*   **`utils/`**: Shared utilities, encompassing sequential slicing math for bulk testing, local storage database persistence wrappers, and hardware camera capture drivers.

---

## 3. Computer Vision & Quantitative Math Ingestion

ChartLens utilizes a dual-pipeline approach, combining visual feature extraction with mathematical evaluation.

### A. The Vision Pipeline

This pipeline translates raw static images and live camera captures into a structured Temporal OHLC (Open, High, Low, Close) Series:

1.  **Rectification**: Employs spatial homography correction combined with Canny/Sobel edge detection filters. This step normalizes and aligns skewed chart regions, ensuring that the camera feed is perfectly horizontal for accurate pixel measurements.
2.  **Calibrated Bounding**: Scans the image for candle clusters and wick edges. It uses dynamic color calibration bounds to differentiate between bullish/bearish candles and background noise, preventing misidentifications across diverse lighting conditions.
3.  **Axis Price Scaling**: Maps relative pixel values to absolute prices through local Optical Character Recognition (OCR). If character recognition encounters anomalies or low confidence, it gracefully falls back to a normalized percentage-based range (e.g., 10.0 to 110.0).

### B. The Quantitative 4-Judge Matrix

Once the OHLC series is constructed, it is evaluated by the quantitative rules engine (`ruleEngine.ts`), which strictly relies on point-based thresholds. The engine consists of four distinct "Judges":

*   **Judge 1 (Patterns & Geometries)**: Cross-references confirmed candle geometries (e.g., Hammers, Engulfing patterns, Dojis) against the baseline trend.
*   **Judge 2 (Vehicles & Momentum)**: Verifies broader trend indicators, including dual EMA golden/death crosses, Bollinger Band extensions, RSI/Stochastic overbought/oversold levels, and MACD accelerations.
*   **Judge 3 (Volatility Boundaries)**: Maps the closing candle's relative height (`yPercent`) within mathematical extremums, assessing reversal probabilities based on historical volatility.
*   **Judge 4 (Skeptic Veto)**: A critical safety mechanism that acts as a volatility gate. It applies dampening multipliers or complete vetoes under conditions of extreme ATR (Average True Range) expansion or dangerous Z-score breakouts.

**Additional Quantitative Mechanisms:**
*   **Hurst Exponent Balancer**: Adjusts scoring weights dynamically based on market state. If `H > 0.55` (Trending), it scales trend momentum scores upwards. If `H < 0.45` (Mean-Reverting), it prioritizes boundary and reversal indicators.
*   **Proportional Custom Gates**: Scales scoring thresholds and confidence parameters dynamically based on the volume of custom-uploaded JSON techniques, ensuring the system remains responsive and avoids perpetual `'NO_TRADE'` deadlocks.

---

## 4. Execution Channels & Simulation Slicing

ChartLens supports multiple modes of operation, catering to both real-time trading analysis and historical backtesting.

### A. Live Analysis Ingestion
This is the primary mode for active trading. It feeds continuous canvas captures from the device's camera module directly into the vision and quantitative pipelines. It aggressively applies temporal stability filters (`PatternStabilityManager`, `GapStabilityManager`) to prevent short-term visual artifacts, glare, or camera shake from rendering false positive signals.

### B. Bulk Forward-Testing Splicer
This simulation environment is used for backtesting strategies and forward-testing past performance. It works by slicing full historical chart images using dynamic margins to simulate real-time ingestion:

1.  **Analyzed Space (Past)**: The pre-split left section of the chart image is fed into the indicators pipeline to generate a prediction.
2.  **Outcome Timeline (Future)**: The rightmost slice of the image represents the future. The system uses relative coordinates to track the subsequent price action.
3.  **Boundary Cut Trajectory**: Leveraged by both Single-Test and Bulk Batch testing environments, this mechanism projects coordinate trends directly onto raw pixel dimensions:
    *   Draws precise horizontal tickers marking the entry level and the subsequent nearest close values.
    *   Automatically maps SVG trajectories against detected price extremes (`absoluteMin` / `absoluteMax`).
    *   Highlights final decisions using highly readable, glow-enabled verdicts: **WORTH IT 💰** (for matched directional targets) or **LOSS ⚠️** (for Contrary outcomes).

---

## 5. Setup, Development & Test Infrastructure

The project uses `pnpm` as its package manager. Ensure you have `pnpm` installed globally before proceeding.

### Installation

1. Clone the repository and navigate into the root directory.
2. Install all dependencies strictly using `pnpm`:
   ```bash
   pnpm install
   ```
*(Note: Do not use `npm` or `yarn` as they may conflict with the `pnpm-lock.yaml` file.)*

### System Scripts

Always utilize standard `pnpm` workspace bindings for development tasks:

*   **Launch Development Workspace**: Start the Vite development server.
    ```bash
    pnpm dev
    ```
*   **Type Evaluation**: Run the TypeScript compiler to check for typing errors without emitting files.
    ```bash
    npx tsc --noEmit
    ```
*   **Code Linting**: Run ESLint across the codebase.
    ```bash
    pnpm lint
    ```
*   **Model Harness (Vitest)**: Execute the comprehensive unit test suite to verify quantitative logic and pipeline integrity.
    ```bash
    npx vitest run
    ```
*   **Production Compiling**: Build the application for production deployment.
    ```bash
    pnpm build
    ```
*   **Serve Production Build**: Preview the built application locally.
    ```bash
    pnpm start
    ```

### Deployment Configuration
The application is configured to deploy seamlessly to platforms like Cloudflare Pages and Vercel. Relevant configurations can be found in `wrangler.jsonc` and `vercel.json`. For Vercel deployments, use `pnpm deploy:vercel`.
