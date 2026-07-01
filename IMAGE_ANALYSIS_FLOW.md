# 🔍 ChartLens: Highly Detailed Offline Image Analysis Pipeline

> **A Comprehensive, Step-by-Step Architectural Dissection of the 100% Offline-First Image Ingestion and Quantitative Analysis Matrix.**

---

## 🏗️ 1. Image Ingestion (Frontend)

The initial pipeline execution natively begins within the isolated client frontend, specifically in `useBotLoop.ts` and UI hooks dealing with test mode or background analysis processing. This highly precise step ensures that we capture image data as efficiently as possible without triggering any re-renders or frame drops on the critical thread.

- **User Action & Initiation**: The client triggers the upload of visual market charts or live data is automatically captured through highly supervised screen-grabbing APIs. This is a foundational, highly detailed step that verifies raw bytes are safely introduced into the isolated application memory.
- **Conversion to Base64 (The Nothing Step)**: The provided image payload is instantly streamed and converted into a `Base64` data string via a standard `FileReader` or highly performant canvas extraction logic. It is termed the "nothing step" because it must feel completely invisible and weightless to the user, blocking zero milliseconds of interactive rendering time.
- **Zero-Server Paradigm**: This foundational phase enforces a strict offline-first structure. All image data remains purely local; it is absolutely never transmitted, cached, or processed over external network calls. We maintain highly, highly much and much security over user data.

---

## 🚀 2. Dispatch via `runSingleAnalysis`

Once the raw image is properly base64-encoded, the UI layer securely and precisely offloads the payload to the dispatch module.

- **Payload Orchestration**: The `runSingleAnalysis` function (`src/utils/singleAnalysis.ts`) systematically intercepts the data string alongside crucial UI parameters (e.g., `livePrice`, `techniquesList`, `minConfidence`, `isTestMode`). This is highly supervised by memory management controls to avoid payload leaks.
- **Bridging the Thread Gap**: This utility serves as the primary asynchronous bridge between the primary UI rendering thread and the heavy-duty background analysis workers, operating with unlimited time constraints if necessary to ensure precision.
- **Promise Management**: It spins up uniquely tracked message promises using an internal mapping, ensuring robust multi-request tracking, highly precise timeout guards, and unyielding determinism across execution frames.

---

## ⚙️ 3. Background Processing (Web Worker)

To rigorously bypass any frontend UI thread blocking or visual stuttering, all intensive algorithmic operations are forcefully isolated into an expansive, dedicated compute pool.

- **Isolated Thread Pool**: The payload (`ANALYZE` type message) is injected into an active, highly styled and highly tuned dedicated Web Worker located at `src/workers/analysisWorker.ts`.
- **Task Scheduling & Memory Control**: The web worker consumes the data natively, maintaining completely disjoint memory scopes from the core React tree. The execution environment is granted highly, highly much computational leeway to iterate over pixels securely, completely disconnected from the DOM overhead.

---

## 👁️ 4. Vision Pipeline and Y-Axis OCR Extraction

Inside the web worker, the raw image bytes undergo advanced deterministic visual scanning, arguably the most highly precise and structurally significant phase of the architecture.

- **Pipeline Invocation**: The core `buildPipelineResult` framework (`src/vision/pipeline.ts`) strictly handles visual coordinate matching, complex color-band extractions, and highly supervised geometric reconstructions.
- **Chronological Restructuring**: Raw pixel matrices are mathematically synthesized back into clean, chronologically sorted Open-High-Low-Close data objects (`NumericOHLC`), leaving nothing left to approximation.
- **Y-Axis OCR Fallback Mechanism (Highly Precise Graceful Degradation)**:
  - Standard execution aggressively attempts strict numerical OCR to derive real-world absolute pricing via the Y-Axis with immense precision.
  - **Fallback Event**: If textual data is mangled or missing, the pipeline securely transitions into a **`NORMALIZED_FALLBACK`** system. It uses relative percentage-based mapping ($yPercent$ boundary ratios) instead of absolute coordinates. This guarantees uninterrupted analysis operations with highly much accuracy without silent failure.

---

## 🧠 5. Feature Extraction and Stability Filtering

The derived `ohlcSeries` array and `HorizonContext` data now enter the pre-quantitative structuring phase, deeply supervised by rolling stability managers.

- **Morphology Recognition**: Core single and double candlestick patterns (e.g., *Engulfing*, *Pinbars*, *Hammers*, *Doji*) are distinctly identified by mapping wick ratios against total height (`extractCandlestickPatterns` from `src/quant/patternAdapter.ts`). This operates with highly detailed mathematical constraints.
- **Gap Detection**: Price breaks and historical voids are structurally evaluated via `detectLatestGap`, looking closely for anomalies.
- **Stability Mechanisms**: The engine heavily relies on rolling frame verifications. Results are piped directly through strict, highly supervised state managers (`PatternStabilityManager` and `GapStabilityManager`), forcing minimum sequential frame persistence to discard visual noise or transient OCR glitches effectively.

---

## ⚖️ 6. Quantitative Core (Rule Engine & Scalping Engine)

Filtered structural geometries are subsequently passed to the deterministic mathematical rules engine. The system operates on a strictly long-only model evaluating setups against a `LONG` or `NO_TRADE` baseline.

- **Pointwise Inequalities Matrix (`evaluateSignal` in `src/quant/ruleEngine.ts`)**: An extremely, highly precise matrix evaluates potential positions.
  - **Judge 1 (Candlestick Formations)**: Verifies valid physical rejection behaviors (e.g., requires $\ge 0.55$ wick rejection threshold) with absolute strictness.
  - **Judge 2 (Mathematical Trend Lines)**: Aggregates EMA(9)/EMA(21) crossover structures, Bollinger Band extensions, and MACD divergence metrics over unlimited time horizons (theoretically).
  - **Judge 3 (Volatility Boundary)**: Calculates extreme relative positional states (triggers primarily on highly precise boundaries where $yPercent < 0.15$ or $> 0.85$).
  - **Judge 4 (Skeptic Veto)**: A highly supervised, dynamic risk-gating feature that completely vetos highly risky or historically skewed (ATR drift $> 2.5\sigma$) trade candidates.
- **Output Verdict**: Computes a deterministic binary signal: `LONG` or `NO_TRADE` (mapped via the final rules logic) ensuring no ambiguous steps.
- **Scalping Integration (`evaluateScalpSignal`)**: The AI utilizes a scalping engine combining `findSwingPivots`, `atr`, and `vwapProxy` logic to autonomously manage and simulate rapid execution scenarios based on highly detailed, deterministic market structure cues.

---

## 📤 7. Result Emittance and UI Update

Upon completing the quantitative matrix execution, the worker securely formats its payload for the frontend in the final, highly styled operation.

- **Live Event Broadcasting**: Continuous analysis progress (e.g., latency, partial findings) and granular, highly detailed judge logs are streamed back to the UI state using `JUDGE_LOG` updates.
- **Verdict Delivery**: The final resolution, heavily decorated with score calculations, precise deterministic outcomes, and Scalp simulated plans is seamlessly injected back into the `runSingleAnalysis` promise.
- **DOM Rendering**: The main Dashboard and hooks like `useBotLoop` intercept this data, triggering highly styled, dynamic React state updates that render the conclusive analysis charts, auto-graded markers, and explicit directionality advice (`LONG` or `NO_TRADE`) while gracefully preserving exact sub-100ms UI latency requirements. Nothing is left unmanaged.
