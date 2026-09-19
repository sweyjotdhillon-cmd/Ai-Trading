# Image Analysis Flow

The application's image analysis workflow has been redesigned to optimize performance and prevent UI thread blocking. This document outlines the updated architecture and data flow.

## 1. Initiation (`src/hooks/useBotLoop.ts`)
- The `LiveAnalysis.tsx` component has been deprecated.
- Frontend image analysis initiation and processing now entirely occur within the autonomous bot mode loop (`src/hooks/useBotLoop.ts`).

## 2. Bypassing DOM/OCR
- The bot's automated image analysis workflow bypasses expensive DOM rendering and OCR extraction.
- Instead, it passes the raw OHLCV buffer (`directOhlcv`) directly into the analysis pipeline via `runSingleAnalysis`.

## 3. Worker Delegation (`src/workers/analysisWorker.ts`)
- To ensure the main UI thread remains highly responsive, the image analysis pipeline triggered by `runSingleAnalysis` delegates heavy image processing tasks (such as pixel extraction in `buildPipelineResult`).
- These tasks are handed off to an isolated Web Worker pool, passing both the image `dataUrl` and the raw OHLCV data.

## 4. Deterministic Scalping Engine (`src/quant/ruleEngine.ts`)
- The quantitative AI prediction analysis does not rely on LLMs or external AI; it uses strictly deterministic mathematical models.
- The system operates as a long-only scalping model, evaluating signals exclusively as `LONG` or `NO_TRADE` through the Scalping Engine.
- The core rule engine evaluates signals based on strict mathematical rules and requires a minimum threshold of techniques for non-bypassed analysis to establish strong consensus.
