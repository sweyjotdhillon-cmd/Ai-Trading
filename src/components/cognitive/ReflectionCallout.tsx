import React from 'react';
import { Compass, Info, Sparkles } from 'lucide-react';

export interface ReflectionCalloutProps {
  title?: string;
  description: string;
  type?: 'info' | 'mindful' | 'reassurance';
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const ReflectionCallout: React.FC<ReflectionCalloutProps> = ({
  title,
  description,
  type = 'mindful',
  actionLabel,
  onAction,
  className = '',
}) => {
  const styles = {
    mindful: {
      border: 'border-amber-500/30 bg-amber-950/20 text-amber-200/90',
      icon: <Compass size={16} className="text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />,
      tag: 'Mindful Friction',
    },
    reassurance: {
      border: 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200/90',
      icon: <Sparkles size={16} className="text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />,
      tag: 'Psychological Safety',
    },
    info: {
      border: 'border-sky-500/30 bg-sky-950/20 text-sky-200/90',
      icon: <Info size={16} className="text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />,
      tag: 'Decision Insight',
    },
  };

  const currentStyle = styles[type];

  return (
    <div
      role="note"
      aria-label={title || currentStyle.tag}
      className={`p-3.5 rounded-xl border flex items-start gap-3 text-xs leading-relaxed ${currentStyle.border} ${className}`}
    >
      {currentStyle.icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          {title && <span className="font-bold text-zinc-100 font-mono tracking-tight">{title}</span>}
          <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-400 bg-zinc-900/80 px-1.5 py-0.5 rounded border border-zinc-800">
            {currentStyle.tag}
          </span>
        </div>
        <p className="text-zinc-300 font-sans">{description}</p>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="mt-2.5 px-2.5 py-1 text-[11px] font-mono font-semibold text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700/80 active:bg-zinc-900 border border-zinc-700 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
};

export default ReflectionCallout;
