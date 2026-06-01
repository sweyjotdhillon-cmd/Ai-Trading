import { recognizeDigits } from './ocr';
import { otsuThreshold } from './otsu';
import { EPSILON } from './colorSpace';

export interface PriceAxisTransform {
  ok: boolean;
  mSlope?: number;
  bIntercept?: number;
  anchors?: { y: number; price: number }[];
  confidence?: number;
  reason?: string;
  tickCount?: number;
  recognizedDigits?: number;
}

export function readYAxis(imageData: ImageData): PriceAxisTransform | null {
  const w = imageData.width;
  const h = imageData.height;

  // Extract rightmost 80px strip
  const stripW = Math.min(80, w);
  const startX = w - stripW;

  const len = stripW * h;
  const gray = new Uint8Array(len);
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < stripW; x++) {
      const idx = (y * w + (startX + x)) * 4;
      gray[y * stripW + x] = Math.round(
        0.299 * imageData.data[idx] + 
        0.587 * imageData.data[idx + 1] + 
        0.114 * imageData.data[idx + 2]
      );
    }
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

  const rowSum = new Int32Array(h);
  let totalSum = 0;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < stripW; x++) {
      s += bin[y * stripW + x];
    }
    rowSum[y] = s;
    totalSum += s;
  }

  const meanSum = totalSum / Math.max(1, h);
  let varSum = 0;
  for (let y = 0; y < h; y++) {
    varSum += (rowSum[y] - meanSum) * (rowSum[y] - meanSum);
  }
  const stdSum = Math.sqrt(varSum / Math.max(1, h));

  const thresholdSum = meanSum + 0.5 * stdSum;
  
  const rows: { minY: number; maxY: number }[] = [];
  let currentStart = -1;
  const gapThreshold = 2; 
  let gapCount = 0;

  for (let y = 0; y < h; y++) {
    if (rowSum[y] > thresholdSum) {
      if (currentStart === -1) currentStart = y;
      gapCount = 0;
    } else {
      if (currentStart !== -1) {
        gapCount++;
        if (gapCount >= gapThreshold) {
          rows.push({ minY: currentStart, maxY: y - gapCount });
          currentStart = -1;
          gapCount = 0;
        }
      }
    }
  }
  if (currentStart !== -1) {
    rows.push({ minY: currentStart, maxY: h - 1 });
  }

  const textRows = rows.filter(r => (r.maxY - r.minY) >= 6 && (r.maxY - r.minY) <= 30);

  const anchors: { y: number; price: number }[] = [];

  for (const r of textRows) {
    const cropH = r.maxY - r.minY + 1;
    const cropW = stripW;
    
    // Use plain array so it runs cleanly in workers without DOM
    const arr = new Uint8ClampedArray(cropW * cropH * 4);
    
    for (let cy = 0; cy < cropH; cy++) {
      for (let cx = 0; cx < cropW; cx++) {
        const srcGlobalX = startX + cx;
        const srcGlobalY = r.minY + cy;
        const srcIdx = (srcGlobalY * w + srcGlobalX) * 4;
        const dstIdx = (cy * cropW + cx) * 4;
        arr[dstIdx] = imageData.data[srcIdx];
        arr[dstIdx + 1] = imageData.data[srcIdx + 1];
        arr[dstIdx + 2] = imageData.data[srcIdx + 2];
        arr[dstIdx + 3] = imageData.data[srcIdx + 3];
      }
    }
    
    const cropImageData = { width: cropW, height: cropH, data: arr } as ImageData;
    
    const { text, confidence } = recognizeDigits(cropImageData);
    if (confidence >= 0.55 && text.length > 0 && !text.includes('?')) {
      const cleanString = text.replace(/,/g, '');
      const parsed = parseFloat(cleanString);
      if (!isNaN(parsed) && isFinite(parsed)) {
         const yCenter = (r.maxY + r.minY) / 2;
         anchors.push({ y: yCenter, price: parsed });
      }
    }
  }

  const expectedTicks = textRows.length;
  // Patch 3: axisConfidence = recognizedTicks / expectedTicks;
  const axisConfidence = expectedTicks > 0 ? anchors.length / expectedTicks : 0;

  if (anchors.length < 2) {
    return { ok: false, reason: 'OCR_FAILED', tickCount: expectedTicks, recognizedDigits: anchors.length, confidence: axisConfidence };
  }

  const N = anchors.length;
  let sumY = 0, sumP = 0, sumYY = 0, sumYP = 0;
  for (const a of anchors) {
    sumY += a.y;
    sumP += a.price;
    sumYY += a.y * a.y;
    sumYP += a.y * a.price;
  }

  const denom = (N * sumYY - sumY * sumY) + EPSILON;
  const mSlope = (N * sumYP - sumY * sumP) / denom;
  const bIntercept = (sumP - mSlope * sumY) / Math.max(1, N);

  return {
    ok: true,
    mSlope,
    bIntercept,
    anchors,
    confidence: axisConfidence, 
  };
}
