import { describe, it, expect } from 'vitest';
import { extractCandlestickPatterns } from '../patternAdapter';
import { NumericOHLC } from '../../vision/pipeline';

describe('Pattern Adapter', () => {
    it('detects a bullish engulfing pattern', () => {
        const series: NumericOHLC[] = [
            { open: 12, high: 15, low: 5, close: 10, xCenter: 0, isBull: false }, // Bearish
            { open: 8, high: 20, low: 4, close: 18, xCenter: 0, isBull: false },  // Bullish engulfing
            { open: 12, high: 15, low: 5, close: 10, xCenter: 0, isBull: false }, // Bearish
            { open: 8, high: 20, low: 4, close: 18, xCenter: 0, isBull: false },  // Bullish engulfing
            { open: 12, high: 15, low: 5, close: 10, xCenter: 0, isBull: false }, // Bearish
            { open: 8, high: 20, low: 4, close: 18, xCenter: 0, isBull: false }  // Bullish engulfing
        ];

        const evidence = extractCandlestickPatterns(series);
        expect(evidence).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    pattern: 'Bullish Engulfing',
                    direction: 'BULL',
                    source: 'candlestick'
                })
            ])
        );
    });

    it('returns empty evidence if series is too short', () => {
        const series: NumericOHLC[] = [
            { open: 12, high: 15, low: 5, close: 10, xCenter: 0, isBull: false }, // Bearish
        ];
        const evidence = extractCandlestickPatterns(series);
        expect(evidence).toEqual([]);
    });
});
