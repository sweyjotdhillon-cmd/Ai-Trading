import React from "react";
import { motion, useReducedMotion } from "motion/react";

export function TerminalPreview() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="w-full max-w-5xl mx-auto mt-6 md:mt-10 mb-0 px-0 relative z-10 flex-shrink-0">
      <motion.div
        initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 20 }}
        whileInView={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "0px" }}
        transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
        className="rounded-2xl border border-white/10 bg-black/50 backdrop-blur-xl overflow-hidden glass-card shadow-elevated w-full"
      >
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <div className="flex gap-2 items-center">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <div className="font-mono text-xs text-gray-500 tracking-widest">POCKET_QUANT_V1.0</div>
          <div className="w-16"></div> {/* Spacer for centering */}
        </div>

        {/* Terminal Body */}
        <div className="p-4 md:p-6 flex flex-col md:flex-row gap-6">
          
          {/* Mock Chart Area */}
          <div className="flex-1 relative h-48 sm:h-64 md:h-auto border border-white/5 rounded-lg bg-black/40 overflow-hidden flex items-end px-3 pb-3">
            {/* Grid Lines */}
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
            
            <div className="relative z-10 w-full h-3/4 flex items-end justify-between gap-1 md:gap-2">
              {[40, 60, 45, 80, 55, 75, 90, 65, 85, 100].map((h, i) => (
                <motion.div 
                  key={i}
                  initial={prefersReducedMotion ? { height: `${h}%` } : { height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ duration: 0.6, delay: i * 0.04, type: "spring" }}
                  className={`w-full rounded-t-sm ${i > 0 && h > [40, 60, 45, 80, 55, 75, 90, 65, 85, 100][i-1] ? 'bg-emerald/80' : 'bg-crimson/80'}`}
                />
              ))}
            </div>
          </div>

          {/* Side Panel / Logs */}
          <div className="w-full md:w-80 flex flex-col gap-4 font-mono text-xs">
            <div className="border border-gold/20 bg-gold/5 rounded-lg p-4">
              <div className="text-gold mb-2 font-bold uppercase tracking-wider">Scout Activated</div>
              <div className="flex justify-between text-gray-400 mb-1">
                <span>Confidence</span>
                <span className="text-white">92.4%</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Signal</span>
                <span className="text-emerald font-bold">LONG [BTC/USD]</span>
              </div>
            </div>

            <div className="flex-1 border border-white/5 bg-black/40 rounded-lg p-4 overflow-hidden relative">
              <div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-black/80 to-transparent z-10" />
              <div className="absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-black/80 to-transparent z-10" />
              <motion.div 
                animate={prefersReducedMotion ? {} : { y: [-100, 0] }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="flex flex-col gap-2 text-gray-500"
              >
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="whitespace-nowrap">
                    <span className="text-gray-600">[{new Date().toISOString().split('T')[1].slice(0,-1)}]</span>{' '}
                    {i % 2 === 0 ? "Analyzing sequence bounds..." : "Re-evaluating OHLC delta..."}
                  </div>
                ))}
              </motion.div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
