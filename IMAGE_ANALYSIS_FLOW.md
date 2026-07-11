# 🔍 ChartLens: Highly Detailed Offline Image Analysis Pipeline

> **A Comprehensive, Step-by-Step Architectural Dissection of the 100% Offline-First Image Ingestion and Quantitative Analysis Matrix.**

---

## 🏗️ 1. Image Ingestion (Frontend)

The initial pipeline execution natively begins within the isolated client frontend. For single image analysis (Test Mode), the frontend flow begins in `useBotLoop.ts` (as `LiveAnalysis.tsx` no longer exists) and UI hooks dealing with background analysis processing.
- **User Action**: The client triggers the upload of visual market charts or live data is automatically captured.
- **Conversion to Base64**: The provided image payload is instantly streamed and converted into a `Base64` data string via a standard `FileReader` or canvas logic.
- **Zero-Server Paradigm**: This foundational phase enforces a strict offline-first structure. All image data remains purely local; it is absolutely never transmitted, cached, or processed over external network calls.

---

## 🚀 2. Dispatch via `runSingleAnalysis`

Once the raw image is properly base64-encoded, the UI layer offloads the payload to the dispatch module.
- **Payload Orchestration**: The `runSingleAnalysis` function (`src/utils/singleAnalysis.ts`) systematically intercepts the data string alongside crucial UI parameters (e.g., `livePrice`, `techniquesList`, `minConfidence`, `isTestMode`).
- **Bridging the Thread Gap**: This utility serves as the primary asynchronous bridge between the primary UI rendering thread and the heavy-duty background analysis workers.
- **Promise Management**: It spins up uniquely tracked message promises using an internal mapping, ensuring robust multi-request tracking and timeout guards.

---

## ⚙️ 3. Background Processing (Web Worker)

To rigorously bypass any frontend UI thread blocking or visual stuttering, all intensive algorithmic operations are forcefully isolated.
- **Isolated Thread Pool**: The payload (`ANALYZE` type message) is injected into an active, dedicated Web Worker located at `src/workers/analysisWorker.ts`.
- **Task Scheduling**: The web worker consumes the data natively, maintaining completely disjoint memory scopes from the core React tree.

---

## 👁️ 4. Vision Pipeline and Y-Axis OCR Extraction

Inside the web worker, the raw image bytes undergo advanced deterministic visual scanning.
- **Pipeline Invocation**: The core `buildPipelineResult` framework (`src/vision/pipeline.ts`) strictly handles visual coordinate matching and color-band extractions, extracting the `ohlcSeries` and `axis` objects.
- **Chronological Restructuring**: Raw pixel matrices are synthesized back into clean, chronologically sorted Open-High-Low-Close data objects (`NumericOHLC`).
- **Y-Axis OCR Fallback Mechanism**:
  - Standard execution aggressively attempts strict numerical OCR to derive real-world absolute pricing via the Y-Axis.
  - **Fallback Event**: If textual data is mangled or missing, the pipeline securely transitions into a **`NORMALIZED_FALLBACK`** system. It uses relative percentage-based mapping ($yPercent$ boundary ratios) instead of absolute coordinates. This guarantees uninterrupted analysis operations without silent failure.

---

## 🧠 5. Feature Extraction and Stability Filtering

The derived `ohlcSeries` array and a freshly constructed `HorizonContext` data object now enter the pre-quantitative structuring phase. The `HorizonContext` is built to capture rolling market constraints (e.g. baseline structure) for the rule engine.
- **Morphology Recognition**: Core single and double candlestick patterns (e.g., *Engulfing*, *Pinbars*, *Hammers*, *Doji*) are distinctly identified by mapping wick ratios against total height (`extractCandlestickPatterns` from `src/quant/patternAdapter.ts`).
- **Gap Detection**: Price breaks and historical voids are structurally evaluated via `detectLatestGap`.
- **Stability Mechanisms**: The engine heavily relies on rolling frame verifications. Results are piped directly through strict state managers (`PatternStabilityManager` and `GapStabilityManager`), forcing minimum sequential frame persistence to discard visual noise or transient OCR glitches.

---

## ⚖️ 6. Quantitative Core (Rule Engine & Scalping Engine)

Filtered structural geometries are subsequently passed to the deterministic mathematical rules engine. The system operates on a strictly long-only model evaluating setups against a `LONG` or `NO_TRADE` baseline.
- **Pointwise Inequalities Matrix (`evaluateSignal` in `src/quant/ruleEngine.ts`)**: An extremely precise matrix evaluates potential positions based on the provided `techniquesList`. It no longer enforces a strict 10-technique minimum count, allowing analysis to proceed even with a small number of techniques to prevent silent timeouts. The function accepts up to 7 arguments: `ohlcSeries`, `techniquesList`, `horizonCtx`, `_confirmedPatterns`, `_confirmedGaps`, an optional `onLog` callback to emit real-time evaluation logs, and `neutralityConfig`.
  - **Judge 1 (Candlestick Formations)**: Verifies valid physical rejection behaviors (e.g., requires $\ge 0.55$ wick rejection threshold).
  - **Judge 2 (Mathematical Trend Lines)**: Aggregates EMA(9)/EMA(21) crossover structures, Bollinger Band extensions, and MACD divergence metrics.
  - **Judge 3 (Volatility Boundary)**: Calculates extreme relative positional states (triggers primarily on boundaries where $yPercent < 0.15$ or $> 0.85$).
  - **Judge 4 (Skeptic Veto)**: A dynamic risk-gating feature that completely vetos highly risky or historically skewed (ATR drift $> 2.5\sigma$) trade candidates.
- **Output Verdict**: Computes a deterministic binary signal: `LONG` or `NO_TRADE` (mapped via the final rules logic). Finally, the core analysis pipeline filters the resulting decision using `emitStability(decision)` to ensure robust final verdicts.
- **Scalping Integration (`evaluateScalpSignal`)**: The AI utilizes a scalping engine combining `findSwingPivots`, `atr`, and `vwapProxy` logic to autonomously manage and simulate rapid execution scenarios based on deterministic market structure cues.

---

## 📤 7. Result Emittance and UI Update

Upon completing the quantitative matrix execution, the worker securely formats its payload for the frontend.
- **Live Event Broadcasting**: Continuous analysis progress (e.g., latency, partial findings) and granular judge logs are streamed back to the UI state using `JUDGE_LOG` updates.
- **Verdict Delivery**: The final resolution, heavily decorated with score calculations, deterministic outcomes, and Scalp simulated plans is seamlessly injected back into the `runSingleAnalysis` promise.
- **DOM Rendering**: The main Dashboard and hooks like `useBotLoop` intercept this data, triggering dynamic React state updates that render the conclusive analysis charts, auto-graded markers, and explicit directionality advice (`LONG` or `NO_TRADE`) while gracefully preserving exact sub-100ms UI latency requirements.
