export interface SwingPivot {
  index: number;
  price: number;
  kind: 'HIGH' | 'LOW';
}

export function findSwingPivots(
  highs: number[] | Float64Array,
  lows: number[] | Float64Array,
  lookback = 2
): SwingPivot[] {
  const pivots: SwingPivot[] = [];
  const n = highs.length;
  for (let i = lookback; i < n - lookback; i++) {
    // Williams Fractal 5-bar rule (lookback=2 each side)
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (lows[i - j] <= lows[i] || lows[i + j] <= lows[i]) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      pivots.push({ index: i, price: lows[i], kind: 'LOW' });
    }

    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (highs[i - j] >= highs[i] || highs[i + j] >= highs[i]) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      pivots.push({ index: i, price: highs[i], kind: 'HIGH' });
    }
  }
  pivots.sort((a, b) => a.index - b.index);
  return pivots;
}

export type TrendState = 'UPTREND' | 'DOWNTREND' | 'RANGING';

export function getTrendState(pivots: SwingPivot[]): TrendState {
  const highs = pivots.filter(p => p.kind === 'HIGH');
  const lows = pivots.filter(p => p.kind === 'LOW');
  if (highs.length < 2 || lows.length < 2) return 'RANGING';

  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];

  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];

  const isHH = h2.price > h1.price;
  const isHL = l2.price > l1.price;
  const isLH = h2.price < h1.price;
  const isLL = l2.price < l1.price;

  if (isHH && isHL) return 'UPTREND';
  if (isLH && isLL) return 'DOWNTREND';
  return 'RANGING';
}

export interface StructureSignal {
  type: 'BOS_BULL' | 'BOS_BEAR' | 'CHOCH_BULL' | 'CHOCH_BEAR' | 'NONE';
  pivotBroken?: SwingPivot;
  bodyClose: number;
  barIndex: number;
}

export function detectStructureSignal(
  closes: number[] | Float64Array,
  highs: number[] | Float64Array,
  lows: number[] | Float64Array,
  lookback = 2
): StructureSignal {
  const n = closes.length;
  const emptySig: StructureSignal = { type: 'NONE', bodyClose: n > 0 ? closes[n - 1] : 0, barIndex: n - 1 };
  if (n < 6) return emptySig;

  const allPivots = findSwingPivots(highs, lows, lookback);
  const pivotsBeforeLast = allPivots.filter(p => p.index < n - 1);

  if (pivotsBeforeLast.length === 0) return emptySig;

  const trend = getTrendState(pivotsBeforeLast);
  const lastClose = closes[n - 1];

  const highPivots = pivotsBeforeLast.filter(p => p.kind === 'HIGH');
  const lowPivots = pivotsBeforeLast.filter(p => p.kind === 'LOW');

  const lastHighPivot = highPivots[highPivots.length - 1];
  const lastLowPivot = lowPivots[lowPivots.length - 1];

  if (trend === 'UPTREND') {
    if (lastHighPivot && lastClose > lastHighPivot.price) {
      return {
        type: 'BOS_BULL',
        pivotBroken: lastHighPivot,
        bodyClose: lastClose,
        barIndex: n - 1
      };
    }
    if (lastLowPivot && lastClose < lastLowPivot.price) {
      return {
        type: 'CHOCH_BEAR',
        pivotBroken: lastLowPivot,
        bodyClose: lastClose,
        barIndex: n - 1
      };
    }
  } else if (trend === 'DOWNTREND') {
    if (lastLowPivot && lastClose < lastLowPivot.price) {
      return {
        type: 'BOS_BEAR',
        pivotBroken: lastLowPivot,
        bodyClose: lastClose,
        barIndex: n - 1
      };
    }
    if (lastHighPivot && lastClose > lastHighPivot.price) {
      return {
        type: 'CHOCH_BULL',
        pivotBroken: lastHighPivot,
        bodyClose: lastClose,
        barIndex: n - 1
      };
    }
  }

  return emptySig;
}

export function detectDoubleTopBottom(
  pivots: SwingPivot[],
  tolerancePct = 0.015
): 'DOUBLE_TOP' | 'DOUBLE_BOTTOM' | 'NONE' {
  const highs = pivots.filter(p => p.kind === 'HIGH');
  const lows  = pivots.filter(p => p.kind === 'LOW');

  if (highs.length >= 2) {
    const ph1 = highs[highs.length - 2];
    const ph2 = highs[highs.length - 1];
    const diffPct = Math.abs(ph1.price - ph2.price) / Math.max(ph1.price, ph2.price);
    const barSeparation = ph2.index - ph1.index;
    // Require: within price tolerance AND at least 5 bars apart
    // (prevents adjacent-candle noise from qualifying as a double top)
    if (diffPct <= tolerancePct && barSeparation >= 5) {
      return 'DOUBLE_TOP';
    }
  }

  if (lows.length >= 2) {
    const pl1 = lows[lows.length - 2];
    const pl2 = lows[lows.length - 1];
    const diffPct = Math.abs(pl1.price - pl2.price) / Math.max(pl1.price, pl2.price);
    const barSeparation = pl2.index - pl1.index;
    // Require: within price tolerance AND at least 5 bars apart
    if (diffPct <= tolerancePct && barSeparation >= 5) {
      return 'DOUBLE_BOTTOM';
    }
  }

  return 'NONE';
}
