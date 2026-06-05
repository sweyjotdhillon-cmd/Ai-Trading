import { OHLCV } from '../types';

export interface ChartRendererOptions {
  width:          number;   // canvas width in px — default 800
  height:         number;   // canvas height in px — default 400
  paddingLeft:    number;   // space for y-axis labels — default 60
  paddingRight:   number;   // right margin — default 20
  paddingTop:     number;   // top margin — default 20
  paddingBottom:  number;   // space for x-axis — default 30
}

export interface ChartRenderResult {
  dataUrl:      string;       // base64 PNG — feeds singleAnalysis directly
  imageData:    ImageData;    // raw ImageData — feeds buildPipelineResult directly
  canvas:       HTMLCanvasElement;
  priceMin:     number;       // lowest price rendered
  priceMax:     number;       // highest price rendered
  candleCount:  number;       // how many candles were drawn
}

const BULL_BODY_COLOR  = '#26a69a';   // HSV ≈ (175°, 0.77, 0.64) — inside bull band
const BEAR_BODY_COLOR  = '#ef5350';   // HSV ≈ (1°, 0.65, 0.94) — inside bear band
const BACKGROUND_COLOR = '#131722';   // Dark background — matches TradingView default
const AXIS_TEXT_COLOR  = '#d1d4dc';   // Light grey — readable by axisReader
const GRID_COLOR       = '#1e222d';   // Subtle grid lines

const DEFAULTS: ChartRendererOptions = {
  width:         800,
  height:        400,
  paddingLeft:   60,
  paddingRight:  20,
  paddingTop:    20,
  paddingBottom: 30,
};

const MIN_CANDLE_WIDTH  = 4;    // px — minimum body width
const MAX_CANDLE_WIDTH  = 16;   // px — maximum body width
const WICK_WIDTH        = 1;    // px — wick line width
const CANDLE_GAP_RATIO  = 0.2;  // gap between candles as fraction of candle width
const Y_AXIS_LABELS     = 6;    // number of price labels on y-axis
const FONT_SIZE         = 11;   // px — axis label font size

export function renderOHLCVToChart(
  ohlcv:    OHLCV[],
  options?: Partial<ChartRendererOptions>
): ChartRenderResult | null {
  if (!ohlcv || ohlcv.length < 3) return null;

  const candles = ohlcv.slice(Math.max(0, ohlcv.length - 60)); // cap at 60

  const opts = { ...DEFAULTS, ...options };

  const canvas  = document.createElement('canvas');
  canvas.width  = opts.width;
  canvas.height = opts.height;
  const ctx     = canvas.getContext('2d');
  if (!ctx) return null;

  const rawMin  = Math.min(...candles.map(c => c.low));
  const rawMax  = Math.max(...candles.map(c => c.high));
  const padding = (rawMax - rawMin) * 0.02 || rawMax * 0.01;
  const priceMin = rawMin - padding;
  const priceMax = rawMax + padding;
  const priceRange = priceMax - priceMin;

  const chartLeft   = opts.paddingLeft;
  const chartRight  = opts.width  - opts.paddingRight;
  const chartTop    = opts.paddingTop;
  const chartBottom = opts.height - opts.paddingBottom;
  const chartWidth  = chartRight  - chartLeft;
  const chartHeight = chartBottom - chartTop;

  function priceToY(price: number): number {
    return chartBottom - ((price - priceMin) / priceRange) * chartHeight;
  }

  const totalCandles  = candles.length;
  const rawCandleW    = chartWidth / totalCandles;
  const candleW       = Math.max(MIN_CANDLE_WIDTH, Math.min(MAX_CANDLE_WIDTH, rawCandleW * (1 - CANDLE_GAP_RATIO)));
  const step          = chartWidth / totalCandles;

  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, opts.width, opts.height);

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth   = 1;
  for (let i = 0; i <= Y_AXIS_LABELS; i++) {
    const price = priceMin + (priceRange * i) / Y_AXIS_LABELS;
    const y     = priceToY(price);
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();
  }

  ctx.fillStyle  = AXIS_TEXT_COLOR;
  ctx.font       = `${FONT_SIZE}px monospace`;
  ctx.textAlign  = 'right';

  for (let i = 0; i <= Y_AXIS_LABELS; i++) {
    const price  = priceMin + (priceRange * i) / Y_AXIS_LABELS;
    const y      = priceToY(price);
    const label  = price >= 1000 ? price.toFixed(0) : price.toFixed(2);
    ctx.fillText(label, chartLeft - 6, y + FONT_SIZE / 2);
  }

  candles.forEach((candle, i) => {
    const isBull  = candle.close >= candle.open;
    const color   = isBull ? BULL_BODY_COLOR : BEAR_BODY_COLOR;

    const xCenter = chartLeft + (i + 0.5) * step;
    const xLeft   = xCenter - candleW / 2;

    const yOpen   = priceToY(candle.open);
    const yClose  = priceToY(candle.close);
    const yHigh   = priceToY(candle.high);
    const yLow    = priceToY(candle.low);

    const bodyTop    = Math.min(yOpen, yClose);
    const bodyBottom = Math.max(yOpen, yClose);
    const bodyHeight = Math.max(bodyBottom - bodyTop, 1);

    ctx.strokeStyle = color;
    ctx.lineWidth   = WICK_WIDTH;
    ctx.beginPath();
    ctx.moveTo(xCenter, yHigh);
    ctx.lineTo(xCenter, bodyTop);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(xCenter, bodyBottom);
    ctx.lineTo(xCenter, yLow);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(xLeft, bodyTop, candleW, bodyHeight);
  });

  const imageData = ctx.getImageData(0, 0, opts.width, opts.height);
  const dataUrl   = canvas.toDataURL('image/png');

  return {
    dataUrl,
    imageData,
    canvas,
    priceMin,
    priceMax,
    candleCount: candles.length,
  };
}

export function ohlcvToDataUrl(
  ohlcv:    OHLCV[],
  options?: Partial<ChartRendererOptions>
): string | null {
  const result = renderOHLCVToChart(ohlcv, options);
  return result ? result.dataUrl : null;
}
