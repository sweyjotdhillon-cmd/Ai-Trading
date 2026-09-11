import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

export interface RiskBoundaryCardProps {
  title?: string;
  drawdownLimitPct?: number;
  currentDrawdownPct?: number;
  cooldownActive?: boolean;
  warnings?: string[];
  className?: string;
}

export const RiskBoundaryCard: React.FC<RiskBoundaryCardProps> = ({
  title = 'Risk Boundary Guard',
  drawdownLimitPct = 15,
  currentDrawdownPct = 0,
  cooldownActive = false,
  warnings = [],
  className = '',
}) => {
  const isBoundaryExceeded = currentDrawdownPct >= drawdownLimitPct || cooldownActive;
  const hasWarnings = warnings.length > 0;

  return (
    <div
      role="region"
      aria-label="Risk Boundary Guard"
      className={`p-3.5 rounded-xl border flex flex-col gap-2.5 bg-zinc-900/60 border-zinc-800/80 shadow-sm ${className}`}
    >
      <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
        <div className="flex items-center gap-2">
          {isBoundaryExceeded ? (
            <ShieldAlert size={15} className="text-rose-400" aria-hidden="true" />
          ) : (
            <ShieldCheck size={15} className="text-emerald-400" aria-hidden="true" />
          )}
          <span className="text-xs font-bold text-zinc-100 font-mono">{title}</span>
        </div>
        <span
          className={`text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded border ${
            isBoundaryExceeded
              ? 'bg-rose-950/80 text-rose-300 border-rose-800/60'
              : 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60'
          }`}
        >
          {isBoundaryExceeded ? 'Boundary Active' : 'Normal Operations'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        <div className="bg-zinc-950/40 p-2 rounded border border-zinc-800/50">
          <span className="text-zinc-500 text-[9px] uppercase block">Max Drawdown Limit</span>
          <span className="text-zinc-200 font-bold">{drawdownLimitPct}%</span>
        </div>
        <div className="bg-zinc-950/40 p-2 rounded border border-zinc-800/50">
          <span className="text-zinc-500 text-[9px] uppercase block">Current Drawdown</span>
          <span
            className={`font-bold ${
              currentDrawdownPct >= drawdownLimitPct ? 'text-rose-400' : 'text-zinc-300'
            }`}
          >
            {currentDrawdownPct.toFixed(2)}%
          </span>
        </div>
      </div>

      {hasWarnings && (
        <div className="mt-0.5 space-y-1">
          {warnings.map((msg, index) => (
            <div
              key={index}
              className="text-[11px] text-amber-300/90 bg-amber-950/30 border border-amber-800/40 px-2 py-1 rounded flex items-start gap-1.5 font-sans"
            >
              <span className="text-amber-400 font-mono font-bold">•</span>
              <span>{msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RiskBoundaryCard;
