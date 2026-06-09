import { NumericOHLC } from '../vision/pipeline';

function getBody(c: NumericOHLC) {
  return Math.abs(c.close - c.open);
}

function getUpperWick(c: NumericOHLC) {
  return c.high - Math.max(c.open, c.close);
}

function getLowerWick(c: NumericOHLC) {
  return Math.min(c.open, c.close) - c.low;
}

function getRange(c: NumericOHLC) {
  return c.high - c.low;
}

function isBullish(c: NumericOHLC) {
  return c.close > c.open;
}

function isBearish(c: NumericOHLC) {
  return c.close < c.open;
}

export function isHammer(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 1) return { match: false, score: 0 };
  const c = ohlc[ohlc.length - 1];
  const body  = getBody(c);
  const lw    = getLowerWick(c);
  const uw    = getUpperWick(c);
  const range = getRange(c);
  if (range === 0) return { match: false, score: 0 };

  // FIX 2: Guard against body being too small relative to range so Dragonfly Dojis don't trigger as Hammer.
  if (body === 0 || body < range * 0.01) return { match: false, score: 0 };

  const tol = range * 0.10;        // 10% of full range tolerance for upper wick
  const bodyInUpper60 = Math.min(c.open, c.close) >= c.low + range * 0.60;

  if (lw >= 1.8 * body && uw <= body + tol && bodyInUpper60) {
    const score = Math.min(1.0, lw / Math.max(2.0 * body, range * 0.1));
    return { match: true, score };
  }
  return { match: false, score: 0 };
}

export function isShootingStar(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 1) return { match: false, score: 0 };
  const c = ohlc[ohlc.length - 1];
  const body  = getBody(c);
  const lw    = getLowerWick(c);
  const uw    = getUpperWick(c);
  const range = getRange(c);
  if (range === 0) return { match: false, score: 0 };

  // FIX 2: Guard against body being too small relative to range so Dragonfly/Gravestone Dojis don't trigger as Shooting Star.
  if (body === 0 || body < range * 0.01) return { match: false, score: 0 };

  const tol = range * 0.10;        // 10% of full range tolerance for lower wick
  const bodyInLower40 = Math.max(c.open, c.close) <= c.low + range * 0.40;

  if (uw >= 1.8 * body && lw <= body + tol && bodyInLower40) {
    const score = Math.min(1.0, uw / Math.max(2.0 * body, range * 0.1));
    return { match: true, score };
  }
  return { match: false, score: 0 };
}

export function isDoji(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 1) return { match: false, score: 0 };
  const c = ohlc[ohlc.length - 1];
  const body = getBody(c);
  const range = getRange(c);

  if (range === 0) return { match: false, score: 0 };

  if (body <= 0.1 * range) {
    const score = Math.max(0, Math.min(1.0, 1.0 - (body / (0.1 * range))));
    return { match: true, score };
  }
  return { match: false, score: 0 };
}

export function isEngulfing(ohlc: NumericOHLC[]): { bullish: boolean; bearish: boolean; score: number } {
  if (ohlc.length < 2) return { bullish: false, bearish: false, score: 0 };
  const c1 = ohlc[ohlc.length - 2];
  const c2 = ohlc[ohlc.length - 1];

  const body1 = getBody(c1);
  const body2 = getBody(c2);

  const engulfs = Math.max(c2.open, c2.close) >= Math.max(c1.open, c1.close) &&
                  Math.min(c2.open, c2.close) <= Math.min(c1.open, c1.close) &&
                  body2 > body1;

  if (engulfs && isBearish(c1) && isBullish(c2)) {
    // FIX 4: Floor body1 to at least 2% of range1 to prevent division-by-near-zero score inflation with dojis.
    const range1 = getRange(c1);
    const flooredBody1 = Math.max(body1, range1 * 0.02);
    return { bullish: true, bearish: false, score: Math.min(1.0, body2 / (flooredBody1 * 1.5)) };
  }
  if (engulfs && isBullish(c1) && isBearish(c2)) {
    // FIX 4: Floor body1 to at least 2% of range1 to prevent division-by-near-zero score inflation with dojis.
    const range1 = getRange(c1);
    const flooredBody1 = Math.max(body1, range1 * 0.02);
    return { bullish: false, bearish: true, score: Math.min(1.0, body2 / (flooredBody1 * 1.5)) };
  }

  return { bullish: false, bearish: false, score: 0 };
}

