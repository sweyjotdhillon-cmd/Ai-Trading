export interface DigitTemplate {
  char: string;
  font: string;
  weight: string;
  size: number;
  w: number;
  h: number;
  mask: Uint8Array;
}

let templateCache: DigitTemplate[] | null = null;

export function getTemplates(): DigitTemplate[] {
  if (templateCache) return templateCache;
  return buildTemplates();
}

export function generateAt(scale: number): DigitTemplate[] {
  // Returns cache for scale agnostic pipeline where bilinear resize is used
  return getTemplates();
}

function buildTemplates(): DigitTemplate[] {
  const chars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '-'];
  const fonts = ['Inter', 'system-ui', 'Arial', 'Roboto Mono'];
  const sizes = [24, 32, 48];
  const weights = ['normal', 'bold', '500'];

  let canvas: HTMLCanvasElement | OffscreenCanvas;
  try {
    canvas = new OffscreenCanvas(64, 64);
  } catch (e) {
    canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
  }
  
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return [];

  const templates: DigitTemplate[] = [];

  for (const font of fonts) {
    for (const size of sizes) {
      for (const weight of weights) {
        for (const char of chars) {
          ctx.clearRect(0, 0, 64, 64);
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, 64, 64);
          ctx.font = `${weight} ${size}px "${font}"`;
          ctx.fillStyle = '#ffffff';
          ctx.textBaseline = 'top';
          ctx.fillText(char, 2, 2);

          const imgData = ctx.getImageData(0, 0, 64, 64);
          let minX = 64, maxX = -1, minY = 64, maxY = -1;

          for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
              const idx = (y * 64 + x) * 4;
              if (imgData.data[idx] > 128) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }

          if (maxX < minX || maxY < minY) continue;

          const tw = maxX - minX + 1;
          const th = maxY - minY + 1;
          const mask = new Uint8Array(tw * th);
          for (let y = 0; y < th; y++) {
            for (let x = 0; x < tw; x++) {
              const srcIdx = ((minY + y) * 64 + (minX + x)) * 4;
              mask[y * tw + x] = imgData.data[srcIdx] > 128 ? 1 : 0;
            }
          }

          templates.push({
            char, font, weight, size, w: tw, h: th, mask
          });
        }
      }
    }
  }

  // Sort deterministically to satisfy requirement
  templates.sort((a, b) => {
    if (a.char !== b.char) return a.char.localeCompare(b.char);
    if (a.font !== b.font) return a.font.localeCompare(b.font);
    if (a.size !== b.size) return a.size - b.size;
    return a.weight.localeCompare(b.weight);
  });

  templateCache = templates;
  return templates;
}
