import { getTemplates } from './digitTemplates';
import { otsuThreshold } from './otsu';
import { EPSILON } from './colorSpace';

export function recognizeDigits(roi: ImageData): { text: string; confidence: number } {
  const w = roi.width;
  const h = roi.height;
  const len = w * h;
  const gray = new Uint8Array(len);
  
  for (let i = 0; i < len; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * roi.data[idx] + 0.587 * roi.data[idx + 1] + 0.114 * roi.data[idx + 2]);
  }

  const sortedGray = new Uint8Array(gray).sort((a,b) => a - b);
  const median = sortedGray[Math.floor(len / 2)];
  
  const th = otsuThreshold(gray);
  const bin = new Uint8Array(len);
  const isLightText = median < th;
  
  for (let i = 0; i < len; i++) {
    if (isLightText) {
      bin[i] = gray[i] > th ? 1 : 0;
    } else {
      bin[i] = gray[i] < th ? 1 : 0;
    }
  }

  const colSum = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      colSum[x] += bin[y * w + x];
    }
  }

  const subROIs: { minX: number; maxX: number; minY: number; maxY: number }[] = [];
  let startX = -1;

  for (let x = 0; x < w; x++) {
    if (colSum[x] > 0) {
      if (startX === -1) startX = x;
    } else {
      if (startX !== -1) {
        subROIs.push({ minX: startX, maxX: x - 1, minY: h, maxY: -1 });
        startX = -1;
      }
    }
  }
  if (startX !== -1) {
    subROIs.push({ minX: startX, maxX: w - 1, minY: h, maxY: -1 });
  }

  for (const roi of subROIs) {
    let minY = h, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = roi.minX; x <= roi.maxX; x++) {
        if (bin[y * w + x] > 0) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    roi.minY = minY;
    roi.maxY = maxY;
  }

  const validROIs = subROIs.filter(r => r.maxY >= r.minY && r.maxX >= r.minX);
  
  let text = '';
  let confSum = 0;
  let charCount = 0;
  const templates = getTemplates();
  if (templates.length === 0) return { text: '', confidence: 0 };

  for (const r of validROIs) {
    const rw = r.maxX - r.minX + 1;
    const rh = r.maxY - r.minY + 1;
    
    if (rw < 2 && rh < 2) continue; // Skip noise

    const rBin = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        rBin[y * rw + x] = bin[(r.minY + y) * w + (r.minX + x)];
      }
    }

    let bestChar = '?';
    let bestConf = -1;

    for (const t of templates) {
      let sumI = 0, sumT = 0;
      const nTotal = t.w * t.h;
      const sampledI = new Float32Array(nTotal);
      
      for (let ty = 0; ty < t.h; ty++) {
        for (let tx = 0; tx < t.w; tx++) {
          const sx = (tx / Math.max(t.w - 1, EPSILON)) * (rw - 1);
          const sy = (ty / Math.max(t.h - 1, EPSILON)) * (rh - 1);
          
          let val = 0;
          if (rw === 1 && rh === 1) {
             val = rBin[0];
          } else if (rw === 1) {
             const y1 = Math.floor(sy);
             const y2 = Math.min(y1 + 1, rh - 1);
             const dy = sy - y1;
             val = rBin[y1] * (1 - dy) + rBin[y2] * dy;
          } else if (rh === 1) {
             const x1 = Math.floor(sx);
             const x2 = Math.min(x1 + 1, rw - 1);
             const dx = sx - x1;
             val = rBin[x1] * (1 - dx) + rBin[x2] * dx;
          } else {
             const x1 = Math.floor(sx);
             const y1 = Math.floor(sy);
             const x2 = Math.min(x1 + 1, rw - 1);
             const y2 = Math.min(y1 + 1, rh - 1);
             const dx = sx - x1;
             const dy = sy - y1;
             
             const v11 = rBin[y1 * rw + x1];
             const v21 = rBin[y1 * rw + x2];
             const v12 = rBin[y2 * rw + x1];
             const v22 = rBin[y2 * rw + x2];
             
             val = v11 * (1 - dx) * (1 - dy) + v21 * dx * (1 - dy) + v12 * (1 - dx) * dy + v22 * dx * dy;
          }
          
          sampledI[ty * t.w + tx] = val;
          sumI += val;
          sumT += t.mask[ty * t.w + tx];
        }
      }

      const meanI = sumI / nTotal;
      const meanT = sumT / nTotal;

      let num = 0, varI = 0, varT = 0;
      for (let i = 0; i < nTotal; i++) {
        const dI = sampledI[i] - meanI;
        const dT = t.mask[i] - meanT;
        num += dI * dT;
        varI += dI * dI;
        varT += dT * dT;
      }
      
      const denom = Math.sqrt(Math.max(0, varI * varT)) + EPSILON;
      const ncc = num / denom;

      if (ncc > bestConf) {
        bestConf = ncc;
        bestChar = t.char;
      }
    }

    if (bestConf >= 0.55) {
      text += bestChar;
      confSum += bestConf;
      charCount++;
    } else {
      text += '?';
    }
  }

  return { text, confidence: charCount > 0 ? confSum / charCount : 0 };
}
