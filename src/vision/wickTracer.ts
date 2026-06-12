import { Component } from './connectedComponents';

export interface Wicks {
  topY: number;
  bottomY: number;
}

export function traceWicks(
  body: Component,
  unionMask: Uint8Array,
  width: number,
  height: number
): Wicks {
  let topY    = body.yMin;
  let bottomY = body.yMax;
  const GAP_TOLERANCE = 2;
  const xMin = Math.max(0, body.cx - 2);
  const xMax = Math.min(width - 1, body.cx + 2);

  for (let x = xMin; x <= xMax; x++) {
    let gap = 0;
    let candidateTop = body.yMin;
    for (let y = body.yMin - 1; y >= 0; y--) {
      if (unionMask[y * width + x] > 0) {
        candidateTop = y;
        gap = 0;
      } else {
        gap++;
        if (gap > GAP_TOLERANCE) break;
      }
    }
    if (candidateTop < topY) topY = candidateTop;
  }

  for (let x = xMin; x <= xMax; x++) {
    let gap = 0;
    let candidateBottom = body.yMax;
    for (let y = body.yMax + 1; y < height; y++) {
      if (unionMask[y * width + x] > 0) {
        candidateBottom = y;
        gap = 0;
      } else {
        gap++;
        if (gap > GAP_TOLERANCE) break;
      }
    }
    if (candidateBottom > bottomY) bottomY = candidateBottom;
  }

  return { topY, bottomY };
}
