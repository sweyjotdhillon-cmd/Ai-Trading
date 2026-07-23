# ChartLens: Deep Image Analysis Architecture Flow

> **Confidential & Proprietary Architecture Documentation**
> This document details the exact, deterministic lifecycle of the ChartLens Image Analysis Pipeline, tracing from initial pixel capture through to the final quantitative trade signal evaluation.

---

## Phase 1: Initiation via `useBotLoop.ts`
**Location:** `src/hooks/useBotLoop.ts`

The entire Test Mode and live execution analysis lifecycle originates within the custom React hook `useBotLoop.ts`. (Note: The legacy `LiveAnalysis.tsx` component is deprecated and no longer part of this workflow).

### 1.1 Trigger and Capture
- The system captures or generates the latest chart data.
- The raw image or chart structure is immediately converted into a Base64-encoded Data URL representation via internal utilities (e.g., `ohlcvToDataUrl`).

### 1.2 Hand-off
- Once the image data is serialized into Base64, `useBotLoop.ts` triggers the dispatch mechanism, passing the serialized payload to the single-analysis handler to avoid blocking the main UI thread.

---

## Phase 2: Dispatching via `singleAnalysis.ts`
**Location:** `src/utils/singleAnalysis.ts`

The `singleAnalysis.ts` module acts as the crucial bridge between the synchronous frontend UI and the asynchronous Web Worker pool.

### 2.1 The `runSingleAnalysis` Function
- **Invocation:** The frontend calls `runSingleAnalysis(dataUrl, ...)`.
- **Worker Allocation:** The function selects an available background Web Worker from the pre-warmed worker pool.
- **Dispatch:** The Base64 string is wrapped into a structured message payload and posted to the allocated Web Worker via `worker.postMessage(...)`.
- **Promise Wrapping:** It creates a pending Promise that will resolve once the entire background processing lifecycle is complete, managing a series of intermediate event listeners for real-time UI updates.

---

## Phase 3: Web Worker Orchestration
**Location:** `src/workers/analysisWorker.ts`

To maintain extreme frontend responsiveness, all heavy computation, computer vision, and mathematical processing run in an isolated Web Worker (`analysisWorker.ts`).

### 3.1 Reception and Initialization
- The worker receives the message payload containing the Base64 image.
- It immediately decodes the image back into raw `ImageData` pixel buffers (using an internal OffscreenCanvas or similar implementation).

### 3.2 Live Logging and Telemetry
- Throughout the entire process, the Web Worker dynamically communicates live analysis progress back to the main thread.
- **`JUDGE_LOG` Transmission:** Granular, step-by-step judge evaluation logs and structural insights are continuously sent back via the `JUDGE_LOG` message type. This ensures the frontend UI reflects real-time, deterministic system activity.

---

## Phase 4: Vision Pipeline Extraction
**Location:** `src/vision/pipeline.ts`

This phase transforms raw, unstructured pixel data into structured financial mathematics.

### 4.1 `buildPipelineResult` Invocation
- The worker invokes the core `buildPipelineResult(imageData)` function.
- This function performs high-speed pixel scanning, OCR, and color calibration to detect structural chart elements.

### 4.2 Mathematical Yield
The pipeline successfully extracts two primary structures:
- **`ohlcSeries`**: A precise array of extracted Japanese Candlesticks containing Open, High, Low, and Close numerical values.
- **`axis`**: The price axis transform data (e.g., pixel-to-price mapping).

*Note: Simultaneously, `HorizonContext` is built to capture market constraints and context for the upcoming rule engine.*

---

## Phase 5: Quantitative Evaluation (`ruleEngine.ts`)
**Location:** `src/quant/ruleEngine.ts`

The extracted structural data is fed into the highly strict, deterministic Quantitative Rule Engine.

### 5.1 The `evaluateSignal` Signature
The `evaluateSignal` function executes the core algorithm and is strictly typed to accept exactly 7 arguments:
1. `ohlcSeries`: The mathematical series from the Vision Pipeline.
2. `techniquesList`: The array of technical indicators/techniques to evaluate against.
3. `horizonArg`: Market constraint context from `HorizonContext`.
4. `_confirmedPatterns`: Detected structural candlestick patterns.
5. `_confirmedGaps`: Detected market gaps.
6. `onLog`: An optional callback mechanism to emit real-time evaluation strings (which are bridged to `JUDGE_LOG`).
7. `neutralityConfig`: Configuration limits for signal neutrality.

### 5.2 The `DecisionResult` Output
The evaluation produces a highly structured `DecisionResult` object which tracks granular system votes:
- **`shardPassVotes`**: Tracks successful passes within the technique shards.
- **`techEnginePassVotes`**: The cumulative score of the main technical engine.
- **`bullJ3Raw`**: The raw output of the J3 Judge (Trend/Momentum).

---

## Phase 6: Signal Filtering & Finalization
**Location:** `src/quant/stabilityFilter.ts` (and related filter chains)

Before a raw mathematical signal is deemed tradable, it must pass a final layer of defensive stability checks.

### 6.1 Stability Emission via `emitStability`
- The system calls `emitStability(decision)` passing the freshly minted `DecisionResult`.
- This filter checks for flickering signals, enforcing temporal consistency over multiple ticks or frames.
- A signal evaluates to `LONG` (in the long-only scalping model) or defaults to `NO_TRADE` if stability or quantitative checks fail.

### 6.2 Completion
- Once stabilized, the final verdict is packaged and sent back from `analysisWorker.ts` to `singleAnalysis.ts`, resolving the pending Promise.
- The `useBotLoop.ts` lifecycle receives the final evaluated result, enabling the execution layers (Scalping Engine) to take real financial action.

---
*End of Document*
