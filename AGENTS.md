# ChartLens Agent Guidelines

This application acts as a 100% offline, local real-time live camera feed chart analyzer.
It has no external dependencies (no Firebase, no external APIs).
It uses Web Workers to run a deterministic machine vision and AI algorithm pipeline to generate trading signals.

## Architecture
- `src/quant/`: Contains all quantitative logic, rules, indicators, filters. Uses `Float64Array` heavily for performance.
- `src/vision/`: Handles image processing, OpenCV/canvas interactions, OCR, and axis extraction.
- `src/workers/`: Contains the Web Workers that bridge the main thread UI with the heavy quant/vision pipelines.
- `src/components/`: React UI components (Tailwind via `twrnc`).
- `src/utils/`: Helper functions.

## Testing & Execution
- Run `npm run lint` for linting.
- Run `npx tsc --noEmit` for type checking.
- Run `npx vitest run` to run all tests.
- For rapid execution of scratchpad scripts, use `npx tsx <filename>.ts`.
- Tests must be run and pass before submitting any code changes.
