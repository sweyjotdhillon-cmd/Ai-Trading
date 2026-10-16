# ChartLens: Offline Image Analysis Flow Architecture

This document provides a highly detailed, extremely precise, and comprehensive breakdown of the client-side, offline image analysis pipeline in ChartLens. It outlines the complete execution path from initial frontend image capture down to the lowest-level deterministic mathematical engine generating autonomous Scalping predictions.

ChartLens' quantitative AI prediction analysis uses strictly deterministic mathematical models utilizing OCR-extracted OHLC data, executing exclusively on the client-side within a sandboxed Web Worker. It operates under a long-only Scalping Engine workflow, evaluating predictive signals exclusively as `LONG` or `NO_TRADE`.

## 1. Frontend Capture and Orchestration (`src/utils/singleAnalysis.ts`)

The analysis pipeline initiates from a single image or data source in the frontend environment (Test Mode or Single Image Analysis). The primary orchestrator function for this execution is `runSingleAnalysis` in `src/utils/singleAnalysis.ts`.

- **Input Conversion:** The image input is converted to Base64 formatting on an invisible, in-memory HTML5 Canvas to strip unwanted meta-artifacts and enforce standard dimensionality and encoding parameters before further processing.
- **Worker Dispatch:** Instead of executing the synchronous and computationally expensive quantitative routines on the main UI thread (which would cause massive jank), the Base64 image and contextual configuration parameters (e.g., `livePrice`, `graphTimeframeMinutes`, `techniquesList`, `minConfidence`) are dispatched via `postMessage` (with `type: 'ANALYZE'`) to a dedicated background Web Worker process.

## 2. Web Worker Ingestion (`src/workers/analysisWorker.ts`)

The `analysisWorker.ts` script acts as the main background thread event loop for handling incoming 'ANALYZE' requests. Because the entire system evaluates complex deterministic formulas directly in the browser, this architectural separation is critical.

- **Initialization & Context Loading:** The worker constructs a `HorizonContext` object mapping parameters such as timeframe (`tfMinutes`), holding duration (`durationMinutes`), and the specific relative ratios required for evaluating candlestick geometries across temporal scales.
- **Sanity Audits:** Prior to execution, global determinism constraints are enforced (e.g., via `runDeterminismGuard` and `runEpsilonGuard`) to ensure math libraries or random number generators don't leak unpredictable state into the pipeline.

## 3. Optical Character Recognition (OCR) and Feature Extraction (`src/vision/pipeline.ts`)

The image analysis moves into the vision layer via the `buildPipelineResult` function.

- **Pixel Parsing to OHLC:** A strictly client-side OCR implementation extracts standard Open, High, Low, Close (OHLC) pricing data points (`ohlcSeries`) directly from the geometric structures (candlesticks, wicks) within the provided image array.
- **Y-Axis Analysis:** The Y-Axis is similarly parsed (`axis`) to map real-world numerical bounds. If the OCR engine fails to extract absolute real-world prices or detects a deviation beyond an acceptable epsilon against a given `livePrice`, it gracefully falls back.
- **Normalization Fallback (`NORMALIZED_FALLBACK`):** In the event of Y-Axis parsing anomalies, the data quality marker is shifted from `REAL_PRICE` to `NORMALIZED_FALLBACK`, allowing subsequent mathematical models to use percentage-based proportional calculations rather than relying on assumed absolute numerical bounds.

## 4. Stability and Pre-Quantitative Feature Managers

Before executing predictive logic, pre-quantitative features are analyzed.

- **Feature Detection:** Functions map additional technical formations.
  - Candlestick patterns (`extractCandlestickPatterns`)
  - Gaps in the pricing series (`detectLatestGap`)
- **Stability Managers:** Time-series jitter or false artifacts are mitigated by passing the raw features through stateful stability layers (`PatternStabilityManager` and `GapStabilityManager`). These managers enforce multi-frame temporal confirmation before declaring a pattern or gap as "stable" and valid for the main evaluation engine.

## 5. The Quantitative Rule Engine (`src/quant/ruleEngine.ts`)

The core analytical logic happens inside `evaluateSignal`, a synchronous pipeline executing the rule-based logic to aggregate evidence across various indicators and price action phenomena.

- **Technique Evaluation:** `evaluateSignal` receives up to 7 crucial arguments: `ohlcSeries`, `techniquesList` (which can bypass strict minimum requirements, allowing isolated analysis without silent timeouts), `horizonCtx`, `_confirmedPatterns`, `_confirmedGaps`, real-time `onLog` callback delegates, and `neutralityConfig`.
- **The Judge System:** The engine uses an aggregate scoring model, evaluating evidence through sub-systems known as Judges (e.g., J1, J2, J3, J4). For example, the J2 (Oscillators) judge handles MACD, RSI, and Stochastic math.
- **Aggregate Verdict:** The final aggregate scores lead to an intermediate directional verdict (e.g., Bull or Bear) and calculate an absolute `finalScore` and a calculated percentage `finalConfidence`. During this execution, progress is synchronously piped back to the main UI thread via `JUDGE_LOG` messages for real-time visualization of the calculation stack.

## 6. Long-Only Scalping Engine (`src/quant/scalpingEngine.ts`)

Because the current ChartLens architecture operates under a strict, long-only approach, the broad directional output from the Rule Engine is piped into the Scalping Engine (`evaluateScalpSignal`) to determine precise execution parameters.

- **Structure and Volatility:** Additional features are rapidly mapped:
  - Swing Pivots (`findSwingPivots`) for structural support/resistance mapping.
  - Average True Range (`atr`) for measuring dynamic volatility.
  - Volume Weighted Average Price (`vwapProxy`) estimations.
- **Decision Execution:** By filtering the intermediate verdict against strict scalping constraints and configuration parameters (`scalpCtx`), the Scalping Engine finalizes the output.
- **Long/No Trade:** If the conditions satisfy a bullish breakout or momentum trade, the output signal is strictly defined as `LONG`. If the conditions are bearish, structurally invalid, or lack sufficient conviction, the system forces a strict `NO_TRADE` verdict.

## 7. Temporal Filtration and Output Emission

With the final deterministic output (`LONG` or `NO_TRADE`) computed, final noise-reduction techniques are applied before responding to the main thread.

- **Stability Emission (`emitStability`):** General stability algorithms are invoked to maintain state. In the long-only approach (`NO_TRADE`), the system yields an early return without updating Exponential Moving Averages (EMAs) to avoid baseline corruption from bearish market drift.
- **Final Packaging:** The worker compiles a highly detailed debug trace (`debugTrace`), appending structural logic, realized PnL estimates for simulated trades, execution latency metrics, and geometric data.
- **Return to Main Thread:** The result is dispatched back to `singleAnalysis.ts` as a `FRAME_RESULT` or `STABLE_SIGNAL`. The orchestrator maps the `BULL` outcome to `LONG` and processes neutral or bear events as `NO_TRADE`.

This comprehensive, completely self-contained architecture allows ChartLens to execute deterministic, rapid, and privacy-centric quantitative analysis entirely offline within the browser sandbox.
