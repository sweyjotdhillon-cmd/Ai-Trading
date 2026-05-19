let msgCounter = 0;
import { dataUrlToImageData } from './imageUtils';

let worker: Worker | null = null;
type Listener = (payload: any) => void;
const messageResolvers = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>();
const stableListeners = new Set<Listener>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../workers/analysisWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const { ok, stage, ms, payload } = e.data;

      if (!ok) {
        console.error(`Worker Fault [${stage}] ${ms.toFixed(1)}ms:`, payload.message);
        if (payload.msgId) {
          const res = messageResolvers.get(payload.msgId);
          if (res) {
            res.resolve({ type: 'ERROR', message: payload.message });
            messageResolvers.delete(payload.msgId);
          }
        }
        return;
      }

      const { type } = payload;
      if (type === 'FRAME_RESULT' && payload.msgId) {
        const res = messageResolvers.get(payload.msgId);
        if (res) {
          res.resolve(payload);
          messageResolvers.delete(payload.msgId);
        }
      } else if (type === 'STABLE_SIGNAL') {
        stableListeners.forEach(l => l(payload));
      }
    };
  }
  return worker;
}

export function onStableSignal(cb: Listener) {
  stableListeners.add(cb);
  return () => stableListeners.delete(cb);
}

export function resetWorkerStability() {
  getWorker().postMessage({ type: 'RESET' });
}

export function calibrateWorker(bullColor: any, bearColor: any) {
  getWorker().postMessage({ type: 'CALIBRATE', payload: { bullColor, bearColor } });
}

function generateId() {
  return String(performance.now()).replace(".","")+String(++msgCounter);
}

