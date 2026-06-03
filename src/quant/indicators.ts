import { EPSILON } from '../vision/colorSpace';

export function sma(values: number[], period: number): number[] {
  const result = new Float64Array(values.length).fill(0);
  if (values.length === 0) return Array.from(result);
  
  const activePeriod = Math.max(1, Math.min(period, values.length));
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= activePeriod) sum -= values[i - activePeriod];
    const currentWindow = Math.min(i + 1, activePeriod);
    result[i] = sum / currentWindow;
  }
  return Array.from(result);
}

export function ema(values: number[], period: number): number[] {
  const result = new Float64Array(values.length).fill(0);
  if (values.length === 0) return Array.from(result);
  
  const activePeriod = Math.max(1, Math.min(period, values.length));
  const k = 2 / (activePeriod + 1);
  
  let prevEma = values[0];
  result[0] = prevEma;
  
  for (let i = 1; i < values.length; i++) {
    prevEma = (values[i] - prevEma) * k + prevEma;
    result[i] = prevEma;
  }
  return Array.from(result);
}

export function rsi(closes: number[], period = 14): number[] {
  const result = new Float64Array(closes.length).fill(50);
  if (closes.length < 2) return Array.from(result);
  
  const activePeriod = Math.max(2, Math.min(period, closes.length - 1));
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= activePeriod; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= activePeriod;
  avgLoss /= activePeriod;
  
  const rs = avgGain === 0 && avgLoss === 0 ? 1 : avgGain / Math.max(avgLoss, EPSILON);
  result[activePeriod] = 100 - (100 / (1 + rs));
  
  // Fill prior values
  for (let i = 0; i < activePeriod; i++) {
    result[i] = result[activePeriod];
  }
  
  for (let i = activePeriod + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    
    avgGain = (avgGain * (activePeriod - 1) + gain) / activePeriod;
    avgLoss = (avgLoss * (activePeriod - 1) + loss) / activePeriod;
    
    const currRs = avgGain === 0 && avgLoss === 0 ? 1 : avgGain / Math.max(avgLoss, EPSILON);
    result[i] = 100 - (100 / (1 + currRs));
  }
  return Array.from(result);
}

export function macd(closes: number[], fastWindow = 12, slowWindow = 26, signalWindow = 9) {
  const macdArray = new Float64Array(closes.length).fill(0);
  const signalArray = new Float64Array(closes.length).fill(0);
  const histArray = new Float64Array(closes.length).fill(0);
  
  const fastEma = ema(closes, fastWindow);
  const slowEma = ema(closes, slowWindow);
  
  const macdValid: number[] = [];
  const validIndices: number[] = [];
  
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(fastEma[i]) && !isNaN(slowEma[i])) {
      const m = fastEma[i] - slowEma[i];
      macdArray[i] = m;
      macdValid.push(m);
      validIndices.push(i);
    }
  }
  
  const sigValid = ema(macdValid, signalWindow);
  for (let i = 0; i < sigValid.length; i++) {
    if (!isNaN(sigValid[i])) {
      const idx = validIndices[i];
      signalArray[idx] = sigValid[i];
      histArray[idx] = macdArray[idx] - sigValid[i];
    }
  }
  
  return {
    macd: Array.from(macdArray),
    signal: Array.from(signalArray),
    hist: Array.from(histArray)
  };
}

export function bollinger(closes: number[], period = 20, k = 2) {
  const upper = new Float64Array(closes.length).fill(0);
  const middle = new Float64Array(closes.length).fill(0);
  const lower = new Float64Array(closes.length).fill(0);
  const width = new Float64Array(closes.length).fill(0);
  
  if (closes.length === 0) {
    return { upper: Array.from(upper), middle: Array.from(middle), lower: Array.from(lower), width: Array.from(width) };
  }
  
  const smaValues = sma(closes, period);
  const activePeriod = Math.max(2, Math.min(period, closes.length));
  
  for (let i = 0; i < closes.length; i++) {
    const mean = smaValues[i];
    const startIndex = Math.max(0, i - activePeriod + 1);
    const endIndex = i;
    const count = endIndex - startIndex + 1;
    
    let variance = 0;
    for (let j = startIndex; j <= endIndex; j++) {
      variance += Math.pow(closes[j] - mean, 2);
    }
    const std = Math.sqrt(Math.max(variance / count, EPSILON));
    
    middle[i] = mean;
    upper[i] = mean + k * std;
    lower[i] = mean - k * std;
    width[i] = (upper[i] - lower[i]) / Math.max(mean, EPSILON);
  }
  
  return {
    upper: Array.from(upper),
    middle: Array.from(middle),
    lower: Array.from(lower),
    width: Array.from(width)
  };
}

