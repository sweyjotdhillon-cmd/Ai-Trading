
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
import { extractChartJSON } from '../quant/dataExtractor';

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

let lastFingerprint = '';

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
    if (data.msgId) {
      heartbeat = setInterval(() => { self.postMessage({ ok: true, stage: 'HEARTBEAT', payload: { type: 'HEARTBEAT', msgId: data.msgId, ts: Date.now() } }); }, 3000);
    }

    if (data.type === 'ANALYZE') {
      const currentFingerprint = data.fingerprint || data.msgId || '';
      if (currentFingerprint !== lastFingerprint) {
        patternStabilityManager.reset();
        gapStabilityManager.reset();
        resetStability();
        if (featureFlags.enableTemporalFiltering) {
          resetTemporalFilter();
        }
        lastFingerprint = currentFingerprint;
      }
    }
    

    if (data.type === 'CALIBRATE') {
      const { bullColor, bearColor } = data.payload;
      setCalibrationBands(bullColor, bearColor);
      sendOk('CALIBRATE', { type: 'CALIBRATED', bands: getCalibrationBands() });
    } 
    else if (data.type === 'ANALYZE') {
      if (data.isTestMode || data.isManifestCheck) {
        patternStabilityManager.reset();
        gapStabilityManager.reset();
        resetStability();
        if (featureFlags.enableTemporalFiltering) {
          resetTemporalFilter();
        }
      }

      if (data.isManifestCheck) {
        const pipe = await buildPipelineResult(data.imageData) as any;
        const ohlc = pipe.ohlcSeries || [];
        const n = Number(data.investmentDurationMinutes) || 5;
        let actualDirection: 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN' = 'UNKNOWN';
        if (ohlc.length > 0) {
          const lastCandle = ohlc[ohlc.length - 1];
          if (lastCandle.close > lastCandle.open) {
            actualDirection = 'UP';
          } else if (lastCandle.close < lastCandle.open) {
            actualDirection = 'DOWN';
          } else {
            actualDirection = 'FLAT';
          }
        }
        sendOk('ANALYZE', {
          type: 'FRAME_RESULT',
          msgId: data.msgId,
          actualDirection
        });
        return;
      }

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
        horizonClass: hClass,
        isTestMode: !!data.isTestMode
      };

      const t0Worker = performance.now();

      sendOk('PROGRESS', { type: 'PROGRESS', msgId: data.msgId, step: 'EXTRACTING CANDLESTICK DATA...' });

      const pipe = await buildPipelineResult(data.imageData) as any;
      if (pipe.axis && pipe.axis.confidence !== undefined) {
        horizonCtx.axisConfidence = pipe.axis.confidence;
      }

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
        const mappedNames = data.techniquesList.map((t: any) => typeof t === 'string' ? t : (t?.name || ''));
        const firstFew = mappedNames.slice(0, 3).join(', ');
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
        (key: string, text: string) => {
          sendOk('JUDGE_LOG', { msgId: data.msgId, logs: { [key]: { text, status: 'active' } } });
        },
        data.neutralityConfig
      );
      console.log(`[PERF] evaluateSignal: ${(performance.now()-t1Worker).toFixed(1)}ms`);
      console.log(`[PERF] TOTAL worker: ${(performance.now()-t0Worker).toFixed(1)}ms`);

      // SANITY: the decision result MUST have the canonical type contract.
      if (typeof decision.signal !== 'string' ||
          typeof decision.winner !== 'string' ||
          typeof decision.finalConfidence !== 'number' ||
          !decision.cases || typeof decision.cases.bull?.total !== 'number') {
        console.error('[CHARTLENS][TYPE_LEAK] decision missing canonical fields', decision);
        throw new Error('Decision result type contract violated. Engine corrupted.');
      }

      const stab = emitStability(decision);

      let finalSignal = decision.signal;
      let finalConfidence = decision.finalConfidence;
      let finalScore = decision.finalScore;
      let finalStable = stab.stable;

      if (featureFlags.enableTemporalFiltering) {
        const tfResult = applyTemporalFilter(
          decision.signal,
          decision.finalConfidence,
          decision.finalScore,
          stab.stable
        );
        finalSignal = tfResult.signal;
        finalConfidence = tfResult.confidence;
        finalScore = tfResult.finalScore;
        finalStable = tfResult.stable;
      }

      const incidents: any[] = [];
      const extractedChartData = extractChartJSON(pipe.ohlcSeries, data.graphTimeframe || '30:00', durationMinutes, incidents);

      let absoluteMin = 0;
      let absoluteMax = 100;
      if (pipe.ohlcSeries && pipe.ohlcSeries.length > 0) {
        const lows = pipe.ohlcSeries.map((c: any) => c.low);
        const highs = pipe.ohlcSeries.map((c: any) => c.high);
        absoluteMin = Math.min(...lows);
        absoluteMax = Math.max(...highs);
      }

      const debugTrace = {
        meta: pipe.meta,
        decision: decision,
        extractedJSON: extractedChartData,
        absoluteMin,
        absoluteMax,
        ohlcSeries: pipe.ohlcSeries,
        rawCandles: pipe.rawCandles,
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
        debugTrace,
        incidents
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
    sendErr('UNKNOWN', err.code === 'WICK_TRACE_FAILED' ? err.message : (err.message || String(err)) + '\n' + (err.stack || ''), { msgId: e.data?.msgId });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
};
