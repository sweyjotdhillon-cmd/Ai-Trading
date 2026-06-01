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
  
  return { topY, bottomY };
}
