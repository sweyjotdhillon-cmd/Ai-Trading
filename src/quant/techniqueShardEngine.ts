import { NumericOHLC } from '../vision/pipeline';

import { rsi, stochastic, macd, atr, bollinger } from './indicators';
import { emaSlope, emaCurvature } from './calculus';
import {
  isHammer,
  isShootingStar,
  isDoji,
  isEngulfing,
  isMorningStar,
  isEveningStar,
  isMarubozu,
  isPiercingLine,
  isDarkCloudCover,
  isThreeWhiteSoldiers,
  isThreeBlackCrows,
  isInsideBar,
  isPinBar,
  isHarami,
  isTweezerTop,
  isTweezerBottom,
  isOutsideBar,
  isHigherHighs,
  isLowerLows
} from './candleGeometry';

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

export function shardTechniques(list: string[], shardSize = 15): string[][] {
  const shards: string[][] = [];
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
    const rawName = shard[i];
    const key = normalizeKey(rawName);
    const id = `T${(shardOffset + i + 1).toString().padStart(3, '0')}`;

    let vote: VoteResult = 'NEUTRAL';
    let score = 0;
    let reason = 'no_match';

    switch (key) {
      // Candlestick Geometries
      case 'hammer':
      case 'pinbullbull':
      case 'pinbarbull': {
        const res = isHammer(ohlc);
        if (res.match) { vote = 'BULL'; score = res.score; reason = 'hammer geometry'; }
        else {
            const pb = isPinBar(ohlc);
            if (pb.bull) { vote = 'BULL'; score = pb.score; reason = 'bull pin bar'; }
        }
        break;
      }
      case 'shootingstar':
      case 'pinbear':
      case 'pinbarbear': {
        const res = isShootingStar(ohlc);
        if (res.match) { vote = 'BEAR'; score = res.score; reason = 'shooting star geometry'; }
        else {
            const pb = isPinBar(ohlc);
            if (pb.bear) { vote = 'BEAR'; score = pb.score; reason = 'bear pin bar'; }
        }
        break;
      }
      case 'doji': {
        const res = isDoji(ohlc);
        if (res.match) { vote = 'NEUTRAL'; score = res.score; reason = 'doji geometry'; }
        break;
      }
      case 'bullishengulfing': {
        const res = isEngulfing(ohlc);
        if (res.bullish) { vote = 'BULL'; score = res.score; reason = 'bullish engulfing'; }
        break;
      }
      case 'bearishengulfing': {
        const res = isEngulfing(ohlc);
        if (res.bearish) { vote = 'BEAR'; score = res.score; reason = 'bearish engulfing'; }
        break;
      }
      case 'morningstar': {
        const res = isMorningStar(ohlc);
        if (res.match) { vote = 'BULL'; score = res.score; reason = 'morning star pattern'; }
        break;
      }
      case 'eveningstar': {
        const res = isEveningStar(ohlc);
        if (res.match) { vote = 'BEAR'; score = res.score; reason = 'evening star pattern'; }
        break;
      }
      case 'bullishmarubozu':
      case 'marubozubull': {
        const res = isMarubozu(ohlc);
        if (res.bullish) { vote = 'BULL'; score = res.score; reason = 'bullish marubozu'; }
        break;
      }
      case 'bearishmarubozu':
      case 'marubozubear': {
        const res = isMarubozu(ohlc);
        if (res.bearish) { vote = 'BEAR'; score = res.score; reason = 'bearish marubozu'; }
        break;
      }
      case 'piercingline':
      case 'piercing': {
        const res = isPiercingLine(ohlc);
        if (res.match) { vote = 'BULL'; score = res.score; reason = 'piercing line geometry'; }
        break;
      }
      case 'darkcloudcover':
      case 'darkcloud': {
        const res = isDarkCloudCover(ohlc);
        if (res.match) { vote = 'BEAR'; score = res.score; reason = 'dark cloud cover geometry'; }
        break;
      }
      case 'threewhitesoldiers': {
        const res = isThreeWhiteSoldiers(ohlc);
        if (res.match) { vote = 'BULL'; score = res.score; reason = 'three white soldiers'; }
        break;
      }
      case 'threeblackcrows': {
        const res = isThreeBlackCrows(ohlc);
        if (res.match) { vote = 'BEAR'; score = res.score; reason = 'three black crows'; }
        break;
      }
      case 'insidebar': {
        const res = isInsideBar(ohlc);
        if (res.match) { vote = 'NEUTRAL'; score = res.score; reason = 'inside bar consolidation'; }
        break;
      }
      case 'outsidebar': {
        const res = isOutsideBar(ohlc);
        if (res.match) { vote = 'NEUTRAL'; score = res.score; reason = 'outside bar expansion'; }
        break;
      }
      case 'bullishharami': {
        const res = isHarami(ohlc);
        if (res.bullish) { vote = 'BULL'; score = res.score; reason = 'bullish harami'; }
        break;
      }
      case 'bearishharami': {
        const res = isHarami(ohlc);
        if (res.bearish) { vote = 'BEAR'; score = res.score; reason = 'bearish harami'; }
        break;
      }
      case 'tweezerbtop':
      case 'tweezertop': {
        const res = isTweezerTop(ohlc);
        if (res.match) { vote = 'BEAR'; score = res.score; reason = 'tweezer top resistance'; }
        break;
      }
      case 'tweezerbottom':
      case 'tweezerbot': {
        const res = isTweezerBottom(ohlc);
        if (res.match) { vote = 'BULL'; score = res.score; reason = 'tweezer bottom support'; }
        break;
      }
      case 'higherhighs':
      case 'hh': {
        const res = isHigherHighs(ohlc);
        if (res.match) { vote = 'BULL'; score = res.score; reason = 'higher highs trend'; }
        break;
      }
      case 'lowerlows':
      case 'll': {
        const res = isLowerLows(ohlc);
        if (res.match) { vote = 'BEAR'; score = res.score; reason = 'lower lows trend'; }
        break;
      }

      // Indicators
      case 'rsioversold':
      case 'rsilow': {
        const rsiArr = getRSI();
        const rsiLast = rsiArr[last];
        if (rsiLast < 30) {
          vote = 'BULL';
          score = Math.min(1.0, (30 - rsiLast) / 30);
          reason = `RSI=${rsiLast.toFixed(1)} < 30`;
        }
        break;
      }
      case 'rsioverbought':
      case 'rsihigh': {
        const rsiArr = getRSI();
        const rsiLast = rsiArr[last];
        if (rsiLast > 70) {
          vote = 'BEAR';
          score = Math.min(1.0, (rsiLast - 70) / 30);
          reason = `RSI=${rsiLast.toFixed(1)} > 70`;
        }
        break;
      }
      case 'rsidivergence': {
        const rsiArr = getRSI();
        const r1 = rsiArr[last - 1];
        const r2 = rsiArr[last];
        const c1 = closes[last - 1];
        const c2 = closes[last];

        if (c2 < c1 && r2 > r1) {
            vote = 'BULL';
            score = 0.8;
            reason = 'bullish RSI divergence';
        } else if (c2 > c1 && r2 < r1) {
            vote = 'BEAR';
            score = 0.8;
            reason = 'bearish RSI divergence';
        }
        break;
      }
      case 'stochoversold':
      case 'stochlow': {
        const stoch = getStoch();
        const k = stoch.k[last];
        if (k < 20) {
            vote = 'BULL';
            score = Math.min(1.0, (20 - k) / 20);
            reason = `StochK=${k.toFixed(1)} < 20`;
        }
        break;
      }
      case 'stochoverbought':
      case 'stochhigh': {
        const stoch = getStoch();
        const k = stoch.k[last];
        if (k > 80) {
            vote = 'BEAR';
            score = Math.min(1.0, (k - 80) / 20);
            reason = `StochK=${k.toFixed(1)} > 80`;
        }
        break;
      }
      case 'stochcross':
      case 'stochgoldencross': {
        const stoch = getStoch();
        if (stoch.k[last] > stoch.d[last] && stoch.k[last - 1] <= stoch.d[last - 1]) {
            vote = 'BULL';
            score = 0.8;
            reason = 'Stoch %K crossed above %D';
        }
        break;
      }
      case 'macdcross':
      case 'macdgoldencross': {
        const macdData = getMACD();
        if (macdData.macd[last] > macdData.signal[last] && macdData.macd[last - 1] <= macdData.signal[last - 1]) {
            vote = 'BULL';
            score = 0.8;
            reason = 'MACD crossed above signal';
        }
        break;
      }
      case 'macddcross':
      case 'macddeathcross': {
        const macdData = getMACD();
        if (macdData.macd[last] < macdData.signal[last] && macdData.macd[last - 1] >= macdData.signal[last - 1]) {
            vote = 'BEAR';
            score = 0.8;
            reason = 'MACD crossed below signal';
        }
        break;
      }
      case 'macddivergence': {
        const macdData = getMACD();
        const m1 = macdData.macd[last - 1];
        const m2 = macdData.macd[last];
        const c1 = closes[last - 1];
        const c2 = closes[last];

        if (c2 > c1 && m2 < m1) {
            vote = 'BEAR';
            score = 0.8;
            reason = 'bearish MACD divergence';
        } else if (c2 < c1 && m2 > m1) {
            vote = 'BULL';
            score = 0.8;
            reason = 'bullish MACD divergence';
        }
        break;
      }
      case 'emaslopeup':
      case 'ematrendingup': {
        const slope = getEmaSlope();
        if (slope[last] > 0 && slope[last - 1] > 0 && slope[last - 2] > 0) {
            vote = 'BULL';
            score = 0.7;
            reason = 'EMA slope positive 3 bars';
        }
        break;
      }
      case 'emaslopedown':
      case 'ematrendingdown': {
        const slope = getEmaSlope();
        if (slope[last] < 0 && slope[last - 1] < 0 && slope[last - 2] < 0) {
            vote = 'BEAR';
            score = 0.7;
            reason = 'EMA slope negative 3 bars';
        }
        break;
      }
      case 'emacurvaturepositive': {
        const curve = getEmaCurvature();
        if (curve[last] > 0) {
            vote = 'BULL';
            score = 0.6;
            reason = 'EMA curvature positive';
        }
        break;
      }
      case 'emacurvaturenegative': {
        const curve = getEmaCurvature();
        if (curve[last] < 0) {
            vote = 'BEAR';
            score = 0.6;
            reason = 'EMA curvature negative';
        }
        break;
      }
      case 'atrexpanding': {
        const atrData = getATR();
        if (last >= 5 && atrData[last] > atrData[last - 5] * 1.2) {
            vote = 'NEUTRAL';
            score = 0.8;
            reason = 'ATR expanded >20% in 5 bars';
        }
        break;
      }
      case 'atrcontracting': {
        const atrData = getATR();
        if (last >= 5 && atrData[last] < atrData[last - 5] * 0.8) {
            vote = 'NEUTRAL';
            score = 0.8;
            reason = 'ATR contracted >20% in 5 bars';
        }
        break;
      }
      case 'bollingersqueeze': {
        const bb = getBollinger();
        const bw = (bb.upper[last] - bb.lower[last]) / bb.middle[last];
        if (bw < 0.02) {
            vote = 'NEUTRAL';
            score = 0.9;
            reason = `BB bandwidth ${bw.toFixed(3)} < 0.02`;
        }
        break;
      }
      case 'bollingerbreakoutup': {
        const bb = getBollinger();
        if (closes[last] > bb.upper[last]) {
            vote = 'BULL';
            score = 0.85;
            reason = 'Close above BB upper band';
        }
        break;
      }
      case 'bollingerbreakoutdown': {
        const bb = getBollinger();
        if (closes[last] < bb.lower[last]) {
            vote = 'BEAR';
            score = 0.85;
            reason = 'Close below BB lower band';
        }
        break;
      }
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

): Promise<{
  votes: TechniqueVote[];
  proofTokens: string;
  bullVotes: number;
  bearVotes: number;
  neutralVotes: number;
  totalEvaluated: number;
}> {
  const shards = shardTechniques(techniquesList, 15);

  const cache: IndicatorCache = {};
  const shardPromises = shards.map((shard, i) => {
    // In a real multi-threading setup, this would dispatch to a Worker
    // For now, we simulate async evaluation wrapping synchronous math
    return new Promise<TechniqueVote[]>((resolve) => {
      resolve(evaluateShard(shard, ohlcSeries, i * 15, cache));
    });
  });

  const results = await Promise.all(shardPromises);
  const votes = results.flat();

  let bullVotes = 0;
  let bearVotes = 0;
  let neutralVotes = 0;
  const proofTokensArr: string[] = [];

  for (const v of votes) {
    if (v.vote === 'BULL' && v.score > 0) bullVotes++;
    else if (v.vote === 'BEAR' && v.score > 0) bearVotes++;
    else neutralVotes++;

    proofTokensArr.push(`${v.id}:${v.vote}:${v.score.toFixed(2)}`);
  }

  return {
    votes,
    proofTokens: proofTokensArr.join(' '),
    bullVotes,
    bearVotes,
    neutralVotes,
    totalEvaluated: votes.length
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
