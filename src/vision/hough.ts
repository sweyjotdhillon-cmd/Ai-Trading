import { EPSILON } from './colorSpace';

export interface Line {
  rho: number;
  theta: number; // radians
  votes: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function probabilisticHough(edgeMap: Uint8Array, w: number, h: number): Line[] {
  const thetaRes = 180;
  const diagLen = Math.ceil(Math.sqrt(w * w + h * h));
  const numRho = 2 * diagLen + 1;
  const accumulator = new Int32Array(thetaRes * numRho);

  const thetas = new Float32Array(thetaRes);
  const cosT = new Float32Array(thetaRes);
  const sinT = new Float32Array(thetaRes);

  for (let t = 0; t < thetaRes; t++) {
    const rad = t * (Math.PI / 180);
    thetas[t] = rad;
    cosT[t] = Math.cos(rad);
    sinT[t] = Math.sin(rad);
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (edgeMap[y * w + x] > 0) {
        for (let t = 0; t < thetaRes; t++) {
          const rho = Math.round(x * cosT[t] + y * sinT[t]) + diagLen;
          accumulator[rho * thetaRes + t]++;
        }
      }
    }
  }

  const threshold = Math.max(50, Math.floor(w / 20));
  const candidates: { r: number; t: number; v: number }[] = [];

  for (let r = 1; r < numRho - 1; r++) {
    for (let t = 1; t < thetaRes - 1; t++) {
      const idx = r * thetaRes + t;
      const v = accumulator[idx];
      if (v >= threshold) {
        // NMS step
        if (
          v > accumulator[idx - thetaRes - 1] &&
          v > accumulator[idx - thetaRes] &&
          v > accumulator[idx - thetaRes + 1] &&
          v > accumulator[idx - 1] &&
          v > accumulator[idx + 1] &&
          v > accumulator[idx + thetaRes - 1] &&
          v > accumulator[idx + thetaRes] &&
          v > accumulator[idx + thetaRes + 1]
        ) {
          candidates.push({ r, t, v });
        }
      }
    }
  }

  candidates.sort((a, b) => b.v - a.v);
  const topLines = candidates.slice(0, 8);
  const lines: Line[] = [];

  for (const c of topLines) {
    const rho = c.r - diagLen;
    const rad = thetas[c.t];
    
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    const ct = cosT[c.t];
    const st = sinT[c.t];

    if (st > 0.5 || st < -0.5) { 
      x1 = 0;
      y1 = Math.round((rho - x1 * ct) / st);
      x2 = w;
      y2 = Math.round((rho - x2 * ct) / st);
    } else { 
      y1 = 0;
      const denom1 = ct === 0 ? EPSILON : ct;
      x1 = Math.round((rho - y1 * st) / denom1);
      y2 = h;
      const denom2 = ct === 0 ? EPSILON : ct;
      x2 = Math.round((rho - y2 * st) / denom2);
    }

    lines.push({ rho, theta: rad, votes: c.v, x1, y1, x2, y2 });
  }

  return lines;
}
