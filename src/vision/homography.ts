import * as mathjs from 'mathjs';
import { Line, probabilisticHough } from './hough';
import { sobel, cannyNMS, cannyHysteresis } from './edges';
import { preprocessFrame } from './preprocess';
import { EPSILON } from './colorSpace';

export interface Quad {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  br: { x: number; y: number };
  bl: { x: number; y: number };
}

function lineIntersection(l1: Line, l2: Line): { x: number; y: number } | null {
  const ct1 = Math.cos(l1.theta), st1 = Math.sin(l1.theta);
  const ct2 = Math.cos(l2.theta), st2 = Math.sin(l2.theta);
  
  const det = ct1 * st2 - st1 * ct2;
  if (Math.abs(det) < EPSILON) return null;
  
  const x = (l1.rho * st2 - l2.rho * st1) / det;
  const y = (l2.rho * ct1 - l1.rho * ct2) / det;
  return { x, y };
}

export function findChartQuadrilateral(lines: Line[], w: number, h: number): Quad | null {
  const horiz = lines.filter(l => Math.abs(l.theta - Math.PI / 2) < 5 * Math.PI / 180);
  const vert = lines.filter(l => l.theta < 5 * Math.PI / 180 || l.theta > 175 * Math.PI / 180);
  
  if (horiz.length < 2 || vert.length < 2) return null;

  horiz.sort((a, b) => {
    const ya = (a.rho - (w / 2) * Math.cos(a.theta)) / (Math.sin(a.theta) || EPSILON);
    const yb = (b.rho - (w / 2) * Math.cos(b.theta)) / (Math.sin(b.theta) || EPSILON);
    return ya - yb;
  });
  const topLine = horiz[0];
  const botLine = horiz[horiz.length - 1];

  vert.sort((a, b) => {
    const xa = (a.rho - (h / 2) * Math.sin(a.theta)) / (Math.cos(a.theta) || EPSILON);
    const xb = (b.rho - (h / 2) * Math.sin(b.theta)) / (Math.cos(b.theta) || EPSILON);
    return xa - xb;
  });
  const leftLine = vert[0];
  const rightLine = vert[vert.length - 1];

  const tl = lineIntersection(topLine, leftLine);
  const tr = lineIntersection(topLine, rightLine);
  const br = lineIntersection(botLine, rightLine);
  const bl = lineIntersection(botLine, leftLine);

  if (!tl || !tr || !br || !bl) return null;

  let area = 0;
  const pts = [tl, tr, br, bl];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  area = Math.abs(area / 2);

  if (area < 0.3 * w * h) return null;

  const wTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const hLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const ar = hLeft / Math.max(wTop, EPSILON);

  if (ar < 0.5 || ar > 4.0) return null;

  return { tl, tr, br, bl };
}

export function solveHomography(src: Quad, dstW: number, dstH: number): number[] | null {
  const dst = {
    tl: { x: 0, y: 0 },
    tr: { x: dstW, y: 0 },
    br: { x: dstW, y: dstH },
    bl: { x: 0, y: dstH }
  };
  
  const A: number[][] = [];
  const srcPts = [src.tl, src.tr, src.br, src.bl];
  const dstPts = [dst.tl, dst.tr, dst.br, dst.bl];
  
  for (let i = 0; i < 4; i++) {
    const sx = srcPts[i].x;
    const sy = srcPts[i].y;
    const dx = dstPts[i].x;
    const dy = dstPts[i].y;
    
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
  }
  
  const b = [
    dstPts[0].x, dstPts[0].y,
    dstPts[1].x, dstPts[1].y,
    dstPts[2].x, dstPts[2].y,
    dstPts[3].x, dstPts[3].y
  ];
  
  try {
    const h = mathjs.lusolve(A, b) as number[][];
    return [
      h[0][0], h[1][0], h[2][0],
      h[3][0], h[4][0], h[5][0],
      h[6][0], h[7][0], 1
    ];
  } catch {
    return null;
  }
}

function invert3x3(m: number[]): number[] | null {
  const det = 
    m[0] * (m[4] * m[8] - m[5] * m[7]) - 
    m[1] * (m[3] * m[8] - m[5] * m[6]) + 
    m[2] * (m[3] * m[7] - m[4] * m[6]);
    
  if (Math.abs(det) < EPSILON) return null;
  const invdet = 1 / det;
  
  return [
    (m[4] * m[8] - m[5] * m[7]) * invdet,
    (m[2] * m[7] - m[1] * m[8]) * invdet,
    (m[1] * m[5] - m[2] * m[4]) * invdet,
    (m[5] * m[6] - m[3] * m[8]) * invdet,
    (m[0] * m[8] - m[2] * m[6]) * invdet,
    (m[2] * m[3] - m[0] * m[5]) * invdet,
    (m[3] * m[7] - m[4] * m[6]) * invdet,
    (m[1] * m[6] - m[0] * m[7]) * invdet,
    (m[0] * m[4] - m[1] * m[3]) * invdet
  ];
}

