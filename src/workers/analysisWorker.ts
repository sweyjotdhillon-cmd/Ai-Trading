// Web Worker for analysis pipeline
import { buildPipelineResult } from '../vision/pipeline';
import { evaluateSignal } from '../quant/ruleEngine';
import { HorizonContext } from '../quant/horizon';
import { emitStability, resetStability } from '../quant/stabilityFilter';
import { getCalibrationBands, setCalibrationBands } from '../vision/colorCalibration';
import { runDeterminismGuard } from '../quant/__audit__/determinismGuard';
import { runEpsilonGuard } from '../vision/__audit__/epsilonGuard';

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

      const t0 = performance.now();
      self.postMessage({ ok: true, stage: 'PROGRESS', payload: { type: 'PROGRESS', msgId: data.msgId, stage: 'OHLC_READY', pct: 10 } });
      const pipe = buildPipelineResult(data.imageData);
      self.postMessage({ ok: true, stage: 'PROGRESS', payload: { type: 'PROGRESS', msgId: data.msgId, stage: 'INDICATORS', pct: 40 } });
      console.log(`[PERF] Pipeline build: ${(performance.now() - t0).toFixed(1)}ms`);

      const t1 = performance.now();
      self.postMessage({ ok: true, stage: 'PROGRESS', payload: { type: 'PROGRESS', msgId: data.msgId, stage: 'RULES_EVAL', pct: 75 } });
      const decision = evaluateSignal(pipe.ohlcSeries, data.techniquesList || [], horizonCtx, data.stock || 'UNKNOWN');
      self.postMessage({ ok: true, stage: 'PROGRESS', payload: { type: 'PROGRESS', msgId: data.msgId, stage: 'SIGNAL_DONE', pct: 100 } });
      console.log(`[PERF] Signal eval: ${(performance.now() - t1).toFixed(1)}ms`);
      console.log(`[PERF] TOTAL: ${(performance.now() - t0).toFixed(1)}ms`);

      const stab = emitStability(decision);

      const debugTrace = {
        meta: pipe.meta,
        decision
      };
      
      sendOk('ANALYZE', {
        type: 'FRAME_RESULT',
        msgId: data.msgId,
        signal: decision.signal,
        confidence: decision.confidence,
        frameStable: stab.stable,
        debugTrace
      });
      
      if (stab.stable) {
        sendOk('ANALYZE_STABLE', {
          type: 'STABLE_SIGNAL',
          signal: decision.signal,
          confidence: decision.confidence,
          debugTrace
        });
      }
    }
    else if (data.type === 'RESET') {
      resetStability();
      sendOk('RESET', { type: 'RESET_OK' });
    }
  } catch (err: any) {
    sendErr('UNKNOWN', err.message || String(err), { msgId: e.data?.msgId });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
};