export function isMorningStar(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 3) return { match: false, score: 0 };
  const c1 = ohlc[ohlc.length - 3];
  const c2 = ohlc[ohlc.length - 2];
  const c3 = ohlc[ohlc.length - 1];

  if (isBearish(c1) && getBody(c1) > getRange(c1) * 0.5) {
    if (getBody(c2) < getRange(c2) * 0.3 && Math.max(c2.open, c2.close) < Math.min(c1.open, c1.close)) {
      if (isBullish(c3) && c3.close > c1.close + getBody(c1) * 0.5) {
        // FIX 3: Soft check for C2->C3 gap (c3.open > max of c2.open, c2.close). Lower score to 0.65 if gap is absent.
        const hasGap = c3.open > Math.max(c2.open, c2.close);
        const score = hasGap ? 0.85 : 0.65;
        return { match: true, score };
      }
    }
  }
  return { match: false, score: 0 };
}

export function isEveningStar(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 3) return { match: false, score: 0 };
  const c1 = ohlc[ohlc.length - 3];
  const c2 = ohlc[ohlc.length - 2];
  const c3 = ohlc[ohlc.length - 1];

  if (isBullish(c1) && getBody(c1) > getRange(c1) * 0.5) {
    if (getBody(c2) < getRange(c2) * 0.3 && Math.min(c2.open, c2.close) > Math.max(c1.open, c1.close)) {
      if (isBearish(c3) && c3.close < c1.open + getBody(c1) * 0.5) {
        // FIX 3: Soft check for C2->C3 gap (c3.open < min of c2.open, c2.close). Lower score to 0.65 if gap is absent.
        const hasGap = c3.open < Math.min(c2.open, c2.close);
        const score = hasGap ? 0.85 : 0.65;
        return { match: true, score };
      }
    }
  }
  return { match: false, score: 0 };
}

export function isMarubozu(ohlc: NumericOHLC[]): { bullish: boolean; bearish: boolean; score: number } {
  if (ohlc.length < 1) return { bullish: false, bearish: false, score: 0 };
  const c = ohlc[ohlc.length - 1];
  const body = getBody(c);
  const lw = getLowerWick(c);
  const uw = getUpperWick(c);
  const range = getRange(c);

  if (body === 0 || range === 0) return { bullish: false, bearish: false, score: 0 };

  if (uw <= range * 0.07 && lw <= range * 0.07) {
    const score = Math.max(0, Math.min(1.0, 1.0 - ((uw + lw) / range)));
    if (isBullish(c)) return { bullish: true, bearish: false, score };
    if (isBearish(c)) return { bullish: false, bearish: true, score };
  }
  return { bullish: false, bearish: false, score: 0 };
}

export function isPiercingLine(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 2) return { match: false, score: 0 };
  const c1 = ohlc[ohlc.length - 2];
  const c2 = ohlc[ohlc.length - 1];

  if (isBearish(c1) && isBullish(c2)) {
    if (c2.open < c1.low && c2.close > (c1.open + c1.close) / 2 && c2.close < c1.open) {
      const c1Mid = (c1.open + c1.close) / 2;
      const score = Math.max(0, Math.min(1.0, (c2.close - c1Mid) / (c1.open - c1Mid)));
      return { match: true, score };
    }
  }
  return { match: false, score: 0 };
}

export function isDarkCloudCover(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 2) return { match: false, score: 0 };
  const c1 = ohlc[ohlc.length - 2];
  const c2 = ohlc[ohlc.length - 1];

  if (isBullish(c1) && isBearish(c2)) {
    if (c2.open > c1.high && c2.close < (c1.open + c1.close) / 2 && c2.close > c1.open) {
      const c1Mid = (c1.open + c1.close) / 2;
      const score = Math.max(0, Math.min(1.0, (c1Mid - c2.close) / (c1Mid - c1.open)));
      return { match: true, score };
    }
  }
  return { match: false, score: 0 };
}

export function isThreeWhiteSoldiers(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 3) return { match: false, score: 0 };
  const c1 = ohlc[ohlc.length - 3];
  const c2 = ohlc[ohlc.length - 2];
  const c3 = ohlc[ohlc.length - 1];

  if (isBullish(c1) && isBullish(c2) && isBullish(c3)) {
    if (c2.close > c1.close && c3.close > c2.close) {
      if (c2.open >= c1.open && c2.open <= c1.close && c3.open >= c2.open && c3.open <= c2.close) {
        return { match: true, score: 0.9 };
      }
    }
  }
  return { match: false, score: 0 };
}

export function isThreeBlackCrows(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 3) return { match: false, score: 0 };
  const c1 = ohlc[ohlc.length - 3];
  const c2 = ohlc[ohlc.length - 2];
  const c3 = ohlc[ohlc.length - 1];

  if (isBearish(c1) && isBearish(c2) && isBearish(c3)) {
    if (c2.close < c1.close && c3.close < c2.close) {
      if (c2.open <= c1.open && c2.open >= c1.close && c3.open <= c2.open && c3.open >= c2.close) {
        return { match: true, score: 0.9 };
      }
    }
  }
  return { match: false, score: 0 };
}

