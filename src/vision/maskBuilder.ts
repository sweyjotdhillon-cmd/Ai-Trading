import { HSVBand, rgbToHsv, inBand } from './colorSpace';

export interface MaskPair {
  bull: Uint8Array;
  bear: Uint8Array;
  union: Uint8Array;
  width: number;
  height: number;
}

export function buildHSVMasks(
  frame: ImageData,
  bullBand: HSVBand,
  bearBand: HSVBand
): MaskPair {
  const width = frame.width;
  const height = frame.height;
  const totalPixels = width * height;
  
  const bull = new Uint8Array(totalPixels);
  const bear = new Uint8Array(totalPixels);
  const union = new Uint8Array(totalPixels);
  
  const data = frame.data;
  const rgb: [number, number, number] = [0, 0, 0];
  
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    rgb[0] = data[idx];
    rgb[1] = data[idx + 1];
    rgb[2] = data[idx + 2];
    
    const hsv = rgbToHsv(rgb);
    
    let isBull = false;
    let isBear = false;
    
    if (inBand(hsv, bullBand)) {
      bull[i] = 1;
      isBull = true;
    } else if (inBand(hsv, bearBand)) {
      bear[i] = 1;
      isBear = true;
    }
    
    if (isBull || isBear) {
      union[i] = 1;
    }
  }
  
  return { bull, bear, union, width, height };
}
