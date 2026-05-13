import { sma, ema } from './indicators';
import { EPSILON } from '../vision/colorSpace';

export function firstDerivative(series: number[], h = 1): number[] {
  const n = series.length;
  const dev = new Float64Array(n).fill(0);
  if (n < 2) return Array.from(dev);
  
  // Forward for first element
  dev[0] = (series[1] - series[0]) / Math.max(h, EPSILON);
  
  // Central diff for middle
  for (let i = 1; i < n - 1; i++) {
    dev[i] = (series[i + 1] - series[i - 1]) / (2 * Math.max(h, EPSILON));
  }
  
  // Backward for last element
  dev[n - 1] = (series[n - 1] - series[n - 2]) / Math.max(h, EPSILON);
  
  return Array.from(dev);
}

export function secondDerivative(series: number[], h = 1): number[] {
  const n = series.length;
  const dev2 = new Float64Array(n).fill(0);
  if (n < 3) return Array.from(dev2);
  
  for (let i = 1; i < n - 1; i++) {
    dev2[i] = (series[i + 1] - 2 * series[i] + series[i - 1]) / Math.max(h * h, EPSILON);
  }
  
  // Missing edges: repeat inner values
  dev2[0] = dev2[1];
  dev2[n - 1] = dev2[n - 2];
  
  return Array.from(dev2);
}

export function smoothBeforeDeriv(series: number[], window = 3): number[] {
  const smoothed = sma(series, window);
  // Pad the beginning with original series to fix NaNs
  for (let i = 0; i < window - 1; i++) {
    if (i < series.length && isNaN(smoothed[i])) {
      smoothed[i] = series[i];
    }
  }
  return smoothed;
}

export function emaSlope(closes: number[], period = 21): number[] {
  const emaValues = ema(closes, period);
  return firstDerivative(emaValues);
}

export function emaCurvature(closes: number[], period = 21): number[] {
  const emaValues = ema(closes, period);
  return secondDerivative(emaValues);
}
