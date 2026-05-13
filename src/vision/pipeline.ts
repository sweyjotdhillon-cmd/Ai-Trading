import { extractOHLCFromPixels, RawCandle } from './pixelScanner';
import { readYAxis, PriceAxisTransform } from './axisReader';
import { rectifyOrCenterCrop } from './homography';
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
    mode: string;
    stages: Record<string, number>;
  };
}

export function buildPipelineResult(imageData: ImageData): PipelineResult {
  const t0 = performance.now();
  
  const rectifyRes = rectifyOrCenterCrop(imageData);
  const rectifiedFrame = rectifyRes.rect;
  const t1 = performance.now();
  
  const ohlcRes = extractOHLCFromPixels(rectifiedFrame);
  const rawCandles = ohlcRes.candles;
  const t2 = performance.now();
  
  const axis = readYAxis(rectifiedFrame);
  const t3 = performance.now();
  
  const ohlcSeries: NumericOHLC[] = [];
  const axisFallback = axis === null;
  
  for (const rc of rawCandles) {
    let o, h, l, c;
    if (axisFallback) {
      o = -rc.openY / Math.max(rectifiedFrame.height, EPSILON);
      h = -rc.highY / Math.max(rectifiedFrame.height, EPSILON);
      l = -rc.lowY / Math.max(rectifiedFrame.height, EPSILON);
      c = -rc.closeY / Math.max(rectifiedFrame.height, EPSILON);
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
  
  const t4 = performance.now();
  
  return {
    rawCandles,
    axis,
    ohlcSeries,
    meta: {
      latencyMs: t4 - t0,
      axisFallback,
      mode: rectifyRes.mode,
      stages: {
        preprocess: rectifyRes.timings.preprocess || 0,
        sobel: rectifyRes.timings.sobel || 0,
        canny: rectifyRes.timings.canny || 0,
        hough: rectifyRes.timings.hough || 0,
        homography: rectifyRes.timings.homography || 0,
        ohlcExt: t2 - t1,
        axisRead: t3 - t2,
        transform: t4 - t3
      }
    }
  };
}
