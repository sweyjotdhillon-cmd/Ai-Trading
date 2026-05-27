import { NumericOHLC } from '../vision/pipeline';

import { rsi, stochastic, macd, atr, bollinger } from './indicators';
import { emaSlope, emaCurvature } from './calculus';

export type VoteResult = 'BULL' | 'BEAR' | 'NEUTRAL';

export interface TechniqueVote {
  id: string;           // e.g. "T042"
  name: string;         // technique name from the list
  vote: VoteResult;
  score: number;        // 0.0 - 1.0 confidence of this technique's finding
  reason: string;       // short math-based reason e.g. "RSI=27 < 30 threshold"
}

export function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, '');
}

export function shardTechniques(list: any[], shardSize = 15): any[][] {
  const shards: any[][] = [];
  for (let i = 0; i < list.length; i += shardSize) {
    shards.push(list.slice(i, i + shardSize));
  }
  return shards;
}

export interface IndicatorCache {
  rsiVals?: number[];
  stochVals?: { k: number[], d: number[] };
  macdVals?: { macd: number[], signal: number[], hist: number[] };
  emaSlope?: number[];
  emaCurvature?: number[];
  atrVals?: number[];
  bollVals?: { upper: number[], lower: number[], middle: number[] };
  closes?: number[];
}

export function evaluateShard(
  shard: string[],
  ohlc: NumericOHLC[],
  shardOffset: number,
  cache: IndicatorCache
): TechniqueVote[] {
  const votes: TechniqueVote[] = [];

  const closes = cache.closes || (cache.closes = ohlc.map(c => c.close));
  const last = closes.length - 1;

  // Memoize indicators globally across shards
  const getRSI = () => cache.rsiVals || (cache.rsiVals = rsi(closes, 14));
  const getStoch = () => cache.stochVals || (cache.stochVals = stochastic(ohlc, 14, 3));
  const getMACD = () => cache.macdVals || (cache.macdVals = macd(closes, 12, 26, 9));
  const getEmaSlope = () => cache.emaSlope || (cache.emaSlope = emaSlope(closes, 20));
  const getEmaCurvature = () => cache.emaCurvature || (cache.emaCurvature = emaCurvature(closes, 20));
  const getATR = () => cache.atrVals || (cache.atrVals = atr(ohlc, 14));
  const getBollinger = () => cache.bollVals || (cache.bollVals = bollinger(closes, 20, 2));

  for (let i = 0; i < shard.length; i++) {
    const techItem = shard[i];
    const rawName = typeof techItem === 'object' ? (techItem.name || techItem.technique || 'Unnamed Technique') : String(techItem);
    const key = normalizeKey(rawName);
    const id = `T${(shardOffset + i + 1).toString().padStart(3, '0')}`;

    let vote: VoteResult = 'NEUTRAL';
    let score = 0;
    let reason = 'no_match';

    if (typeof techItem === 'object' && techItem.code) {
      try {
        const func = new Function('ohlc', 'closes', 'last', 'getRSI', 'getStoch', 'getMACD', 'getEmaSlope', 'getEmaCurvature', 'getATR', 'getBollinger', techItem.code);
        const res = func(ohlc, closes, last, getRSI, getStoch, getMACD, getEmaSlope, getEmaCurvature, getATR, getBollinger);
        
        if (res && typeof res === 'object') {
           vote = res.vote || 'NEUTRAL';
           score = res.score || 0;
           reason = res.reason || 'Executed user technique';
        }
      } catch (err: any) {
        reason = `Code Exec Error: ${err.message}`;
      }
    } else {
      reason = 'No execution code provided in the user technique file.';
    }

    votes.push({
      id,
      name: rawName,
      vote,
      score,
      reason
    });
  }

  return votes;
}

export async function evaluateAllShards(
  techniquesList: string[],
  ohlcSeries: NumericOHLC[],
  _context?: any
): Promise<{
  votes: TechniqueVote[];
  proofTokens: string;
  bullVotes: number;
  bearVotes: number;
  neutralVotes: number;
  totalEvaluated: number;
  earlyExit: boolean;
}> {
  const shards = shardTechniques(techniquesList, 5);

  const cache: IndicatorCache = {};

  let bullVotes = 0;
  let bearVotes = 0;
  let neutralVotes = 0;
  const proofTokensArr: string[] = [];
  const votes: TechniqueVote[] = [];
  let earlyExit = false;

  for (let i = 0; i < shards.length; i++) {
    const shard = shards[i];
    const shardVotes = await new Promise<TechniqueVote[]>((resolve) => {
      resolve(evaluateShard(shard, ohlcSeries, i * 5, cache));
    });

    votes.push(...shardVotes);

    for (const v of shardVotes) {
      if (v.vote === 'BULL' && v.score > 0) bullVotes++;
      else if (v.vote === 'BEAR' && v.score > 0) bearVotes++;
      else neutralVotes++;

      proofTokensArr.push(`${v.id}:${v.vote}:${v.score.toFixed(2)}`);
    }

    const totalEvaluated = bullVotes + bearVotes + neutralVotes;
    const runningConfidence = (bullVotes - bearVotes) / Math.max(1, totalEvaluated);

    if (Math.abs(runningConfidence) >= 0.75 && totalEvaluated >= 10) {
      earlyExit = true;
      break;
    }
  }

  return {
    votes,
    proofTokens: proofTokensArr.join(' '),
    bullVotes,
    bearVotes,
    neutralVotes,
    totalEvaluated: votes.length,
    earlyExit
  };
}

export function validateProofTokens(tokens: string, expectedCount: number): {
  valid: boolean;
  found: number;
  missing: number[];
} {
  const parts = tokens.trim().split(/\s+/).filter(Boolean);
  const foundIds = new Set<number>();

  for (const part of parts) {
      const match = part.match(/^T(\d{3}):/);
      if (match) {
          foundIds.add(parseInt(match[1], 10));
      }
  }

  const missing: number[] = [];
  for (let i = 1; i <= expectedCount; i++) {
      if (!foundIds.has(i)) {
          missing.push(i);
      }
  }

  return {
      valid: missing.length === 0 && parts.length === expectedCount,
      found: parts.length,
      missing
  };
}
