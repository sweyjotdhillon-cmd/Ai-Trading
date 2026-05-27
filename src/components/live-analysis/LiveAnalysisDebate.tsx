import { Text, ActivityIndicator } from 'react-native';
import tw from 'twrnc';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';

interface Props {
  loading: boolean;
  analysisStep: string | null;
  judgeLogs: {
    system: { text: string; status: string };
    judge1: { text: string; status: string };
    judge2: { text: string; status: string };
    judge3: { text: string; status: string };
    judge4: { text: string; status: string };
  };
  prefersReducedMotion: boolean;
}

export function LiveAnalysisDebate({
  loading,
  analysisStep,
  judgeLogs,
  prefersReducedMotion
}: Props) {
  if (!loading) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-[#14161C] rounded-2xl border border-[#D9B382] border-opacity-20 p-4 mt-4 shadow-2xl relative overflow-hidden"
    >
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(#D9B382_1px,transparent_1px)] [background-size:16px_16px]" />
        <motion.div
          animate={{ y: [0, 200, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          className="absolute top-0 left-0 right-0 h-px bg-[#D9B382] shadow-[0_0_15px_#D9B382]"
        />
      </div>

      <div style={tw`flex-row items-center justify-between mb-4 border-b border-white border-opacity-10 pb-3 relative z-10`}>
        <div style={tw`flex-row items-center gap-2`}>
           <ActivityIndicator color="#D9B382" size="small" />
           <motion.div animate={prefersReducedMotion ? {} : { scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} style={{ display: 'contents' }}>
           <Text style={[tw`font-black uppercase tracking-widest`, { fontSize: 10, color: '#D9B382' }]}>
             {analysisStep || 'Live Neural Debate Active'}
           </Text>
           </motion.div>
        </div>
        <Text style={[tw`tracking-widest uppercase`, { fontSize: 8, color: '#8B95B0' }]}>Simultaneous execution</Text>
      </div>

      <div style={tw`gap-3 relative z-10`}>
        {[
          { key: 'system', label: 'System Context', color: '#00FFFF', bg: 'rgba(0, 255, 255, 0.05)' },
          { key: 'judge1', label: 'Judge 1: Trend & Momentum', color: '#FF00FF', bg: 'rgba(255, 0, 255, 0.05)' },
          { key: 'judge2', label: 'Judge 2: Oscillator Consensus', color: '#FF1493', bg: 'rgba(255, 20, 147, 0.05)' },
          { key: 'judge3', label: 'Skeptic: Veto Multiplier', color: '#39FF14', bg: 'rgba(57, 255, 20, 0.05)' },
          { key: 'judge4', label: 'Judge 3: Boundary/Reversal', color: '#EAB308', bg: 'rgba(234, 179, 8, 0.05)' }
        ].map((item, idx) => (
          <motion.div
            key={item.key}
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-black bg-opacity-20 p-3 rounded-lg flex-row items-center justify-between border-l-4"
            style={{ borderColor: item.color, backgroundColor: item.bg }}
          >
            <div style={tw`flex-1`}>
              <div className="flex flex-row items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                <Text style={[tw`font-black uppercase tracking-widest`, { fontSize: 9, color: item.color }]}>{item.label}</Text>
              </div>
              <motion.p
                key={judgeLogs[item.key as keyof typeof judgeLogs].text}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-white font-bold text-xs"
              >
                {judgeLogs[item.key as keyof typeof judgeLogs].text}
              </motion.p>
            </div>
            {judgeLogs[item.key as keyof typeof judgeLogs].status === 'done' ? (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-2">
                <Check size={16} color={item.color} />
              </motion.div>
            ) : (
              <div className="flex flex-row items-end gap-0.5 h-3">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ height: [2, 8, 2] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                    className="w-0.5 bg-white/20"
                  />
                ))}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
