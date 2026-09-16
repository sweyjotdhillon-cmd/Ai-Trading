# IMAGE_ANALYSIS_FLOW

This document provides a highly detailed explanation of the automated image analysis workflow in ChartLens. The pipeline processes raw OHLCV market data through a multi-layered quantitative engine via web workers, ensuring the UI remains responsive.

## 1. Initiation Phase: `src/hooks/useBotLoop.ts`
The automated trading loop orchestrates the analysis.

*   **Trigger:** The system continuously monitors for new market data ticks (e.g., from Twelve Data or Yahoo Finance).
*   **Bypass DOM/OCR:** ChartLens directly receives raw OHLCV data. The `useBotLoop` hook directly passes this buffer (`directOhlcv`) to the analysis function, avoiding the overhead of generating a visual representation on the DOM and performing optical character recognition (OCR).
*   **Action:** It calls `runSingleAnalysis(params)` and awaits the result. During this period, the `isAnalyzing` flag is true, preventing overlapping runs.

## 2. Preparation & Delegation Phase: `src/utils/singleAnalysis.ts`
This function acts as the bridge between the UI thread and the web worker thread.

*   **Setup:** It receives the analysis parameters (live price, timeframe, techniques, raw OHLCV buffer).
*   **Worker Communication:** It initializes communication with a dedicated web worker from the isolated pool (`src/workers/analysisWorker.ts`).
*   **Message Dispatch:** It constructs a message payload (type: `"ANALYZE"`) containing the necessary data and a unique `msgId`.
*   **Promise Wrapping:** The `w.postMessage` call is wrapped in a Promise to seamlessly integrate the asynchronous worker response into the awaitable flow of `useBotLoop`.

## 3. Execution Phase: `src/workers/analysisWorker.ts` (The Engine)
The web worker handles all heavy computational tasks, operating on dedicated background threads.

*   **Ingestion & Parsing:** It receives the message and extracts the payload (OHLCV array). The engine often uses contiguous memory blocks like `Float64Array` for high-speed backtesting, bypassing regular garbage-collection overhead.
*   **Quantitative Rule Engine (`src/quant/ruleEngine.ts`):** The core logic is executed here.
    *   The engine evaluates signals (`LONG` or `NO_TRADE`) based on a strictly deterministic mathematical model.
    *   It requires a minimum of 10 techniques for non-bypassed analysis to ensure strong consensus.
    *   It features 4 distinct Judges:
        *   **Judge 1 (J1):** Candlestick Formations.
        *   **Judge 2 (J2):** Mathematical Trend Lines (EMA intersections, Bollinger, MACD, etc.).
        *   **Judge 3 (J3):** Volatility Boundary Positioning.
        *   **Judge 4 (J4):** Skeptic Veto (risk-gating).
*   **Scalping Engine (`src/quant/scalpingEngine.ts`):** In autonomous 'bot mode', it evaluates scalping signals using features like Swing Pivots, ATR, and VWAP proxies.

## 4. Finalization & Result Delivery
Once the worker concludes its analysis:

*   **Result Construction:** The worker constructs a detailed result object, including the final decision (signal, confidence), score matrix, judge evaluations, and debug traces.
*   **Message Return:** It sends the payload back to the main thread via `postMessage`.
*   **Promise Resolution:** The Promise in `singleAnalysis.ts` resolves, returning the detailed `AnalysisResult`.
*   **State Update:** `useBotLoop` processes the result, updates the application state, manages risk guards (`checkRiskCaps`), and records outcomes (e.g., triggering virtual trades).

---
*End of Flow Analysis.*
