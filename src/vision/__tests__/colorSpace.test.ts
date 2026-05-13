import { describe, it, expect } from 'vitest';
import { hsvToRgb, rgbToHsv, RGB, HSV } from '../colorSpace';

describe('colorSpace', () => {
  describe('hsvToRgb', () => {
    it('should correctly convert known HSV values to RGB', () => {
      // Red
      expect(hsvToRgb([0, 1, 1])).toEqual([255, 0, 0]);
      // Green
      expect(hsvToRgb([120, 1, 1])).toEqual([0, 255, 0]);
      // Blue
      expect(hsvToRgb([240, 1, 1])).toEqual([0, 0, 255]);
      // Yellow
      expect(hsvToRgb([60, 1, 1])).toEqual([255, 255, 0]);
      // Cyan
      expect(hsvToRgb([180, 1, 1])).toEqual([0, 255, 255]);
      // Magenta
      expect(hsvToRgb([300, 1, 1])).toEqual([255, 0, 255]);

      // White
      expect(hsvToRgb([0, 0, 1])).toEqual([255, 255, 255]);
      expect(hsvToRgb([100, 0, 1])).toEqual([255, 255, 255]);
      // Black
      expect(hsvToRgb([0, 0, 0])).toEqual([0, 0, 0]);
      expect(hsvToRgb([300, 1, 0])).toEqual([0, 0, 0]);
      // Gray
      expect(hsvToRgb([0, 0, 0.5])).toEqual([128, 128, 128]);
    });

    it('should roundtrip RGB -> HSV -> RGB consistently', () => {
      const testCases: RGB[] = [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 0],
        [0, 255, 255],
        [255, 0, 255],
        [255, 255, 255],
        [0, 0, 0],
        [128, 128, 128],
        [50, 100, 150],
        [200, 100, 50],
        [12, 34, 56],
        [255, 128, 0],
        [254, 253, 252],
        [1, 2, 3],
      ];

      for (const rgb of testCases) {
        const hsv = rgbToHsv(rgb);
        const reconstructedRgb = hsvToRgb(hsv);

        // Due to rounding and the fact that we divide by 255 and multiply back,
        // we allow a tolerance of +/- 1 in the reconstructed values.
        expect(Math.abs(rgb[0] - reconstructedRgb[0])).toBeLessThanOrEqual(1);
        expect(Math.abs(rgb[1] - reconstructedRgb[1])).toBeLessThanOrEqual(1);
        expect(Math.abs(rgb[2] - reconstructedRgb[2])).toBeLessThanOrEqual(1);
      }
    });

    it('should handle random colors roundtrip', () => {
      for (let i = 0; i < 100; i++) {
        const rgb: RGB = [
          Math.floor(Math.random() * 256),
          Math.floor(Math.random() * 256),
          Math.floor(Math.random() * 256),
        ];

        const hsv = rgbToHsv(rgb);
        const reconstructed = hsvToRgb(hsv);

        expect(Math.abs(rgb[0] - reconstructed[0])).toBeLessThanOrEqual(1);
        expect(Math.abs(rgb[1] - reconstructed[1])).toBeLessThanOrEqual(1);
        expect(Math.abs(rgb[2] - reconstructed[2])).toBeLessThanOrEqual(1);
      }
    });

    it('should handle HSV boundary conditions', () => {
      // Hue 360 is conceptually same as 0, but hsvToRgb might handle it.
      // Based on hsvToRgb: "else" branch handles hue >= 300
      expect(hsvToRgb([359.99, 1, 1])[0]).toBe(255);

      // Saturation 0 is gray regardless of hue
      const gray1 = hsvToRgb([100, 0, 0.5]);
      const gray2 = hsvToRgb([200, 0, 0.5]);
      expect(gray1).toEqual([128, 128, 128]);
      expect(gray2).toEqual([128, 128, 128]);
    });
  });
});