export function atr(candles: {high: number, low: number, close: number}[], period = 14) {
  const result = new Float64Array(candles.length).fill(0);
  if (candles.length === 0) return Array.from(result);
  
  const activePeriod = Math.max(1, Math.min(period, candles.length));
  const tr = new Float64Array(candles.length);
  tr[0] = Math.max(candles[0].high - candles[0].low, EPSILON);
  
  for (let i = 1; i < candles.length; i++) {
    const hLogSub = candles[i].high - candles[i].low;
    const hClose = Math.abs(candles[i].high - candles[i-1].close);
    const lClose = Math.abs(candles[i].low - candles[i-1].close);
    tr[i] = Math.max(Math.max(hLogSub, hClose, lClose), EPSILON);
  }
  
  // First ATR is SMA of first TRs
  let trSum = 0;
  for (let i = 0; i < activePeriod; i++) {
    trSum += tr[i];
  }
  let prevAtr = trSum / activePeriod;
  for (let i = 0; i < activePeriod; i++) {
    result[i] = prevAtr;
  }
  
  for (let i = activePeriod; i < candles.length; i++) {
    prevAtr = (prevAtr * (activePeriod - 1) + tr[i]) / activePeriod;
    result[i] = prevAtr;
  }
  return Array.from(result);
}

export function stochastic(candles: {high: number, low: number, close: number}[], kPeriod = 14, dPeriod = 3) {
  const kArray = new Float64Array(candles.length).fill(0);
  
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > highest) highest = candles[j].high;
      if (candles[j].low < lowest) lowest = candles[j].low;
    }
    const denom = Math.max(highest - lowest, EPSILON);
    kArray[i] = 100 * ((candles[i].close - lowest) / denom);
  }
  
  const kValid = [];
  const validIdx = [];
  for (let i = 0; i < kArray.length; i++) {
    if (!isNaN(kArray[i])) {
      kValid.push(kArray[i]);
      validIdx.push(i);
    }
  }
  
  const kSma = sma(kValid, dPeriod);
  const dArray = new Float64Array(candles.length).fill(0);
  
  for (let i = 0; i < kSma.length; i++) {
    if (!isNaN(kSma[i])) {
      dArray[validIdx[i]] = kSma[i];
    }
  }
  
  return {
    k: Array.from(kArray),
    d: Array.from(dArray)
  };
}

export function adx(
  candles: {high: number; low: number; close: number}[],
  period = 14
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const n = candles.length;
  const adxResult = new Array(n).fill(NaN);
  const plusDIResult = new Array(n).fill(NaN);
  const minusDIResult = new Array(n).fill(NaN);

  if (n < period + 1) {
    return { adx: adxResult, plusDI: plusDIResult, minusDI: minusDIResult };
  }

  const tr = new Float64Array(n);
  const plusDM = new Float64Array(n);
  const minusDM = new Float64Array(n);

  for (let i = 1; i < n; i++) {
    const hSubL = candles[i].high - candles[i].low;
    const hSubCp = Math.abs(candles[i].high - candles[i - 1].close);
    const lSubCp = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(hSubL, hSubCp, lSubCp);

    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;

    plusDM[i] = (up > down && up > 0) ? up : 0;
    minusDM[i] = (down > up && down > 0) ? down : 0;
  }

  const smoothedTR = new Float64Array(n);
  const smoothedPlusDM = new Float64Array(n);
  const smoothedMinusDM = new Float64Array(n);

  let sumTR = 0;
  let sumPlusDM = 0;
  let sumMinusDM = 0;

  for (let i = 1; i <= period && i < n; i++) {
    sumTR += tr[i];
    sumPlusDM += plusDM[i];
    sumMinusDM += minusDM[i];
  }

  smoothedTR[period] = sumTR;
  smoothedPlusDM[period] = sumPlusDM;
  smoothedMinusDM[period] = sumMinusDM;

  for (let i = period + 1; i < n; i++) {
    smoothedTR[i] = smoothedTR[i - 1] - (smoothedTR[i - 1] / period) + tr[i];
    smoothedPlusDM[i] = smoothedPlusDM[i - 1] - (smoothedPlusDM[i - 1] / period) + plusDM[i];
    smoothedMinusDM[i] = smoothedMinusDM[i - 1] - (smoothedMinusDM[i - 1] / period) + minusDM[i];
  }

  const dx = new Float64Array(n);

  for (let i = period; i < n; i++) {
    const trVal = smoothedTR[i];
    const plusDMVal = smoothedPlusDM[i];
    const minusDMVal = smoothedMinusDM[i];

    const pDI = trVal > 0 ? (plusDMVal / trVal) * 100 : 0;
    const mDI = trVal > 0 ? (minusDMVal / trVal) * 100 : 0;

    plusDIResult[i] = pDI;
    minusDIResult[i] = mDI;

    const diff = Math.abs(pDI - mDI);
    const sum = pDI + mDI;
    dx[i] = sum > 0 ? (diff / sum) * 100 : 0;
  }

  let dxSum = 0;
  for (let i = period; i < period * 2 && i < n; i++) {
    dxSum += dx[i];
  }

  const startAdxIdx = period * 2 - 1;
  if (startAdxIdx < n) {
    adxResult[startAdxIdx] = dxSum / period;
    for (let i = startAdxIdx + 1; i < n; i++) {
      adxResult[i] = ((adxResult[i - 1] * (period - 1)) + dx[i]) / period;
    }
  }

  return {
    adx: adxResult,
    plusDI: plusDIResult,
    minusDI: minusDIResult
  };
}

