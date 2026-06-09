import { NumericOHLC } from '../vision/pipeline';

import { rsi, stochastic, macd, atr, bollinger, ema } from './indicators';
import { emaSlope, emaCurvature } from './calculus';

import { TECHNIQUE_LIBRARY, resolveLibraryKey } from './techniqueLibrary';

export type VoteResult = 'BULL' | 'BEAR' | 'NEUTRAL' | 'SKIP';

export interface TechniqueVote {
  id: string;           // e.g. "T042"
  name: string;         // technique name from the list
  vote: VoteResult;
  score: number;        // 0.0 - 1.0 confidence of this technique's finding
  reason: string;       // short math-based reason e.g. "RSI=27 < 30 threshold"
  bullPoints?: number;
  bearPoints?: number;
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

function evaluateConditions(
  conditions: any[],
  ohlc: NumericOHLC[],
  closes: number[],
  last: number,
  getRSI: () => number[],
  getStoch: () => { k: number[], d: number[] },
  getMACD: () => { macd: number[], signal: number[], hist: number[] },
  getATR: () => number[],
  getBollinger: () => { upper: number[], middle: number[], lower: number[] },
  cache?: any
): { score: number, matched: number, reasons: string[] } {

  // Build a lookup for a candle by reference name
  function resolveCandle(ref: string): NumericOHLC | null {
    if (ref === 'current' || !ref || ref === 'any') return ohlc[last] ?? null;
    if (ref === 'prev')           return ohlc[last - 1] ?? null;
    if (ref === 'prev2')          return ohlc[last - 2] ?? null;
    return null;
  }

  // Build indicator snapshot at the last index
  function getFieldValue(field: string, candleRef: string): number | string | null {
    const rsiVals    = getRSI();
    const stochVals  = getStoch();
    const macdVals   = getMACD();
    const atrVals    = getATR();
    const bollVals   = getBollinger();
    const c          = resolveCandle(candleRef);

    if (!c) return null;

    const bodySize   = Math.abs(c.close - c.open);
    const totalRange = c.high - c.low || 1e-9;

    switch (field) {
      // OHLC
      case 'open':            return c.open;
      case 'high':            return c.high;
      case 'low':             return c.low;
      case 'close':           return c.close;
      case 'bodySize':        return bodySize;
      case 'totalRange':      return totalRange;
      case 'bodyRatio':       return bodySize / totalRange;
      case 'upperWick':       return c.high - Math.max(c.open, c.close);
      case 'lowerWick':       return Math.min(c.open, c.close) - c.low;
      case 'upperWickRatio':  return (c.high - Math.max(c.open, c.close)) / totalRange;
      case 'lowerWickRatio':  return (Math.min(c.open, c.close) - c.low) / totalRange;
      case 'direction':
        if (bodySize / totalRange < 0.05) return 'DOJI';
        return c.close > c.open ? 'BULL' : 'BEAR';

      // Oscillators
      case 'rsi':        return rsiVals[last] ?? null;
      case 'stochK':     return stochVals.k[last] ?? null;
      case 'stochD':     return stochVals.d[last] ?? null;
      case 'macdLine':   return macdVals.macd[last] ?? null;
      case 'macdSignal': return macdVals.signal[last] ?? null;
      case 'macdHist':   return macdVals.hist[last] ?? null;

      // EMAs
      case 'ema9': {
        const e = ema(closes, 9);
        return closes[last] - (e[last] ?? NaN);  // approximate: return close vs ema
      }
      case 'ema21': {
        const e = ema(closes, 21);
        return closes[last] - (e[last] ?? NaN);
      }

      // Volatility
      case 'atr':      return atrVals[last] ?? null;
      case 'bbUpper':  return bollVals.upper[last] ?? null;
      case 'bbMiddle': return bollVals.middle[last] ?? null;
      case 'bbLower':  return bollVals.lower[last] ?? null;
      case 'bbPct': {
        const u = bollVals.upper[last], l = bollVals.lower[last];
        if (!u || !l || u === l) return null;
        return (c.close - l) / (u - l);
      }
      case 'bbWidth': {
        const u = bollVals.upper[last], m = bollVals.middle[last], l = bollVals.lower[last];
        if (!m || m === 0) return null;
        return (u - l) / m;
      }

      // Delta fields
      case 'rsiDelta': {
        const r = rsiVals;
        if (isNaN(r[last]) || isNaN(r[last-1])) return null;
        return r[last] - r[last - 1];
      }
      case 'macdHistDelta': {
        const h = macdVals.hist;
        if (isNaN(h[last]) || isNaN(h[last-1])) return null;
        return h[last] - h[last - 1];
      }
      case 'stochKDelta': {
        const k = stochVals.k;
        if (isNaN(k[last]) || isNaN(k[last-1])) return null;
        return k[last] - k[last - 1];
      }
      case 'closeDelta': {
        if (last < 1) return null;
        return closes[last] - closes[last - 1];
      }

      case 'trend':
        return (cache as any).context?.trendState ?? null;

      case 'atSupport': {
        const yPct = (cache as any).context?.yPercent;
        if (yPct === null || yPct === undefined) return null;
        return yPct <= 20 ? true : false;
      }

      case 'atResistance': {
        const yPct = (cache as any).context?.yPercent;
        if (yPct === null || yPct === undefined) return null;
        return yPct >= 80 ? true : false;
      }

      default: return null;
    }
  }

  // Evaluate a single operator
  function applyOperator(
    fieldValue: number | string | null,
    operator: string,
    threshold: number | string,
    field: string,
    candleRef: string
  ): boolean {
    if (fieldValue === null || fieldValue === undefined) return false;
    if (typeof fieldValue === 'string') {
      // String fields only support == and !=
      if (operator === '==') return fieldValue === threshold;
      if (operator === '!=') return fieldValue !== threshold;
      return false;
    }
    const v = fieldValue as number;
    const t = threshold as number;
    if (isNaN(v)) return false;

    switch (operator) {
      case '<':   return v < t;
      case '>':   return v > t;
      case '<=':  return v <= t;
      case '>=':  return v >= t;
      case '==':  return v === t;
      case '!=':  return v !== t;
      case 'CROSS_UP': {
        // current[field] > threshold AND prev[field] <= threshold
        const cur  = getFieldValue(field, 'current') as number;
        const prev = getFieldValue(field, 'prev')    as number;
        if (cur === null || prev === null) return false;
        return cur > t && prev <= t;
      }
      case 'CROSS_DOWN': {
        const cur  = getFieldValue(field, 'current') as number;
        const prev = getFieldValue(field, 'prev')    as number;
        if (cur === null || prev === null) return false;
        return cur < t && prev >= t;
      }
      default: return false;
    }
  }

  let totalScore = 0;
  let matchedCount = 0;
  const reasons: string[] = [];

  for (const cond of conditions) {
    const fieldVal = getFieldValue(cond.field, cond.candle || 'current');
    const passed   = applyOperator(fieldVal, cond.operator, cond.value, cond.field, cond.candle);

    const condId = cond.id ? `[${cond.id}] ` : '';
    if (passed) {
      totalScore  += cond.weight ?? 1.0;
      matchedCount++;
      reasons.push(`${condId}${cond.field}=${typeof fieldVal === 'number' ? fieldVal.toFixed(3) : fieldVal} ${cond.operator} ${cond.value} ✓`);
    } else {
      reasons.push(`${condId}${cond.field}=${typeof fieldVal === 'number' ? fieldVal.toFixed(3) : fieldVal} ${cond.operator} ${cond.value} ✗`);
    }
  }

  return { score: totalScore, matched: matchedCount, reasons };
}

export function evaluateShard(
  shard: any[],
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
    let bullPoints = 0;
    let bearPoints = 0;

    if (typeof techItem === 'object' && techItem.callConditions) {
      // Evaluate CALL side
      const callResult = evaluateConditions(
        techItem.callConditions || [], ohlc, closes, last,
        getRSI, getStoch, getMACD, getATR, getBollinger,
        cache
      );
      
      // Evaluate PUT side
      const putResult = evaluateConditions(
        techItem.putConditions || [], ohlc, closes, last,
        getRSI, getStoch, getMACD, getATR, getBollinger,
        cache
      );

      const scoring = techItem.scoring || { minConditionsForSignal: 0, fullSignalThreshold: 0, halfSignalThreshold: 0, maxScore: 0 };

      // Determine CALL signal level
      let callVote: VoteResult = 'NEUTRAL';
      let callScore = 0;
      if (callResult.matched >= scoring.minConditionsForSignal &&
          callResult.score  >= scoring.fullSignalThreshold) {
        callVote  = 'BULL';
        callScore = callResult.score;
      } else if (callResult.score >= scoring.halfSignalThreshold) {
        callVote  = 'BULL';
        callScore = callResult.score * 0.5;
      }

      // Determine PUT signal level
      let putVote: VoteResult = 'NEUTRAL';
      let putScore = 0;
      if (putResult.matched >= scoring.minConditionsForSignal &&
          putResult.score   >= scoring.fullSignalThreshold) {
        putVote  = 'BEAR';
        putScore = putResult.score;
      } else if (putResult.score >= scoring.halfSignalThreshold) {
        putVote  = 'BEAR';
        putScore = putResult.score * 0.5;
      }

      // Winning direction
      if (callScore > putScore) {
        vote   = 'BULL';
        score  = callScore;
        reason = `CALL: ${callResult.reasons.filter(r => r.includes('✓')).join(' | ')}`;
      } else if (putScore > callScore) {
        vote   = 'BEAR';
        score  = putScore;
        reason = `PUT: ${putResult.reasons.filter(r => r.includes('✓')).join(' | ')}`;
      } else {
        vote   = 'NEUTRAL';
        score  = 0;
        reason = `CALL=${callResult.score.toFixed(2)} PUT=${putResult.score.toFixed(2)} — tied`;
      }

      bullPoints = vote === 'BULL' ? score : 0;
      bearPoints = vote === 'BEAR' ? score : 0;
    } else if (typeof techItem === 'object' && techItem.code) {
      try {
        const func = new Function('ohlc', 'closes', 'last', 'getRSI', 'getStoch', 'getMACD', 'getEmaSlope', 'getEmaCurvature', 'getATR', 'getBollinger', techItem.code);
        const res = func(ohlc, closes, last, getRSI, getStoch, getMACD, getEmaSlope, getEmaCurvature, getATR, getBollinger);
        
        if (res && typeof res === 'object') {
           vote = res.vote || 'NEUTRAL';
           score = res.score || 0;
           reason = res.reason || 'Executed user technique';
           bullPoints = res.bullPoints ?? (vote === 'BULL' ? score : 0);
           bearPoints = res.bearPoints ?? (vote === 'BEAR' ? score : 0);
        }
      } catch (err: any) {
        reason = `Code Exec Error: ${err.message}`;
      }
    } else {
      const canonical = resolveLibraryKey(rawName);
      const libFn = canonical ? TECHNIQUE_LIBRARY[canonical] : undefined;
      if (libFn) {
        const res = libFn(ohlc, cache, (cache as any).context);
        vote = res.vote;
        score = res.score;
        reason = res.reason;
        bullPoints = res.bullPoints;
        bearPoints = res.bearPoints;
      } else {
        vote = 'NEUTRAL';
        score = 0;
        reason = typeof techItem === 'object' 
          ? 'Technique has no executable conditions or code field.' 
          : `unknown technique "${rawName}"`;
      }
    }

    votes.push({
      id,
      name: rawName,
      vote,
      score,
      reason,
      bullPoints,
      bearPoints
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
