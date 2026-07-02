# ChartLens Architectural Dissection: Offline Image Analysis Flow

This document provides a highly detailed, extremely precise, and highly structured technical dissection of the ChartLens offline, client-side image analysis pipeline. This pipeline enables instantaneous quantitative trading signals generated purely from pixel data, fully encapsulated within the user's browser via Web Workers.

---

## **Phase 1: Frontend Image Ingestion**

### **1.1. User Interaction & Base64 Encoding (`LiveAnalysis.tsx`)**
- The flow originates in the UI layer where a user submits a chart image (via screenshot, upload, or paste).
- The image is read asynchronously using standard DOM `FileReader` APIs.
- The raw image is converted directly into a Base64 encoded string (`dataUrl`).
- The component invokes the single analysis pipeline by calling `runSingleAnalysis(params)`.

### **1.2. Pre-processing & Canvas Extraction (`src/utils/singleAnalysis.ts`)**
- Upon entry to `runSingleAnalysis`, the `dataUrl` is loaded into a native HTML5 `<Image>` element.
- The image is rendered onto an off-screen `<canvas>` context (`2DCanvasRenderingContext`).
- **Cropping & Slicing:** To maintain focus and performance, the image may be horizontally sliced into segments (e.g., Left/Right splits for backtesting validation vs live evaluation).
- The canvas data is re-exported to Base64 using `canvas.toDataURL("image/jpeg", 0.5)` to aggressively optimize the payload size.
- **Image Data Extraction:** Finally, the optimized Base64 string is converted into a standard `ImageData` object (`Uint8ClampedArray` containing raw RGBA pixel data).

---

## **Phase 2: Background Dispatch & Web Worker Initialisation**

### **2.1. The Dispatch (`src/utils/singleAnalysis.ts`)**
- A dedicated background Web Worker (`analysisWorker.ts`) is utilised to offload heavy pixel processing and mathematical calculations from the main UI thread.
- The `ImageData` object, alongside user-configured context variables (e.g., `livePrice`, `graphTimeframeMinutes`, `techniquesList`, `minConfidence`), is packaged into an asynchronous `postMessage` payload labeled `ANALYZE`.
- The main thread creates a Promise wrapper, storing the `resolve`/`reject` handles in a `messageResolvers` Map indexed by a unique `msgId`.

### **2.2. Web Worker Ingestion (`src/workers/analysisWorker.ts`)**
- The Worker receives the `ANALYZE` payload.
- It immediately invokes the `buildPipelineResult` function passing the raw `ImageData`.

---

## **Phase 3: The Vision Pipeline (Pixel to OHLC Extraction)**

### **3.1. Pipeline Entry (`src/vision/pipeline.ts`)**
- **Budget Guard:** `buildPipelineResult` verifies the system is not exceeding compute budgets via `sessionBudgetExceeded`. If limits are hit, large images are dynamically down-scaled to reduce computational overhead.
- The raw `ImageData` is passed sequentially through two core machine vision modules:
    1.  **Axis Reader (`readYAxis`):**
        - OCR (Optical Character Recognition) techniques are applied to the right-most portion of the image to identify and parse the Y-Axis price labels.
        - The resulting labels are used to construct a `PriceAxisTransform`, providing a mathematical scaling factor (pixels-to-price ratio).
        - **Fallback Mechanism:** If OCR fails or is ambiguous, the system degrades gracefully to a `NORMALIZED_FALLBACK` model, using percentage-based calculations rather than absolute price values.
    2.  **Pixel Scanner (`extractOHLCFromPixels`):**
        - The image is vertically scanned to identify structural components of financial candlesticks (wicks and bodies).
        - Colour thresholds and spatial heuristics distinguish Bullish (green/white) from Bearish (red/black) candles.
        - Generates an array of `RawCandle` objects containing pixel coordinates for Open, High, Low, and Close points.

