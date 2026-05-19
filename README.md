# ChartLens

ChartLens is a deterministic, offline-first web app for extracting candlestick structure from live chart screenshots/camera feeds and producing rule-based trading signals in real time.

## What it does
- Runs chart vision + signal logic locally in the browser.
- Uses a Web Worker pipeline for responsive UI while analysis runs off the main thread.
- Applies deterministic decision logic so identical inputs produce identical outputs.
- Surfaces confidence and stability gating before showing a trade call.

## Core pipeline
1. Capture frame input from the chart view.
2. Preprocess and rectify chart geometry.
3. Extract OHLC/candle-level features.
4. Compute indicator + rule-engine verdicts.
5. Apply stability filtering and display result.

## Local development
```bash
npm install
npm run dev
```

## Production build
```bash
npm run build
npm run preview
```

## Vercel
This repository includes `vercel.json` configured for SPA routing:
- Framework Preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- SPA fallback routing via `vercel.json`

## Notes
- ChartLens is designed for research and workflow automation; validate signals independently before any live trading use.
