# 🖼️ CHARTLENS IMAGE ANALYSIS FLOW

> *A highly detailed, deeply supervised, deterministic pathway tracking market data from chronological buffer ingestion down to pointwise scoring decisions.*

This document traces the exact sequential lifecycle of how an OHLCV string buffer becomes a physical pixel array, travels through the isolated thread pool, and is evaluated by the quantitative 4-Judge matrix.

---

## 🏗️ Phase 1: Ingestion & Render (UI Thread)

**Location**: `src/hooks/useBotLoop.ts`

The primary loop orchestrates the start of a quantitative frame analysis:
1. **Buffer Aggregation**: Captures a contiguous block of text-based market data (from external JSON structures or twelve-data API).
2. **Data-URL Rendering**: Invokes the offline chart renderer `ohlcvToDataUrl(feed.ohlcvBuffer)` directly on the main thread, producing a Base64 graphical representation of the sequence.
3. **Delegation**: Calls `runSingleAnalysis(...)` from `src/utils/singleAnalysis.ts`, passing the raw data along with the newly rendered image string.

---

## 🚢 Phase 2: Web Worker Task Dispatch

**Location**: `src/utils/singleAnalysis.ts`

To guarantee a stable 60FPS UI rate and prevent GC freezes, heavy analysis runs entirely within an isolated worker:
1. **Thread Pool Rotation**: `getWorker()` rotates through a dedicated navigator hardware-limited pool (up to 8 Web Workers).
2. **Payload Generation**: Bundles the `imageDataUrl`, target dimensions, stock IDs, and configuration options.
3. **Execution**: Emits an `ANALYZE` structured message over `postMessage()` towards the isolated context.

---

## 🛠️ Phase 3: The Isolated Thread Context

**Location**: `src/workers/analysisWorker.ts`

Upon receiving the `ANALYZE` command, the worker performs pre-validation:
1. **Audit Hooks Run**: Tests system math predictability via `runDeterminismGuard` and floating-point precision bounds via `runEpsilonGuard`.
2. **Base64 Decoupling**: If using vision-based overrides, decodes the raw string directly back into a structured HTML `ImageData` entity without triggering the DOM.
3. **Vision Pipeline Boot**: Hands the context over to `buildPipelineResult(imageData)`.

---

## 👁️ Phase 4: Vision & Axis Normalization

**Location**: `src/vision/pipeline.ts`

This is the bridge between raw pixels and semantic float vectors.
1. **Budget Enforcement**: Evaluates recent CPU usage patterns. If in cooldown or if images are excessively large ($>1280 \times 720$), downsamples instantly via local arrays to a $960 \times 540$ buffer.
2. **Color Space Scanning (`extractOHLCFromPixels`)**:
   - Compares pixel data against calibrated Bullish/Bearish HSV masks.
   - Trace geometric boundaries and isolate candlestick blocks.
3. **Y-Axis Interpolation (`readYAxis`)**:
   - Scans visual ticks along the far-right border, applying text-based OCR (if needed) or relative coordinate maps.
4. **Final Assembly**: Normalizes spatial bounds into exact `NumericOHLC[]` objects containing `open`, `high`, `low`, `close` relative price points.

---

## 🧠 Phase 5: The Quantitative Engine Matrix

**Location**: `src/quant/ruleEngine.ts`

The `NumericOHLC[]` is passed immediately to the deterministic 4-Judge scoring matrix, `evaluateSignal`.
1. **Pattern Mapping**: `extractCandlestickPatterns` matches normalized prices against physical formations (Engulfing, Doji, Wick Rejection).
2. **Judge 1 (Structure)**: Assesses micro structural rejections via wick ratio mapping.
3. **Judge 2 (Mathematical Limits)**: Interrogates EMA convergence rates, MACD divergence metrics, and RSI limit pushes.
4. **Judge 3 (Volatility Bounds)**: Confirms the close relative to Bollinger standard deviations ($yPercent$ analysis).
5. **Judge 4 (Risk/Skeptic)**: Scans for runaway ATR drifts, preventing entries during violent, high-$\sigma$ gaps.

**Verdict Computation**:
If sufficient consensus is reached across $\ge 10$ technical metrics, a strict deterministic `LONG`, `SHORT`, or `NO_TRADE` vector is cast alongside an internal confidence score.

---

## 🏁 Phase 6: Resolution Loop

1. **Emission**: The worker compiles the confidence metrics, structural footprints, and the verdict into a `FRAME_RESULT` payload.
2. **UI Handshake**: The worker calls `postMessage()` back to `singleAnalysis.ts`.
3. **Execution Delivery**: Resolves the original internal Promise, allowing `useBotLoop.ts` to proceed into an `ARMED` or `IN_TRADE` temporal state.
