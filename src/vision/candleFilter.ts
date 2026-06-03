import { Component } from './connectedComponents';
import { EPSILON } from './colorSpace';

export interface FilterDiagnostics {
  reasons: Record<string, number>;
}

export function filterCandleBodies(
  components: Component[],
  width: number,
  height: number,
  unionMask: Uint8Array
): { bodies: Component[]; diag: FilterDiagnostics } {
  const bodies: Component[] = [];
  const diag: FilterDiagnostics = { reasons: {} };
  
  function reject(reason: string) {
    diag.reasons[reason] = (diag.reasons[reason] || 0) + 1;
  }

  for (const comp of components) {
    // 1. Area gate: not too small
    if (comp.area < 3) {
      reject('TOO_SMALL');
      continue;
    }
    // Area upper bound: full background panel, watermark, etc.
    if (comp.area > 0.02 * width * height) {
      reject('TOO_LARGE');
      continue;
    }
    
    // 2. Aspect-ratio gate
    const w = comp.xMax - comp.xMin + 1;
    const h = comp.yMax - comp.yMin + 1;
    const ar = h / Math.max(w, EPSILON);
    
    // For very small candles, allow extremely flat entries (e.g. Dojis)
    const minAr = comp.area < 15 ? 0.15 : 0.40;
    if (ar < minAr) {
      reject('TOO_HORIZONTAL');
      continue;
    }
    if (ar > 35) {
      reject('TOO_VERTICAL');
      continue;
    }
    
    // 3. Column-density gate
    const density = comp.area / Math.max(w * h, EPSILON);
    const minDensity = comp.area < 15 ? 0.35 : 0.50;
    if (density < minDensity) {
      // Outline detection fallback: an outlined candle might have low total density
      // but a high density on its perimeter.
      let perimeterTotal = 0;
      let perimeterInBand = 0;
      // Top and bottom edges
      for (let x = comp.xMin; x <= comp.xMax; x++) {
        if (unionMask[comp.yMin * width + x]) perimeterInBand++;
        if (unionMask[comp.yMax * width + x]) perimeterInBand++;
        perimeterTotal += 2;
      }
      // Left and right edges (excluding corners already checked)
      for (let y = comp.yMin + 1; y < comp.yMax; y++) {
        if (unionMask[y * width + comp.xMin]) perimeterInBand++;
        if (unionMask[y * width + comp.xMax]) perimeterInBand++;
        perimeterTotal += 2;
      }
      const perimeterDensity = perimeterInBand / Math.max(perimeterTotal, EPSILON);
      if (perimeterDensity >= 0.70) {
         bodies.push(comp); // accepted via outline rule
         continue;
      }

      reject('TOO_SPARSE');
      continue;
    }
    
    bodies.push(comp);
  }

  return { bodies, diag };
}
