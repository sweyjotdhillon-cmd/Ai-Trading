import { EPSILON } from '../vision/colorSpace';

export function sma(values: number[] | Float64Array, period: number): Float64Array {
  const result = new Float64Array(values.length).fill(0);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

export function ema(values: number[] | Float64Array, period: number): Float64Array {
  const result = new Float64Array(values.length).fill(0);
  if (values.length < period) return result;
  
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prevEma = sum / period;
  result[period - 1] = prevEma;
  
  for (let i = period; i < values.length; i++) {
    prevEma = (values[i] - prevEma) * k + prevEma;
    result[i] = prevEma;
  }
  return result;
}

export function rsi(closes: number[] | Float64Array, period = 14): Float64Array {
  const result = new Float64Array(closes.length).fill(0);
  if (closes.length <= period) return result;
  
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  
  const rs = avgGain === 0 && avgLoss === 0 ? 1 : avgGain / Math.max(avgLoss, EPSILON);
  result[period] = 100 - (100 / (1 + rs));
  
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    const currRs = avgGain === 0 && avgLoss === 0 ? 1 : avgGain / Math.max(avgLoss, EPSILON);
    result[i] = 100 - (100 / (1 + currRs));
  }
  return result;
}

export function macd(closes: number[] | Float64Array, fastWindow = 12, slowWindow = 26, signalWindow = 9) {
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
    macd: macdArray,
    signal: signalArray,
    hist: histArray
  };
}

export function bollinger(closes: number[] | Float64Array, period = 20, k = 2) {
  const upper = new Float64Array(closes.length).fill(0);
  const middle = new Float64Array(closes.length).fill(0);
  const lower = new Float64Array(closes.length).fill(0);
  const width = new Float64Array(closes.length).fill(0);
  
  const smaValues = sma(closes, period);
  
  for (let i = period - 1; i < closes.length; i++) {
    const mean = smaValues[i];
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += Math.pow(closes[j] - mean, 2);
    }
    const std = Math.sqrt(Math.max(variance / period, EPSILON));
    
    middle[i] = mean;
    upper[i] = mean + k * std;
    lower[i] = mean - k * std;
    width[i] = (upper[i] - lower[i]) / Math.max(mean, EPSILON);
  }
  
  return {
    upper: upper,
    middle: middle,
    lower: lower,
    width: width
  };
}

export function atr(candles: {high: number, low: number, close: number}[], period = 14): Float64Array {
  const result = new Float64Array(candles.length).fill(0);
  if (candles.length <= period) return result;
  
  const tr = new Float64Array(candles.length);
  tr[0] = Math.max(candles[0].high - candles[0].low, EPSILON);
  
  for (let i = 1; i < candles.length; i++) {
    const hLogSub = candles[i].high - candles[i].low;
    const hClose = Math.abs(candles[i].high - candles[i-1].close);
    const lClose = Math.abs(candles[i].low - candles[i-1].close);
    tr[i] = Math.max(Math.max(hLogSub, hClose, lClose), EPSILON);
  }
  
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  result[period] = sum / period;
  
  for (let i = period + 1; i < candles.length; i++) {
    result[i] = (result[i-1] * (period - 1) + tr[i]) / period;
  }
  
  return result;
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
    k: kArray,
    d: dArray
  };
}
