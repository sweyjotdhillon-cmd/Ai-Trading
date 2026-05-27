import React from 'react';

interface TestResultCandleChartProps {
  ohlcSeries?: any[];
  candlesCut?: number;
  tradingDirection?: 'UP' | 'DOWN' | 'NO_TRADE';
  actualDirection?: 'UP' | 'DOWN' | 'FLAT' | null;
  entryClose?: number;
  exitClose?: number;
  expectedProfitText?: string;
  isBulkItem?: boolean;
}

export const TestResultCandleChart: React.FC<TestResultCandleChartProps> = ({
  ohlcSeries = [],
  candlesCut = 8,
  tradingDirection = 'NO_TRADE',
  actualDirection = null,
  entryClose,
  exitClose,
  expectedProfitText = '+₹36.60 (83%)',
  isBulkItem = false
}) => {
  // If we don't have enough candles, let's generate a stunning representative dummy series
  // so the user gets an interactive imaginary line guide even for low-fidelity fallback streams
  const sList = ohlcSeries && ohlcSeries.length >= 10 ? [...ohlcSeries] : Array.from({ length: 40 }).map((_, i) => {
    const isPast = i < 30;
    const isUpTrend = tradingDirection === 'UP' || (tradingDirection === 'NO_TRADE' && i % 2 === 0);
    const trendOffset = isPast ? -i * 0.1 : (isUpTrend ? (i - 30) * 0.4 : -(i - 30) * 0.4);
    
    // Create base
    const prevClose = 50 + trendOffset;
    const rnd = Math.random() * 2 - 1;
    const isBull = rnd > 0;
    const open = prevClose;
    const close = prevClose + (isBull ? 2.5 : -2.5) + (Math.random() * 2 - 1);
    
    return {
      open,
      close,
      high: Math.max(open, close) + Math.random() * 2,
      low: Math.min(open, close) - Math.random() * 2,
      xCenter: i * 20,
      isBull: close >= open
    };
  });

  const nCut = Math.max(1, candlesCut || Math.floor(sList.length * 0.2) || 8);
  const cutIndex = Math.max(5, sList.length - nCut);
  
  const leftCandles = sList.slice(0, cutIndex);
  const rightCandles = sList.slice(cutIndex);

  // Compute stats
  const highs = sList.map(c => c.high);
  const lows = sList.map(c => c.low);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const priceRange = maxPrice - minPrice || 1;

  // Layout parameters
  const svgW = 500;
  const svgH = 220;
  const padT = 32;
  const padB = 24;
  const padL = 36;
  const padR = 36;

  const chartW = svgW - padL - padR;
  const chartH = svgH - padT - padB;

  const mapX = (index: number) => {
    return padL + (index / (sList.length - 1)) * chartW;
  };

  const mapY = (val: number) => {
    // Standard Coordinate mapping: Visually higher price -> Lower SVG Y coordinate (closer to top)
    return padT + chartH - ((val - minPrice) / priceRange) * chartH;
  };

  // Derive entry and exit closes if missing
  const derivedEntryClose = entryClose !== undefined ? entryClose : leftCandles[leftCandles.length - 1]?.close || 50;
  const derivedExitClose = exitClose !== undefined ? exitClose : rightCandles[rightCandles.length - 1]?.close || derivedEntryClose;

  // Determine Support and Resistance (local extremes of the past window)
  const leftLows = leftCandles.map(c => c.low);
  const leftHighs = leftCandles.map(c => c.high);
  const supportPrice = Math.min(...leftLows, minPrice);
  const resistancePrice = Math.max(...leftHighs, maxPrice);

  const entryY = mapY(derivedEntryClose);
  const exitY = mapY(derivedExitClose);
  const supportY = mapY(supportPrice);
  const resistanceY = mapY(resistancePrice);
  const cutX = mapX(cutIndex - 0.5);

  const isPredictUp = tradingDirection === 'UP';
  const isPredictDown = tradingDirection === 'DOWN';

  return (
    <div className={`bg-[#0A0D14] rounded-xl border border-white/10 overflow-hidden shadow-2xl relative select-none w-full ${isBulkItem ? 'p-2' : 'p-4'}`}>
      {/* Header Info Banner */}
      <div className="flex flex-row items-center justify-between border-b border-white/5 pb-2 mb-2 font-sans">
        <div className="flex items-center gap-2">
          <div className="bg-[#10B981]/15 px-2 py-0.5 rounded border border-[#10B981]/20">
            <span className="text-[#10B981] font-mono text-[9px] font-black uppercase tracking-wider">
              {expectedProfitText || '+83% EXPECTED'}
            </span>
          </div>
          <span className="text-white/40 text-[9px] uppercase tracking-wider font-bold">
            Auto Result Chart
          </span>
        </div>
        
        {/* Dynamic Legend showing we strictly distinguish bull vs bear candle anatomy */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-black/30 px-2 py-0.5 rounded border border-white/5">
            <div className="w-1.5 h-3 bg-emerald-500 rounded-sm" />
            <div className="text-[8px] text-white/70 font-mono">
              <span className="text-emerald-400 font-bold">BULL</span> (Close: Top)
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-black/30 px-2 py-0.5 rounded border border-white/5">
            <div className="w-1.5 h-3 bg-red-500 rounded-sm" />
            <div className="text-[8px] text-white/70 font-mono">
              <span className="text-red-400 font-bold">BEAR</span> (Close: Bottom)
            </div>
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" className="block overflow-visible">
        <defs>
          <filter id="glow-candle">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Vertical Separator: Analysis Line */}
        <line
          x1={cutX}
          y1={padT}
          x2={cutX}
          y2={padT + chartH}
          stroke="#38BDF8"
          strokeWidth="1.5"
          strokeDasharray="4,4"
        />

        {/* Left Side (Analyzed Past) Background Tint */}
        <rect
          x={padL}
          y={padT}
          width={cutX - padL}
          height={chartH}
          fill="rgba(217, 179, 130, 0.02)"
        />

        {/* Right Side (Outcome Window) Background Tint */}
        <rect
          x={cutX}
          y={padT}
          width={padL + chartW - cutX}
          height={chartH}
          fill="rgba(88, 143, 255, 0.02)"
        />

        {/* Grid Lines */}
        <line x1={padL} y1={padT + chartH * 0.25} x2={padL + chartW} y2={padT + chartH * 0.25} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
        <line x1={padL} y1={padT + chartH * 0.5} x2={padL + chartW} y2={padT + chartH * 0.5} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
        <line x1={padL} y1={padT + chartH * 0.75} x2={padL + chartW} y2={padT + chartH * 0.75} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />

        {/* Support & Resistance Horizontal Reference Lines */}
        <line
          x1={padL}
          y1={supportY}
          x2={cutX}
          y2={supportY}
          stroke="#D9B382"
          strokeWidth="0.8"
          strokeDasharray="2,3"
          opacity="0.6"
        />
        <text
          x={padL + 5}
          y={supportY - 3}
          fill="#D9B382"
          fontSize="7"
          fontWeight="bold"
          opacity="0.8"
        >
          SUPPORT LEVEL
        </text>

        <line
          x1={padL}
          y1={resistanceY}
          x2={cutX}
          y2={resistanceY}
          stroke="#F87171"
          strokeWidth="0.8"
          strokeDasharray="2,3"
          opacity="0.6"
        />
        <text
          x={padL + 5}
          y={resistanceY + 8}
          fill="#F87171"
          fontSize="7"
          fontWeight="bold"
          opacity="0.8"
        >
          RESISTANCE LEVEL
        </text>

        {/* Horizontal Entry Line from Separator to Right */}
        <line
          x1={cutX}
          y1={entryY}
          x2={padL + chartW}
          y2={entryY}
          stroke="#8B95B0"
          strokeWidth="1"
          strokeDasharray="2,2"
          opacity="0.75"
        />
        
        {/* Draw Candlesticks */}
        {sList.map((c, i) => {
          const cx = mapX(i);
          const top = mapY(Math.max(c.open, c.close));
          const bot = mapY(Math.min(c.open, c.close));
          const bodyH = Math.max(1, Math.abs(top - bot));
          const wickT = mapY(c.high);
          const wickB = mapY(c.low);
          
          const isBull = c.isBull;
          const strokeColor = isBull ? '#10B981' : '#EF4444';
          const fillColor = isBull ? '#0F5132' : '#5C1D24'; // fill for bodies
          
          // Size of individual candles
          const bw = Math.max(3, Math.min(10, (chartW / sList.length) * 0.65));

          return (
            <g key={i} className="cursor-pointer">
              {/* Wick */}
              <line
                x1={cx}
                y1={wickT}
                x2={cx}
                y2={wickB}
                stroke={strokeColor}
                strokeWidth="1.2"
              />
              {/* Body */}
              <rect
                x={cx - bw / 2}
                y={top}
                width={bw}
                height={bodyH}
                fill={isBull ? '#10B981' : '#EF4444'}
                stroke={strokeColor}
                strokeWidth="0.5"
                rx="0.5"
                opacity="0.95"
              />
            </g>
          );
        })}

        {/* Overlay Labels and Predicted Trajectory Path (Orange glowing dots & target) - ALWAYS rendered */}
        <g>
          {/* Draw Path */}
          <path
            d={isPredictUp 
              ? `M ${cutX} ${entryY} Q ${(cutX + svgW - padR) / 2} ${entryY - 30}, ${svgW - padR - 15} ${entryY - 50}`
              : isPredictDown
                ? `M ${cutX} ${entryY} Q ${(cutX + svgW - padR) / 2} ${entryY + 30}, ${svgW - padR - 15} ${entryY + 50}`
                : `M ${cutX} ${entryY} Q ${(cutX + svgW - padR) / 2} ${entryY - 10}, ${svgW - padR - 15} ${entryY}`
            }
            fill="none"
            stroke="#D9B382"
            strokeWidth="2"
            strokeDasharray="5,4"
            filter="url(#glow-candle)"
          />

          {/* Path glow bullet circles */}
          <circle
            cx={(cutX + svgW - padR - 15) / 2 + 10}
            cy={isPredictUp ? entryY - 25 : isPredictDown ? entryY + 25 : entryY - 5}
            r="4"
            fill="#D9B382"
            filter="url(#glow-candle)"
          />

          {/* Target Circle */}
          <circle
            cx={svgW - padR - 15}
            cy={isPredictUp ? entryY - 50 : isPredictDown ? entryY + 50 : entryY}
            r="7"
            fill="#D9B382"
            filter="url(#glow-candle)"
          />
          <circle
            cx={svgW - padR - 15}
            cy={isPredictUp ? entryY - 50 : isPredictDown ? entryY + 50 : entryY}
            r="3"
            fill="#0A0D14"
          />

          {/* Explanatory callouts on the trajectory */}
          <g transform={`translate(${(cutX + svgW - padR - 15) / 2}, ${isPredictUp ? entryY - 40 : isPredictDown ? entryY + 40 : entryY - 15})`}>
            <rect
              x="-35"
              y="-7"
              width="70"
              height="14"
              rx="3"
              fill="rgba(0, 0, 0, 0.85)"
              stroke="#D9B382"
              strokeWidth="0.5"
            />
            <text
              fontFamily="sans-serif"
              fontSize="6"
              fontWeight="bold"
              fill="#D9B382"
              textAnchor="middle"
              y="2"
            >
              {isPredictUp ? 'UPWARD TARGET' : isPredictDown ? 'SUPPORT BROKEN' : 'RANGE BOUND'}
            </text>
          </g>

          {/* Imaginary Auto-Grade Outcome Trajectory Path */}
          {actualDirection && (
            <g>
              <path
                d={`M ${cutX} ${entryY} Q ${(cutX + svgW - padR) / 2} ${(entryY + exitY) / 2 - 12}, ${svgW - padR - 15} ${exitY}`}
                fill="none"
                stroke={actualDirection === 'UP' ? '#10B981' : actualDirection === 'DOWN' ? '#EF4444' : '#38BDF8'}
                strokeWidth="2"
                strokeDasharray="3,3"
                opacity="0.8"
                filter="url(#glow-candle)"
              />
              
              {/* Actual Outcome Node */}
              <circle
                cx={svgW - padR - 15}
                cy={exitY}
                r="6"
                fill={actualDirection === 'UP' ? '#10B981' : actualDirection === 'DOWN' ? '#EF4444' : '#38BDF8'}
                filter="url(#glow-candle)"
              />
              <circle
                cx={svgW - padR - 15}
                cy={exitY}
                r="2"
                fill="#0A0D14"
              />

              {/* Dynamic Auto-Grade Line Annotation text callout */}
              <g transform={`translate(${(cutX + svgW - padR - 15) / 2 + 10}, ${exitY > entryY ? exitY + 16 : exitY - 16})`}>
                <rect
                  x="-42"
                  y="-6"
                  width="84"
                  height="12"
                  rx="2.5"
                  fill="rgba(0, 0, 0, 0.9)"
                  stroke={actualDirection === 'UP' ? '#10B981' : actualDirection === 'DOWN' ? '#EF4444' : '#38BDF8'}
                  strokeWidth="0.8"
                />
                <text
                  fontFamily="monospace"
                  fontSize="5.5"
                  fontWeight="bold"
                  fill={actualDirection === 'UP' ? '#10B981' : actualDirection === 'DOWN' ? '#EF4444' : '#38BDF8'}
                  textAnchor="middle"
                  y="2.5"
                >
                  AUTOGRADE OUTCOME: {actualDirection}
                </text>
              </g>
            </g>
          )}

          {/* Predicted action badge label on outcome screen */}
          <g transform={`translate(${chartW + padL - 60}, ${isPredictUp ? entryY - 72 : isPredictDown ? entryY + 68 : entryY - 32})`}>
            <rect
              x="-40"
              y="-9"
              width="80"
              height="18"
              rx="4"
              fill="rgba(0,0,0,0.9)"
              stroke={isPredictUp ? '#10B981' : isPredictDown ? '#EF4444' : '#D9B382'}
              strokeWidth="1.2"
            />
            <text
              fontSize="7.5"
              fontFamily="sans-serif"
              fontWeight="900"
              fill={isPredictUp ? '#10B981' : isPredictDown ? '#EF4444' : '#D9B382'}
              textAnchor="middle"
              y="3"
            >
              {isPredictUp ? 'PREDICTED UP' : isPredictDown ? 'PREDICTED DOWN' : 'NO TRADE ZONE'}
            </text>
          </g>
        </g>

        {/* Labels on vertical boundaries */}
        {/* Analysis partition line badge */}
        <g transform={`translate(${cutX}, ${padT + 12})`}>
          <rect
            x="-40"
            y="-7"
            width="80"
            height="14"
            rx="3"
            fill="#091320"
            stroke="#38BDF8"
            strokeWidth="1"
          />
          <text
            fontSize="6"
            fontFamily="monospace"
            fontWeight="black"
            fill="#38BDF8"
            textAnchor="middle"
            y="2"
          >
            ANALYSIS LINE
          </text>
        </g>

        {/* Left Hand side / Right Hand side titles */}
        <text
          x={padL + 12}
          y={padT - 10}
          fill="rgba(255,255,255,0.4)"
          fontSize="8"
          fontWeight="bold"
          fontFamily="sans-serif"
          letterSpacing="1"
        >
          ANALYZED (PAST)
        </text>

        <text
          x={padL + chartW - 60}
          y={padT - 10}
          fill="#D9B382"
          fontSize="8"
          fontWeight="bold"
          fontFamily="sans-serif"
          letterSpacing="1"
        >
          OUTCOME
        </text>
      </svg>
      {/* Bottom detailed stats footer bar */}
      <div className="flex flex-row items-center justify-between mt-2 pt-2 border-t border-white/5 font-mono text-[9px] text-white/50">
        <div>
          <span>ENTRY CLOSE: </span>
          <span className="text-white font-bold">${derivedEntryClose.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>EXIT CLOSE: </span>
          <span className={`font-bold ${derivedExitClose > derivedEntryClose ? 'text-green-400' : 'text-red-400'}`}>
            ${derivedExitClose.toFixed(2)}
          </span>
          <span className="text-white/20">|</span>
          <span className={`font-mono text-[8px] font-bold px-1 rounded ${actualDirection === 'UP' ? 'bg-green-500/10 text-green-400' : actualDirection === 'DOWN' ? 'bg-red-500/10 text-red-400' : 'bg-white/10 text-white'}`}>
            {actualDirection || 'FLAT'}
          </span>
        </div>
      </div>
    </div>
  );
};
