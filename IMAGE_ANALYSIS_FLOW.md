# IMAGE ANALYSIS FLOW

This document outlines the highly detailed, precise, and supervised lifecycle of a chart image traversing the ChartLens quantitative trading simulation engine. It describes the step-by-step process—from raw pixel ingestion to generating a strict, deterministic trading verdict.

---

## Phase 1: Frontend Ingestion & Canvas Preparation

### 1. Image Acquisition and Pre-processing (`src/utils/singleAnalysis.ts`)
*   **Trigger**: The frontend (`src/hooks/useBotLoop.ts`) captures a raw snapshot of the market chart (e.g., via `ohlcvToDataUrl` or an uploaded file) and passes the Base64 image to `runSingleAnalysis`.
*   **Test Mode Segmentation**:
    *   If running in `isTestMode`, the image is drawn onto an HTML `<canvas>`.
    *   The canvas is deterministically sliced based on user-defined configurations (e.g., `splitXPercent`) into a **left segment** (historical context for analysis) and a **right segment** (future outcome for auto-grading).
*   **Serialization**: The final image designated for analysis (the full image in live mode, or the left segment in test mode) is serialized back into a Base64 string and converted into raw `ImageData` via an asynchronous `dataUrlToImageData` utility.

### 2. Payload Dispatch
*   **Message Construction**: The main thread packages the raw `ImageData` alongside user parameters (e.g., `livePrice`, `holdingMinutesVal`, `techniquesList`, `minConfidence`) into a heavily supervised payload (`type: "ANALYZE"`).
*   **Thread Transition**: The payload is dispatched to a dedicated, background Web Worker thread (`src/workers/analysisWorker.ts`) via `postMessage`, completely decoupling the heavy visual and mathematical workloads from the React UI thread to prevent blocking.

---

## Phase 2: Web Worker Orchestration & Vision Pipeline

### 3. Worker Initialization (`src/workers/analysisWorker.ts`)
*   **Reception**: The `analysisWorker.ts` event listener intercepts the `"ANALYZE"` message.
*   **Environment Reset**: Pre-analysis safety checks are triggered, including resetting stability filters (`resetStability`, `resetTemporalFilter`) to ensure state isolation.

### 4. Vision Pipeline Execution (`src/vision/pipeline.ts`)
*   **Invocation**: The worker immediately calls `buildPipelineResult(imageData)`.
*   **Budgeting & Downscaling**: If previous extraction limits were exceeded (budget exceeded constraint), high-resolution images are dynamically downscaled (e.g., to $960 \times 540$) directly at the byte-array level using clamped nearest-neighbor loops to preserve processing bandwidth.
*   **Pixel Scanning (`extractOHLCFromPixels`)**:
    *   The engine loops over the `ImageData` pixel by pixel.
    *   It identifies candlestick geometry by searching for high-contrast structures, extracting raw vertical extrema (Highest Point/Lowest Point) and geometric boundaries (Body Top/Body Bottom).
    *   Color mapping determines polarity (Bull/Green vs. Bear/Red).
*   **Axis Translation (`readYAxis`)**:
    *   The right margin of the image is scanned via Optical Character Recognition (OCR) heuristics or predefined fallback transformations.
    *   It translates raw Y-coordinates (pixels) into a scaled market price domain (`PriceAxisTransform`).
*   **Structured Output**: The pipeline outputs an array of `NumericOHLC` objects—precise numerical representations matching the original chart's geometry.

---

## Phase 3: Mathematical Structuring & Context Gating

### 5. Architectural Context Building
*   **Horizon Definition (`HorizonContext`)**: Using the ingested timeframe and duration, physical boundaries and Hurst regime thresholds are set to govern behavior in the mathematical analysis.
*   **Market Structure**: Functions like `findSwingPivots` (from `src/quant/marketStructure.ts`) scan the `NumericOHLC` series for structural breaks (BOS) and changes of character (CHoCH).
*   **Technical Indicator Calculation**: Baseline indicators are mapped as Float64Arrays, calculating rolling values for RSI, MACD, Bollinger Bands, ATR, and VWAP (`src/quant/indicators.ts`).

### 6. Pattern & Edge Case Extraction
*   **Candlestick Formations (`extractCandlestickPatterns`)**: The adapter scans consecutive candle combinations for structural motifs (e.g., Engulfing patterns, Hammers, Pinbars).
*   **Gaps (`detectLatestGap`)**: Identifies severe liquidity voids between successive closes and opens.
*   **Stability Managers (`PatternStabilityManager`, `GapStabilityManager`)**: Applies temporal dampening to prevent flickering patterns from triggering false signals. Only patterns that persist across consecutive frames are recognized as actionable.

---

## Phase 4: The 4-Judge Deterministic Core

### 7. Evaluation Engine (`src/quant/ruleEngine.ts`)
The `NumericOHLC` array and all supporting evidence are fed into `evaluateSignal`. The engine is strictly deterministic and operates through a 4-Judge scoring matrix:

*   **Judge 1 (Wick & Body Ratios)**:
    *   Calculates relative exhaustions based on the formula: `|High - max(Open, Close)| / (High - Low)`.
    *   Verifies whether the physical rejection qualifies based on rigid threshold cutoffs (e.g., $\ge 0.55$).
*   **Judge 2 (Dynamic Trend Analysis)**:
    *   Cross-references EMAs (e.g., 9 vs 21).
    *   Evaluates MACD velocity and histogram divergence.
    *   Measures slope steepness and curvature to differentiate strong momentum from stagnation.
*   **Judge 3 (Volatility & Boundary Pricing)**:
    *   Calculates the precise floating-point positioning of the current price relative to moving Bollinger Standard Deviation bounds ($yPercent$).
    *   Detects extreme boundary reversals ($yPercent < 0.15$ or $> 0.85$).
*   **Judge 4 (The Skeptic / Risk Veto)**:
    *   Operates as a multiplier (penalty system).
    *   Drastically reduces overall confidence if the Z-score is mathematically overextended, if ATR spikes beyond acceptable standard deviations, or if contradictory volatility states exist.

### 8. Verdict Aggregation
*   **Scoring**: Bullish and Bearish inputs from all judges are summed independently.
*   **Margin Analysis**: The engine subtracts the opposing forces.
*   **Threshold Gating**: The final confidence must exceed strict system margins and the user-defined `minConfidence` limit.
*   **Decision**: The resulting struct declares a `winner`: `"BULL"`, `"BEAR"`, or `"NO_TRADE"`.

---

## Phase 5: Post-Processing & Return

### 9. Return Transmission
*   **Worker Completion**: The Web Worker packages the comprehensive judge matrix, reasoning statements, computed technicals, and the final decision.
*   **IPC Message (`postMessage`)**: The payload (`type: "ANALYZE_RESULT"`) is transmitted back across the thread boundary to `singleAnalysis.ts`.

### 10. Auto-Grading (Test Mode)
*   If in test mode, the frontend intercepts the result.
*   **Simulated Execution**: `singleAnalysis.ts` models a hypothetical execution based on the chosen direction (Long/Short), using the exact broad entry of the current candle (`open`).
*   **Verification**: The stored right-side "future" slice is analyzed to definitively calculate `"WIN"`, `"LOSS"`, or `"NEUTRAL"`.
*   **Resolution**: The `runSingleAnalysis` promise resolves, mapping the complex JSON structural data into the UI components (BotLoop/BotDashboard), triggering logging, statistical updates, and drawing visual bounding boxes on the DOM.
