import { ScalpFeatures, SwingPivot } from '../types';
import { NumericOHLC } from '../vision/pipeline';
import { detectStructureSignal } from './marketStructure';
import { rsi, macd, adx, ema } from './indicators';
import { calculateVolatilityRegime, calculatePredictability, detectMACDDivergence } from './mathEngine';
import { isEngulfing, isHammer } from './candleGeometry';
import { emaSlope } from './calculus';

export function getISTMinutesSinceMidnight(nowMs: number): number {
  // IST is UTC + 5:30 -> 330 minutes
  const istTime = new Date(nowMs + 330 * 60_000);
  return istTime.getUTCHours() * 60 + istTime.getUTCMinutes();
}

function isNearSupport(price: number, pivots: SwingPivot[], ohlc: NumericOHLC[], atrVal: number): boolean {
  if (ohlc.length === 0) return false;
  const lows = ohlc.slice(-15).map(c => c.low);
  const minLow = Math.min(...lows);
  // Within 1% of the 15-bar low
  if (price <= minLow * 1.01) return true;
  
  // Or within 1.5 * ATR of any recent swing low pivot
  const lowPivots = pivots.filter(p => p.kind === 'LOW');
  for (const p of lowPivots.slice(-3)) {
    if (Math.abs(price - p.price) <= atrVal * 1.5) return true;
  }
  return false;
}

export function buildScalpFeatures(
  ohlc: NumericOHLC[],
  pivots: SwingPivot[],
  atr14: number[],
  vwapVals: number[],
  nowMs: number,
  indicatorCache?: any
): ScalpFeatures {
  const highs = ohlc.map(c => c.high);
  const lows = ohlc.map(c => c.low);
  const closes = ohlc.map(c => c.close);
  const lastClose = closes[closes.length - 1];
  
  const atrVal = atr14.length > 0 ? atr14[atr14.length - 1] : 0;
  
  // Standard triggers at support
  const isBEngulf = isEngulfing(ohlc).bullish;
  const bullEngulfingAtSupport = isBEngulf && isNearSupport(lastClose, pivots, ohlc, atrVal);
  
  const isHam = isHammer(ohlc).match;
  const hammerAtSupport = isHam && isNearSupport(lastClose, pivots, ohlc, atrVal);
  
  // MACD Divergence
  const macdData = indicatorCache?.macdVals || macd(closes);
  const mDiv = detectMACDDivergence(closes, macdData);
  const macdBullishDivergence = !!mDiv && (mDiv.type === 'BULLISH' || String(mDiv) === 'BULLISH');
  
  // EMA relations
  const ema9Data = indicatorCache?.ema9 || ema(closes, 9);
  const ema21Data = indicatorCache?.ema21 || ema(closes, 21);
  const ema9_above_ema21 = ema9Data[ema9Data.length - 1] > ema21Data[ema21Data.length - 1];
  
  const slope9 = indicatorCache?.slopeSeries || emaSlope(closes, 9);
  const ema9_slope_up = slope9[slope9.length - 1] > 0;
  
  // DM/ADX Index System Setup
  const adxData = indicatorCache?.adxVals || adx(ohlc, 14);
  const curAdx = adxData.adx[adxData.adx.length - 1] || 0;
  const curPlusDI = adxData.plusDI[adxData.plusDI.length - 1] || 0;
  const curMinusDI = adxData.minusDI[adxData.minusDI.length - 1] || 0;
  
  const adx_above_20 = curAdx > 20;
  const plusDI_dominant = curPlusDI > curMinusDI;
  const adx_above_25 = curAdx > 25;
  const minusDI_dominant = curMinusDI > curPlusDI;
  
  // Price pivots / structures
  const structSig = detectStructureSignal(closes, highs, lows);
  const bos_bull = structSig.type === 'BOS_BULL';
  const choch_bull = structSig.type === 'CHOCH_BULL';
  
  // RSI oversold recovery: prior < 30 in last 5 steps, now in [30, 55] and rising
  const rsiVals = indicatorCache?.rsiVals || rsi(closes, 14);
  const curRsi = rsiVals[rsiVals.length - 1] || 50;
  const priorRsiSlice = rsiVals.slice(Math.max(0, rsiVals.length - 16), Math.max(0, rsiVals.length - 1));
  const holdsPriorOversold = priorRsiSlice.some(v => v < 30);
  const currentRsiInZone = curRsi >= 32 && curRsi <= 52;
  const currentRsiRising = rsiVals.length >= 2 && rsiVals[rsiVals.length - 1] > rsiVals[rsiVals.length - 2];
  const rsi_recovering_from_oversold = holdsPriorOversold && currentRsiInZone && currentRsiRising;
  
  // Volatility regime status
  const volsCandles = ohlc.slice(-30).map((c, i) => ({
    high: c.high,
    low: c.low,
    close: c.close,
    prevClose: i > 0 ? ohlc[i - 1].close : c.open,
  }));
  const volReg = calculateVolatilityRegime(volsCandles);
  const volatility_normal = volReg.status === 'TRADEABLE' || volReg.status === 'INSUFFICIENT_DATA';
  
  // Price and VWap proxy
  const lastVwap = vwapVals[vwapVals.length - 1] || lastClose;
  const price_above_vwap = lastClose > lastVwap;
  
  // Recent bearish engulfing
  const n = ohlc.length;
  const bear_engulfing_recent = 
    n >= 2 && isEngulfing(ohlc.slice(-2)).bearish || 
    n >= 3 && isEngulfing(ohlc.slice(-3, -1)).bearish || 
    n >= 4 && isEngulfing(ohlc.slice(-4, -2)).bearish;
  
  // Kolmogorov predictability gate
  const predData = calculatePredictability(closes.slice(-50));
  const predictabilityPassed = predData.isPredictable === true || closes.length < 10;
  
  // Market hours gate (NSE 09:20 - 15:00 IST)
  const istMins = getISTMinutesSinceMidnight(nowMs);
  const withinMarketHours = istMins >= 555 && istMins <= 930;
  
  let timeOfDayQuality: 'OPTIMAL' | 'ACCEPTABLE' | 'AVOID' = 'OPTIMAL';
  if (istMins < 555 || istMins > 930) timeOfDayQuality = 'AVOID';
  else if (istMins < 570) timeOfDayQuality = 'AVOID';
  else if (istMins >= 720 && istMins <= 780) timeOfDayQuality = 'ACCEPTABLE';
  else if (istMins > 885) timeOfDayQuality = 'ACCEPTABLE';

  return {
    timeOfDayQuality,
    bullEngulfingAtSupport,
    hammerAtSupport,
    macdBullishDivergence,
    ema9_above_ema21,
    ema9_slope_up,
    adx_above_20,
    plusDI_dominant,
    adx_above_25,
    minusDI_dominant,
    bos_bull,
    choch_bull,
    rsi_recovering_from_oversold,
    volatility_normal,
    price_above_vwap,
    bear_engulfing_recent,
    predictabilityPassed,
    withinMarketHours
  };
}
