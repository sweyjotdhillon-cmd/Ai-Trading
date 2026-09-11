import React from 'react';
import { ShieldCheck, AlertCircle, HelpCircle } from 'lucide-react';

export interface ConfidenceBadgeProps {
  confidence: number;
  decision?: string;
  signal?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({
  confidence,
  decision,
  signal,
  size = 'md',
  className = '',
}) => {
  const isHighConfidence = confidence >= 60;
  const isModerateConfidence = confidence >= 35 && confidence < 60;

  // Design token styles depending on confidence level and signal
  let badgeColors = 'bg-zinc-800/80 text-zinc-300 border-zinc-700';
  let icon = <HelpCircle size={12} className="text-zinc-400" aria-hidden="true" />;

  if (signal === 'LONG' || decision?.includes('STRONG')) {
    if (isHighConfidence) {
      badgeColors = 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50';
      icon = <ShieldCheck size={12} className="text-emerald-400" aria-hidden="true" />;
    } else if (isModerateConfidence) {
      badgeColors = 'bg-amber-950/60 text-amber-300 border-amber-700/50';
      icon = <AlertCircle size={12} className="text-amber-400" aria-hidden="true" />;
    } else {
      badgeColors = 'bg-zinc-900 text-zinc-400 border-zinc-800';
      icon = <AlertCircle size={12} className="text-zinc-500" aria-hidden="true" />;
    }
  } else if (signal === 'NO_TRADE' || decision === 'WEAK') {
    badgeColors = 'bg-zinc-900/90 text-zinc-400 border-zinc-800';
    icon = <AlertCircle size={12} className="text-zinc-500" aria-hidden="true" />;
  }

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-[10px] gap-1',
    md: 'px-2 py-1 text-[11px] gap-1.5',
    lg: 'px-3 py-1.5 text-xs gap-2',
  };

  const formattedLabel = `Signal Confidence: ${confidence}% ${
    decision ? `(${decision})` : ''
  }`;

  return (
    <div
      role="status"
      aria-label={formattedLabel}
      className={`inline-flex items-center font-mono font-semibold rounded border ${sizeClasses[size]} ${badgeColors} ${className}`}
    >
      {icon}
      <span>{confidence}%</span>
      {decision && (
        <span className="opacity-80 font-normal uppercase tracking-wider text-[90%]">
          • {decision}
        </span>
      )}
    </div>
  );
};

export default ConfidenceBadge;
