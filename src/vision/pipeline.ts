import { extractOHLCFromPixels, RawCandle, OHLCExtractionResult } from './pixelScanner';
import { readYAxis, PriceAxisTransform } from './axisReader';
import { EPSILON } from './colorSpace';

export interface NumericOHLC {
  open: number;
  high: number;
  low: number;
  close: number;
  xCenter: number;
  isBull: boolean;
}

export interface PipelineResult {
  rawCandles: RawCandle[];
  axis: PriceAxisTransform | null;
  ohlcSeries: NumericOHLC[];
  meta: {
    latencyMs: number;
    axisFallback: boolean;
    stages: Record<string, number>;
  };
}

export function buildPipelineResult(imageData: ImageData): PipelineResult {
  const t0 = performance.now();
  
  const ohlcRes = extractOHLCFromPixels(imageData);
  const rawCandles = ohlcRes.candles;
  const t1 = performance.now();
  
  const axis = readYAxis(imageData);
  const t2 = performance.now();
  
  const ohlcSeries: NumericOHLC[] = [];
  const axisFallback = axis === null;
  
  for (const rc of rawCandles) {
    let o, h, l, c;
    if (axisFallback) {
      o = -rc.openY / Math.max(imageData.height, EPSILON);
      h = -rc.highY / Math.max(imageData.height, EPSILON);
      l = -rc.lowY / Math.max(imageData.height, EPSILON);
      c = -rc.closeY / Math.max(imageData.height, EPSILON);
    } else {
      const transform = axis as PriceAxisTransform;
      o = transform.mSlope * rc.openY + transform.bIntercept;
      h = transform.mSlope * rc.highY + transform.bIntercept;
      l = transform.mSlope * rc.lowY + transform.bIntercept;
      c = transform.mSlope * rc.closeY + transform.bIntercept;
    }
    
    ohlcSeries.push({
      open: o,
      high: h,
      low: l,
      close: c,
      xCenter: rc.xCenter,
      isBull: rc.isBull
    });
  }
  
  const t3 = performance.now();
  
  return {
    rawCandles,
    axis,
    ohlcSeries,
    meta: {
      latencyMs: t3 - t0,
      axisFallback,
      stages: {
        ohlcExt: t1 - t0,
        axisRead: t2 - t1,
        transform: t3 - t2
      }
    }
  };
}