export function isInsideBar(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 2) return { match: false, score: 0 };
  const c1 = ohlc[ohlc.length - 2];
  const c2 = ohlc[ohlc.length - 1];

  if (c2.high < c1.high && c2.low > c1.low) {
    return { match: true, score: 1.0 };
  }
  return { match: false, score: 0 };
}

export function isPinBar(ohlc: NumericOHLC[]): { bull: boolean; bear: boolean; score: number } {
  if (ohlc.length < 1) return { bull: false, bear: false, score: 0 };
  const c = ohlc[ohlc.length - 1];
  const body = getBody(c);
  const lw = getLowerWick(c);
  const uw = getUpperWick(c);
  const range = getRange(c);

  if (range === 0) return { bull: false, bear: false, score: 0 };

  const totalWick = lw + uw;

  if (totalWick >= (2/3) * range) {
    // Body in upper third
    if (Math.min(c.open, c.close) >= c.low + (range * 0.6)) {
        return { bull: true, bear: false, score: Math.min(1.0, lw / (2.0 * (body || 0.001))) };
    }
    // Body in lower third
    if (Math.max(c.open, c.close) <= c.low + (range * 0.4)) {
        return { bull: false, bear: true, score: Math.min(1.0, uw / (2.0 * (body || 0.001))) };
    }
  }
  return { bull: false, bear: false, score: 0 };
}

export function isHarami(ohlc: NumericOHLC[]): { bullish: boolean; bearish: boolean; score: number } {
  if (ohlc.length < 2) return { bullish: false, bearish: false, score: 0 };
  const c1 = ohlc[ohlc.length - 2];
  const c2 = ohlc[ohlc.length - 1];

  const body1 = getBody(c1);
  const body2 = getBody(c2);

  if (body1 === 0) return { bullish: false, bearish: false, score: 0 };

  const inside = Math.max(c2.open, c2.close) < Math.max(c1.open, c1.close) &&
                 Math.min(c2.open, c2.close) > Math.min(c1.open, c1.close);

  if (inside) {
      const score = Math.max(0, Math.min(1.0, 1.0 - (body2 / body1)));
      if (isBearish(c1) && isBullish(c2)) return { bullish: true, bearish: false, score };
      if (isBullish(c1) && isBearish(c2)) return { bullish: false, bearish: true, score };
  }
  return { bullish: false, bearish: false, score: 0 };
}

export function isTweezerTop(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 2) return { match: false, score: 0 };
  const c1 = ohlc[ohlc.length - 2];
  const c2 = ohlc[ohlc.length - 1];

  if (isBullish(c1) && isBearish(c2)) {
      const diff = Math.abs(c1.high - c2.high);
      // FIX 5: Change tolerance from 0.001 (0.1%) to 0.003 (0.3%) for practical market conditions.
      if (diff / c1.high <= 0.003) {
          const score = Math.max(0, Math.min(1.0, 1.0 - (diff / c1.high) / 0.003));
          return { match: true, score };
      }
  }
  return { match: false, score: 0 };
}

export function isTweezerBottom(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 2) return { match: false, score: 0 };
  const c1 = ohlc[ohlc.length - 2];
  const c2 = ohlc[ohlc.length - 1];

  if (isBearish(c1) && isBullish(c2)) {
      const diff = Math.abs(c1.low - c2.low);
      // FIX 5: Change tolerance from 0.001 (0.1%) to 0.003 (0.3%) for practical market conditions.
      if (diff / c1.low <= 0.003) {
          const score = Math.max(0, Math.min(1.0, 1.0 - (diff / c1.low) / 0.003));
          return { match: true, score };
      }
  }
  return { match: false, score: 0 };
}
export function isOutsideBar(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 2) return { match: false, score: 0 };
  const c1 = ohlc[ohlc.length - 2];
  const c2 = ohlc[ohlc.length - 1];

  if (c2.high > c1.high && c2.low < c1.low) {
    return { match: true, score: 1.0 };
  }
  return { match: false, score: 0 };
}

export function isHigherHighs(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 5) return { match: false, score: 0 };
  for (let i = ohlc.length - 4; i < ohlc.length; i++) {
      // FIX 1: Compare candle highs instead of close prices to identify correct market structure.
      if (ohlc[i].high <= ohlc[i - 1].high) {
          return { match: false, score: 0 };
      }
  }
  return { match: true, score: 1.0 };
}

export function isLowerLows(ohlc: NumericOHLC[]): { match: boolean; score: number } {
  if (ohlc.length < 5) return { match: false, score: 0 };
  for (let i = ohlc.length - 4; i < ohlc.length; i++) {
      // FIX 1: Compare candle lows instead of close prices to identify correct market structure.
      if (ohlc[i].low >= ohlc[i - 1].low) {
          return { match: false, score: 0 };
      }
  }
  return { match: true, score: 1.0 };
}
