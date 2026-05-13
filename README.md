# OcularAlpha: Live Chart Analyzer

**OcularAlpha** is a completely offline, real-time visual trading assistant built for professional day traders. By simply pointing your device's camera at any trading monitor or chart, OcularAlpha instantly converts live candlestick feeds into actionable trading signals using advanced, on-device machine vision and AI algorithms.

## Key Features

- **Real-Time Camera Feed Analysis**: Skip the APIs and manual data entry. Point your camera at a chart, and the app instantly begins scanning and analyzing candlestick patterns.
- **100% Offline & Private**: Your trading data and strategies never leave your device. The entire analysis pipeline runs entirely offline, guaranteeing maximum privacy and zero network latency.
- **Deterministic AI Engine**: The core engine is built to be strictly deterministic—given the exact same visual input, it guarantees the exact same signal output, ensuring reliable and consistent trading decisions.
- **Zero-Lag Architecture**: Heavy visual processing runs asynchronously using Web Workers. If the analysis exceeds 250ms per frame, the system dynamically scales down the resolution to maintain a flawless 30 FPS experience without freezing the main interface.

## How It Works

At its core, OcularAlpha acts as an automated chart analyzer that bridges the physical and digital trading worlds. The architecture is split into several offline stages:

1. **Vision Pipeline (The "Eyes")**:
   - The app captures the live camera feed and extracts image data.
   - Using edge detection and computer vision techniques, it identifies the structure of the chart, extracts open, high, low, and close (OHLC) data directly from the pixels.
2. **Quant Engine (The "Brain")**:
   - Extracted data is fed into a fast, local quantitative engine that evaluates traditional indicators (like RSI, MACD, and Bollinger Bands).
   - Decisions are routed through a **4-Judge Voting System** (Bull, Bear, Skeptic, and Boundary algorithms). All four must agree for a signal to pass.
3. **Stability Filter (The "Trigger")**:
   - To prevent false positives from flickering camera frames, the stability filter waits for three consecutive, identical decisions before issuing a final, high-confidence **STABLE 3/3** signal (CALL or PUT).

## Setup & Calibration

Because monitor screens, lighting, and chart colors vary across setups, OcularAlpha features a quick calibration step:

1. Point your camera at your active trading terminal or chart.
2. Tap **"Calibrate Colors"**.
3. Tap on a green (bullish) candle on your screen to register the bullish band.
4. Tap on a red (bearish) candle to register the bearish band.
5. Press **Confirm**.

The app is now perfectly tuned to the unique color signature of your monitor, allowing the computer vision engine to accurately read the market.

## Tech Stack Highlights

- **Web Workers**: Ensures the main UI thread never freezes by offloading the intensive vision processing.
- **React Native & Motion**: Delivers a premium, 60fps UI experience with smooth animations tailored for a pro terminal interface.
- **Determinism Guards**: Built-in self-audits ensure the quant engine never drifts or produces unpredictable results.
