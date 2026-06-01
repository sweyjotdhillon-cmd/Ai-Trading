import { HSVBand } from './colorSpace';
import { buildHSVMasks } from './maskBuilder';
import { findCandleComponents } from './connectedComponents';
import { filterCandleBodies, FilterDiagnostics } from './candleFilter';
import { traceWicks } from './wickTracer';

export interface RawCandle {
  index: number;
  xCenter: number;
  bodyTopY: number;
  bodyBottomY: number;
  wickTopY: number;
  wickBottomY: number;
  isBull: boolean;
  openY: number;
  closeY: number;
  highY: number;
  lowY: number;
}

export interface OHLCExtractionResult {
  candles: RawCandle[];
  diagnostics: {
    maskBuildMs: number;
    componentsMs: number;
    filterMs: number;
    wickTraceMs: number;
    componentCount: number;
    acceptedCount: number;
    filterDiag: FilterDiagnostics;
    reason: string;
  };
}

export class VisionDegradedError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'VisionDegradedError';
    this.code = code;
  }
}

export function extractRawCandles(
  imageData: ImageData,
  bullBand: HSVBand,
  bearBand: HSVBand
): OHLCExtractionResult {
  const t0 = performance.now();
  
  if (!imageData || imageData.width === 0 || imageData.height === 0) {
    return {
      candles: [],
      diagnostics: { 
        maskBuildMs: 0, 
        componentsMs: 0, 
        filterMs: 0, 
        wickTraceMs: 0, 
        componentCount: 0, 
        acceptedCount: 0, 
        filterDiag: { reasons: {} }, 
        reason: 'NO_IMAGE' 
      }
    };
  }

  const masks = buildHSVMasks(imageData, bullBand, bearBand);
  const t1 = performance.now();

  const components = findCandleComponents(masks.bull, masks.bear, masks.width, masks.height);
  const t2 = performance.now();

  const { bodies, diag } = filterCandleBodies(components, masks.width, masks.height, masks.union);
  const t3 = performance.now();

  const ordered = bodies.sort((a, b) => a.cx - b.cx || a.yMin - b.yMin);

  let candles: RawCandle[] = ordered.map((body, i) => {
    const wicks = traceWicks(body, masks.union, masks.width, masks.height);
    const isBull = body.classLabel === 'bull';
    return {
      index: i,
      xCenter: body.cx,
      bodyTopY: body.yMin,
      bodyBottomY: body.yMax,
      wickTopY: wicks.topY,
      wickBottomY: wicks.bottomY,
      isBull,
      // In canvas, y=0 is top. Price increases visually upwards, meaning lower Y.
      // High price = low Y. Low price = high Y.
      // Bullish candle: open is lower price than close -> open has higher Y.
      openY:  isBull ? body.yMax : body.yMin,
      closeY: isBull ? body.yMin : body.yMax,
      highY:  wicks.topY,    // lowest Y visually
      lowY:   wicks.bottomY, // highest Y visually
    };
  });
  
  if (candles.length > 0) {
    const recent = candles.slice(-20);
    let wickShareSum = 0;
    for (const c of recent) {
      const bodyRatio = Math.abs(c.closeY - c.openY) / Math.max(1e-9, c.lowY - c.highY);
      wickShareSum += (1 - bodyRatio);
    }
    const avgWickShare = wickShareSum / recent.length;
    if (avgWickShare < 0.05) {
      throw new VisionDegradedError(
        "Vision degraded: wick tracer produced zero-wick candles. Re-capture image with higher contrast or larger candles.",
        "WICK_TRACE_FAILED"
      );
    }
  }

  const t4 = performance.now();

  return {
    candles,
    diagnostics: {
      maskBuildMs: t1 - t0,
      componentsMs: t2 - t1,
      filterMs: t3 - t2,
      wickTraceMs: t4 - t3,
      componentCount: components.length,
      acceptedCount: bodies.length,
      filterDiag: diag,
      reason: candles.length === 0 ? 'NO_CANDLES_DETECTED' : 'OK',
    },
  };
}
