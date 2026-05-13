import { EPSILON } from './colorSpace';

export interface PreprocessResult {
  lumMedian: Uint8Array;
  cbBlur: Uint8Array;
  crBlur: Uint8Array;
  w: number;
  h: number;
}

export function rgbToYCbCr(imageData: ImageData): { Y: Uint8Array; Cb: Uint8Array; Cr: Uint8Array } {
  const w = imageData.width;
  const h = imageData.height;
  const len = w * h;
  const Y = new Uint8Array(len);
  const Cb = new Uint8Array(len);
  const Cr = new Uint8Array(len);

  const data = imageData.data;
  for (let i = 0; i < len; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    Y[i]  = Math.min(255, Math.max(0, Math.round( 0.299 * r + 0.587 * g + 0.114 * b)));
    Cb[i] = Math.min(255, Math.max(0, Math.round(-0.1687 * r - 0.3313 * g + 0.5 * b + 128)));
    Cr[i] = Math.min(255, Math.max(0, Math.round( 0.5 * r - 0.4187 * g - 0.0813 * b + 128)));
  }

  return { Y, Cb, Cr };
}

export function median3x3(channel: Uint8Array, w: number, h: number): Uint8Array {
  const result = new Uint8Array(w * h);
  const win = new Uint8Array(9);
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        result[y * w + x] = channel[y * w + x];
        continue;
      }
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          win[c++] = channel[(y + dy) * w + (x + dx)];
        }
      }
      win.sort();
      result[y * w + x] = win[4];
    }
  }
  return result;
}

export function gaussianBlurSeparable(channel: Uint8Array, w: number, h: number, sigma: number): Uint8Array {
  const r = Math.ceil(3 * sigma);
  const kernLen = 2 * r + 1;
  const kernel = new Float32Array(kernLen);
  let sum = 0;
  
  for (let i = -r; i <= r; i++) {
    const val = Math.exp(-(i * i) / (Math.max(EPSILON, 2 * sigma * sigma)));
    kernel[i + r] = val;
    sum += val;
  }
  for (let i = 0; i < kernLen; i++) {
    kernel[i] /= Math.max(EPSILON, sum);
  }

  const temp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -r; k <= r; k++) {
        const nx = Math.min(Math.max(x + k, 0), w - 1);
        val += channel[y * w + nx] * kernel[k + r];
      }
      temp[y * w + x] = val;
    }
  }

  const result = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -r; k <= r; k++) {
        const ny = Math.min(Math.max(y + k, 0), h - 1);
        val += temp[ny * w + x] * kernel[k + r];
      }
      result[y * w + x] = Math.min(255, Math.max(0, Math.round(val)));
    }
  }

  return result;
}

export function preprocessFrame(imageData: ImageData): PreprocessResult {
  const { Y, Cb, Cr } = rgbToYCbCr(imageData);
  const w = imageData.width;
  const h = imageData.height;

  const lumMedian = median3x3(Y, w, h);
  const cbBlur = gaussianBlurSeparable(Cb, w, h, 0.6);
  const crBlur = gaussianBlurSeparable(Cr, w, h, 0.6);

  return { lumMedian, cbBlur, crBlur, w, h };
}
