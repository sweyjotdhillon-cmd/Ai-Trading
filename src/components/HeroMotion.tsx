import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronDown, ArrowRight } from 'lucide-react';
import * as THREE from 'three';

import HeroScene from './HeroScene';

interface HeroMotionProps {
  onStart: () => void;
}

export function HeroMotion({ onStart }: HeroMotionProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [warpPhase, setWarpPhase] = useState(0);
  const reducedMotion = useReducedMotion();

  const handleStart = () => {
    if (reducedMotion) {
      onStart();
      return;
    }
    setWarpPhase(1);
    setTimeout(() => {
      setWarpPhase(2);
      setTimeout(() => {
        onStart();
      }, 300);
    }, 400);
  };

  const textLines = ["TRADE", "WITH", "PRECISION."];

  return (
    <div className="relative w-full h-[100vh] min-h-[600px] bg-[#05070A] overflow-hidden flex flex-col items-center justify-center font-sans tracking-tight">
      {/* 3D Canvas Layer */}
      <div className="absolute inset-0 z-0 bg-[#05070A]">
          <Canvas 
            dpr={[1, 1.75]} 
            frameloop="always" 
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
            camera={{ fov: 35, position: [0, 0, 14] }}
          >
            <HeroScene isHovered={isHovered} warpPhase={warpPhase} reducedMotion={reducedMotion} />
          </Canvas>
      </div>

      {/* DOM Overlay z-10 */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center mt-[-5%] px-4 pointer-events-none">
        
        {/* Eyebrow */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, duration: 0.8 }}
          className="mb-4"
        >
          <span className="text-[#D9B382] font-mono text-xs sm:text-sm tracking-[0.2em] uppercase font-bold">
            // LIVE_MARKET_INTELLIGENCE
          </span>
        </motion.div>

        {/* Title Stagger */}
        <div className="flex flex-col items-center mb-6">
          {textLines.map((line, i) => {
             const isLast = i === textLines.length - 1;
             return (
              <div key={line} className="overflow-hidden">
                <motion.h1
                  initial={{ y: "100%", filter: "blur(6px)" }}
                  animate={{ y: "0%", filter: "blur(0px)" }}
                  transition={{ delay: 1.5 + (i * 0.15), duration: 0.8, ease: "easeOut" }}
                  className={`text-6xl sm:text-7xl md:text-8xl font-black uppercase text-center leading-[0.9] pb-2 ${
                    isLast ? "bg-clip-text text-transparent bg-[length:200%_auto] animate-shimmer" : "text-[#E8ECF4]"
                  }`}
                  style={{ fontFamily: "'Anton', sans-serif", ...(isLast ? { backgroundImage: "linear-gradient(90deg, #A67C52, #E8D5B5, #D9B382, #A67C52)" } : {}) }}
                >
                  {line}
                </motion.h1>
              </div>
             )
          })}
        </div>

        {/* Sub-copy */}
        <motion.div
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           transition={{ delay: 1.8, duration: 1 }}
        >
          <p className="text-[#8E9299] max-w-md text-sm sm:text-base mb-10 px-4 font-inter leading-relaxed">
            AI-debated signals. Statistical edge. Loss autopsy on every trade.
          </p>
        </motion.div>

        {/* CTA */}
        <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 2.0, duration: 0.8 }}
           className="pointer-events-auto"
        >
          <motion.button
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={handleStart}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            className="flex flex-row items-center justify-center gap-3 px-8 py-4 rounded-xl bg-gradient-to-r from-[#A67C52] via-[#D9B382] to-[#A67C52] bg-[length:200%_auto] hover:animate-shimmer text-[#05070A] font-black uppercase tracking-widest text-sm shadow-[0_0_30px_rgba(217,179,130,0.3)] border border-[#E8D5B5]/30 overflow-hidden relative transition-transform"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Start Live Analysis
            <ArrowRight size={18} />
          </motion.button>
        </motion.div>

      </div>

      {/* Ticker Strip */}
      <div className="absolute bottom-16 sm:bottom-12 w-full overflow-hidden border-y border-white/5 bg-[#111318]/50 py-2 backdrop-blur-sm pointer-events-none z-10 hidden sm:block">
        <div className="flex whitespace-nowrap animate-marquee">
          {Array(8).fill(null).map((_, i) => (
            <div key={i} className="flex flex-row items-center mx-4 sm:mx-8 gap-4 sm:gap-8 opacity-60">
              <span className="text-white font-mono text-xs font-black">BTC/USD <span className="text-[#22C55E]">69,450.00</span></span>
              <span className="text-white/20">•</span>
              <span className="text-white font-mono text-xs font-black">EUR/USD <span className="text-[#EF4444]">1.0842</span></span>
              <span className="text-white/20">•</span>
              <span className="text-[#D9B382] font-mono text-xs font-black">AI CONFIDENCE <span className="text-[#22C55E]">92%</span></span>
              <span className="text-white/20">•</span>
              <span className="text-[#D9B382] font-mono text-xs font-black">WIN-RATE <span className="text-white">68.4%</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll Hint */}
      <motion.div 
        className="absolute bottom-6 flex justify-center w-full opacity-40 pointer-events-none z-10"
        animate={{ y: [0, 8, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <ChevronDown className="text-[#D9B382]" size={24} />
      </motion.div>
    </div>
  );
}
