import { dataUrlToImageData } from './imageUtils';
import { buildPipelineResult } from '../vision/pipeline';

export async function runSingleAnalysis(params: {
  imageDataUrl: string;
  stock: string;
  graphTimeframe: string;
  investmentDuration: string;
  investmentAmount: string;
  profitabilityPercent: string;
  techniquesList: string[];
  encryptedSystemTokens?: string;
  signal: AbortSignal;
  onProgress?: (step: string) => void;
  onJudgeLogs?: (logs: any) => void;
  isTestMode?: boolean;
}): Promise<{
  analysis: any;
  direction: 'UP' | 'DOWN' | 'NO_TRADE';
  outcome: 'WIN' | 'LOSS' | 'INCONCLUSIVE';
  confidence: number;
  reason: string;
  testModeRightSlice: string | null;
  finalImageForAnalysis: string;
  entryAnchorBase64: string | null;
  rawOutcome?: string;
}> {
  const { imageDataUrl, onJudgeLogs } = params;

  if (onJudgeLogs) {
    onJudgeLogs({
      judge1: { text: "Initializing Deterministic Pipeline...", status: 'active' },
      judge2: { text: "Awaiting Frame...", status: 'active' },
      judge3: { text: "Reading Y-Axis...", status: 'active' },
      judge4: { text: "Checking Filters...", status: 'active' },
      system: { text: "Starting...", status: 'active' }
    });
  }

  let resultInfo = 'OK';
  let cCount = 0;

  try {
    const imgData = await dataUrlToImageData(imageDataUrl);
    const pipeRes = buildPipelineResult(imgData);
    
    cCount = pipeRes.ohlcSeries.length;
    const ax = pipeRes.axis;
    const axString = ax ? `m=${ax.mSlope.toFixed(4)}, b=${ax.bIntercept.toFixed(1)}, anchors=${ax.anchors.length}` : `fallback`;

    if (onJudgeLogs) {
      const j2Status = pipeRes.meta.latencyMs > 500 ? 'error' : 'success';
      const axStatus = ax ? 'success' : 'active';
      const fallbackStr = pipeRes.meta.axisFallback ? ' (No exact OCR)' : '';
      const geomTimings = `[Geom: pre=${Math.round(pipeRes.meta.stages.preprocess)}ms cny=${Math.round(pipeRes.meta.stages.canny)}ms hgh=${Math.round(pipeRes.meta.stages.hough)}ms H=${Math.round(pipeRes.meta.stages.homography)}ms]`;

      onJudgeLogs({
        judge1: { text: `Mode: ${pipeRes.meta.mode} | Candles: ${cCount}`, status: cCount > 0 ? 'success' : 'active' },
        judge2: { text: `Pipeline: ${Math.round(pipeRes.meta.latencyMs)}ms ${geomTimings} [ohlc:${Math.round(pipeRes.meta.stages.ohlcExt)}ms]`, status: j2Status },
        judge3: { text: `Axis: ${axString}${fallbackStr}`, status: axStatus },
        judge4: { text: `Data Extracted successfully.`, status: 'success' },
        system: { text: `Status: ${resultInfo}`, status: resultInfo === 'OK' ? 'success' : 'error' }
      });
    }

  } catch (err: any) {
    resultInfo = err.message || String(err);
    if (onJudgeLogs) {
      onJudgeLogs({
        system: { text: `Error: ${resultInfo}`, status: 'error' }
      });
    }
  }

  return {
    analysis: {
      judge: {
        statement: `Pixel-to-Price Pipeline: ${resultInfo} (${cCount} candles)`,
        finalConfidence: 0
      }
    },
    direction: 'NO_TRADE',
    outcome: 'INCONCLUSIVE',
    confidence: 0,
    reason: 'Engine not yet implemented',
    testModeRightSlice: null,
    finalImageForAnalysis: imageDataUrl,
    entryAnchorBase64: null,
    rawOutcome: 'Engine not yet implemented'
  };
}
