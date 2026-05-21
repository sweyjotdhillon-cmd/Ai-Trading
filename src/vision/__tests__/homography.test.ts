import { describe, it, expect } from 'vitest';
import { solveHomography, Quad } from '../homography';

function applyH(H: number[], x: number, y: number) {
  const denom = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / denom,
    y: (H[3] * x + H[4] * y + H[5]) / denom
  };
}

describe('solveHomography', () => {
  it('should calculate homography matrix for simple identity translation', () => {
    const src: Quad = {
      tl: { x: 0, y: 0 },
      tr: { x: 100, y: 0 },
      br: { x: 100, y: 100 },
      bl: { x: 0, y: 100 }
    };

    const H = solveHomography(src, 100, 100);

    expect(H).toBeDefined();
    if (H) {
      // For identity mapping, we expect [1, 0, 0, 0, 1, 0, 0, 0, 1] or close to it
      expect(H[0]).toBeCloseTo(1, 4);
      expect(H[1]).toBeCloseTo(0, 4);
      expect(H[2]).toBeCloseTo(0, 4);
      expect(H[3]).toBeCloseTo(0, 4);
      expect(H[4]).toBeCloseTo(1, 4);
      expect(H[5]).toBeCloseTo(0, 4);
      expect(H[6]).toBeCloseTo(0, 4);
      expect(H[7]).toBeCloseTo(0, 4);
      expect(H[8]).toBeCloseTo(1, 4);
    }
  });

  it('should handle scaling', () => {
    const src: Quad = {
      tl: { x: 0, y: 0 },
      tr: { x: 50, y: 0 },
      br: { x: 50, y: 50 },
      bl: { x: 0, y: 50 }
    };

    const H = solveHomography(src, 100, 100);

    expect(H).toBeDefined();
    if (H) {
      // To go from 50x50 to 100x100, scale is 2x
      expect(H[0]).toBeCloseTo(2, 4); // x scale
      expect(H[4]).toBeCloseTo(2, 4); // y scale
    }
  });

  it('should handle translation', () => {
    const src: Quad = {
      tl: { x: 10, y: 10 },
      tr: { x: 110, y: 10 },
      br: { x: 110, y: 110 },
      bl: { x: 10, y: 110 }
    };

    const H = solveHomography(src, 100, 100);
    expect(H).toBeDefined();
    if (H) {
      // For translation by -10, -10: x' = x - 10, y' = y - 10
      expect(H[0]).toBeCloseTo(1, 4);
      expect(H[1]).toBeCloseTo(0, 4);
      expect(H[2]).toBeCloseTo(-10, 4);
      expect(H[3]).toBeCloseTo(0, 4);
      expect(H[4]).toBeCloseTo(1, 4);
      expect(H[5]).toBeCloseTo(-10, 4);
    }
  });

  it('should correctly map a perspective projected quad to a rectangle', () => {
    const src: Quad = {
      tl: { x: 10, y: 20 },
      tr: { x: 90, y: 15 },
      br: { x: 110, y: 85 },
      bl: { x: 5, y: 95 }
    };
    const dstW = 100;
    const dstH = 100;

    const H = solveHomography(src, dstW, dstH);
    expect(H).toBeDefined();

    if (H) {
      const pTL = applyH(H, src.tl.x, src.tl.y);
      expect(pTL.x).toBeCloseTo(0, 4);
      expect(pTL.y).toBeCloseTo(0, 4);

      const pTR = applyH(H, src.tr.x, src.tr.y);
      expect(pTR.x).toBeCloseTo(100, 4);
      expect(pTR.y).toBeCloseTo(0, 4);

      const pBR = applyH(H, src.br.x, src.br.y);
      expect(pBR.x).toBeCloseTo(100, 4);
      expect(pBR.y).toBeCloseTo(100, 4);

      const pBL = applyH(H, src.bl.x, src.bl.y);
      expect(pBL.x).toBeCloseTo(0, 4);
      expect(pBL.y).toBeCloseTo(100, 4);
    }
  });

  it('should return null for invalid singular inputs', () => {
    const src: Quad = {
      tl: { x: 0, y: 0 },
      tr: { x: 0, y: 0 },
      br: { x: 0, y: 0 },
      bl: { x: 0, y: 0 }
    };

    const H = solveHomography(src, 100, 100);
    expect(H).toBeNull();
  });
});
