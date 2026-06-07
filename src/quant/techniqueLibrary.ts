import { NumericOHLC } from '../vision/pipeline';
import { IndicatorCache } from './techniqueShardEngine';
import { rsi, stochastic, macd, atr, bollinger, ema, sma } from './indicators';
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

export interface LibraryResult {
  vote: 'BULL' | 'BEAR' | 'NEUTRAL' | 'SKIP';
  score: number;
  bullPoints: number;
  bearPoints: number;
  reason: string;
}

// Helper to fill the cache if missing
export function ensureIndicators(ohlc: NumericOHLC[], cache: IndicatorCache) {
  const closes = cache.closes || (cache.closes = ohlc.map(c => c.close));
  if (!cache.rsiVals) cache.rsiVals = rsi(closes, 14);
  if (!cache.stochVals) {
    cache.stochVals = ohlc.length >= 14 ? stochastic(ohlc, 14, 3) : { k: Array(ohlc.length).fill(null), d: Array(ohlc.length).fill(null) };
  }
  if (!cache.macdVals) {
    const rawMacd = macd(closes, 12, 26, 9);
    cache.macdVals = {
      macd: rawMacd.macd || (rawMacd as any).line || [],
      signal: rawMacd.signal || [],
      hist: rawMacd.hist || (rawMacd as any).histogram || []
    };
  }
  if (!cache.emaSlope) cache.emaSlope = emaSlope(closes, 9);
  if (!cache.emaCurvature) cache.emaCurvature = emaCurvature(closes, 9);
  if (!cache.atrVals) cache.atrVals = atr(ohlc, 14);
  if (!cache.bollVals) {
    const rawBoll = bollinger(closes, 20, 2);
    cache.bollVals = {
      upper: rawBoll.upper || [],
      lower: rawBoll.lower || [],
      middle: rawBoll.middle || []
    };
  }
}

export type TechniqueLibraryFunction = (
  ohlc: NumericOHLC[],
  cache: IndicatorCache,
  context?: { trendState?: string; yPercent?: number }
) => LibraryResult;

function checkTwoCandlePatternConfirmation(ohlc: NumericOHLC[], direction: 'BULL' | 'BEAR'): boolean {
  if (ohlc.length < 3) return false;
  const current = ohlc[ohlc.length - 1];
  const patternCandle1 = ohlc[ohlc.length - 2];
  const patternCandle2 = ohlc[ohlc.length - 3];

  const body = Math.abs(current.close - current.open);
  const range = current.high - current.low || 1e-9;
  const solidBody = (body / range) >= 0.35;

  if (direction === 'BULL') {
    const patternHigh = Math.max(patternCandle1.high, patternCandle2.high);
    const isGreen = current.close > current.open;
    return isGreen && current.close > patternHigh && solidBody;
  } else {
    const patternLow = Math.min(patternCandle1.low, patternCandle2.low);
    const isRed = current.close < current.open;
    return isRed && current.close < patternLow && solidBody;
  }
}

function checkThreeCandlePatternConfirmation(ohlc: NumericOHLC[], direction: 'BULL' | 'BEAR'): boolean {
  if (ohlc.length < 1) return false;
  const current = ohlc[ohlc.length - 1];
  if (direction === 'BULL') {
    return current.close > current.open;
  } else {
    return current.close < current.open;
  }
}

function applyContextAndConfirmationGates(
  result: LibraryResult,
  ohlc: NumericOHLC[],
  contextValues: { trendState?: string; yPercent?: number } | undefined,
  direction: 'BULL' | 'BEAR',
  candlePatternType: 'SINGLE' | 'TWO_CANDLE' | 'THREE_CANDLE'
): LibraryResult {
  if (result.vote === 'SKIP' || result.vote === 'NEUTRAL') {
    return result;
  }

  let finalScore = result.score;
  let finalBullPoints = result.bullPoints;
  let finalBearPoints = result.bearPoints;
  let suffix = '';

  // A. Setup Context Gate (BUG #9)
  if (contextValues && contextValues.trendState !== undefined && contextValues.yPercent !== undefined) {
    const { trendState, yPercent } = contextValues;
    if (direction === 'BULL') {
      const isPerfect = trendState === 'DOWNTREND' && yPercent <= 30;
      const isValid = (trendState === 'RANGING' && yPercent <= 35) || yPercent <= 20;
      if (isPerfect) {
        finalScore = Math.min(1.0, finalScore * 1.25);
        if (result.vote === 'BULL') finalBullPoints *= 1.20;
        else finalBearPoints *= 1.20;
        suffix += ' [Perfect Reversal Setup]';
      } else if (!isValid) {
        finalScore *= 0.25;
        if (result.vote === 'BULL') finalBullPoints *= 0.25;
        else finalBearPoints *= 0.25;
        suffix += ' [Weak Context Neutered]';
      }
    } else if (direction === 'BEAR') {
      const isPerfect = trendState === 'UPTREND' && yPercent >= 70;
      const isValid = (trendState === 'RANGING' && yPercent >= 65) || yPercent >= 80;
      if (isPerfect) {
        finalScore = Math.min(1.0, finalScore * 1.25);
        if (result.vote === 'BULL') finalBullPoints *= 1.20;
        else finalBearPoints *= 1.20;
        suffix += ' [Perfect Reversal Setup]';
      } else if (!isValid) {
        finalScore *= 0.25;
        if (result.vote === 'BULL') finalBullPoints *= 0.25;
        else finalBearPoints *= 0.25;
        suffix += ' [Weak Context Neutered]';
      }
    }
  }

  // B. Confirmation Check (BUG #10)
  if (candlePatternType === 'TWO_CANDLE') {
    const isConfirmed = checkTwoCandlePatternConfirmation(ohlc, direction);
    if (!isConfirmed) {
      if (result.vote === 'BULL') finalBullPoints *= 0.60;
      else finalBearPoints *= 0.60;
      suffix += ' [Awaiting confirmation]';
    }
  } else if (candlePatternType === 'THREE_CANDLE') {
    const isConfirmed = checkThreeCandlePatternConfirmation(ohlc, direction);
    if (!isConfirmed) {
      if (result.vote === 'BULL') finalBullPoints *= 0.70;
      else finalBearPoints *= 0.70;
      suffix += ' [Awaiting confirmation]';
    }
  } else if (candlePatternType === 'SINGLE') {
    suffix += ' [Exposing recommendation: awaitsConfirmation=true]';
  }

  return {
    vote: result.vote,
    score: parseFloat(finalScore.toFixed(3)),
    bullPoints: parseFloat(finalBullPoints.toFixed(3)),
    bearPoints: parseFloat(finalBearPoints.toFixed(3)),
    reason: result.reason + suffix
  };
}

