import { describe, it, expect, beforeEach } from 'vitest';
import { PatternStabilityManager } from '../patternStability';
import { PatternEvidence } from '../patternAdapter';

describe('PatternStabilityManager', () => {
    let manager: PatternStabilityManager;

    beforeEach(() => {
        manager = new PatternStabilityManager(3, 'streaming');
    });

    it('requires 3 consecutive frames to confirm a pattern', () => {
        const patternA: PatternEvidence = { pattern: 'Bullish Engulfing', confidence: 1, direction: 'BULL', index: 0, source: 'candlestick' };

        let confirmed = manager.processFrame([patternA]);
        expect(confirmed.length).toBe(0);

        confirmed = manager.processFrame([patternA]);
        expect(confirmed.length).toBe(0);

        confirmed = manager.processFrame([patternA]);
        expect(confirmed.length).toBe(1);
        expect(confirmed[0].pattern).toBe('Bullish Engulfing');
    });

    it('resets pattern count if it is absent in a frame', () => {
        const patternA: PatternEvidence = { pattern: 'Bullish Engulfing', confidence: 1, direction: 'BULL', index: 0, source: 'candlestick' };

        manager.processFrame([patternA]);
        manager.processFrame([patternA]);

        // Missing pattern A
        let confirmed = manager.processFrame([]);
        expect(confirmed.length).toBe(0);

        // Pattern A returns, count restarts from 1
        confirmed = manager.processFrame([patternA]);
        expect(confirmed.length).toBe(0);
    });

    it('can reset all state', () => {
        const patternA: PatternEvidence = { pattern: 'Bullish Engulfing', confidence: 1, direction: 'BULL', index: 0, source: 'candlestick' };

        manager.processFrame([patternA]);
        manager.processFrame([patternA]);
        manager.reset();

        // Count should be reset to 1
        const confirmed = manager.processFrame([patternA]);
        expect(confirmed.length).toBe(0);
    });
});
