# 👁️ ChartLens: High-Precision Image Analysis Flow

Welcome to the definitive architectural dissection of ChartLens' offline, client-side, zero-latency image analysis pipeline. This document maps out the highly-supervised, deterministic machine vision and quantitative engine logic that takes a raw visual feed and converts it into actionable, high-conviction trading signals.

---

## 🏗️ 1. Frontend Capture & Ingestion (`src/components/LiveAnalysis.tsx`)

The analysis life-cycle triggers immediately when visual data enters the ChartLens interface.

- **The Source:** The frontend, constructed using React & React Native Web (`twrnc`), intercepts user-provided images or real-time camera frames (during live mode or bulk test mode).
- **The Delivery:** Utilizing standard browser capabilities like the `FileReader` API or `<canvas>`, the image is transformed into Base64 format or raw `ImageData` arrays.
- **The Dispatch:** This raw artifact is promptly handed over to the unified analysis orchestration gateway, preventing main-thread blocking.

---

## ⚡ 2. The Worker Delegation Gateway (`src/utils/singleAnalysis.ts`)

To ensure smooth UI performance and uninterrupted 60FPS rendering, heavy lifting must be offloaded.

- **Pool Mechanics:** ChartLens employs a dynamic Web Worker pool (`WORKER_POOL_SIZE` bounded by `navigator.hardwareConcurrency`).
- **The Bridge:** `runSingleAnalysis()` orchestrates the transport. It serializes the image data and dynamically attaches the user's selected trading criteria (`techniquesList`).
- **The Handshake:** The payload is transmitted to the dedicated background thread via `postMessage`, initiating the autonomous processing phase.

---

## 🏭 3. The Isolated Analysis Worker (`src/workers/analysisWorker.ts`)

The worker environment operates completely independently from the DOM, running strict determinism and safety audits before proceeding.

- **Pre-Flight Audits:** Guard rails like `runEpsilonGuard()` and `runDeterminismGuard()` are executed immediately upon worker startup to mathematically prove that the underlying JavaScript environment hasn't suffered floating-point corruption or unpredicted stochastic behaviors.
- **Payload Unpacking:** The worker receives the message, parsing out the raw pixels and user context (e.g., active techniques, horizon contexts).
- **Execution Invocation:** The worker commands the Vision Pipeline to commence its deep scan of the visual data via `buildPipelineResult()`.

---

## 🖼️ 4. The Deep Vision Pipeline (`src/vision/pipeline.ts`)

The raw pixels enter the core computer vision engine to mathematically reconstruct the original market structure.

### Phase 4A: Preparation & Calibration
- **Resolution Management:** A budget monitor prevents out-of-memory errors. If `sessionBudgetExceeded` is true for high-resolution images, a deterministic down-scaling (homography via crop/ratio bounding) preserves the core chart geometry.
- **Calibration Check:** The `isCalibrated()` function ensures the pipeline knows exactly which HSV color bands represent "Bullish" (green/white) and "Bearish" (red/black) forces.

### Phase 4B: Pixel Scanning (`src/vision/pixelScanner.ts`)
- **Extraction:** `extractOHLCFromPixels()` processes the `ImageData` pixel by pixel, seeking structural formations that match the calibrated color profiles.
- **The Artifacts:** The result is an array of `RawCandle` shapes, which accurately measure wicks, bodies, open/close orientations, and dimensional boundaries within the image plane.

### Phase 4C: OCR Axis Mapping & Transformation
- **Price Translation:** `readYAxis()` runs optical character recognition on the extreme right bounds of the frame.
- **Normalization Fallback:** If true market prices cannot be resolved (due to blurriness or cropping), the engine dynamically falls back to a normalized percentage scale (`NORMALIZED_FALLBACK`).
- **The Synthesis:** Combining the spatial `RawCandle` coordinates with the Y-Axis price map yields a mathematically rigorous, fully numeric array representing the historical market: the `NumericOHLC[]` sequence.

---

## 🔎 5. Advanced Feature Extraction

With the clean `NumericOHLC[]` array established, the engine looks for high-level technical formations.

- **Candlestick Patterns:** `extractCandlestickPatterns()` scans the series for identifiable structures (Doji, Hammer, Engulfing).
- **Gap Detection:** `detectLatestGap()` identifies localized structural discontinuities (Runaway Gaps, Breakaway Gaps).
- **Stability Filtering:** Because the feed might be fluctuating (camera jitter), the discoveries must survive temporal validation.
  - `PatternStabilityManager` enforces strict frame-by-frame survival for candlestick patterns.
  - `GapStabilityManager` ensures gaps represent real market voids, not artifacts.

---

## ⚖️ 6. The 4-Judge Quantitative Matrix (`src/quant/ruleEngine.ts`)

The final, filtered market structure is evaluated by `evaluateSignal()`, routing through a deterministic, high-conviction decision matrix.

1. **Judge 1 (Trend & Momentum):** Evaluates moving average slopes, Hurst exponents, and momentum gradients.
2. **Judge 2 (Oscillator Consensus):** Checks RSI divergence, MACD crossovers, and Stochastic extremes.
3. **Judge 3 (Boundary & Reversal):** Inspects Bollinger Band pinches, Z-Score breakouts, and support/resistance interactions.
4. **Judge 4 (The Skeptic Multiplier):** An overriding penalty system that crushes confidence scores if market conditions suggest untradeable noise (e.g., low volatility regime or conflicting signal evidence).

**The Verdict:** The four judges collapse their findings into a single `JudgeVerdict`—culminating in a calculated `finalConfidence`, a `winner` (BULL, BEAR, or NO_TRADE), and a detailed log output (`JUDGE_LOG`).

---

## 📡 7. Verification & UI Dispatch

The analytical cycle concludes as the worker prepares to update the user.

- **Temporal Stability:** The final decision is passed through `emitStability()` to prevent flickering UI signals. A signal only manifests if it has survived multiple sequential frames.
- **Message Transport:** The worker posts the resulting verdict, extracted patterns, and real-time calculation logs back to the main thread.
- **UI Render:** `LiveAnalysis.tsx` consumes the event payload. The application instantly maps the highly precise signal logic to the visual components (`LiveAnalysisResult`, `LiveAnalysisDebate`), displaying clear, high-contrast insights.

---

*This document serves as the master blueprint for the ChartLens autonomous analysis flow—strictly offline, highly determinist, and engineered for maximum precision.*