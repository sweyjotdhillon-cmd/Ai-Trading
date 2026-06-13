# ChartLens: Deterministic Point-Based Chart Analyzer

ChartLens is a highly specialized, 100% offline, local browser-based platform engineered to process real-time chart images and camera feeds. It extracts geometrical pricing structures via a machine vision pipeline and applies a point-based quantitative rule engine to generate trading signals (e.g., binary options, 3-5 minute durations).

---

## 0. Quick Start & Prerequisites

To begin working with the ChartLens codebase, ensure your local development environment is correctly configured.

### Prerequisites
- **Node.js**: Requires a modern LTS version of Node.
- **Package Manager**: Strictly use `pnpm` (version 10.x+). Do not use `npm` or `yarn` in this repository.

### Installation
Clone the repository and install the dependencies:
```bash
git clone <repository_url>
cd chartlens
pnpm install
```
*Note: If running `pnpm install` alters `pnpm-lock.yaml`, always revert the lockfile (`git restore pnpm-lock.yaml`) unless dependency updates are explicitly in scope.*

### Quick Commands
- **Start Development Server**: `pnpm dev` (Starts Vite server on http://localhost:5173 or 3001)
- **Type Checking**: `npx tsc --noEmit`
- **Linting**: `pnpm lint`
- **Run Tests**: `npx vitest run` (Executes the model harness including deterministic guards)
- **Build Production**: `pnpm build`
- **Preview Production Build**: `npx vite preview` (Served on http://localhost:4173)

### Deployment
ChartLens is configured to deploy via **Cloudflare Pages** (using `wrangler.jsonc`) and **Render**.
- **Render Web Service**: Vite's `preview` server must be configured to bind to host `0.0.0.0` (`host: true`) and allow hosts dynamically (`allowedHosts: true`) to pass Render's health checks.

---


## 1. System Architecture & Tech Stack

*   **100% Offline Execution**: Runs entirely inside the client browser without external API services or network requests to ensure deterministic performance and privacy.
*   **Core UI & Styling**: React 18, React Native Web, and Vite styled with Tailwind CSS (`twrnc`) to preserve cross-platform layout compatibility.
*   **Performance Concurrency**: High-intensity CPU-bound computer vision and indicator mathematics execute in background thread pools using Web Workers (`src/workers/analysisWorker.ts`), engineered with comprehensive thread-level state-isolation guards to prevent cross-image signal/memory pollution.
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
*   **Test-Mode Threshold Customization**: Automatically relaxes threshold strictness (using a `0.35` factor on minimum scores and confidence bounds) during backtests and batch-run trials, preventing blanket `NO_TRADE` suppression and ensuring valid backtest trajectories can execute.

---

## 4. Execution Channels & Simulation Slicing

### A. Live Analysis Ingestion
Feeds active canvas captures from the camera module into the model pipelines, applying stability filters to prevent short-term visual artifacts from rendering false positives.

### B. Bulk Forward-Testing Splicer
Simulates post-entry forward performance by slicing historical chart images using exact, high-fidelity anatomical coordinates:
1.  **Candle-Aligned Slicing**: Rather than a static or percentage-based clip (which could slice directly through a candlestick body and distort OCR or scanning), the slicer maps the precise `xCenter` of the target entry candle. The back-stepping offset is dynamically calculated to match the investment duration in minutes (e.g., 3 minutes maps to exactly 3 candles back, and 5 minutes maps to exactly 5 candles back from the rightmost active candle).
2.  **Analyzed Space (Past)**: Feeds the left boundary-cut section starting exactly at the midpoint of the entry-to-next candle spacer to the indicator pipeline.
3.  **Outcome Timeline (Future)**: Saves the matching rightmost slice for visual presentation, evaluating `entryClose` vs `exitClose` with extreme coordinate fidelity to determine win/loss outcomes without raw pixel bleed or candle mutilation.
3.  **Boundary Cut Trajectory**: Leveraged by both Single-Test and Bulk Batch testing environments to project coordinate trends directly on raw pixel dimensions:
    - Draws precise horizontal tickers marking the entry level and subsequent nearest close values.
    - **Imaginary Indicator Overlays**: Renders real-time math-simulated EMA(9) curves, EMA(21) pathways, Bollinger Band boundaries, and custom Resistance/Support channels directly on past-slice coordinates to visually illustrate the vision pipeline's geometrical focus.
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
    *   *Unit-Testing Reliability*: Synthetic OHLC trends in the model test harness (`judgeVerdict.test.ts`) are generated with natural historical volatility noise to establish robust standard deviation baselines, preventing artificial Z-score explosions while utilizing diagnostic `isTestMode: true` parameters to reliably verify extreme uptrends and downtrends.
*   **Production Compiling**: `pnpm build`

---

## 6. Directional Bias Neutrality & Strict Agnosticism

To eliminate structural bias (e.g., Call/Put imbalances in neutral markets) and ensure directional agnosticism, ChartLens integrates a multi-layered mathematical neutrality enforcement system governed by strict, non-negotiable invariants:

*   **Pointwise Mirror Symmetry (Invariants I-1, I-6)**: `calculateZScoreSignificance` employs a strength-weighted voting engine evaluating candle attributes (solid body ratio, wick rejection, pinbar triggers, and trend momentum vectors) rather than sequential, priority-biased order chains. Polarity calculations are structurally mirror-symmetric; given equivalent raw momentum arrays, bullish and bearish outputs map to identical absolute coordinates.
*   **Central Neutrality Safety Zone (Invariant I-5)**: `calculateBoundaryReversal` features a central neutrality zone. Any candle closing within 47.5% to 52.5% of the normalized channel height evaluates to exactly 0 points on both sides, ensuring range-bound stagnation is never misconstrued.
*   **Zero-Sum Hurst Regime Balancer (Invariant I-3)**: The Hurst Exponent regime balancer scales scores under a mathematical zero-sum constraint. In a trending regime, trend-following momentum scores are amplified on the winning side and reduced on the losing side symmetrically, while reversal-based points are dampened.
*   **The Neutrality Enforcement Layer (NEL)**: A dedicated `neutralityGuard` acts as an active gatekeeper for options margin arbitration. It applies anti-bias correction factors based on rolling statistical rates, dynamically dampening scores if the sequence starts skewing, ensuring long-run output convergence toward a balanced distribution.
*   **Calibration Control Knobs**: Users can interactively calibrate Strict Neutrality toggle bounds, anti-bias correction multipliers, and the epsilon NO_TRADE zone safety margin through the main System Settings panel.

---

## 7. Surgical Trend-Reversal Engine Upgrades (May 2026)

ChartLens has completed a targeted surgical upgrade to its quantitative core to lift trend-reversal signals and balance continuation bias:

*   **Judge Re-Routing (BUG #1)**: Pattern categories are correctly routed so that reversal-inducing setups (e.g. Pinbars, Engulfings, Hammers) contribute to Judge 3 (Boundary Reversals) rather than leaking into Trend-following Judge 1.
*   **Vol Boundary Cap Allocation (BUG #2)**: Increased the J3 reversal score allocation ceiling from `3.0` to `4.0` points, establishing high-confidence reversal weighting and updated the total score denominator across the UI and tests from `11.0` to `12.0`.
*   **Two-Stage Hurst Balancer (BUG #3)**: Integrated a sophisticated regime gate combining Rescaled Range Hurst index with Wilder's ADX trend strength to cleanly separate trending conditions (blocking premature counter-trend Trades) from mean-reverting structures (boosting reversal signals in direction of boundary targets).
*   **Blow-off Wick Volatility Amplification (BUG #4)**: Reconfigured wick multipliers in boundary rejection math to use a default floor of `0.55` and added a logarithmic blow-off topper allowing hyper-extended pinbars to break standard caps.
*   **Fractal Pivot-Based RSI & MACD Divergence Scanning (BUG #5, #6)**: Replaced naive RSI comparisons with Williams Fractal pivot point scanning, enabling high-fidelity coordinate-perfect divergence evaluation. Added MACD Divergence detection feeding into J3 boundary strength.
*   **Wilder's ADX Indicator (BUG #7)**: Implemented Wilder's ADX, PlusDI, and MinusDI inside `/src/quant/indicators.ts` to power trend corroboration and speed/exhaustion testing.
*   **Swings and Market Structure Core (BUG #8)**: Created a core Swing Pivot, BOS (Break of Structure), and CHoCH (Change of Character) tracker inside `/src/quant/marketStructure.ts` to reward structural trend transitions and penalize running trends.
*   **Context & Confirmation Candlestick Gates (BUG #9, #10)**: Bound reversal techniques to strict trend/yPercent confirmation boundaries, ensuring single/double candle setups only trigger when fully localized and followed by confirmed closures.
*   **Permissive Reversal Grounding (BUG #11)**: Enabled a dynamic confidence denominator and relaxed minimum margin thresholds (by `0.85x`) for "reversal-dominant" signals, allowing pristine boundary exhaustion setups to safely clear conservative trade filters.

---

## 8. High-Fidelity Indicator Level Alignment Upgrades
*   **Volatility-Adaptive Dynamic Indicators**: Replaced rigid fixed multipliers and static percentage lines with dynamic price coordinate mapping. The overlaid Support, Resistance, and Bollinger Bands curves now extract exact calculated indicator levels (`localResistance`, `localSupport`, `bollUpper`, `bollLower`) from the real chart's quantitative evidence.
*   **Coordinate-Perfect Chart Scaling**: Automatically translates price fluctuations into precise pixel position coordinates, scaling and adapting dynamically to varying container heights and differing chart image boundaries across different symbols.
*   **Coordinate-Perfect Visual Trade Mapping**: Removed all boundaries, image splits, and labels. Replaced with just two simple horizontal lines. The chaotic simulated indicators have been removed in favor of a coordinate-perfect horizontal yellow line (denoting trade entry price level) and a horizontal red line (denoting trade outcome final rate price level) that dynamically map the real trade bounds directly across the full visual block.
*   **Timeframe-Perfect Lookback Slicing**: Reconfigured the manifest lookback and batch testing logic to determine the exact lookback cutoff mathematically from the user-selected duration. For 3-minute graph charts, exactly 3 candles of lookback are parsed for testing, sending only data preceding the opening line to the model and evaluating trade outcomes by checking whether the end final rate candles closed above (upward traction) or below (downward correction) the entry point.

---

## 9. Chronological Trajectory Verification (Start Candle & Lookback History)
*   **Deterministic Entry & History Tracking**: Implemented standard mathematical lookup coordinates inside `runSingleAnalysis` to locate the exact "Star / First Candle" which marks the trade opening trigger (coinciding with the yellow entry boundary line). 
*   **Three-Candle Historical Lookback Analysis**: To eliminate any subjective/imagined values, the system parses the temporal OHLC series to extract exactly 3 candlesticks prior to the trigger candle. It catalogs their absolute Open, High, Low, and Close parameters.
*   **Highly Polished Trajectory Dropdown Visual logs**: Embedded beautiful color-coded cards under the math evaluation dashboard in individual batch item dropdowns. These logs dynamically itemize the historical preceding candles (flagged as bullish green or bearish red indicator badges) and display the explicit trigger Close price, proving to the user that all indicators, testing offsets, and decisions operate under strict real-world market structure logic.
*   **H&M Manifest File Generation Synchronization**: Integrated the exact same chronological identification algorithms into the fast manifest creation process, storing the detected trade start Close and preceding lookback Close points in custom properties and placing a clear textual trade summary directly into the downloaded JSON entries.

---

## 10. Geometry-Perfect Candlestick Opening Point Alignments
*   **True Physical Candlestick Open Logic**: Standardized the system-wide backtesting, manifest validation, and visualization coordinate mapping to derive the trade opening entry barrier level directly from the physical opening point of the candle body:
    *   **In a Bullish (Green) Candlestick**: The visual broad bottom represents the exact opening price (`candle.open`).
    *   **In a Bearish (Red) Candlestick**: The visual broad top represents the exact opening price (`candle.open`).
*   **Strict Outcome Evaluation Sync**: Re-oriented the performance scoring and trade profitability direction calculations (`actualDirection`) in both live backtests and batch-manifest validation. Trade outcomes are evaluated by comparing the final exit close rate `ohlc[N-1].close` directly to this structurally correct `candle.open` price, fully eliminating any intermediate closed gaps or offset inaccuracies during sliced chronological timeline calculations.
*   **Polished Trajectory Badge Identifiers**: Rendered dedicated descriptive indicators (`(Broad Bottom)` for bullish and `(Broad Top)` for bearish) inside the individual dropdown log cards, providing full visibility and confirmation of candle physical geometry mapping.

---

## 11. Regulatory Notice (India)

ChartLens is designed and built in compliance with SEBI regulatory guidelines and exchange policies in India:

1.  **Educational Tool Only (Non-Advisory Portfolio Limit)**: ChartLens is **NOT registered** with the Securities and Exchange Board of India (SEBI) as an Investment Adviser (IA) under the SEBI (Investment Advisers) Regulations, 2013, or as a Research Analyst (RA) under the SEBI (Research Analysts) Regulations, 2014. It operates solely as an educational, quantitative chart analysis utility.
2.  **No Algo Order Execution / API Placement**: In strict compliance with SEBI Circular `SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013` (governing automated trade execution for retail clients), this application **does NOT place automated orders**, link to broker execution APIs, or engage in automated algorithmic execution. All signals are analytical outputs on a manual-only advisory sandbox overlay.
3.  **VWAP is a Proxy (HLC/3)**: Because volume is not extracted from static or camera-streamed chart images in the pixel vision pipeline, the indicator labeled `VWAP-Proxy*` uses an HLC/3 rolling calculation. It is not a true Volume Weighted Average Price (VWAP) and is labeled accordingly in the UI.
4.  **No Short-Selling Support**: Although the SEBI Short-Selling Framework (including the NSE Circular `CMPL60221` and January 2024 Master Circular) permits institutional and retail intraday short selling in the cash market under specific borrowing parameters, this application enforces a strict, **long-only** retail cash perspective. No bearish directional trades or naked short execution recommendations are emitted. All bear scoring operates purely as a veto/invalidation weight.






---

## 12. Complete Detailed Feature Breakdown

### A. The 3D Component Rendering Engine
ChartLens uses `@react-three/fiber` and `three.js` to provide a highly interactive, 3D visualization layer. The system renders floating diagnostic layers over charts to visualize the deterministic decisions.
- **Isolating Thread Memory**: A robust state-isolation architecture ensures that no cross-image signal/memory pollution occurs during backtesting. Web Workers are completely stateless per iteration.

### B. Fallback OCR and Normalize Data
The machine vision pipeline employs a fallback mechanism (`NORMALIZED_FALLBACK`) using percentage-based calculations if exact absolute price numbers cannot be reliably extracted via OCR. This ensures continuous operation in extremely noisy graphical charts.

### C. The Epsilon Guard and Determinism Checks
To guarantee strict determinism across different hardware, the application executes an `runEpsilonGuard()` verification at startup inside `analysisWorker.ts`. This validates that native floating-point math libraries on the current environment match the expected standard deviation parameters.

### D. Silent Audio Wake Lock
When bulk processing large backtests in background tabs, modern browsers heavily throttle or suspend Web Worker execution. ChartLens uses a "silent audio hack" via a continuously looping, silent base64 `Audio` element in `src/hooks/useWakeLock.ts` to maintain maximum CPU thread allocation.

### E. Frontend Interception of Errors
To ensure the highest reliability during operations, all uncaught exceptions, promise rejections, and Web Worker faults are globally intercepted in `src/main.tsx` and broadcast via `app-console-error` custom events to the main `App` component, displaying a scrollable global error overlay instead of silent failures.
