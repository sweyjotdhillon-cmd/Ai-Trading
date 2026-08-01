# Image Analysis Flow (Test Mode)

The image analysis workflow for the Test Mode has been updated to streamline data processing and improve background task delegation. The previous `LiveAnalysis.tsx` component has been deprecated and removed.

The current flow is as follows:

1. **Frontend Initiation**:
   The frontend flow now begins in `src/hooks/useBotLoop.ts`.

2. **Image Processing**:
   Within `useBotLoop.ts`, the target image is converted into a Base64 string format.

3. **Dispatch to Worker**:
   The Base64 image data is passed to the `runSingleAnalysis` function, located in `src/utils/singleAnalysis.ts`.

4. **Background Execution**:
   `runSingleAnalysis` dispatches the data to the background Web Worker (`src/workers/analysisWorker.ts`) where heavy mathematical, OCR, and technical indicator processing occurs asynchronously, preventing UI thread blockages.

5. **Result Evaluation**:
   The background worker processes the image (via the vision pipeline) and computes a trade decision (`LONG` or `NO_TRADE`) through the multi-judge quantitative rule engine, which is then sent back to the frontend.
