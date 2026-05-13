import { sma, ema, rsi, macd, bollinger, atr, stochastic } from '../../quant/indicators';
import { firstDerivative, secondDerivative } from '../../quant/calculus';

function cleanInput(arr: number[]): number[] {
  return arr.map(v => {
    if (Number.isNaN(v)) return 0;
    if (v === Infinity) return Number.MAX_VALUE;
    if (v === -Infinity) return -Number.MAX_VALUE;
    return v;
  });
}

function checkFiniteNaN(arr: number[]) {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) {
      throw new Error('NaN encountered in array output at index ' + i);
    }
  }
}

export function runEpsilonGuard(): boolean {
  const inputs = [
    [], [0], [0,0,0], [Infinity], [NaN], [-Infinity, 1, 0]
  ];

  const floatInputs = inputs.map(cleanInput);

  const numFns = [
    (arr: number[]) => sma(arr, 2),
    (arr: number[]) => ema(arr, 2),
    (arr: number[]) => rsi(arr, 2),
    (arr: number[]) => macd(arr, 2, 3, 2).macd,
    (arr: number[]) => macd(arr, 2, 3, 2).signal,
    (arr: number[]) => macd(arr, 2, 3, 2).hist,
    (arr: number[]) => bollinger(arr, 2, 2).upper,
    (arr: number[]) => firstDerivative(arr, 1),
    (arr: number[]) => secondDerivative(arr, 1),
  ];

  for (const arr of floatInputs) {
    for (const fn of numFns) {
      const res = fn(arr);
      checkFiniteNaN(res);
    }
  }

  const objInputs = floatInputs.map(arr => arr.map(v => ({ high: v, low: v, close: v, open: v, isBull: true, xCenter: 0 })));
  
  const objFns = [
    (arr: any[]) => atr(arr, 2),
    (arr: any[]) => stochastic(arr, 2, 2).k,
    (arr: any[]) => stochastic(arr, 2, 2).d,
  ];

  for (const arr of objInputs) {
    for (const fn of objFns) {
      const res = fn(arr);
      checkFiniteNaN(res);
    }
  }

  return true;
}
