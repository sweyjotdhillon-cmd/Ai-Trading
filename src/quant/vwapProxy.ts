export function vwapProxy(
  ohlc: { high: number; low: number; close: number }[],
  opts: { mode: 'ANCHORED' | 'ROLLING'; window?: number } = { mode: 'ANCHORED' }
): number[] {
  const tp = ohlc.map(c => (c.high + c.low + c.close) / 3);
  const out: number[] = new Array(ohlc.length);
  if (opts.mode === 'ANCHORED') {
    let cum = 0;
    for (let i = 0; i < tp.length; i++) {
      cum += tp[i];
      out[i] = cum / (i + 1);
    }
  } else {
    const w = Math.max(2, opts.window ?? 20);
    for (let i = 0; i < tp.length; i++) {
      const lo = Math.max(0, i - w + 1);
      let s = 0, n = 0;
      for (let j = lo; j <= i; j++) {
        s += tp[j];
        n++;
      }
      out[i] = s / n;
    }
  }
  return out;
}
