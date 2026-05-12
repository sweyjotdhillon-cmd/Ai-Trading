import { EPSILON } from './colorSpace';

export interface Component {
  id: number;
  area: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  cx: number;
  cy: number;
  classLabel: 'bull' | 'bear';
}

export function findCandleComponents(
  bullMask: Uint8Array,
  bearMask: Uint8Array,
  width: number,
  height: number
): Component[] {
  const total = width * height;
  const labels = new Int32Array(total);
  // Allocate parent array a bit smaller but union-find could use up to total / 2 sets
  const parent = new Int32Array(total);
  let nextLabel = 1;

  function find(i: number): number {
    let p = parent[i];
    if (p === i) return i;
    while (p !== parent[p]) {
      parent[p] = parent[parent[p]];
      p = parent[p];
    }
    return p;
  }

  function unionSet(i: number, j: number) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI < rootJ) {
      parent[rootJ] = rootI;
    } else if (rootI > rootJ) {
      parent[rootI] = rootJ;
    }
  }

  // Pass 1: Labeling
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const isBull = bullMask[idx] > 0;
      const isBear = !isBull && bearMask[idx] > 0;
      
      if (isBull || isBear) {
        const leftIdx = x > 0 ? idx - 1 : -1;
        const upIdx = y > 0 ? idx - width : -1;
        
        const sameLeft = leftIdx >= 0 && ((isBull && bullMask[leftIdx] > 0) || (isBear && bearMask[leftIdx] > 0));
        const sameUp = upIdx >= 0 && ((isBull && bullMask[upIdx] > 0) || (isBear && bearMask[upIdx] > 0));

        if (sameLeft && sameUp) {
          const lLeft = labels[leftIdx];
          const lUp = labels[upIdx];
          labels[idx] = Math.min(lLeft, lUp);
          unionSet(lLeft, lUp);
        } else if (sameLeft) {
          labels[idx] = labels[leftIdx];
        } else if (sameUp) {
          labels[idx] = labels[upIdx];
        } else {
          labels[idx] = nextLabel;
          parent[nextLabel] = nextLabel;
          nextLabel++;
        }
      }
    }
  }

  // Pass 2: Accumulate component stats
  const area = new Int32Array(nextLabel);
  const xMin = new Int32Array(nextLabel).fill(width + 1);
  const xMax = new Int32Array(nextLabel).fill(-1);
  const yMin = new Int32Array(nextLabel).fill(height + 1);
  const yMax = new Int32Array(nextLabel).fill(-1);
  const sumX = new Float64Array(nextLabel);
  const sumY = new Float64Array(nextLabel);
  const classObj = new Uint8Array(nextLabel); // 1=bull, 2=bear

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (labels[idx] > 0) {
        const root = find(labels[idx]);
        labels[idx] = root; // Flatten
        
        area[root]++;
        if (x < xMin[root]) xMin[root] = x;
        if (x > xMax[root]) xMax[root] = x;
        if (y < yMin[root]) yMin[root] = y;
        if (y > yMax[root]) yMax[root] = y;
        sumX[root] += x;
        sumY[root] += y;
        
        if (classObj[root] === 0) {
          classObj[root] = bullMask[idx] > 0 ? 1 : 2;
        }
      }
    }
  }

  const components: Component[] = [];
  for (let i = 1; i < nextLabel; i++) {
    if (area[i] > 0) {
      components.push({
        id: i,
        area: area[i],
        xMin: xMin[i],
        xMax: xMax[i],
        yMin: yMin[i],
        yMax: yMax[i],
        cx: Math.round(sumX[i] / Math.max(area[i], EPSILON)),
        cy: Math.round(sumY[i] / Math.max(area[i], EPSILON)),
        classLabel: classObj[i] === 1 ? 'bull' : 'bear'
      });
    }
  }

  return components;
}
