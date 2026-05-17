import { describe, it, expect } from "vitest";
import { evaluateAllShards, validateProofTokens } from '../techniqueShardEngine';
import { NumericOHLC } from '../../vision/pipeline';
import { HorizonContext } from '../horizon';

const mockHorizonCtx: HorizonContext = {
    tfMinutes: 5,
    durationMinutes: 15,
    H: 0.5,
    horizonClass: 'INTRA_CANDLE'
};

function makeOhlc(count: number, trend: 'up' | 'down' | 'hammer' = 'up'): NumericOHLC[] {
    const ohlc: NumericOHLC[] = [];
    let price = 100;
    for (let i = 0; i < count; i++) {
        if (trend === 'up') {
            ohlc.push({ open: price, close: price + 1, high: price + 1.5, low: price - 0.5, xCenter: i, isBull: true });
            price += 1;
        } else if (trend === 'down') {
            ohlc.push({ open: price, close: price - 1, high: price + 0.5, low: price - 1.5, xCenter: i, isBull: false });
            price -= 1;
        } else if (trend === 'hammer') {
            if (i === count - 1) {
                // hammer: low way down, close near open, high close to close
                ohlc.push({ open: price, close: price + 0.1, high: price + 0.2, low: price - 2, xCenter: i, isBull: true });
            } else {
                ohlc.push({ open: price, close: price - 1, high: price + 0.5, low: price - 1.5, xCenter: i, isBull: false });
                price -= 1;
            }
        }
    }
    return ohlc;
}

describe('Technique Shard Engine', () => {

    it('1. evaluateAllShards with 150 techniques -> totalEvaluated === 150', async () => {
        const list = Array.from({ length: 150 }, (_, i) => `Tech_${i}`);
        const result = await evaluateAllShards(list, makeOhlc(30), mockHorizonCtx);
        expect(result.totalEvaluated).toBe(150);
        expect(result.votes.length).toBe(150);
    });

    it('2. Proof token count equals input length', async () => {
        for (const N of [1, 15, 47, 150]) {
            const list = Array.from({ length: N }, (_, i) => `Tech_${i}`);
            const result = await evaluateAllShards(list, makeOhlc(30), mockHorizonCtx);
            const tokens = result.proofTokens.trim().split(/\s+/).filter(Boolean);
            expect(tokens.length).toBe(N);
        }
    });

    it('3. Unknown technique names produce NEUTRAL:0.00 token - never a gap', async () => {
        const list = ['completely_unknown_technique', 'another_one'];
        const result = await evaluateAllShards(list, makeOhlc(30), mockHorizonCtx);
        expect(result.votes[0].vote).toBe('NEUTRAL');
        expect(result.votes[0].score).toBe(0);
        expect(result.proofTokens).toMatch(/T001:NEUTRAL:0\.00/);
        expect(result.proofTokens).toMatch(/T002:NEUTRAL:0\.00/);
    });

    it('4. validateProofTokens correctly identifies a missing T042', () => {
        const tokens: string[] = [];
        for (let i = 1; i <= 50; i++) {
            if (i !== 42) {
                tokens.push(`T${i.toString().padStart(3, '0')}:BULL:1.00`);
            }
        }
        const tokenStr = tokens.join(' ');
        const validation = validateProofTokens(tokenStr, 50);
        expect(validation.valid).toBe(false);
        expect(validation.missing).toContain(42);
        expect(validation.found).toBe(49);
    });

    it('5. Shard independence (no shared state)', async () => {
        const list = Array.from({ length: 45 }, (_, i) => i < 15 ? 'hammer' : (i < 30 ? 'doji' : 'rsioversold'));

        // Full evaluation
        const allResult = await evaluateAllShards(list, makeOhlc(30), mockHorizonCtx);
        const shard2FromFull = allResult.votes.slice(15, 30);

        // Isolated shard 2
        const shard2Isolated = await evaluateAllShards(list.slice(15, 30), makeOhlc(30), mockHorizonCtx);

        expect(shard2FromFull.map(v => v.vote)).toEqual(shard2Isolated.votes.map(v => v.vote));
        expect(shard2FromFull.map(v => v.score)).toEqual(shard2Isolated.votes.map(v => v.score));
    });

    it('6. Synthetic OHLC with RSI < 30 -> RSI_Oversold votes BULL', async () => {
        // A strong downtrend will eventually push RSI < 30
        const ohlc = makeOhlc(40, 'down');
        const result = await evaluateAllShards(['RSI_Oversold'], ohlc, mockHorizonCtx);
        expect(result.votes[0].vote).toBe('BULL');
        expect(result.votes[0].score).toBeGreaterThan(0);
        expect(result.proofTokens).toMatch(/T001:BULL:/);
    });

    it('7. Synthetic OHLC hammer candle -> Hammer votes BULL with score > 0.5', async () => {
        const ohlc = makeOhlc(30, 'hammer');
        const result = await evaluateAllShards(['Hammer'], ohlc, mockHorizonCtx);
        expect(result.votes[0].vote).toBe('BULL');
        expect(result.votes[0].score).toBeGreaterThan(0.5);
    });

});
