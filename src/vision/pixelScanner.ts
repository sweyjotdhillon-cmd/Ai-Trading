import { getBullishHSVBands, getBearishHSVBands, isCalibrated } from './colorCalibration';
import { extractRawCandles, RawCandle, OHLCExtractionResult } from './ohlcExtractor';

export { type OHLCExtractionResult, type RawCandle };

/**
 * Commit 3 entry point.
 * Returns an empty array on failure modes — never throws.
 */
export function extractOHLCFromPixels(imageData: ImageData): OHLCExtractionResult {
  if (!imageData || imageData.width === 0 || imageData.height === 0) {
     return {
       candles: [],
       diagnostics: { maskBuildMs: 0, componentsMs: 0, filterMs: 0, wickTraceMs: 0, componentCount: 0, acceptedCount: 0, filterDiag: { reasons: {} }, reason: 'NO_IMAGE' }
     };
  }

  if (!isCalibrated()) {
    return {
       candles: [],
       diagnostics: { maskBuildMs: 0, componentsMs: 0, filterMs: 0, wickTraceMs: 0, componentCount: 0, acceptedCount: 0, filterDiag: { reasons: {} }, reason: 'NO_CALIBRATION' }
     };
  }

  const bull = getBullishHSVBands();
  const bear = getBearishHSVBands();

  return extractRawCandles(imageData, bull, bear);
}
