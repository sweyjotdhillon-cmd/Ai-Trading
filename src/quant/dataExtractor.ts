import { rsi, macd, bollinger, atr, stochastic, ema } from './indicators';
import { NumericOHLC } from '../vision/pipeline';
import { emaSlope } from './calculus';
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
  isOutsideBar
} from './candleGeometry';

export function extractChartJSON(ohlcSeries: NumericOHLC[], chartTimeframe: string, durationMinutes: number, _incidents: any[] = []) {
  const closes = ohlcSeries.map(c => c.close);
  const highs = ohlcSeries.map(c => c.high);
  const lows = ohlcSeries.map(c => c.low);

  const rsiVals = ohlcSeries.length >= 14 ? rsi(closes, 14) : Array(ohlcSeries.length).fill(null);
  const macdVals: any = ohlcSeries.length >= 26 ? macd(closes) : { macd: Array(ohlcSeries.length).fill(null), signal: Array(ohlcSeries.length).fill(null), hist: Array(ohlcSeries.length).fill(null) };
  const stochVals = ohlcSeries.length >= 14 ? stochastic(ohlcSeries, 14, 3) : { k: Array(ohlcSeries.length).fill(null), d: Array(ohlcSeries.length).fill(null) };
  const bbVals = ohlcSeries.length >= 20 ? bollinger(closes, 20) : { upper: Array(ohlcSeries.length).fill(null), lower: Array(ohlcSeries.length).fill(null), middle: Array(ohlcSeries.length).fill(null), width: Array(ohlcSeries.length).fill(null) };
  const atrVals = ohlcSeries.length >= 14 ? atr(ohlcSeries, 14) : Array(ohlcSeries.length).fill(null);

  const ema9 = ohlcSeries.length >= 9 ? ema(closes, 9) : Array(ohlcSeries.length).fill(null);
  const ema21 = ohlcSeries.length >= 21 ? ema(closes, 21) : Array(ohlcSeries.length).fill(null);

  const meta = {
    totalCandlesVisible: ohlcSeries.length,
    chartTimeframe: chartTimeframe || null,
    hasRSIPanel: rsiVals.some(v => v !== null && v !== 0),
    hasMACDPanel: macdVals && macdVals.macd && macdVals.macd.some((v: number) => v !== null && v !== 0),
    hasStochPanel: stochVals && stochVals.k && stochVals.k.some((v: number) => v !== null && v !== 0),
    hasVolumePanel: false, // Dataset mathematically does not carry volume indicators
    yAxisReadable: true
  };

  const focusCount = durationMinutes === 3 ? 3 : durationMinutes === 5 ? 5 : durationMinutes;
  const startIndex = Math.max(0, ohlcSeries.length - focusCount);
  
  const focusCandles = [];
  
  const minPrice = Math.min(...closes);
  const maxPrice = Math.max(...closes);
  const chartRange = maxPrice - minPrice || 1;

  for (let i = startIndex; i < ohlcSeries.length; i++) {
    const c = ohlcSeries[i];
    const range = c.high - c.low || 0.0001;
    const bodySize = Math.abs(c.close - c.open);
    const upperWick = c.close > c.open ? c.high - c.close : c.high - c.open;
    const lowerWick = c.close > c.open ? c.open - c.low : c.close - c.low;

    let bodyDirection = 'DOJI';
    if (c.close > c.open) bodyDirection = 'BULL';
    else if (c.close < c.open) bodyDirection = 'BEAR';

    const indexLabel = i === ohlcSeries.length - 1 ? 'CURRENT' : `PREV_${ohlcSeries.length - 1 - i}`;

    const closePositionInChart = Math.max(0, Math.min(1, (c.close - minPrice) / chartRange));

    const getBollingerPosition = (cPrice: number, bb: any) => {
      if (!bb || !bb.upper || bb.upper[i] === null) return null;
      const { upper, lower, middle } = bb;
      if (cPrice >= upper[i]) return 'OUTSIDE_BANDS';
      if (cPrice <= lower[i]) return 'OUTSIDE_BANDS';
      if (Math.abs(cPrice - upper[i]) < (upper[i] - middle[i]) * 0.1) return 'AT_UPPER';
      if (Math.abs(cPrice - lower[i]) < (middle[i] - lower[i]) * 0.1) return 'AT_LOWER';
      if (cPrice > middle[i]) return 'UPPER_HALF';
      if (cPrice < middle[i]) return 'LOWER_HALF';
      return 'MIDDLE';
    };

    // --- Candlestick pattern detection for the slice ending at index i ---
    const slice = ohlcSeries.slice(0, i + 1);
    let patternHint = "NONE";

    if (isMorningStar(slice).match) patternHint = "MORNING_STAR";
    else if (isEveningStar(slice).match) patternHint = "EVENING_STAR";
    else if (isThreeWhiteSoldiers(slice).match) patternHint = "THREE_WHITE_SOLDIERS";
    else if (isThreeBlackCrows(slice).match) patternHint = "THREE_BLACK_CROWS";
    else if (isEngulfing(slice).bullish) patternHint = "BULLISH_ENGULFING";
    else if (isEngulfing(slice).bearish) patternHint = "BEARISH_ENGULFING";
    else if (isPiercingLine(slice).match) patternHint = "PIERCING_LINE";
    else if (isDarkCloudCover(slice).match) patternHint = "DARK_CLOUD_COVER";
    else if (isHarami(slice).bullish) patternHint = "BULLISH_HARAMI";
    else if (isHarami(slice).bearish) patternHint = "BEARISH_HARAMI";
    else if (isTweezerTop(slice).match) patternHint = "TWEEZER_TOP";
    else if (isTweezerBottom(slice).match) patternHint = "TWEEZER_BOTTOM";
    else if (isHammer(slice).match) patternHint = "HAMMER";
    else if (isShootingStar(slice).match) patternHint = "SHOOTING_STAR";
    else if (isDoji(slice).match) patternHint = "DOJI";
    else if (isInsideBar(slice).match) patternHint = "INSIDE_BAR";
    else if (isOutsideBar(slice).match) patternHint = "OUTSIDE_BAR";
    else if (isMarubozu(slice).bullish) patternHint = "BULLISH_MARUBOZU";
    else if (isMarubozu(slice).bearish) patternHint = "BEARISH_MARUBOZU";
    else {
      const pin = isPinBar(slice);
      if (pin.bull) patternHint = "BULLISH_PINBAR";
      else if (pin.bear) patternHint = "BEARISH_PINBAR";
    }

    focusCandles.push({
      index: focusCandles.length,
      label: indexLabel,
      ohlc: {
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      },
      geometry: {
        bodyDirection,
        bodyRatio: bodySize / range,
        upperWickRatio: upperWick / range,
        lowerWickRatio: lowerWick / range,
        patternHint
      },
      yContext: {
        closePositionInChart,
        priceValue: c.close
      },
      oscillators: {
        rsi: rsiVals[i] !== undefined ? rsiVals[i] : null,
        stochK: stochVals.k[i] !== undefined ? stochVals.k[i] : null,
        stochD: stochVals.d[i] !== undefined ? stochVals.d[i] : null,
        macdLine: (macdVals.line ? macdVals.line[i] : (macdVals as any).macd?.[i]) ?? null,
        macdSignal: macdVals.signal?.[i] ?? null,
        macdHist: (macdVals.histogram ? macdVals.histogram[i] : (macdVals as any).hist?.[i]) ?? null
      },
      ema: {
        ema9: ema9[i] !== undefined ? ema9[i] : null,
        ema21: ema21[i] !== undefined ? ema21[i] : null,
        ema9AbovePrice: ema9[i] ? ema9[i] > c.close : null,
        ema21AbovePrice: ema21[i] ? ema21[i] > c.close : null,
        ema9AboveEma21: (ema9[i] && ema21[i]) ? ema9[i] > ema21[i] : null,
        visibleCrossover: "NONE"
      },
      volatility: {
        bollingerUpper: bbVals.upper[i] !== undefined ? bbVals.upper[i] : null,
        bollingerLower: bbVals.lower[i] !== undefined ? bbVals.lower[i] : null,
        bollingerMiddle: bbVals.middle[i] !== undefined ? bbVals.middle[i] : null,
        bollingerWidth: bbVals.width[i] !== undefined ? bbVals.width[i] : null,
        atr: atrVals[i] !== undefined ? atrVals[i] : null,
        bollingerPosition: getBollingerPosition(c.close, bbVals),
        bandWidth: (bbVals.width && bbVals.width[i] !== null && bbVals.width[i] < 0.02) ? "NARROW" : ((bbVals.width && bbVals.width[i] !== null && bbVals.width[i] > 0.1) ? "WIDE" : "NORMAL"),
        atrEstimate: (atrVals && atrVals[i] !== null && atrVals[i] > c.close * 0.02) ? "HIGH" : "NORMAL"
      }
    });
  }

  // --- Real Mathematical Trend & Structural Bias ---
  const slopeSeries = emaSlope(closes, 9);
  const lastSlope = slopeSeries.length > 0 ? slopeSeries[slopeSeries.length - 1] : 0;

  let visibleTrend: "UPTREND" | "DOWNTREND" | "SIDEWAYS" = "SIDEWAYS";
  if (lastSlope > 0.1) {
    visibleTrend = "UPTREND";
  } else if (lastSlope < -0.1) {
    visibleTrend = "DOWNTREND";
  }

  let structuralBias: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (lastSlope > 0.03) {
    structuralBias = "BULLISH";
  } else if (lastSlope < -0.03) {
    structuralBias = "BEARISH";
  }

  // --- Real Mathematical Support & Resistance levels ---
  const supportLevel = ohlcSeries.length > 0 ? Math.min(...Array.from(lows.slice(-15))) : null;
  const resistanceLevel = ohlcSeries.length > 0 ? Math.max(...Array.from(highs.slice(-15))) : null;
  const currentClose = closes[closes.length - 1] || 0;
  
  const nearSupport = (supportLevel !== null && resistanceLevel !== null)
    ? (currentClose - supportLevel) / (resistanceLevel - supportLevel || 1) < 0.15
    : false;
  
  const nearResistance = (supportLevel !== null && resistanceLevel !== null)
    ? (resistanceLevel - currentClose) / (resistanceLevel - supportLevel || 1) < 0.15
    : false;

  // --- Real Mathematical RSI Divergence Detector ---
  let rsiDivergence: "BULLISH" | "BEARISH" | "NONE" = "NONE";
  if (closes.length >= 15 && rsiVals.length >= 15) {
    const last15Closes = closes.slice(-15);
    const last15Rsi = rsiVals.slice(-15);
    
    const midIdx = 7;
    const firstHalfPrices = last15Closes.slice(0, midIdx);
    const secondHalfPrices = last15Closes.slice(midIdx);
    const firstHalfRsi = last15Rsi.slice(0, midIdx);
    const secondHalfRsi = last15Rsi.slice(midIdx);
    
    const maxP1 = Math.max(...firstHalfPrices);
    const maxP2 = Math.max(...secondHalfPrices);
    const minP1 = Math.min(...firstHalfPrices);
    const minP2 = Math.min(...secondHalfPrices);
    
    const rsiAtMaxP1 = firstHalfRsi[firstHalfPrices.indexOf(maxP1)] || 50;
    const rsiAtMaxP2 = secondHalfRsi[secondHalfPrices.indexOf(maxP2)] || 50;
    const rsiAtMinP1 = firstHalfRsi[firstHalfPrices.indexOf(minP1)] || 50;
    const rsiAtMinP2 = secondHalfRsi[secondHalfPrices.indexOf(minP2)] || 50;
    
    if (maxP2 > maxP1 && rsiAtMaxP2 < rsiAtMaxP1) {
      rsiDivergence = "BEARISH";
    } else if (minP2 < minP1 && rsiAtMinP2 > rsiAtMinP1) {
      rsiDivergence = "BULLISH";
    }
  }

  // --- Real Bollinger Squeeze Detector ---
  let bollingerSqueeze = false;
  const widths = bbVals.width ? bbVals.width.filter((w: number) => w !== null && !isNaN(w) && w > 0) : [];
  if (widths.length >= 10) {
    const currentWidth = bbVals.width[ohlcSeries.length - 1];
    const last10Widths = widths.slice(-10);
    const avgWidth = last10Widths.reduce((sum, val) => sum + val, 0) / last10Widths.length;
    if (currentWidth < avgWidth * 0.85) {
      bollingerSqueeze = true;
    }
  }

  // --- Real Volatility State Classifier ---
  let volatilityState = "NORMAL";
  const validAtrs = atrVals ? atrVals.filter((v: number) => v !== null && v > 0) : [];
  if (validAtrs.length >= 10) {
    const recentAtr = atrVals[ohlcSeries.length - 1] || 0;
    const avgAtr = validAtrs.slice(-10).reduce((sum, val) => sum + val, 0) / 10;
    if (recentAtr > avgAtr * 1.5) {
      volatilityState = "HIGH";
    } else if (recentAtr < avgAtr * 0.6) {
      volatilityState = "LOW";
    }
  }

  return {
    meta,
    focusCandles,
    marketContext: {
      visibleTrend,
      structuralBias,
      nearSupport,
      nearResistance,
      supportLevel,
      resistanceLevel,
      rsiDivergence,
      bollingerSqueeze,
      volatilityState
    },
    dataQuality: {
      ohlcConfidence: "HIGH",
      indicatorSource: "COMPUTED",
      warningFlags: []
    }
  };
}
