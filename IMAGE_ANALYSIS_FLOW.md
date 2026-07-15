# 📊 ChartLens: The Offline Image Analysis Flow Architecture

> **A Comprehensive, Highly Detailed, and Extremely Precise Breakdown**
>
> This document serves as the definitive reference for the client-side, offline image analysis pipeline implemented within ChartLens. It meticulously delineates the execution lifecycle—from the exact moment of frontend image capture down through the deepest layers of our deterministic mathematical Scalping Engine, culminating in autonomous, high-conviction predictions.
>
> ChartLens operates entirely under a **long-only Scalping Engine workflow**. Predictive signals are aggressively evaluated and reduced to strictly binary states: `LONG` or `NO_TRADE`.

---

## 🏗️ 1. Frontend Capture and Execution Orchestration

The initiation of the analysis pipeline is deeply embedded in the frontend environment (active during Test Mode or Single Image Analysis). The primary orchestrator handling this initialization is `runSingleAnalysis` located in `src/utils/singleAnalysis.ts`.

### **Phase 1: Input Homogenization & Sanitization**
- **Base64 Canvas Conversion:** The raw image input is instantiated onto an invisible, in-memory HTML5 `<canvas>`. This serves a dual purpose: stripping away volatile meta-artifacts and enforcing rigid dimensionality and encoding standards (`image/jpeg` or `image/png`). This guarantees that downstream processes receive a standardized pixel array, neutralizing variance caused by diverse upload sources.

### **Phase 2: Thread Separation & Worker Dispatch**
- **Non-Blocking PostMessage Protocol:** To preserve 60FPS UI rendering and eliminate main-thread jank, the synchronous and computationally aggressive quantitative routines are strictly offloaded.
- The Base64 string, coupled with a robust configuration payload (`livePrice`, `graphTimeframeMinutes`, `techniquesList`, `minConfidence`), is dispatched to a dedicated background Web Worker process using the standard `postMessage` API with the payload `type: 'ANALYZE'`.

---

## ⚙️ 2. Web Worker Ingestion & Guard Rails

Operating independently, the `analysisWorker.ts` script functions as an infinite loop listener for 'ANALYZE' tasks. This architectural segregation is non-negotiable, given the intensity of client-side determinism enforced here.

### **Phase 1: Environment Initialization & Context Loading**
- **Horizon Context Construction:** The worker immediately builds a `HorizonContext` object. This crucial state manager normalizes external market variables—mapping timeframes (`tfMinutes`) against expected holding durations (`durationMinutes`) and calibrating the relative candlestick geometric ratios needed for scale-invariant processing.

### **Phase 2: Strict Determinism Audits**
- **Sanity Audits (Epsilon & Randomness Guards):** Before a single pixel is processed, the system runs strict structural constraints (`runDeterminismGuard` and `runEpsilonGuard`). These functions fiercely validate the execution sandbox, ensuring that native `Math.random()` outputs or arbitrary precision float drift (epsilon) do not leak unpredictable or non-deterministic states into the pure math pipeline.

---

## 👁️ 3. Vision Core: Optical Character Recognition & Feature Extraction

The pipeline transitions from basic ingestion into the heavy-lifting vision layer, orchestrated primarily through `buildPipelineResult` in `src/vision/pipeline.ts`.

### **Phase 1: Pixel Parsing to Numeric OHLC**
- **Client-Side Structure Mapping:** Leveraging a custom, strictly client-side Optical Character Recognition (OCR) implementation, the system scans the byte array to detect geometric forms. It identifies candlesticks, wicks, and body formations, meticulously translating these visual artifacts into a high-fidelity series of Open, High, Low, Close numeric data points (`ohlcSeries`).

### **Phase 2: Y-Axis Bounding & Epsilon Deviations**
- **Absolute vs. Relative Bounding:** The Y-Axis (`axis`) is concurrently parsed to map physical pixel coordinates to real-world numerical price boundaries.
- **Normalization Fallback (`NORMALIZED_FALLBACK`):** Should the OCR fail to derive absolute prices—or if the derived prices deviate beyond a strict mathematical epsilon when compared against the provided `livePrice`—the system executes a graceful degradation. The `dataQuality` flag is instantly demoted from `REAL_PRICE` to `NORMALIZED_FALLBACK`. This vital fail-safe forces all subsequent math algorithms to utilize percentage-based proportional calculations, averting catastrophic failures from corrupted absolute boundaries.

---

## 🛡️ 4. Stability Enforcement & Pre-Quantitative Feature Management

Prior to evaluating pure predictive logic, the pipeline aggregates higher-level visual patterns and fortifies them against time-series jitter.

