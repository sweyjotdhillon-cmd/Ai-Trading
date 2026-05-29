
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
import { evaluateTechniques } from '../quant/techniqueEngine';

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
        horizonClass: hClass
      };

      const t0Worker = performance.now();

      sendOk('PROGRESS', { type: 'PROGRESS', msgId: data.msgId, step: 'EXTRACTING CANDLESTICK DATA...' });

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

      let engineResult: any = undefined;
      const incidents: any[] = [];

      const extractedChartData = extractChartJSON(pipe.ohlcSeries, data.graphTimeframe || '30:00', durationMinutes, incidents);

      if (data.techniquesList && data.techniquesList.length > 0 && typeof data.techniquesList[0] === 'object' && 'callConditions' in data.techniquesList[0]) {
        try {
          engineResult = evaluateTechniques(extractedChartData, data.techniquesList);
          finalSignal = engineResult.verdict;
          finalConfidence = Math.max(engineResult.callConfidence, engineResult.putConfidence);
          finalScore = engineResult.margin;
          
          // Partition techniqueBreakdown results into J1, J2, and J3 for visual presentation!
          let bullJ1 = 0, bearJ1 = 0;
          let bullJ2 = 0, bearJ2 = 0;
          let bullJ3 = 0, bearJ3 = 0;

          const getTechniqueJudgeCategory = (name: string): 'J1' | 'J2' | 'J3' => {
            const k = name.toLowerCase().replace(/[\s_-]/g, '');
            if (k.includes('rsi') || k.includes('stoch') || k.includes('oscillator')) {
              return 'J2';
            }
            if (k.includes('boll') || k.includes('reversal') || k.includes('hammer') || k.includes('doji') || k.includes('candle') || k.includes('support') || k.includes('resistance') || k.includes('boundary') || k.includes('wick') || k.includes('shadow')) {
              return 'J3';
            }
            return 'J1';
          };

          if (engineResult.techniqueBreakdown) {
            engineResult.techniqueBreakdown.forEach((b: any) => {
              if (b.status === "EVALUATED") {
                const cat = getTechniqueJudgeCategory(b.name || '');
                if (cat === 'J1') {
                  bullJ1 += b.callScore || 0;
                  bearJ1 += b.putScore || 0;
                } else if (cat === 'J2') {
                  bullJ2 += b.callScore || 0;
                  bearJ2 += b.putScore || 0;
                } else if (cat === 'J3') {
                  bullJ3 += b.callScore || 0;
                  bearJ3 += b.putScore || 0;
                }
              }
            });
          }

          const totalBull = bullJ1 + bullJ2 + bullJ3 || 0.0001;
          const totalBear = bearJ1 + bearJ2 + bearJ3 || 0.0001;

          // Scale to fit our maximum judge caps (J1=4, J2=4, J3=3)
          const finalBullJ1 = Number(Math.min(4.0, (bullJ1 / totalBull) * engineResult.callTotal).toFixed(2)) || 0;
          const finalBearJ1 = Number(Math.min(4.0, (bearJ1 / totalBear) * engineResult.putTotal).toFixed(2)) || 0;
          const finalBullJ2 = Number(Math.min(4.0, (bullJ2 / totalBull) * engineResult.callTotal).toFixed(2)) || 0;
          const finalBearJ2 = Number(Math.min(4.0, (bearJ2 / totalBear) * engineResult.putTotal).toFixed(2)) || 0;
          const finalBullJ3 = Number(Math.min(3.0, (bullJ3 / totalBull) * engineResult.callTotal).toFixed(2)) || 0;
          const finalBearJ3 = Number(Math.min(3.0, (bearJ3 / totalBear) * engineResult.putTotal).toFixed(2)) || 0;

          decision.cases = {
            bull: { 
              j1: finalBullJ1, 
              j2: finalBullJ2, 
              j3: finalBullJ3, 
              total: Number((finalBullJ1 + finalBullJ2 + finalBullJ3).toFixed(2))
            },
            bear: { 
              j1: finalBearJ1, 
              j2: finalBearJ2, 
              j3: finalBearJ3, 
              total: Number((finalBearJ1 + finalBearJ2 + finalBearJ3).toFixed(2))
            }
          };
          decision.winner = engineResult.verdict === 'CALL' ? 'BULL' : (engineResult.verdict === 'PUT' ? 'BEAR' : 'NO_TRADE');
          decision.margin = engineResult.margin;
          decision.finalConfidence = finalConfidence;
          decision.ruling = engineResult.noTradeReason ? `NO_TRADE - ${engineResult.noTradeReason}` : `Signal from matched techniques (${engineResult.callTotal} vs ${engineResult.putTotal})`;
          decision.signal = finalSignal;
          decision.finalScore = finalScore;

          if (engineResult.skipped > 0) {
            incidents.push({ type: 'BYPASS', module: 'techniqueEngine', message: `Engine skipped ${engineResult.skipped} techniques due to missing data` });
          }
        } catch (e: any) {
          incidents.push({ type: 'ERROR', module: 'techniqueEngine', message: `Evaluation failed with error: ${e.message}`, details: String(e) });
        }
      }

      const debugTrace = {
        meta: pipe.meta,
        decision: engineResult || decision,
        extractedJSON: extractedChartData,
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
    sendErr('UNKNOWN', (err.message || String(err)) + '\n' + (err.stack || ''), { msgId: e.data?.msgId });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
};
