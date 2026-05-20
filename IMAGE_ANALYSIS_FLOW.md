# Image Analysis Flow

This document provides a highly detailed, comprehensive breakdown of the step-by-step image analysis pipeline within ChartLens. The flow describes how raw image data (either from a camera feed or test mode) is transformed into a deterministic quantitative trading prediction.

## 1. Frontend Capture (`LiveAnalysis.tsx`)

The analysis process begins in the frontend user interface. The user provides an image either via a live camera feed snapshot or by uploading a file.

*   **Image Acquisition:** The source frame is acquired. In Test Mode, this might be a historical chart image.
*   **Base64 Conversion:** The raw image data is read using the `FileReader` API and converted into a Base64 string payload. This stringified format ensures easy transport across the application boundary.
*   **Analysis Invocation:** The frontend calls the asynchronous utility `runSingleAnalysis(params)` from `src/utils/singleAnalysis.ts`. The payload includes the image data URL, stock ticker, timeframe, duration, and the user's selected trading techniques list (`techniquesList`).

## 2. Dispatching to the Web Worker (`runSingleAnalysis.ts`)

To prevent the main JavaScript thread from blocking (which would freeze the React UI), the heavy lifting is offloaded to a dedicated Web Worker.

*   **Decoding:** The Base64 `imageDataUrl` is parsed back into raw pixel `ImageData` (via `dataUrlToImageData`).
*   **Worker Communication:** `runSingleAnalysis` posts a message (`type: 'ANALYZE'`) containing the `ImageData` and user parameters (like timeframes and techniques) to `src/workers/analysisWorker.ts`.
*   **Test Mode Slicing:** If Bulk Test Mode is active, the image is programmatically divided into two sub-slices (Left for historical context, Right for future outcome verification) using canvas cropping techniques (`cropRatio`).

## 3. Worker Initialization & Safety Guards (`analysisWorker.ts`)

When the web worker receives the payload, it initializes the core deterministic processing routines.

*   **Audit Guards:** The system executes `runEpsilonGuard()` and `runDeterminismGuard()`. These ensure the mathematical environment is stable and that floating-point operations behave deterministically.
*   **Horizon Context:** The worker calculates a `HorizonContext` using the `graphTimeframeMinutes` and `investmentDurationMinutes`, resolving a timeframe ratio `H`.

## 4. The Vision Pipeline (`src/vision/pipeline.ts`)

The worker delegates the raw image data to `buildPipelineResult()`, which acts as the orchestrator for the machine vision algorithms. This pipeline transforms pixels into temporal market data (OHLC).

*   **Rectification & Centering:** `rectifyOrCenterCrop(imageData)` performs Sobel/Canny edge detection and homography transforms. This flattens, aligns, and un-skews the image to ensure vertical and horizontal lines are orthogonal.
*   **Color Space & Pixel Scanning:** `extractOHLCFromPixels(rectifiedFrame)` identifies the candlestick structures. Using calibrated color thresholds (`EPSILON`), it differentiates between bullish (green/white) and bearish (red/black) candles, isolating Open, High, Low, and Close (OHLC) pixel coordinates.
*   **Y-Axis OCR Translation:** `readYAxis(rectifiedFrame)` scans the right boundary of the image for price labels. If OCR successfully identifies text, it maps vertical pixel locations to real-world monetary values via a `PriceAxisTransform` slope/intercept model. If it fails, the pipeline uses a `NORMALIZED_FALLBACK`, analyzing the data purely on relative proportional changes.
*   **Data Structuring:** The output is a structured array of `NumericOHLC` objects representing the mathematical history of the chart.

## 5. The Quantitative AI Pipeline (`src/quant/ruleEngine.ts`)

With the structured `ohlcSeries`, the worker invokes the core quantitative rule engine via `evaluateSignal()`. This engine runs a strictly deterministic, point-based matrix.

*   **Strict Rule 10:** The engine verifies that at least 10 valid techniques are provided in `techniquesList`. At least 10 must mathematically match the dataset, otherwise, it immediately returns `NO_TRADE`. (Unit tests can bypass this via `__TEST_BYPASS__`).
*   **Indicator Generation:** Standard mathematical indicators (RSI, MACD, Bollinger Bands, ATR, Stochastic) and advanced derivatives (Z-Scores, EMA slope/curvature, RQA Determinism) are calculated over the OHLC array using typed `Float64Array` buffers for memory efficiency.
*   **The 4-Judge Matrix:**
    *   **Judge 1 (Trend & Momentum):** Evaluates prevailing slope, curvature, and matched candlestick patterns (e.g., Engulfing, Marubozu). Matched user-selected patterns boost this score.
    *   **Judge 2 (Oscillator Consensus):** Analyzes RSI divergence, Stochastic boundaries, and MACD histogram velocity.
    *   **Judge 3 (Boundary/Reversal):** Looks at wick-to-body ratios and the `yPercent` (percentile placement of the close relative to local highs/lows).
    *   **Judge 4 (The Skeptic Multiplier):** A gating mechanism that evaluates Z-Scores, ATR spikes, and RQA laminarity. If erratic chop or extreme volatility is detected, it acts as a penalty multiplier, severely dropping overall confidence.
*   **Hurst Balancer:** The Hurst Exponent (`rescaledRangeHurst`) modifies the weights dynamically. High Hurst (> 0.55) amplifies momentum scoring, while low Hurst (< 0.45) amplifies mean-reversion scoring.
*   **Decision Rendering:** The engine totals the Bull and Bear points. The highest score wins (`BULL` or `BEAR`). If the margin is too close (< 3) or raw points are too low (< 7), it falls back to `NO_TRADE`.

## 6. Stability Filtering & Dispatch

Before sending the result back, the application attempts to eliminate noise from temporary camera glitches.

*   **Stability Filter:** `emitStability(decision)` compares the new decision against previous rapid frames. It only emits a `STABLE_SIGNAL` if multiple sequential frames agree on the point configurations.
*   **Worker Response:** The worker wraps the final signal, confidence percentage, margin, and detailed debug trace into a `FRAME_RESULT` payload.
*   **PostMessage:** The payload is sent back to the main thread via `self.postMessage`.

## 7. Frontend Resolution & Verdict Reporting

The `runSingleAnalysis` promise resolves, mapping the web worker output to the UI format.

*   **Test Mode Validation:** If running in Test Mode, the right-side (future) slice is evaluated against the predicted direction to automatically grade the result as a `WIN` or `LOSS`.
*   **Log Rendering:** The raw scoring details (Bull Score, Bear Score, Margin, Skeptic Veto percentage) are fed into the UI log streams (`onJudgeLogs`).
*   **Final Output:** The final unified payload, including the mapped direction (`UP`, `DOWN`, `NO_TRADE`) and final image references, is returned to `LiveAnalysis.tsx` to update the application state, rendering the verdict to the user.