### **3.2. Data Structuring (`NumericOHLC`)**
- The `RawCandle` outputs are mathematically scaled using the `PriceAxisTransform`.
- This converts pixel coordinates into absolute (or normalized) mathematical values representing financial data.
- The output is an array of `NumericOHLC` objects, representing the canonical, machine-readable timeseries passed to the quantitative engine.
- A comprehensive `PipelineResult` object is constructed, encapsulating the timeseries, latency metrics, fallback states, and candle positioning data.

---

## **Phase 4: Quantitative Feature Extraction & Filtering**

### **4.1. The Horizon Context (`src/quant/horizon.ts`)**
- A `HorizonContext` is built, encapsulating the required state for the current timeframe and analysis parameters.

### **4.2. Pattern Recognition (`src/quant/patternAdapter.ts` & `src/quant/gapDetector.ts`)**
- **Candlestick Patterns:** `extractCandlestickPatterns` scans the recent `NumericOHLC` series for recognized visual formations (e.g., Doji, Hammer, Engulfing).
- **Gap Detection:** `detectLatestGap` identifies significant price discontinuities between adjacent periods.

### **4.3. Stability Managers**
- Raw detected patterns and gaps are passed through stability filters:
    -   `PatternStabilityManager`
    -   `GapStabilityManager`
- These layers ensure that ephemeral or weak signals identified in a single frame are consistently verified across multiple frames before being classified as actionable, mitigating false positives derived from minor vision errors.

---

## **Phase 5: The Quantitative Rule Engine (Signal Generation)**

### **5.1. Evaluation Entry (`src/quant/ruleEngine.ts` - `evaluateSignal`)**
- The core analytical function is invoked with up to 6 parameters: `ohlcSeries`, `techniquesList`, `horizonCtx`, `confirmedPatterns`, `confirmedGaps`, and a live `onLog` callback.

### **5.2. The Scoring Rubric (4-Judge Matrix)**
The engine utilises a deterministic, multi-faceted grading system:
1.  **Judge 1 (Trend/Momentum):** Evaluates prevailing market direction using moving averages (EMAs) and trendline proximity.
2.  **Judge 2 (Oscillator Consensus):** Analyses overbought/oversold conditions using RSI, Stochastic, and MACD indicators.
3.  **Judge 3 (Boundary/Reversal):** Looks for mean reversion signals utilizing Bollinger Bands, Support/Resistance zones, and the detected candlestick patterns/gaps.
4.  **Judge 4 (Skeptic Multiplier):** A macroeconomic risk filter that penalizes the total score if contradictory conditions or high volatility are present.

### **5.3. Scalping Engine (`src/quant/scalpingEngine.ts` - Optional)**
- If the application is operating in 'Bot Mode' or utilizing short-term scalping features (`featureFlags.USE_SCALPING_MODE`), the data is concurrently routed to the Scalping Engine (`evaluateScalpSignal`).
- This engine focuses on immediate micro-structure:
    -   `findSwingPivots`: Maps local highs and lows.
    -   `atr`: Calculates Average True Range for volatility-based dynamic stops.
    -   `vwapProxy`: Estimates Volume Weighted Average Price for intra-day trend bias.

---

## **Phase 6: Final Filtering & Response Dispatch**

### **6.1. Temporal Filtering (`src/quant/temporalFilter.ts`)**
- The final numeric decision (e.g., `BULL`, `BEAR`, or `NO_TRADE`) generated by the Rule Engine is passed through a temporal filter.
- This filter ensures the signal holds true over a specified duration, requiring sequential confirmations before a formal signal is emitted.
- In the long-only approach, Bearish signals are typically mapped to `NO_TRADE`.

### **6.2. Worker Response & Frontend Reconciliation**
- The `analysisWorker.ts` constructs the final payload containing the decision, detailed debug traces (OHLC arrays, score breakdowns), and execution latency.
- It posts the payload back to the main thread via `postMessage`.
- In `src/utils/singleAnalysis.ts`, the waiting Promise resolves.
- The UI layer reconciles the Worker's decision, calculates simulated outcomes, and maps the internal signal states (e.g., "LONG", "NO_TRADE") to the visual Dashboard elements.
