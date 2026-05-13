// Web Worker for analysis pipeline
import { buildPipelineResult } from '../vision/pipeline';
import { evaluateSignal } from '../quant/ruleEngine';
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

self.onmessage = (e: MessageEvent) => {
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

  try {
    const data = e.data;
    
    if (data.type === 'CALIBRATE') {
      const { bullColor, bearColor } = data.payload;
      setCalibrationBands(bullColor, bearColor);
      sendOk('CALIBRATE', { type: 'CALIBRATED', bands: getCalibrationBands() });
    } 
    else if (data.type === 'ANALYZE') {
      const pipe = buildPipelineResult(data.imageData);
      const decision = evaluateSignal(pipe.ohlcSeries, pipe.axis);
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
  }
};
