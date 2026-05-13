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
    budgetExceeded?: boolean;
    axisFallback: boolean;
    mode: string;
    stages: Record<string, number>;
  };
}

let sessionBudgetExceeded = false;

export function buildPipelineResult(imageData: ImageData): PipelineResult {
  const t0 = performance.now();
  let workingData = imageData;

  if (sessionBudgetExceeded && imageData.width >= 1280 && imageData.height >= 720) {
    const dstW = 960;
    const dstH = 540;
    const dstData = new Uint8ClampedArray(dstW * dstH * 4);
    const sx = imageData.width / dstW;
    const sy = imageData.height / dstH;
    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
        const srcX = Math.min(Math.floor(x * sx), imageData.width - 1);
        const srcY = Math.min(Math.floor(y * sy), imageData.height - 1);
        const si = (srcY * imageData.width + srcX) * 4;
        const di = (y * dstW + x) * 4;
        dstData[di] = imageData.data[si];
        dstData[di+1] = imageData.data[si+1];
        dstData[di+2] = imageData.data[si+2];
        dstData[di+3] = imageData.data[si+3];
      }
    }
    workingData = new ImageData(dstData, dstW, dstH);
  }

  const rectifyRes = rectifyOrCenterCrop(workingData);
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
  const totalLatencyMs = t4 - t0;
  
  if (!sessionBudgetExceeded && workingData.width >= 1280 && workingData.height >= 720 && totalLatencyMs > 250) {
    sessionBudgetExceeded = true;
  }
  
  return {
    rawCandles,
    axis,
    ohlcSeries,
    meta: {
      latencyMs: totalLatencyMs,
      budgetExceeded: sessionBudgetExceeded,
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
