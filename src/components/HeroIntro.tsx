import React, { useState, useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ParticleOrb } from "./ParticleOrb";
import { TerminalPreview } from "./TerminalPreview";

const words = ["Read.", "Reason.", "Execute."];

export function HeroIntro({ onLaunch }: { onLaunch?: () => void }) {
  const prefersReducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="relative w-full h-full min-h-[100dvh] flex flex-col overflow-x-hidden overflow-y-auto bg-black text-white font-sans selection:bg-gold/30">
      {/* Background Orbital */}
      <div className="absolute top-0 left-0 w-full h-[100dvh] z-0 opacity-80 pointer-events-none">
        <ParticleOrb />
      </div>
      
      {/* Top Navigation */}
      <header className="relative z-10 w-full pt-6 md:pt-8 px-6 lg:px-12 flex justify-center sm:justify-start">
        <motion.div 
          initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="flex items-center gap-3"
        >
          <div className="w-2 h-2 rounded-full bg-gold animate-pulse" />
          <span className="font-mono text-xs md:text-sm tracking-[0.2em] uppercase text-gray-300">
            ChartLens <span className="opacity-40 px-2">·</span> Pro Terminal
          </span>
        </motion.div>
      </header>

      {/* Main Hero Content */}
      <main className="relative z-10 flex flex-col items-center justify-center px-4 sm:px-6 w-full text-center pt-16 pb-8 md:pt-24 md:pb-12 flex-grow">
        <div className="w-full max-w-4xl mx-auto flex flex-col items-center">
          
          <h1 className="font-display text-5xl md:text-7xl lg:text-[90px] font-bold leading-[1.05] tracking-tight mb-6">
            {words.map((w, i) => (
              <motion.div
                key={w}
                initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 20, rotateX: 10 }}
                animate={mounted ? { opacity: 1, y: 0, rotateX: 0 } : {}}
                transition={{ duration: 0.5, delay: prefersReducedMotion ? 0 : i * 0.1 + 0.1, ease: [0.16, 1, 0.3, 1] }}
                className={i === 1 ? "text-gradient-gold" : "text-white"}
              >
                {w}
              </motion.div>
            ))}
          </h1>

          <motion.p 
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 15 }}
            animate={mounted ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: prefersReducedMotion ? 0 : 0.4, ease: "easeOut" }}
            className="w-full text-gray-400 text-sm md:text-xl font-medium max-w-2xl mx-auto mb-10 leading-relaxed px-2"
          >
            Multi-agent market intelligence that debates every chart before it tells you what to do.
          </motion.p>

          <motion.div
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 20, scale: 0.95 }}
            animate={mounted ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ duration: 0.5, delay: prefersReducedMotion ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center gap-6"
          >
            <button
              onClick={onLaunch}
              className="bg-gold text-[#1A1308] px-10 py-5 rounded-full font-bold text-lg hover:scale-105 hover:bg-gold-bright transition-all active:scale-95 shadow-[0_0_40px_rgba(217,179,130,0.3)] flex items-center gap-3"
            >
              Launch Terminal
              <span className="text-xl">→</span>
            </button>
            <button className="text-gray-400 hover:text-gold uppercase tracking-[0.2em] text-xs font-mono font-bold transition-colors">
              See how it thinks
            </button>
          </motion.div>
        </div>
      </main>

      {/* Embedded Terminal Preview */}
      <div className="w-full relative z-10 px-4 sm:px-6 pb-12 overflow-hidden flex flex-col items-center">
        <TerminalPreview />
      </div>

      {/* Live Ticker Rail */}
      <div className="relative z-10 w-full overflow-hidden border-t border-white/5 bg-black/60 backdrop-blur-md py-4">
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 1.2 }}
          className="flex whitespace-nowrap animate-ticker"
        >
          {[...Array(2)].map((_, k) => (
            <div key={k} className="flex gap-12 px-6 items-center">
              {[
                ["BTC/USD","67,420.18","+2.41%"],["ETH/USD","3,210.55","+1.88%"],
                ["XAU/USD","2,418.30","-0.32%"],["EUR/USD","1.0842","+0.12%"],
                ["NAS100","20,114.7","+1.04%"],["SOL/USD","164.22","+5.12%"],
                ["GBP/JPY","198.41","-0.21%"]
              ].map(([s, p, c], i) => (
                <div key={i} className="flex items-center gap-3 font-mono text-sm">
                  <span className="text-gray-500 font-bold">{s}</span>
                  <span className="text-gray-200">{p}</span>
                  <span className={c.startsWith('+') ? "text-emerald" : "text-crimson"}>{c}</span>
                </div>
              ))}
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