import { parseDurationToMinutes } from '../quant/horizon';

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
  outcome: 'WIN' | 'LOSS' | 'NEUTRAL';
  confidence: number;
  reason: string;
  testModeRightSlice: string | null;
  finalImageForAnalysis: string;
  entryAnchorBase64: string | null;
  rawOutcome?: string;
  frameStable?: boolean;
  actualDirection?: 'UP' | 'DOWN' | 'FLAT' | null;
  entryClose?: number;
  exitClose?: number;
  candlesCut?: number;
}> {
  const t0 = performance.now();
  const { imageDataUrl, onJudgeLogs, isTestMode } = params;

  if (onJudgeLogs) {
    onJudgeLogs({
      judge1: { text: "Initializing Worker Pipeline...", status: 'active' },
      judge2: { text: "Awaiting Frame...", status: 'active' },
      judge3: { text: "Reading Y-Axis...", status: 'active' },
      judge4: { text: "Checking Filters...", status: 'active' },
      system: { text: "Starting...", status: 'active' }
    });
  }

  const msgId = generateId();
  const w = getWorker();

  let imgData: ImageData;
  try {
    imgData = await dataUrlToImageData(imageDataUrl);
  } catch (err: any) {
    if (onJudgeLogs) {
      onJudgeLogs({ system: { text: `Error decoding image: ${err.message}`, status: 'error' } });
    }
    throw err;
  }


    const tfM = parseDurationToMinutes(params.graphTimeframe);
    const durM = parseDurationToMinutes(params.investmentDuration);

    const payloadPromise = new Promise<any>((resolve, reject) => {

    // Handle abort
    params.signal.addEventListener('abort', () => {
      messageResolvers.delete(msgId);
      reject(new Error('Aborted'));
    });
  });

  const payload = await payloadPromise;
  
  if (payload.type === 'ERROR') {
    if (onJudgeLogs) {
      onJudgeLogs({
        judge1: { text: "FAULT", status: 'error' },
        judge2: { text: "FAULT", status: 'error' },
        judge3: { text: "FAULT", status: 'error' },
        judge4: { text: "FAULT", status: 'error' },
        system: { text: `System Fault: ${payload.message}`, status: 'error' }
      });
    }
    return {
      analysis: {
        judge: { winner: 'NONE', decision: 'FAULT', finalConfidence: 0, j1Score: 0, j2Score: 0, j3Score: 0, j4Score: 0, ruling: payload.message, totalScore: 0, tradeDetails: { latencyAdjustedForecast: '', techniquesUsed: '', executionTimeMs: performance.now() - t0 } },
        bull: { reasoning: 'FAULT' }, bear: { reasoning: 'FAULT' }, skeptic: { riskVerdict: 'FAULT' }, techUsedCount: 0
      },
      direction: 'NO_TRADE', outcome: 'NEUTRAL', confidence: 0, reason: payload.message,
      testModeRightSlice: null, finalImageForAnalysis: imageDataUrl, entryAnchorBase64: null, rawOutcome: 'ERROR', frameStable: false,
      actualDirection: null
    };
  }

  const { frameStable, debugTrace } = payload;
  const decision = debugTrace.decision;
  const meta = debugTrace.meta;
  
  if (meta.reason === 'NO_CALIBRATION' || meta.candlesLength === 0) {
    if (onJudgeLogs) {
      onJudgeLogs({ system: { text: "Calibration required: Tap 'Calibrate Colors' before running analysis.", status: 'error' } });
    }
    throw new Error("Calibration required: Tap 'Calibrate Colors' before running analysis.");
  }
  
  // Predict outcome if testMode
  let outcome: 'WIN' | 'LOSS' | 'NEUTRAL' = 'NEUTRAL';
  let testModeRightSlice: string | null = null;
  let finalImageForAnalysis = imageDataUrl;
  
  let finalDecision = decision;
  let FS = finalDecision.finalScore;
  let entryClose: number | undefined;
  let exitClose: number | undefined;
  let actualDirection: 'UP' | 'DOWN' | 'FLAT' | null = null;
  let candlesCut: number | undefined;

  if (isTestMode && meta.candlesLength && meta.candlesLength > 10) {
    const nCut = parseInt(params.investmentDuration) || 5;
    candlesCut = nCut;
    const cropRatio = nCut / meta.candlesLength;
    
    if (cropRatio < 0.5) {
        const canvas = document.createElement('canvas');
        canvas.width = imgData.width;
        canvas.height = imgData.height;
        const ctx = canvas.getContext('2d')!;
        ctx.putImageData(imgData, 0, 0);

        const clampedRatio = Math.max(0.05, Math.min(0.40, cropRatio));
        const cutWidth = Math.floor(imgData.width * clampedRatio);
        const leftWidth = imgData.width - cutWidth;

        const leftCanvas = document.createElement('canvas');
        leftCanvas.width = leftWidth;
        leftCanvas.height = imgData.height;
        leftCanvas.getContext('2d')!.drawImage(canvas, 0, 0, leftWidth, imgData.height, 0, 0, leftWidth, imgData.height);
        
        const rightWidth = cutWidth;
        const rightCanvas = document.createElement('canvas');
        rightCanvas.width = rightWidth;
        rightCanvas.height = imgData.height;
        rightCanvas.getContext('2d')!.drawImage(canvas, leftWidth, 0, rightWidth, imgData.height, 0, 0, rightWidth, imgData.height);
        
        testModeRightSlice = rightCanvas.toDataURL('image/jpeg', 0.5);
        finalImageForAnalysis = leftCanvas.toDataURL('image/jpeg', 0.5);

        canvas.width = 0; canvas.height = 0;
        leftCanvas.width = 0; leftCanvas.height = 0;
        rightCanvas.width = 0; rightCanvas.height = 0;

        const leftImgData = await dataUrlToImageData(finalImageForAnalysis);


        const payloadPromise2 = new Promise<any>((resolve, reject) => {
          messageResolvers.set(msgId2, { resolve, reject });
          try {
            w.postMessage({
              type: 'ANALYZE',
              msgId: msgId2,
              imageData: leftImgData,
              graphTimeframeMinutes: tfM,
              investmentDurationMinutes: durM,
              techniquesList: params.techniquesList,
            });
          } catch (e: any) {
            reject(e);
          }
          params.signal.addEventListener('abort', () => {
            messageResolvers.delete(msgId2);
            reject(new Error('Aborted'));
          });
        });

        const payload2 = await payloadPromise2;
        
        if (payload2.type !== 'ERROR') {
           finalDecision = payload2.debugTrace?.decision || payload2.decision || finalDecision;
           FS = finalDecision.finalScore || 0;
           
           exitClose = decision?.evidence?.lastClose;
           entryClose = finalDecision?.evidence?.lastClose;
           
           if (entryClose !== undefined && exitClose !== undefined) {
             if (exitClose > entryClose) {
               actualDirection = 'UP';
             } else if (exitClose < entryClose) {
               actualDirection = 'DOWN';
             } else {
               actualDirection = 'FLAT';
             }

             if (actualDirection === 'FLAT' || finalDecision.winner === 'NO_TRADE') {
                 outcome = 'NEUTRAL';
             } else if (finalDecision.winner === 'BULL') {
                 outcome = actualDirection === 'UP' ? 'WIN' : 'LOSS';
             } else if (finalDecision.winner === 'BEAR') {
                 outcome = actualDirection === 'DOWN' ? 'WIN' : 'LOSS';
             }
           }
        }
    }
  }

  const mappedDirection = finalDecision.winner === 'BULL' ? 'UP' : (finalDecision.winner === 'BEAR' ? 'DOWN' : 'NO_TRADE');

  const cases = finalDecision.cases || { bull: { j1: 0, j2: 0, j3: 0, total: 0 }, bear: { j1: 0, j2: 0, j3: 0, total: 0 } };
  const J1 = cases.bull.j1 + cases.bear.j1;
  const J2 = cases.bull.j2 + cases.bear.j2;
  const J3 = cases.bull.j3 + cases.bear.j3;
  const J4 = finalDecision.skepticMultiplier || 1.0;

  if (onJudgeLogs) {
    onJudgeLogs({
      judge1: { text: `Bull Score: ${cases.bull.total.toFixed(1)}`, status: 'success' },
      judge2: { text: `Bear Score: ${cases.bear.total.toFixed(1)}`, status: 'success' },
      judge3: { text: `Margin: ${finalDecision.margin.toFixed(1)}`, status: 'success' },
      judge4: { text: `Skeptic Veto: ${(J4 * 100).toFixed(0)}%`, status: 'success' },
      system: { text: `Pipeline: ${(meta.latencyMs || 0).toFixed(0)}ms | Stable: ${frameStable ? 'YES' : 'NO'}`, status: 'success' }
    });
  }

  const tTotal = performance.now() - t0;

  return {
    analysis: {
      judge: {
        cases: cases,
        winner: finalDecision.winner,
        decision: finalDecision.winner === 'NO_TRADE' ? 'WEAK' : 'STRONG SIGNAL',
        finalConfidence: finalDecision.finalConfidence,
        j1Score: J1,
        j2Score: J2,
        j3Score: J3,
        j4Score: finalDecision.skepticPenalty,
        ruling: finalDecision.ruling,
        totalScore: FS,
        tradeDetails: {
          latencyAdjustedForecast: `Signal: ${finalDecision.signal}`,
          techniquesUsed: finalDecision.techniquesUsed || 'None',
          executionTimeMs: tTotal
        }
      },
      bull: { reasoning: `Score ${cases.bull.total}` },
      bear: { reasoning: `Score ${cases.bear.total}` },
      skeptic: { riskVerdict: `Multiplier ${J4}` },
      techUsedCount: finalDecision.techUsedCount || 0
    },
    direction: mappedDirection,
    actualDirection,
    outcome,
    confidence: finalDecision.finalConfidence,
    reason: `Engine completed with finalScore=${FS}`,
    testModeRightSlice,
    finalImageForAnalysis,
    entryAnchorBase64: null,
    rawOutcome: finalDecision.signal,
    frameStable,
    entryClose,
    exitClose,
    candlesCut
  };
}
