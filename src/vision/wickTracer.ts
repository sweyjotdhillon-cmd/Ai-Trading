import { Component } from './connectedComponents';

export interface Wicks {
  topY: number;
  bottomY: number;
  wickConfidence?: number;
}

export function traceWicks(
  body: Component,
  unionMask: Uint8Array,
  width: number,
  height: number
): Wicks {
  let topY = body.yMin;
  let bottomY = body.yMax;
  
  const cx = body.cx;
  
  // Trace UP (decreasing Y, which means visually higher on screen)
  for (let y = body.yMin - 1; y >= 0; y--) {
    const idx = y * width + cx;
    if (unionMask[idx] > 0) {
      topY = y;
    } else {
      break;
    }
  }
  
  // Trace DOWN (increasing Y, visually lower on screen)
  for (let y = body.yMax + 1; y < height; y++) {
    const idx = y * width + cx;
    if (unionMask[idx] > 0) {
      bottomY = y;
    } else {
      break;
    }
  }
  
  const upperWick = body.yMin - topY;
  const lowerWick = bottomY - body.yMax;
  let wickConfidence = 1.0;

  if (upperWick === 0 && lowerWick === 0) {
    // Fallback: relax spatial threshold (1 sigma) if wicks are detached or 1px off-center
    let tRelaxed = body.yMin;
    let bRelaxed = body.yMax;
    for (let y = body.yMin - 1; y >= 0; y--) {
      if (unionMask[y * width + cx] > 0 || unionMask[y * width + cx - 1] > 0 || unionMask[y * width + cx + 1] > 0) {
        tRelaxed = y;
      } else {
        break;
      }
    }
    for (let y = body.yMax + 1; y < height; y++) {
      if (unionMask[y * width + cx] > 0 || unionMask[y * width + cx - 1] > 0 || unionMask[y * width + cx + 1] > 0) {
        bRelaxed = y;
      } else {
        break;
      }
    }
    const bodyHeight = body.yMax - body.yMin;
    const apparentHeight = bRelaxed - tRelaxed;
    
    // Retry wick scan with the threshold relaxed
    if (apparentHeight > 1.5 * bodyHeight) {
      topY = tRelaxed;
      bottomY = bRelaxed;
    }

    // If still zero after relaxation
    if (topY === body.yMin && bottomY === body.yMax) {
      wickConfidence = 0;
    }
  }

  return { topY, bottomY, wickConfidence };
}
