# 🖼️ ChartLens Image Analysis Workflow 🚀

*A highly detailed, comprehensive, and precision-engineered overview of the deterministic image-to-signal pipeline.*

---

## 🏗️ Architectural Overview

The image analysis flow is separated into three distinct boundaries to guarantee UI thread stability while executing heavy deterministic mathematical models on chart data.

1. **Frontend Capture Layer** (`useBotLoop.ts`)
2. **Orchestration Layer** (`singleAnalysis.ts`)
3. **Execution & Math Engine Layer** (`analysisWorker.ts`)

---

## 🔄 Step 1: Frontend Capture (`src/hooks/useBotLoop.ts`)

The lifecycle of an analysis begins when the automated bot determines a new candle has closed or the user forces a manual re-evaluation.

* **Trigger**: A valid tick is received and stability gates pass.
* **Canvas Snapshot**: The system invokes `ohlcvToDataUrl` (from `chartRenderer.ts`) to synchronously render the current OHLCV array into a static Base64 image payload on an off-screen canvas.
* **Initiation**: The Base64 string is forwarded alongside critical context (timeframe, holding duration, and active AI techniques) by calling `runSingleAnalysis`.

---

## 🚦 Step 2: Orchestration & Dispatch (`src/utils/singleAnalysis.ts`)

This orchestrator bridges the UI thread and the heavy background math engines.

### Worker Pool Management
A Web Worker pool is instantiated dynamically based on `navigator.hardwareConcurrency` (capped between 1 and 8). A round-robin system (`currentWorkerIndex = (currentWorkerIndex + 1) % WORKER_POOL_SIZE`) guarantees parallel processing capabilities when under heavy load.

### Pre-Flight Operations
* **Data Transformation**: The Base64 `imageDataUrl` is painted onto an isolated DOM canvas to be converted into a structured `ImageData` object (`dataUrlToImageData`), allowing raw byte access.
* **Test Mode Handling**: In Test Mode, the orchestrator physically crops the right side of the image (the "future" price action) via a dual-canvas slice operation to prevent data leakage. It extracts `threePriorCandles` for context and prepares an `AutoGradeGeometry` instance on the hidden slice to grade the eventual prediction strictly deterministically.

### Dispatch
A `MessageChannel` promise system (`messageResolvers`) tracks the lifecycle of the request. A unified payload is passed to the worker via `postMessage`:
```typescript
w.postMessage({
  type: "ANALYZE",
  msgId,
  imageData: imgData,              // Raw pixels
  directOhlcv: params.directOhlcv, // Optional bypass
  techniquesList: params.techniquesList,
  neutralityConfig: { strictNeutrality, biasCorrectionStrength, noTradePreference },
  minConfidence: params.minConfidence
});
```

---

## ⚙️ Step 3: Background Processing (`src/workers/analysisWorker.ts`)

Operating strictly on a background thread, this is where the `PipelineResult` is transformed into an actionable `Signal`.

### 3.1: Audit & Guard Initialization
The worker initiates by executing the `runEpsilonGuard` and `runDeterminismGuard` to guarantee that mathematical operations running in this thread yield exactly deterministic results across all hardware architectures.

### 3.2: Pipeline Extraction
* **Vision Pass**: The raw `ImageData` is passed through `buildPipelineResult`, extracting bounding boxes and mapping pixels back to absolute OHLC floats.
* **Axis Fallback**: If a live price feed is provided, the extracted highs/lows are cross-referenced. A deviation exceeding 2% triggers a `NORMALIZED_FALLBACK` warning, marking the chart scale as untrusted and falling back to relative spatial ratios.

### 3.3: Stability Managers
* **Patterns**: `extractCandlestickPatterns` isolates dojis, hammers, and engulfing shapes. These are fed into the `PatternStabilityManager` to ensure they persist across frames before entering the active context.
* **Gaps**: `detectLatestGap` is executed, and its results are funneled through the `GapStabilityManager`.

### 3.4: Rule Engine Execution (`evaluateSignal`)
The contextualized OHLC data is passed into the core `evaluateSignal` loop, distributing the data across up to four distinct judges:
1. **Judge 1 (J1 - Overbought/Oversold)**: Evaluates SR, Stochastic, etc.
2. **Judge 2 (J2 - Momentum/Oscillators)**: Processes MACD, RSI Divergences.
3. **Judge 3 (J3 - Moving Averages)**: Checks EMAs, VWAP.
4. **Judge 4 (J4 - The Skeptic)**: Applies global risk vetos.

*Output*: A raw canonical `DecisionResult` indicating `LONG` or `NO_TRADE`.

### 3.5: Scalping Mode Override
If `USE_SCALPING_MODE` is enabled, the worker runs an advanced pass:
* **Generates Structures**: Creates inputs dynamically via `vwapProxy`, `atr`, and `findSwingPivots`.
* **Scalping Engine**: The `evaluateScalpSignal` wrapper takes the output of `evaluateSignal` and applies tight, execution-focused scalping logic (confluence matrices, trailing stops).
* **Scalp Stability**: The result is passed through `emitScalpStability` to ensure the scalp thesis remains valid over multiple frames.

### 3.6: Temporal Filtering
The final signal and confidence are smoothed via `applyTemporalFilter` (or `applyScalpTemporalFilter`), preventing violent micro-flapping between `LONG` and `NO_TRADE` on volatile ticks.

### 3.7: Result Posting
The worker builds a comprehensive `debugTrace` containing the raw mathematical structures and fires a `postMessage` back to the orchestrator:
```typescript
sendOk('ANALYZE', {
  type: 'FRAME_RESULT',
  msgId: data.msgId,
  signal: finalSignal,
  confidence: finalConfidence,
  frameStable: finalStable,
  debugTrace,
  incidents,
  scalpDecision,
});
```

The orchestrator catches this event, resolves the promise, formats it into a mapped UI structure (`actualDirection`, `testModeRightSlice`), and returns it to `useBotLoop.ts` for final UI rendering and trade execution.
