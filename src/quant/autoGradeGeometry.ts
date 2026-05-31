export interface AutoGradeGeometry {
  /** Schema version — bump when fields change. */
  version: 1;

  /** Pixel coordinate space these values are expressed in. */
  space: 'RIGHT_SLICE_NORMALIZED';  // 0..1 on the right-slice canvas, NOT the full image

  /** Y in [0,1], 0 = top of right slice, 1 = bottom. */
  entryY: number;       // y of the entry-close line (yellow dashed)
  exitY:  number;       // y of the nearest-future-close line (green/red dashed)

  /** X in [0,1] of the candle bodies these lines touch. */
  entryX: number;       // typically very close to 0 (leftmost candle of right slice)
  exitX:  number;       // typically the first/nearest candle after the cut

  /** Echoed price values, for the label badges. */
  entryClose: number;
  exitClose:  number;

  /** Hard quality gate. If any of these is false, do NOT render lines —
   *  surface AUTO_GRADE_INVALID instead. */
  valid: boolean;
  invalidReason?:
    | 'NO_RIGHT_SLICE_OHLC'
    | 'AXIS_OUT_OF_BOUNDS'
    | 'PRICE_FLAT'
    | 'COORD_MAP_DEGENERATE';

  /** For audit: which right-slice candle index produced exitClose. */
  exitCandleIndex: number;
}

export function buildAutoGradeGeometry(
  rightOhlc: { low: number; high: number; close: number }[],
  rightCandleCentersX: number[],
  entryClose: number
): AutoGradeGeometry {
  if (!rightOhlc || rightOhlc.length === 0) {
    return {
      version: 1,
      space: 'RIGHT_SLICE_NORMALIZED',
      entryY: 0,
      exitY: 0,
      entryX: 0,
      exitX: 0,
      entryClose,
      exitClose: 0,
      valid: false,
      invalidReason: 'NO_RIGHT_SLICE_OHLC',
      exitCandleIndex: -1
    };
  }

  const exitClose = rightOhlc[0].close;

  let yMin = entryClose;
  let yMax = entryClose;
  for (const candle of rightOhlc) {
    if (candle.low < yMin) yMin = candle.low;
    if (candle.high > yMax) yMax = candle.high;
  }

  if (Math.abs(yMax - yMin) < 1e-9) {
    return {
      version: 1,
      space: 'RIGHT_SLICE_NORMALIZED',
      entryY: 0,
      exitY: 0,
      entryX: 0,
      exitX: 0,
      entryClose,
      exitClose,
      valid: false,
      invalidReason: 'PRICE_FLAT',
      exitCandleIndex: 0
    };
  }

  const range = yMax - yMin;
  const entryY = (yMax - entryClose) / range;
  const exitY = (yMax - exitClose) / range;
  const entryX = 0;
  const exitX = rightCandleCentersX.length > 0 ? rightCandleCentersX[0] : 0;

  return {
    version: 1,
    space: 'RIGHT_SLICE_NORMALIZED',
    entryY,
    exitY,
    entryX,
    exitX,
    entryClose,
    exitClose,
    valid: true,
    exitCandleIndex: 0
  };
}
