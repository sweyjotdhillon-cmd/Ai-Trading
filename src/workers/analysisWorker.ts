
import { evaluateSignal } from '../quant/ruleEngine';
import { buildPipelineResult, PipelineResult } from '../vision/pipeline';
import { HorizonContext } from '../quant/horizon';
import { emitStability, resetStability, emitScalpStability } from '../quant/stabilityFilter';
import { getCalibrationBands, setCalibrationBands } from '../vision/colorCalibration';
import { runDeterminismGuard } from '../quant/__audit__/determinismGuard';
import { runEpsilonGuard } from '../vision/__audit__/epsilonGuard';
import { featureFlags } from '../config/featureFlags';
import { extractCandlestickPatterns, PatternEvidence } from '../quant/patternAdapter';
import { PatternStabilityManager } from '../quant/patternStability';
import { detectLatestGap, GapEvidence } from '../quant/gapDetector';
import { GapStabilityManager } from '../quant/gapStability';
import { applyTemporalFilter, resetTemporalFilter, applyScalpTemporalFilter } from '../quant/temporalFilter';
import { extractChartJSON } from '../quant/dataExtractor';
import { evaluateScalpSignal } from '../quant/scalpingEngine';
import { loadScalpConfig } from '../config/scalpConfig';
import { loadRiskState } from '../quant/riskGuard';
import { findSwingPivots } from '../quant/marketStructure';
import { atr } from '../quant/indicators';
import { vwapProxy } from '../quant/vwapProxy';


const patternStabilityManager = new PatternStabilityManager(3, 'bar');
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
        const n = Number(data.holdingMinutesVal) || 5;
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
      const durationMinutes = data.holdingMinutesVal || 5;
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

      let pipe: PipelineResult;

      if (data.directOhlcv && data.directOhlcv.length > 0) {
        pipe = {
          rawCandles: [],
          axis: null,
          ohlcSeries: data.directOhlcv,
          meta: {
            latencyMs: 0,
            axisFallback: false,
            ohlcQuality: 'REAL_PRICE',
            candlesLength: data.directOhlcv.length,
            candleCentersX: data.directOhlcv.map((_: any, i: number) => i / Math.max(1, data.directOhlcv.length - 1)),
            mode: 'DIRECT_PASSTHROUGH',
            stages: {}
          }
        } as any;
      } else {
        pipe = await buildPipelineResult(data.imageData) as any;

        if (data.livePrice && data.livePrice > 0 && pipe.ohlcSeries.length > 0) {
          const pipeMin  = Math.min(...pipe.ohlcSeries.map((c: any) => c.low));
          const pipeMax  = Math.max(...pipe.ohlcSeries.map((c: any) => c.high));
          const midRange = (pipeMin + pipeMax) / 2;
          const deviation = Math.abs(data.livePrice - midRange) / Math.max(1, midRange);

          if (deviation > 0.02 && pipe.meta.ohlcQuality === 'REAL_PRICE') {
            console.warn(`[VISION] Live price ₹${data.livePrice} deviates ${(deviation*100).toFixed(1)}% from pipe range.`);
            (pipe.meta as any).ohlcQuality = 'NORMALIZED_FALLBACK';
            (pipe.meta as any).axisFallback = true;
          }
        }
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

      let finalSignal: any = decision.signal;
      let finalConfidence = decision.finalConfidence;
      let finalScore = decision.finalScore;
      let finalStable = false;
      let scalpDecision: any = undefined;

      if (featureFlags.USE_SCALPING_MODE) {
        const highs = pipe.ohlcSeries.map((c: any) => c.high);
        const lows = pipe.ohlcSeries.map((c: any) => c.low);
        const pivots = findSwingPivots(highs, lows);
        const atr14Vec = atr(pipe.ohlcSeries, 14);
        const vwapProxyVec = vwapProxy(pipe.ohlcSeries);
        const pcfg = data.scalpConfig || loadScalpConfig();
        const prisk = data.riskState || loadRiskState();

        const scalpCtx = {
          config: pcfg,
          riskState: prisk,
          pivots,
          atr14: atr14Vec,
          vwapProxy: vwapProxyVec,
          nowMsEpoch: Date.now(),
          nowISTMinutesSinceMidnight: 600,
          currentBarIndex: pipe.ohlcSeries.length - 1
        };

        scalpDecision = evaluateScalpSignal(pipe.ohlcSeries, decision, scalpCtx);
        
        const stabScalar = emitScalpStability(scalpDecision.signal, finalConfidence, finalScore);
        finalStable = stabScalar.stable;

        if (featureFlags.enableTemporalFiltering) {
          const tfResult = applyScalpTemporalFilter(
            scalpDecision.signal,
            finalConfidence,
            finalScore,
            stabScalar.stable,
            data.minConfidence
          );
          finalSignal = tfResult.signal;
          finalConfidence = tfResult.confidence;
          finalScore = tfResult.finalScore;
          finalStable = tfResult.stable;
        } else {
          finalSignal = scalpDecision.signal;
        }
      } else {
        const stab = emitStability(decision);
        finalStable = stab.stable;

        if (featureFlags.enableTemporalFiltering) {
          const tfResult = applyTemporalFilter(
            decision.signal,
            decision.finalConfidence,
            decision.finalScore,
            stab.stable,
            data.minConfidence
          );
          finalSignal = tfResult.signal;
          finalConfidence = tfResult.confidence;
          finalScore = tfResult.finalScore;
          finalStable = tfResult.stable;
        }
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

      const debugTrace: any = {
        meta: pipe.meta,
        decision: decision,
        extractedJSON: extractedChartData,
        absoluteMin,
        absoluteMax,
        ohlcSeries: pipe.ohlcSeries,
        rawCandles: pipe.rawCandles,
        scalpDecision,
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
        incidents,
        scalpDecision,
      });
      
      if (finalStable) {
        sendOk('ANALYZE_STABLE', {
          type: 'STABLE_SIGNAL',
          signal: finalSignal,
          confidence: finalConfidence,
          debugTrace,
          scalpDecision,
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
    sendErr('UNKNOWN', (err.message || String(err)) + '\n' + (err.stack || ''), { msgId: e.data?.msgId });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
};
