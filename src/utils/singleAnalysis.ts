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
  frameStable?: boolean;
}> {
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

  const payloadPromise = new Promise<any>((resolve, reject) => {
    messageResolvers.set(msgId, { resolve, reject });
    try {
      w.postMessage({ type: 'ANALYZE', imageData: imgData, msgId, timestamp: performance.now() }, [imgData.data.buffer]);
    } catch {
      w.postMessage({ type: 'ANALYZE', imageData: imgData, msgId, timestamp: performance.now() });
    }

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
        judge: { winner: 'NONE', decision: 'FAULT', finalConfidence: 0, j1Score: 0, j2Score: 0, j3Score: 0, j4Score: 0, ruling: payload.message, totalScore: 0, tradeDetails: { latencyAdjustedForecast: '', techniquesUsed: '' } },
        bull: { reasoning: 'FAULT' }, bear: { reasoning: 'FAULT' }, skeptic: { riskVerdict: 'FAULT' }, techUsedCount: 0
      },
      direction: 'NO_TRADE', outcome: 'INCONCLUSIVE', confidence: 0, reason: payload.message,
      testModeRightSlice: null, finalImageForAnalysis: imageDataUrl, entryAnchorBase64: null, rawOutcome: 'ERROR', frameStable: false
    };
  }

  const { signal, confidence, frameStable, debugTrace } = payload;
  const decision = debugTrace.decision;
  const meta = debugTrace.meta;
  
  if (meta.reason === 'NO_CALIBRATION' || meta.candlesLength === 0) {
    if (onJudgeLogs) {
      onJudgeLogs({ system: { text: "Calibration required: Tap 'Calibrate Colors' before running analysis.", status: 'error' } });
    }
    throw new Error("Calibration required: Tap 'Calibrate Colors' before running analysis.");
  }
  
  // Predict outcome if testMode
  let outcome: 'WIN' | 'LOSS' | 'INCONCLUSIVE' = 'INCONCLUSIVE';
  let testModeRightSlice: string | null = null;
  let finalImageForAnalysis = imageDataUrl;
  
  let finalSignal = signal;
  let finalConfidence = confidence;
  let J1 = decision.bullScore;
  let J2 = decision.bearScore;
  let J3 = decision.skepticPenalty;
  let J4 = decision.boundaryBias;
  let FS = decision.finalScore;

  if (isTestMode && meta.candlesLength && meta.candlesLength > 10) {
    const nCut = parseInt(params.investmentDuration) || 5;
    const cropRatio = nCut / meta.candlesLength;
    
    if (cropRatio < 0.5) {
        const canvas = document.createElement('canvas');
        canvas.width = imgData.width;
        canvas.height = imgData.height;
        const ctx = canvas.getContext('2d')!;
        ctx.putImageData(imgData, 0, 0);

        const leftWidth = Math.floor(imgData.width * (1 - cropRatio));
        const leftCanvas = document.createElement('canvas');
        leftCanvas.width = leftWidth;
        leftCanvas.height = imgData.height;
        leftCanvas.getContext('2d')!.drawImage(canvas, 0, 0, leftWidth, imgData.height, 0, 0, leftWidth, imgData.height);
        
        const rightWidth = imgData.width - leftWidth;
        const rightCanvas = document.createElement('canvas');
        rightCanvas.width = rightWidth;
        rightCanvas.height = imgData.height;
        rightCanvas.getContext('2d')!.drawImage(canvas, leftWidth, 0, rightWidth, imgData.height, 0, 0, rightWidth, imgData.height);
        
        testModeRightSlice = rightCanvas.toDataURL();
        finalImageForAnalysis = leftCanvas.toDataURL();

        const leftImgData = await dataUrlToImageData(finalImageForAnalysis);
        
        const msgId2 = generateId();
        const payloadPromise2 = new Promise<any>((resolve, reject) => {
          messageResolvers.set(msgId2, { resolve, reject });
          w.postMessage({ type: 'ANALYZE', imageData: leftImgData, msgId: msgId2, timestamp: performance.now() });
        });
        const payload2 = await payloadPromise2;
        
        if (payload2.type !== 'ERROR' && payload2.debugTrace?.decision?.evidence?.lastClose !== undefined) {
           finalSignal = payload2.signal;
           finalConfidence = payload2.confidence;
           J1 = payload2.debugTrace.decision.bullScore;
           J2 = payload2.debugTrace.decision.bearScore;
           J3 = payload2.debugTrace.decision.skepticPenalty;
           J4 = payload2.debugTrace.decision.boundaryBias;
           FS = payload2.debugTrace.decision.finalScore;
           
           const originalClose = decision.evidence?.lastClose;
           const newClose = payload2.debugTrace.decision.evidence.lastClose;
           
           if (originalClose !== undefined) {
             const actualDir = originalClose > newClose ? 'UP' : (originalClose < newClose ? 'DOWN' : 'NO_TRADE');
             if (finalSignal === 'CALL') {
                 outcome = actualDir === 'UP' ? 'WIN' : 'LOSS';
             } else if (finalSignal === 'PUT') {
                 outcome = actualDir === 'DOWN' ? 'WIN' : 'LOSS';
             }
           }
        }
    }
  }

  const mappedDirection = finalSignal === 'CALL' ? 'UP' : (finalSignal === 'PUT' ? 'DOWN' : 'NO_TRADE');

  if (onJudgeLogs) {
    onJudgeLogs({
      judge1: { text: `Bull: Score=${J1.toFixed(0)}`, status: 'success' },
      judge2: { text: `Bear: Score=${J2.toFixed(0)}`, status: 'success' },
      judge3: { text: `Skeptic: Penalty=${J3.toFixed(0)}`, status: 'success' },
      judge4: { text: `Boundary: Bias=${J4.toFixed(0)}`, status: 'success' },
      system: { text: `Pipeline: ${(meta.latencyMs || 0).toFixed(0)}ms | Stable: ${frameStable ? 'YES' : 'NO'}`, status: 'success' }
    });
  }

  return {
    analysis: {
      judge: {
        winner: finalSignal === 'CALL' ? 'BULL' : (finalSignal === 'PUT' ? 'BEAR' : 'NONE'),
        decision: finalSignal === 'NO_TRADE' ? 'WEAK' : 'STRONG SIGNAL',
        finalConfidence: finalConfidence,
        j1Score: J1,
        j2Score: J2,
        j3Score: J3,
        j4Score: J4,
        ruling: `Final Score: ${FS}`,
        totalScore: FS,
        tradeDetails: {
          latencyAdjustedForecast: `Signal: ${finalSignal}`,
          techniquesUsed: `RSI: ${decision.evidence?.rsi?.toFixed(1) || 0}`
        }
      },
      bull: { reasoning: `Score ${J1}` },
      bear: { reasoning: `Score ${J2}` },
      skeptic: { riskVerdict: `Penalty ${J3}` },
      techUsedCount: 3
    },
    direction: mappedDirection,
    outcome,
    confidence: finalConfidence,
    reason: `Engine completed with finalScore=${FS}`,
    testModeRightSlice,
    finalImageForAnalysis,
    entryAnchorBase64: null,
    rawOutcome: finalSignal,
    frameStable
  };
}

