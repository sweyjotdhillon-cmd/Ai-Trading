
import { evaluateSignal } from '../quant/ruleEngine';
import { buildPipelineResult } from '../vision/pipeline';
import { HorizonContext } from '../quant/horizon';
import { emitStability, resetStability } from '../quant/stabilityFilter';
import { getCalibrationBands, setCalibrationBands } from '../vision/colorCalibration';
import { runDeterminismGuard } from '../quant/__audit__/determinismGuard';
import { runEpsilonGuard } from '../vision/__audit__/epsilonGuard';
import { featureFlags } from '../config/featureFlags';
import { extractCandlestickPatterns, PatternEvidence } from '../quant/patternAdapter';
import { PatternStabilityManager } from '../quant/patternStability';
import { detectLatestGap, GapEvidence } from '../quant/gapDetector';
import { GapStabilityManager } from '../quant/gapStability';
import { applyTemporalFilter, resetTemporalFilter } from '../quant/temporalFilter';

const patternStabilityManager = new PatternStabilityManager();
const gapStabilityManager = new GapStabilityManager();

let engineFault = false;
let faultStack = '';

try {
  runEpsilonGuard();
  runDeterminismGuard();
} catch (e: any) {
  engineFault = true;
  faultStack = e.message || String(e);
}

self.onmessage = async (e: MessageEvent) => {
  const tStart = performance.now();
  const data = e.data;

  const sendOk = (stage: string, payload: any) => {
    self.postMessage({ ok: true, stage, ms: performance.now() - tStart, payload });
  };
  const sendErr = (stage: string, message: string, payload: any = {}) => {
    self.postMessage({ ok: false, stage, ms: performance.now() - tStart, payload: { ...payload, message } });
  };

  if (engineFault) {
    sendErr('AUDIT', faultStack, { msgId: data?.msgId });
    return;
  }

  let heartbeat: any;
  try {
    const data = e.data;
    if (data.msgId) {
      heartbeat = setInterval(() => { self.postMessage({ ok: true, stage: 'HEARTBEAT', payload: { type: 'HEARTBEAT', msgId: data.msgId, ts: Date.now() } }); }, 3000);
    }
    

    if (data.type === 'CALIBRATE') {
      const { bullColor, bearColor } = data.payload;
      setCalibrationBands(bullColor, bearColor);
      sendOk('CALIBRATE', { type: 'CALIBRATED', bands: getCalibrationBands() });
    } 
    else if (data.type === 'ANALYZE') {
      sendOk('PROGRESS', { type: 'PROGRESS', msgId: data.msgId, step: 'READING MARKET OUTCOME...' });
      sendOk('JUDGE_LOG', { msgId: data.msgId, logs: { system: { text: 'Starting...', status: 'active' } } });

      const tfMinutes = data.graphTimeframeMinutes || 30;
      const durationMinutes = data.investmentDurationMinutes || 5;
      const hRatio = Math.max(0.001, Math.min(4.0, durationMinutes / tfMinutes));
      let hClass: 'INTRA_CANDLE' | 'NEAR_FULL' | 'MULTI_CANDLE' = 'INTRA_CANDLE';
      if (hRatio >= 0.8 && hRatio <= 1.2) hClass = 'NEAR_FULL';
      else if (hRatio > 1.2) hClass = 'MULTI_CANDLE';

      const horizonCtx: HorizonContext = {
        tfMinutes,
        durationMinutes,
        H: hRatio,
        horizonClass: hClass
      };

      const t0Worker = performance.now();

      sendOk('PROGRESS', { type: 'PROGRESS', msgId: data.msgId, step: 'EXTRACTING CANDLESTICK DATA...' });
      sendOk('JUDGE_LOG', { msgId: data.msgId, logs: { system: { text: 'Extracting data...', status: 'active' } } });
      const pipe = await buildPipelineResult(data.imageData) as any;


      let confirmedPatterns: PatternEvidence[] = [];
      if (featureFlags.enableCandlestickRepoPatterns) {
        const rawPatterns = extractCandlestickPatterns(pipe.ohlcSeries);
        confirmedPatterns = patternStabilityManager.processFrame(rawPatterns);
      }

      let confirmedGaps: GapEvidence[] = [];
      if (featureFlags.enableGapDetection) {
        const latestGap = detectLatestGap(pipe.ohlcSeries);
        confirmedGaps = gapStabilityManager.processFrame(latestGap);
      }


      const t1Worker = performance.now();

      if (data.techniquesList && data.techniquesList.length > 0) {
        const firstFew = data.techniquesList.slice(0, 3).join(', ');
        const others = data.techniquesList.length > 3 ? ` and ${data.techniquesList.length - 3} more` : '';
        sendOk('PROGRESS', { type: 'PROGRESS', msgId: data.msgId, step: `APPLYING TECHNIQUES: ${firstFew}${others}...` });
      } else {
         sendOk('PROGRESS', { type: 'PROGRESS', msgId: data.msgId, step: 'ANALYZING PRICE ACTION...' });
      }

      const decision = evaluateSignal(
        pipe.ohlcSeries,
        data.techniquesList,
        horizonCtx,
        confirmedPatterns,
        confirmedGaps,
        (key, text) => {
          sendOk('JUDGE_LOG', { msgId: data.msgId, logs: { [key]: { text, status: 'active' } } });
        }
      );
      console.log(`[PERF] evaluateSignal: ${(performance.now()-t1Worker).toFixed(1)}ms`);
      console.log(`[PERF] TOTAL worker: ${(performance.now()-t0Worker).toFixed(1)}ms`);
      const stab = emitStability(decision);

      let finalSignal = decision.signal;
      let finalConfidence = decision.confidence;
      let finalScore = decision.finalScore;
      let finalStable = stab.stable;

      if (featureFlags.enableTemporalFiltering) {
        const tfResult = applyTemporalFilter(
          decision.signal,
          decision.confidence,
          decision.finalScore,
          stab.stable
        );
        finalSignal = tfResult.signal;
        finalConfidence = tfResult.confidence;
        finalScore = tfResult.finalScore;
        finalStable = tfResult.stable;
      }

      const debugTrace = {
        meta: pipe.meta,
        decision,
        temporalFiltering: featureFlags.enableTemporalFiltering ? {
          smoothedConfidence: finalConfidence,
          smoothedScore: finalScore
        } : undefined
      };
      
      sendOk('ANALYZE', {
        type: 'FRAME_RESULT',
        msgId: data.msgId,
        signal: finalSignal,
        confidence: finalConfidence,
        frameStable: finalStable,
        debugTrace
      });
      
      if (finalStable) {
        sendOk('ANALYZE_STABLE', {
          type: 'STABLE_SIGNAL',
          signal: finalSignal,
          confidence: finalConfidence,
          debugTrace
        });
      }
    }
    else if (data.type === 'RESET') {
      patternStabilityManager.reset();
      gapStabilityManager.reset();
      resetStability();
      if (featureFlags.enableTemporalFiltering) resetTemporalFilter();
      sendOk('RESET', { type: 'RESET_OK' });
    }
  } catch (err: any) {
    sendErr('UNKNOWN', err.message || String(err), { msgId: e.data?.msgId });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
};
