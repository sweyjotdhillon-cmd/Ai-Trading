// src/vision/colorSpace.ts

export const EPSILON = 1e-9;
export type RGB = readonly [number, number, number];   // each ∈ [0, 255]
export type HSV = readonly [number, number, number];   // h ∈ [0, 360), s ∈ [0, 1], v ∈ [0, 1]

export interface HSVBand {
  hCenter: number;        // 0..360
  hTolerance: number;     // half-width in degrees, e.g. 12
  sMin: number;           // 0..1
  vMin: number;           // 0..1
}

export function rgbToHsv(rgb: RGB): HSV {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;

  let h = 0;
  if (c < EPSILON) {
    h = 0;
  } else if (max === r) {
    h = 60 * (((g - b) / Math.max(c, EPSILON)) % 6);
  } else if (max === g) {
    h = 60 * (((b - r) / Math.max(c, EPSILON)) + 2);
  } else {
    h = 60 * (((r - g) / Math.max(c, EPSILON)) + 4);
  }

  if (h < 0) h += 360;
  else if (h >= 360) h -= 360;

  const v = max;
  const s = v < EPSILON ? 0 : c / Math.max(v, EPSILON);

  return [h, s, v];
}

export function hsvToRgb(hsv: HSV): RGB {
  const [h, s, v] = hsv;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r1 = 0, g1 = 0, b1 = 0;
  if (h >= 0 && h < 60) {
    [r1, g1, b1] = [c, x, 0];
  } else if (h >= 60 && h < 120) {
    [r1, g1, b1] = [x, c, 0];
  } else if (h >= 120 && h < 180) {
    [r1, g1, b1] = [0, c, x];
  } else if (h >= 180 && h < 240) {
    [r1, g1, b1] = [0, x, c];
  } else if (h >= 240 && h < 300) {
    [r1, g1, b1] = [x, 0, c];
  } else {
    [r1, g1, b1] = [c, 0, x];
  }

  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255)
  ];
}

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

export function inBand(hsv: HSV, band: HSVBand): boolean {
  const [h, s, v] = hsv;
  if (s < band.sMin) return false;
  if (v < band.vMin) return false;
  if (hueDistance(h, band.hCenter) > band.hTolerance) return false;
  return true;
}

function extractPixelRGB(frame: ImageData, x: number, y: number): RGB {
  const idx = (y * frame.width + x) * 4;
  return [frame.data[idx], frame.data[idx + 1], frame.data[idx + 2]];
}

export function samplePatchHSV(frame: ImageData, cx: number, cy: number, patchSize = 5): HSV[] {
  const half = Math.floor(patchSize / 2);
  const hsvs: HSV[] = [];
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const px = cx + dx;
      const py = cy + dy;
      if (px >= 0 && px < frame.width && py >= 0 && py < frame.height) {
        hsvs.push(rgbToHsv(extractPixelRGB(frame, px, py)));
      }
    }
  }
  return hsvs;
}

export function linearMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function circularMedian(hues: number[]): number {
  if (hues.length === 0) return 0;
  let sumSin = 0;
  let sumCos = 0;
  for (const h of hues) {
    const rad = h * (Math.PI / 180);
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
  }
  let meanHue = Math.atan2(sumSin, sumCos) * (180 / Math.PI);
  if (meanHue < 0) meanHue += 360;

  // Find the actual hue closest to the angular mean
  let bestHue = hues[0];
  let minDiff = 360;
  for (const h of hues) {
    const diff = hueDistance(h, meanHue);
    if (diff < minDiff) {
      minDiff = diff;
      bestHue = h;
    }
  }
  return bestHue;
}

export function calculateAdaptiveBand(samples: HSV[], hTolerance = 12): HSVBand {
  const hues = samples.map(s => s[0]);
  const sats = samples.map(s => s[1]);
  const vals = samples.map(s => s[2]);

  const medianH = circularMedian(hues);
  const medianS = linearMedian(sats);
  const medianV = linearMedian(vals);

  return {
    hCenter: medianH,
    hTolerance,
    sMin: Math.max(0.15, medianS - 0.2),
    vMin: Math.max(0.15, medianV - 0.25)
  };
}