### **Phase 1: Advanced Feature Detection**
- **Geometric Pattern Recognition:** Dedicated sub-routines analyze the freshly generated `ohlcSeries`.
  - `extractCandlestickPatterns`: Identifies engulfing shapes, dojis, and hammers.
  - `detectLatestGap`: Scans for pricing discontinuities and structural voids in the series.

### **Phase 2: Multi-Frame Temporal Confirmation**
- **Stability Managers:** Raw patterns are inherently noisy. The pipeline mitigates false artifacts by passing features through robust, stateful stability layers (`PatternStabilityManager` and `GapStabilityManager`).
- These managers enforce strict temporal confirmation requirements, requiring a pattern to exist consistently across multiple sequential frames before being declared "stable" and injected into the main Quantitative Rule Engine.

---

## 🧠 5. The Quantitative Rule Engine (4-Judge Matrix)

The analytical nucleus resides inside `evaluateSignal` (`src/quant/ruleEngine.ts`). This is a synchronous, highly deterministic pipeline that aggregates evidence across oscillators, trend lines, and price action phenomena.

### **Phase 1: Technique Evaluation Pipeline**
- `evaluateSignal` consumes up to 7 deeply structured arguments: `ohlcSeries`, `techniquesList` (which dynamically adjusts the technique minimums to prevent silent timeouts on isolated data), `horizonCtx`, `_confirmedPatterns`, `_confirmedGaps`, real-time `onLog` callbacks, and `neutralityConfig`.

### **Phase 2: The Judge Aggregation System**
The engine fractures analysis into specialized sub-systems (Judges), which operate as independent mathematical entities:
- **Judge 1 (J1):** Candlestick Structure & Geometry.
- **Judge 2 (J2 - Oscillators):** Evaluates moving averages and bounds (e.g., MACD, RSI, and Stochastic formulas).
- **Judge 3 (J3):** Volatility and Market Boundary Positioning.
- **Judge 4 (J4):** Skeptic Veto and Risk Gating.

### **Phase 3: Real-Time UI Pipe & Verdict Compilation**
- As these Judges process evidence, they emit progress logs directly back to the main UI thread via `JUDGE_LOG` messages, creating a live diagnostic visualization.
- The Judges yield an intermediate directional verdict (Bull, Bear, Neutral), calculating an absolute `finalScore` and a precise percentage `finalConfidence`.

---

## 🚀 6. Long-Only Scalping Engine & Strategic Volatility

Because ChartLens enforces a draconian long-only strategic parameter, the Rule Engine's broad output is violently filtered through the Scalping Engine (`evaluateScalpSignal` in `src/quant/scalpingEngine.ts`).

### **Phase 1: Structural & Volatility Mapping**
Additional localized features are rapidly mapped to context:
- **Swing Pivots (`findSwingPivots`):** Determines structural support and resistance floors.
- **Dynamic Volatility (`atr`):** Computes the Average True Range to measure kinetic market energy.
- **Mean Valuation (`vwapProxy`):** Estimates Volume Weighted Average Price positioning.

### **Phase 2: Ruthless Decision Execution**
- The intermediate verdict is cross-examined against strict scalping constraints defined in `scalpCtx`.
- **The Binary Outcome:** If, and only if, conditions align perfectly for a high-momentum bullish breakout, the system outputs `LONG`. If conditions are bearish, structurally weak, or lack absolute mathematical conviction, the execution is abruptly terminated, forcing a strict `NO_TRADE` verdict.

---

## 🏁 7. Temporal Filtration and Output Emission

With the final predictive state mathematically proven (`LONG` or `NO_TRADE`), the system executes final noise-reduction techniques before terminating the worker lifecycle.

### **Phase 1: Stability Emission (`emitStability`)**
- Stability algorithms analyze the directional flip. Crucially, under the `NO_TRADE` outcome, the system triggers an early exit. It intentionally bypasses updating Exponential Moving Averages (EMAs) or stateful indicators to strictly prevent baseline corruption from irrelevant bearish market drift.

### **Phase 2: Forensic Packaging & Dispatch**
- The worker compiles a meticulously detailed `debugTrace`. This artifact contains the entire structural logic tree, realized PnL estimates for simulated backtests, ultra-low execution latency metrics, and geometric bound mappings.
- **Return to Main Thread:** The definitive output is packaged and transmitted back to `singleAnalysis.ts` as a `FRAME_RESULT` or `STABLE_SIGNAL`. The frontend orchestrator maps a `BULL` outcome to `LONG` and processes neutral or bear events as `NO_TRADE`, concluding the fully autonomous, offline-first execution cycle.
