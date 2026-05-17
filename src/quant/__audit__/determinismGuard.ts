import { buildPipelineResult } from '../../vision/pipeline';
import { evaluateSignal } from '../ruleEngine';


export async function runDeterminismGuard(): Promise<boolean> {
  const w = 64;
  const h = 64;
  const imgData = new Uint8ClampedArray(w * h * 4);
  let seed = 0xC0FFEE;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }
  for (let i = 0; i < w * h * 4; i++) {
    imgData[i] = Math.floor(rnd() * 255);
  }
  const img = new ImageData(imgData, w, h);

  let firstRes = '';
  for (let i = 0; i < 10; i++) {
    const pipe = buildPipelineResult(img);
    const decision = await evaluateSignal(pipe.ohlcSeries, [], { tfMinutes: 30, durationMinutes: 5, H: 5/30, horizonClass: 'INTRA_CANDLE' });
    
    const trace = JSON.stringify({
      signal: decision.signal,
      confidence: decision.confidence,
      score: decision.finalScore
    });

    if (i === 0) {
      firstRes = trace;
    } else if (firstRes !== trace) {
      throw new Error('Determinism fault: ' + firstRes + ' vs ' + trace);
    }
  }
  return true;
}
