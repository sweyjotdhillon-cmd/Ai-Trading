# Pocket Quant: 100% Offline Deterministic Trading Signals

A 100% offline, deterministic, Web Worker-powered technical analysis pipeline that converts a live camera feed of a candlestick chart into actionable trading signals (CALL/PUT) with real-time confidence scoring.

## Key Features
- **100% Offline Deterministic Build**: The pipeline guarantees the same input image will result in the exact same output. Verified directly on worker boot.
- **Latency Budget Enforcement**: If the geometric pipeline takes longer than 250ms on a 1280x720 frame, it automatically steps down the resolution to preserve the 30 FPS experience.
- **Workerization**: The heavy Vision processing and Quant engine runs purely in an asynchronous Web Worker. The main thread never hangs.
- **Four Independent Judges**: Bull, Bear, Skeptic, and Boundary. All algorithms must reach a consensus above a high threshold before a `STABLE 3/3` trade signal is produced.

## Architecture

```text
[ Camera Feed ] -> (OffscreenCanvas) -> [ ImageData ]
        |
    postMessage
        |
[ Web Worker (AnalysisWorker) ]
        |
        +-- 1. Vision Pipeline (pipeline.ts)
        |      - Rectify & Crop (homography.ts)
        |      - Feature Ext (Canny, Hough)
        |      - OHLC Extraction (pixelScanner.ts)
        |
        +-- 2. Quant Engine (ruleEngine.ts)
        |      - Indicators (RSI, MACD, Bollinger)
        |      - 4-Judge Deterministic Voting 
        |
        +-- 3. Stability Filter (stabilityFilter.ts)
        |      - 3 consecutive identical decisions required
        |      - Outputs STABLE_SIGNAL
        |
    postMessage { ok, stage, ms, payload }
        |
[ Main Thread (LiveAnalysis.tsx) ]
        |
    [ UI Update (STABLE 3/3 Badge) ]
```

## Calibration Walkthrough
*(1 GIF, captured separately)*

When pointing the camera at a new terminal or chart, press **"Calibrate Colors"**.
- Tap a green candle to set the **Bullish** calibration band.
- Tap a red candle to set the **Bearish** calibration band.
- Press **Confirm**. The bands are passed to the worker and standardizes the machine vision against the specific screen.
