import { Platform } from 'react-native';
import { downscaleImage, parseTimeframeToMinutes, autoDetectCandles, cropRightByRatio } from './imageUtils';

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
  const {
    imageDataUrl, stock, graphTimeframe, investmentDuration, investmentAmount, 
    profitabilityPercent, techniquesList, encryptedSystemTokens, signal, 
    onProgress, onJudgeLogs, isTestMode
  } = params;

  let testModeRightSlice: string | null = null;
  let entryAnchorBase64: string | null = null;
  let finalImageForAnalysis = imageDataUrl;
  let autoGradeReason = '';
  let autoGradeConfidence = 0;
  let autoGradeRawOutcome = '';
  let autoOutcomePromise: Promise<any> | null = null;
  

  const fetchWithRetry = async (url: string, options: any, retries: number = 2): Promise<Response> => {
    if (options.signal?.aborted) throw new Error("Request aborted before retry");
    try {
      const res = await fetch(url, options);
      if (!res.ok && retries > 0 && (res.status >= 500 || res.status === 429)) {
        await new Promise(r => setTimeout(r, 2000));
        return fetchWithRetry(url, options, retries - 1);
      }
      return res;
    } catch (err: any) {
      if (retries > 0 && err.name !== 'AbortError' && !options.signal?.aborted) {
        await new Promise(r => setTimeout(r, 2000));
        return fetchWithRetry(url, options, retries - 1);
      }
      throw err;
    }
  };

  const optimizedImageForCrop = await downscaleImage(imageDataUrl);
  finalImageForAnalysis = optimizedImageForCrop;

  if (isTestMode && Platform.OS === 'web' && optimizedImageForCrop) {
    const parseDuration = parseTimeframeToMinutes(investmentDuration);
    const gDuration = parseTimeframeToMinutes(graphTimeframe);
    
    if (isNaN(parseDuration) || isNaN(gDuration) || gDuration <= 0) {
      throw new Error(`CROP FAILED: bad duration "${investmentDuration}" / timeframe "${graphTimeframe}".`);
    }
    
    const detectedCandles = await autoDetectCandles(optimizedImageForCrop);
    const candleMinutes = gDuration / Math.max(1, detectedCandles);
    const candlesToCut = Math.max(1, Math.round(parseDuration / candleMinutes));
    const ratioByDuration = parseDuration / gDuration;
    const ratioByCandles = candlesToCut / Math.max(1, detectedCandles);
    let ratio = Math.max(ratioByDuration, ratioByCandles);
    ratio = Math.max(0.05, Math.min(0.40, ratio));
    
    const cropResult = await cropRightByRatio(optimizedImageForCrop, ratio);
    finalImageForAnalysis = cropResult.leftSliceBase64;
    testModeRightSlice = cropResult.rightSliceBase64;
    entryAnchorBase64 = cropResult.entryAnchorBase64;
    
    autoOutcomePromise = fetchWithRetry('/api/read-outcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: entryAnchorBase64,
        rightSliceFallback: testModeRightSlice,
        encryptedSystemTokens
      })
    })
    .then(r => r.json())
    .catch(e => { console.error('AutoOutcome error:', e); return null; });
  }

  const base64Data = finalImageForAnalysis.split(',')[1];
  
  if (onJudgeLogs) {
    onJudgeLogs({
      judge1: { text: "Initializing Deep Scan...", status: 'active' },
      judge2: { text: "Initializing Deep Scan...", status: 'active' },
      judge3: { text: "Initializing Deep Scan...", status: 'active' },
      judge4: { text: "Initializing Deep Scan...", status: 'active' },
      system: { text: "Injecting global context...", status: 'active' }
    });
  }

  const apiCall = fetchWithRetry('/api/debate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: base64Data,
      symbol: stock,
      timeframe: graphTimeframe,
      investment: { amount: investmentAmount, duration: investmentDuration, profit: profitabilityPercent },
      structuralPriors: `Macro context for ${stock} on ${graphTimeframe} timeframe.`,
      geometricOracles: "Standard geometric extraction.",
      techniqueData: techniquesList,
      encryptedSystemTokens
    }),
    signal
  });
  apiCall.catch(() => { /* suppressed */ });

  if (onProgress) {
    const JUDGE_TASKS = {
      judge1: ["Scanning support nodes...", "Evaluating volume nodes...", "Mapping price patterns...", "Analyzing breakouts...", "Finalizing Bullish Case..."],
      judge2: ["Locating resistance zones...", "Analyzing selling pressure...", "Checking candle patterns...", "Projecting crash vectors...", "Finalizing Bearish Case..."],
      judge3: ["Calculating dynamic volatility...", "Identifying macro risks...", "Searching for liquidity sweeps...", "Measuring stop hunt probability...", "Finalizing Risk Assessment..."],
      judge4: ["Evaluating multi-timeframe boundaries...", "Plotting geometric boundaries...", "Detecting anomalous activity...", "Checking historical correlations...", "Setting Final Boundaries..."],
      system: ["Synchronizing visual tokens...", "Running tensor network...", "Weighting confidence matrices...", "Analyzing latency shifts...", "Compiling neural output..."]
    };
    (async () => {
      for (let i = 0; i <= 3; i++) {
        if (signal.aborted) break;
        if (onJudgeLogs) onJudgeLogs({
          judge1: { text: JUDGE_TASKS.judge1[i], status: 'active' },
          judge2: { text: JUDGE_TASKS.judge2[i], status: 'active' },
          judge3: { text: JUDGE_TASKS.judge3[i], status: 'active' },
          judge4: { text: JUDGE_TASKS.judge4[i], status: 'active' },
          system: { text: JUDGE_TASKS.system[i], status: 'active' }
        });
        await new Promise(r => setTimeout(r, 2000));
      }
      if (onJudgeLogs) onJudgeLogs({
        judge1: { text: JUDGE_TASKS.judge1[4], status: 'active' },
        judge2: { text: JUDGE_TASKS.judge2[4], status: 'active' },
        judge3: { text: JUDGE_TASKS.judge3[4], status: 'active' },
        judge4: { text: JUDGE_TASKS.judge4[4], status: 'active' },
        system: { text: "Simultaneously synthesizing neural nodes...", status: 'active' },
      });
    })().catch(console.error);
  }

  const minTimer = new Promise(r => setTimeout(r, 7000));
  const [response, , autoOutcomeResult] = await Promise.all([
    apiCall, minTimer, autoOutcomePromise || Promise.resolve(null)
  ]) as [Response, any, any];

  const contentType = response.headers.get('content-type');
  if (!response.ok) {
    let errorMsg = `Server Error: ${response.status}`;
    try {
      if (contentType && contentType.includes('application/json')) {
        const err = await response.json();
        errorMsg = err.error || errorMsg;
      }
    } catch(e) { console.error(e); }
    throw new Error(errorMsg);
  }
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error(`Server Error (${response.status}): Expected JSON.`);
  }

  const data = await response.json();
  if (!data || !data.judge) throw new Error("Analysis failed. Arbitrator did not return a valid decision.");

  const rawWinner = (data.judge.winner || '').toUpperCase();
  const rawSignal = (data.judge.tradeDetails?.signal || '').toUpperCase();
  const finalConfidence = Number(data.judge.finalConfidence) || 0;
  
  let direction: 'UP' | 'DOWN' | 'NO_TRADE' = 'NO_TRADE';
  if (finalConfidence >= 70) {
    if (rawWinner === 'BULL' || rawSignal === 'CALL' || rawSignal === 'UP') {
      direction = 'UP';
    } else if (rawWinner === 'BEAR' || rawSignal === 'PUT' || rawSignal === 'DOWN') {
      direction = 'DOWN';
    }
  }

  let finalOutcome: 'WIN' | 'LOSS' | 'INCONCLUSIVE' = 'INCONCLUSIVE';

  if (isTestMode && autoOutcomeResult) {
    const oc = autoOutcomeResult.outcome;
    let resolvedOutcome = (oc === 'UP' || oc === 'DOWN') ? oc : null;
    autoGradeReason = autoOutcomeResult.reason || '';
    autoGradeConfidence = Number(autoOutcomeResult.confidence) || 0;
    autoGradeRawOutcome = autoOutcomeResult.rawOutcome || '';

    if (!resolvedOutcome && testModeRightSlice) {
      try {
        const r = await fetch('/api/read-outcome', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: testModeRightSlice, encryptedSystemTokens })
        });
        const j = await r.json();
        if (j.outcome === 'UP' || j.outcome === 'DOWN') resolvedOutcome = j.outcome;
      } catch (e) { console.error("Fallback read-outcome error:", e); }
    }

    if (resolvedOutcome) {
      const isWin = (direction === 'UP' && resolvedOutcome === 'UP') || (direction === 'DOWN' && resolvedOutcome === 'DOWN');
      finalOutcome = isWin ? 'WIN' : 'LOSS';
    }
  }

  return {
    analysis: data,
    direction,
    outcome: finalOutcome,
    confidence: autoGradeConfidence,
    reason: autoGradeReason,
    testModeRightSlice,
    finalImageForAnalysis,
    entryAnchorBase64,
    rawOutcome: autoGradeRawOutcome
  };
}
