import { EPSILON } from './colorSpace';

export function sobel(lumMedian: Uint8Array, w: number, h: number): { mag: Float32Array; theta: Float32Array } {
  const mag = new Float32Array(w * h);
  const theta = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const i00 = lumMedian[idx - w - 1];
      const i01 = lumMedian[idx - w];
      const i02 = lumMedian[idx - w + 1];
      const i10 = lumMedian[idx - 1];
      const i12 = lumMedian[idx + 1];
      const i20 = lumMedian[idx + w - 1];
      const i21 = lumMedian[idx + w];
      const i22 = lumMedian[idx + w + 1];

      const gx = -i00 + i02 - 2 * i10 + 2 * i12 - i20 + i22;
      const gy = -i00 - 2 * i01 - i02 + i20 + 2 * i21 + i22;

      mag[idx] = Math.sqrt(gx * gx + gy * gy + EPSILON);
      theta[idx] = Math.atan2(gy, gx);
    }
  }

  return { mag, theta };
}

export function cannyNMS(mag: Float32Array, theta: Float32Array, w: number, h: number): Float32Array {
  const nms = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const m = mag[idx];
      let angle = theta[idx] * (180 / Math.PI);
      if (angle < 0) angle += 180;

      let mag1 = 0, mag2 = 0;
      
      if ((angle >= 0 && angle < 22.5) || (angle >= 157.5 && angle <= 180)) {
        mag1 = mag[idx - 1];
        mag2 = mag[idx + 1];
      } else if (angle >= 22.5 && angle < 67.5) {
        mag1 = mag[idx - w + 1];
        mag2 = mag[idx + w - 1];
      } else if (angle >= 67.5 && angle < 112.5) {
        mag1 = mag[idx - w];
        mag2 = mag[idx + w];
      } else {
        mag1 = mag[idx - w - 1];
        mag2 = mag[idx + w + 1];
      }

      if (m >= mag1 && m >= mag2) {
        nms[idx] = m;
      }
    }
  }
  return nms;
}

export function cannyHysteresis(nms: Float32Array, w: number, h: number, lowFrac = 0.1, highFrac = 0.3): Uint8Array {
  const len = w * h;
  const vals = new Float32Array(len);
  let c = 0;
  for (let i = 0; i < len; i++) {
    if (nms[i] > EPSILON) vals[c++] = nms[i];
  }
  const validVals = vals.subarray(0, c);
  validVals.sort((a, b) => a - b);
  
  let highT = 0;
  let lowT = 0;
  if (c > 0) {
    highT = validVals[Math.floor(c * (1 - highFrac))];
    lowT = validVals[Math.floor(c * (1 - lowFrac))];
  }

  const out = new Uint8Array(len);
  const q = new Int32Array(len);
  let head = 0, tail = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (nms[idx] >= highT && out[idx] === 0) {
        out[idx] = 1;
        q[tail++] = idx;
      }
    }
  }

  const dx = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dy = [-1, -1, -1, 0, 0, 1, 1, 1];

  while (head < tail) {
    const idx = q[head++];
    const x = idx % w;
    const y = Math.floor(idx / w);
    
    for (let i = 0; i < 8; i++) {
      const nx = x + dx[i];
      const ny = y + dy[i];
      if (nx > 0 && nx < w - 1 && ny > 0 && ny < h - 1) {
        const nidx = ny * w + nx;
        if (out[nidx] === 0 && nms[nidx] >= lowT) {
          out[nidx] = 1;
          q[tail++] = nidx;
        }
      }
    }
  }

  return out;
}