export const TECHNIQUE_LIBRARY: Record<string, TechniqueLibraryFunction> = {};

// ─── ALIAS TABLE ───────────────────────────────────────────────────────────
// Many users (and AI vibe-coding tools) spell patterns differently. This
// table maps normalized variants to the canonical library key.
const CANONICAL_ALIASES: Record<string, string> = {
  // RSI
  'rsibearishfade': 'rsioverbought',
  'rsibullishfade': 'rsioversold',
  'rsi30':          'rsioversold',
  'rsi70':          'rsioverbought',

  // Hammer family
  'bullishhammer':   'hammer',
  'hammercandle':    'hammer',
  'hammerpattern':   'hammer',
  'bearishhammer':   'hangingman',
  'hanging':         'hangingman',
  'hanger':          'hangingman',

  // Shooting Star / Inverted Hammer
  'bearishshootingstar': 'shootingstar',
  'shootingstarpattern': 'shootingstar',
  'invhammer':           'invertedhammer',

  // Doji family
  'standarddoji':       'doji',
  'normaldoji':         'doji',
  'dragonfly':          'dragonflydoji',
  'gravestone':         'gravestonedoji',
  'longleggeddo':       'longleggeddoji',
  'rickshawman':        'longleggeddoji',

  // Engulfing
  'bullishengulfing':   'engulfing',
  'bearishengulfing':   'engulfing',
  'engulfingpattern':   'engulfing',

  // Stars
  'bullishmorningstar': 'morningstar',
  'bearisheveningstar': 'eveningstar',
  'morning':            'morningstar',
  'evening':            'eveningstar',

  // Three soldiers/crows
  '3whitesoldiers':     'threewhitesoldiers',
  '3blackcrows':        'threeblackcrows',

  // Harami / Tweezer / Inside / Outside
  'bullishharami':      'harami',
  'bearishharami':      'harami',
  'tweezertopbear':     'tweezertop',
  'tweezerbottombull':  'tweezerbottom',
  'tweezer':            'tweezerbottom',
  'insidebarpattern':   'insidebar',
  'outsidebarpattern':  'outsidebar',
  'pinbarbull':         'pinbar',
  'pinbarbear':         'pinbar',

  // Marubozu
  'bullmarubozu':       'marubozu',
  'bearmarubozu':       'marubozu',

  // Continuation patterns
  'risingthree':        'risingthreemethods',
  'fallingthree':       'fallingthreemethods',
  'rising3':            'risingthreemethods',
  'falling3':           'fallingthreemethods',

  // Inside/Outside variants
  '3insideup':          'threeinsideup',
  '3insidedown':        'threeinsidedown',
  '3outsideup':         'threeoutsideup',
  '3outsidedown':       'threeoutsidedown',

  // Double pattern variants
  'doubletoppattern':    'doubletop',
  'doublebottompattern': 'doublebottom',

  // Belt hold / kicking
  'bullishbelthold':    'belthold',
  'bearishbelthold':    'belthold',
  'bullishkicking':     'kicking',
  'bearishkicking':     'kicking',

  // Spinning top
  'spinning':           'spinningtop',

  // Piercing / Dark cloud
  'piercing':           'piercingline',
  'darkcloud':          'darkcloudcover',
  'piercingpattern':    'piercingline',
};

// Exported helper for techniqueShardEngine to consult
export function resolveLibraryKey(rawName: string): string | null {
  const normalized = rawName.toLowerCase().replace(/[\s_\-.]/g, '');
  if (TECHNIQUE_LIBRARY[normalized])     return normalized;
  if (CANONICAL_ALIASES[normalized])     return CANONICAL_ALIASES[normalized];
  return null;
}
