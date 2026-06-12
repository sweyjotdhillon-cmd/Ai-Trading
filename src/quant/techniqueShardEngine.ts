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
    rsiPeriod?: number;
    stochPeriod?: number;
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
    if (ref === 'prev3')          return ohlc[last - 3] ?? null;
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
      case 'isDoji':          return (bodySize / totalRange) < 0.05 ? 1 : 0;
      case 'isHammer': {
        const lw = Math.min(c.open, c.close) - c.low;
        const uw = c.high - Math.max(c.open, c.close);
        return (lw > bodySize * 2 && uw < bodySize * 0.5) ? 1 : 0;
      }
      case 'isShootingStar': {
        const lw = Math.min(c.open, c.close) - c.low;
        const uw = c.high - Math.max(c.open, c.close);
        return (uw > bodySize * 2 && lw < bodySize * 0.5) ? 1 : 0;
      }
      case 'isBullCandle':    return c.close > c.open ? 1 : 0;
      case 'isBearCandle':    return c.close < c.open ? 1 : 0;
      case 'isMarubozu':      return (bodySize / totalRange) > 0.90 ? 1 : 0;
      case 'volume':          return (c as any).volume ?? null; // volume and volumeSpike will return null until stockPriceFeed.ts passes volume in OHLCV — fields are ready for when feed supports it
      case 'volumeSpike': {
        const volumes = ohlc.map(x => (x as any).volume ?? 0);
        const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        return avgVol > 0 ? ((c as any).volume ?? 0) / avgVol : null;
      }
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
        return e[last] ?? null;
      }
      case 'ema21': {
        const e = ema(closes, 21);
        return e[last] ?? null;
      }
      case 'ema9Delta': {
        const e = ema(closes, 9);
        return closes[last] - (e[last] ?? NaN);
      }
      case 'ema21Delta': {
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
        const cur  = getFieldValue(field, candleRef) as number;
        const prevRef = candleRef === 'current' ? 'prev' : candleRef === 'prev' ? 'prev2' : candleRef === 'prev2' ? 'prev3' : 'prev';
        const prev = getFieldValue(field, prevRef)    as number;
        if (cur === null || prev === null) return false;
        return cur > t && prev <= t;
      }
      case 'CROSS_DOWN': {
        const cur  = getFieldValue(field, candleRef) as number;
        const prevRef = candleRef === 'current' ? 'prev' : candleRef === 'prev' ? 'prev2' : candleRef === 'prev2' ? 'prev3' : 'prev';
        const prev = getFieldValue(field, prevRef)    as number;
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
): { votes: TechniqueVote[], deadTechniques: string[] } {
  const votes: TechniqueVote[] = [];
  const deadTechniques: string[] = [];

  const closes = cache.closes || (cache.closes = ohlc.map(c => c.close));
  const last = closes.length - 1;

  // Memoize indicators globally across shards
  const getRSI = () => cache.rsiVals || (cache.rsiVals = rsi(closes, cache.rsiPeriod ?? 14));
  const getStoch = () => cache.stochVals || (cache.stochVals = stochastic(ohlc, cache.stochPeriod ?? 14, 3));
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
      const bullResult = evaluateConditions(
        techItem.callConditions || [], ohlc, closes, last,
        getRSI, getStoch, getMACD, getATR, getBollinger,
        cache
      );
      
      // Evaluate BEAR side
      const bearResult = evaluateConditions(
        techItem.putConditions || [], ohlc, closes, last,
        getRSI, getStoch, getMACD, getATR, getBollinger,
        cache
      );

      const scoring = techItem.scoring || { minConditionsForSignal: 0, fullSignalThreshold: 0, halfSignalThreshold: 0, maxScore: 0 };

      // Determine BULL signal level
      let bullVote: VoteResult = 'NEUTRAL';
      let bullScore = 0;
      if (bullResult.matched >= scoring.minConditionsForSignal &&
          bullResult.score  >= scoring.fullSignalThreshold) {
        bullVote  = 'BULL';
        bullScore = bullResult.score;
      } else if (bullResult.score >= scoring.halfSignalThreshold && bullResult.matched >= Math.ceil((scoring.minConditionsForSignal || 1) * 0.5)) {
        bullVote  = 'BULL';
        bullScore = bullResult.score * 0.5;
      }

      // Determine BEAR signal level
      let bearVote: VoteResult = 'NEUTRAL';
      let bearScore = 0;
      if (bearResult.matched >= scoring.minConditionsForSignal &&
          bearResult.score   >= scoring.fullSignalThreshold) {
        bearVote  = 'BEAR';
        bearScore = bearResult.score;
      } else if (bearResult.score >= scoring.halfSignalThreshold && bearResult.matched >= Math.ceil((scoring.minConditionsForSignal || 1) * 0.5)) {
        bearVote  = 'BEAR';
        bearScore = bearResult.score * 0.5;
      }

      // Winning direction
      if (bullScore > bearScore) {
        vote   = 'BULL';
        score  = bullScore;
        reason = `BULL: ${bullResult.reasons.filter(r => r.includes('✓')).join(' | ')}`;
      } else if (bearScore > bullScore) {
        vote   = 'BEAR';
        score  = bearScore;
        reason = `BEAR: ${bearResult.reasons.filter(r => r.includes('✓')).join(' | ')}`;
      } else {
        vote   = 'NEUTRAL';
        score  = 0;
        reason = `BULL=${bullResult.score.toFixed(2)} BEAR=${bearResult.score.toFixed(2)} — tied`;
      }

      bullPoints = vote === 'BULL' ? score : 0;
      bearPoints = vote === 'BEAR' ? score : 0;
    } else if (typeof techItem === 'object' && techItem.code) {
      let timedOut = false;
      const timeoutId = setTimeout(() => { timedOut = true; }, 200); // TODO: replace with SharedArrayBuffer interrupt for true infinite-loop protection
      try {
        const func = new Function('ohlc', 'closes', 'last', 'getRSI', 'getStoch', 'getMACD', 'getEmaSlope', 'getEmaCurvature', 'getATR', 'getBollinger', techItem.code);
        const res = func(ohlc, closes, last, getRSI, getStoch, getMACD, getEmaSlope, getEmaCurvature, getATR, getBollinger);
        
        clearTimeout(timeoutId);
        if (timedOut) throw new Error('Execution timeout exceeded 200ms');

        if (res && typeof res === 'object') {
           vote = res.vote || 'NEUTRAL';
           score = res.score || 0;
           reason = res.reason || 'Executed user technique';
           bullPoints = res.bullPoints ?? (vote === 'BULL' ? score : 0);
           bearPoints = res.bearPoints ?? (vote === 'BEAR' ? score : 0);
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        vote = 'NEUTRAL';
        score = 0;
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
        vote = 'SKIP';
        score = 0;
        reason = typeof techItem === 'object' 
          ? 'Technique has no executable conditions or code field.' 
          : `unknown technique "${rawName}"`;
        if (reason.includes('no executable conditions')) {
          deadTechniques.push(rawName);
        }
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

  return { votes, deadTechniques };
}
