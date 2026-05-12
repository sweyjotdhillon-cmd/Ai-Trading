import { dataUrlToImageData } from './imageUtils';
import { extractOHLCFromPixels } from '../vision/pixelScanner';

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
      judge3: { text: "Computing...", status: 'active' },
      judge4: { text: "Checking Filters...", status: 'active' },
      system: { text: "Starting...", status: 'active' }
    });
  }

  let resultInfo = 'OK';
  let diag: any = {};
  let cCount = 0;

  try {
    const imgData = await dataUrlToImageData(imageDataUrl);
    const res = extractOHLCFromPixels(imgData);
    
    resultInfo = res.diagnostics.reason;
    diag = res.diagnostics;
    cCount = res.candles.length;

    if (onJudgeLogs) {
      const totalMs = Math.round(diag.maskBuildMs + diag.componentsMs + diag.filterMs + diag.wickTraceMs);
      const j3Status = totalMs > 100 ? 'error' : 'success';
      const fDiagPairs = Object.entries(diag.filterDiag?.reasons || {}).map(([k,v]) => `${k}:${v}`).join(', ') || 'None';

      onJudgeLogs({
        judge1: { text: `Detected ${cCount} candles.`, status: cCount > 0 ? 'success' : 'active' },
        judge2: { text: `Components: ${diag.componentCount} \u2192 ${diag.acceptedCount} accepted.`, status: 'success' },
        judge3: { text: `Perf: Mask[${Math.round(diag.maskBuildMs)}ms] cc[${Math.round(diag.componentsMs)}ms] flt[${Math.round(diag.filterMs)}ms] wick[${Math.round(diag.wickTraceMs)}ms] = ${totalMs}ms`, status: j3Status },
        judge4: { text: `Rejections: ${fDiagPairs}`, status: 'active' },
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