export function applyHomography(src: ImageData, H: number[], dstW: number, dstH: number): ImageData {
  const dst = new ImageData(dstW, dstH);
  const H_inv = invert3x3(H);
  if (!H_inv) return dst;
  
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const denom = H_inv[6] * x + H_inv[7] * y + H_inv[8];
      if (Math.abs(denom) < EPSILON) continue;
      
      const sx = (H_inv[0] * x + H_inv[1] * y + H_inv[2]) / denom;
      const sy = (H_inv[3] * x + H_inv[4] * y + H_inv[5]) / denom;
      
      const x1 = Math.floor(sx), y1 = Math.floor(sy);
      const x2 = Math.min(x1 + 1, src.width - 1);
      const y2 = Math.min(y1 + 1, src.height - 1);
      const dx = sx - x1, dy = sy - y1;
      
      if (x1 >= 0 && x1 < src.width && y1 >= 0 && y1 < src.height) {
        for (let c = 0; c < 4; c++) {
          const v11 = src.data[(y1 * src.width + x1) * 4 + c];
          const v21 = src.data[(y1 * src.width + x2) * 4 + c];
          const v12 = src.data[(y2 * src.width + x1) * 4 + c];
          const v22 = src.data[(y2 * src.width + x2) * 4 + c];
          
          const val = v11 * (1 - dx) * (1 - dy) + 
                      v21 * dx * (1 - dy) + 
                      v12 * (1 - dx) * dy + 
                      v22 * dx * dy;
          dst.data[(y * dstW + x) * 4 + c] = val;
        }
      }
    }
  }
  return dst;
}

export interface RectifyResult {
  rect: ImageData;
  mode: 'HOMOGRAPHY' | 'CENTER_CROP';
  confidence: number;
  timings: Record<string, number>;
}

export function rectifyOrCenterCrop(imageData: ImageData): RectifyResult {
  const timings: Record<string, number> = {};
  const t0 = performance.now();
  
  const w = imageData.width;
  const h = imageData.height;

  const pre = preprocessFrame(imageData);
  const t1 = performance.now();
  timings.preprocess = t1 - t0;
  
  const { mag, theta } = sobel(pre.lumMedian, w, h);
  const t2 = performance.now();
  timings.sobel = t2 - t1;

  const nms = cannyNMS(mag, theta, w, h);
  const edgeMap = cannyHysteresis(nms, w, h, 0.1, 0.3);
  const t3 = performance.now();
  timings.canny = t3 - t2;

  const lines = probabilisticHough(edgeMap, w, h);
  const t4 = performance.now();
  timings.hough = t4 - t3;

  const quad = findChartQuadrilateral(lines, w, h);
  const t5 = performance.now();
  
  if (quad) {
    const maxW = Math.max(
      Math.hypot(quad.br.x - quad.bl.x, quad.br.y - quad.bl.y),
      Math.hypot(quad.tr.x - quad.tl.x, quad.tr.y - quad.tl.y)
    );
    const maxH = Math.max(
      Math.hypot(quad.bl.x - quad.tl.x, quad.bl.y - quad.tl.y),
      Math.hypot(quad.br.x - quad.tr.x, quad.br.y - quad.tr.y)
    );
    
    const dstW = Math.round(maxW);
    const dstH = Math.round(maxH);
    
    if (dstW > 10 && dstH > 10) {
      const H = solveHomography(quad, dstW, dstH);
      if (H) {
        const rect = applyHomography(imageData, H, dstW, dstH);
        const t6 = performance.now();
        timings.homography = t6 - t5;
        return { rect, mode: 'HOMOGRAPHY', confidence: 1.0, timings };
      }
    }
  }
  
  const cw = Math.round(w * 0.8);
  const ch = Math.round(h * 0.8);
  const ox = Math.round(w * 0.1);
  const oy = Math.round(h * 0.1);
  
  const crop = new ImageData(cw, ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const sx = ox + cx;
      const sy = oy + cy;
      const srcIdx = (sy * w + sx) * 4;
      const dstIdx = (cy * cw + cx) * 4;
      crop.data[dstIdx] = imageData.data[srcIdx];
      crop.data[dstIdx + 1] = imageData.data[srcIdx + 1];
      crop.data[dstIdx + 2] = imageData.data[srcIdx + 2];
      crop.data[dstIdx + 3] = imageData.data[srcIdx + 3];
    }
  }
  
  const t6 = performance.now();
  timings.homography = t6 - t5;
  
  return { rect: crop, mode: 'CENTER_CROP', confidence: 0.5, timings };
}
