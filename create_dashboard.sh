#!/bin/bash
cat << 'INNER_EOF' > src/components/live-analysis/LiveAnalysisDashboard.tsx
import { View, Text, Pressable, TextInput, Image, Platform } from 'react-native';
import tw from 'twrnc';
import { motion } from 'motion/react';
import { ChevronDown, Camera, Layers, Activity, Upload, FileText } from 'lucide-react';
import { BulkTestPanel } from '../BulkTestPanel';

interface Props {
  symbols: { name: string; icon: string }[];
  stockName: string;
  setStockName: (val: string) => void;
  graphTimeframe: string;
  setGraphTimeframe: (val: string) => void;
  showTfPicker: boolean;
  setShowTfPicker: (val: boolean) => void;
  timeframes: string[];
  investmentDuration: string;
  setInvestmentDuration: (val: string) => void;
  showDurPicker: boolean;
  setShowDurPicker: (val: boolean) => void;
  durations: string[];
  investmentAmount: string;
  setInvestmentAmount: (val: string) => void;
  profitabilityPercent: string;
  setProfitabilityPercent: (val: string) => void;
  mode: 'live' | 'test' | 'bulk';
  setMode: (val: 'live' | 'test' | 'bulk') => void;
  isCameraActive: boolean;
  startCamera: () => void;
  stopCamera: () => void;
  videoRef: React.RefObject<any>;
  pipActive: boolean;
  scoutActive: boolean;
  scoutData: { action: string; reason: string } | null;
  handlePickImage: () => void;
  handleDrop: (e: any) => void;
  preventDefault: (e: any) => void;
  selectedImage: string | null;
  techniquesList: string[];
  encryptedSystemTokens: string | undefined;
  saveToStats: (analysisData: any, outcome: 'WIN' | 'LOSS') => void;
  prefersReducedMotion: boolean;
  springProps: any;
  buttonHoverProps: any;
  buttonTapProps: any;
  cardHoverProps: any;
  techFileName: string | null;
  handlePickTechnique: () => void;
}

export function LiveAnalysisDashboard({
  symbols, stockName, setStockName,
  graphTimeframe, setGraphTimeframe, showTfPicker, setShowTfPicker, timeframes,
  investmentDuration, setInvestmentDuration, showDurPicker, setShowDurPicker, durations,
  investmentAmount, setInvestmentAmount, profitabilityPercent, setProfitabilityPercent,
  mode, setMode, isCameraActive, startCamera, stopCamera, videoRef, pipActive,
  scoutActive, scoutData, handlePickImage, handleDrop, preventDefault, selectedImage,
  techniquesList, encryptedSystemTokens, saveToStats,
  springProps, buttonHoverProps, buttonTapProps, cardHoverProps,
  techFileName, handlePickTechnique
}: Props) {
  return (
    <>
      <View style={tw`flex-row justify-between items-end mb-4 px-1 mt-12`}>
        <View>
          <Text style={tw`text-[#D9B382] text-[8px] font-black tracking-[3px] uppercase`}>Pro Terminal v2</Text>
          <Text style={tw`text-white text-2xl font-black`}>DASHBOARD</Text>
        </View>
        <View style={tw`flex-row gap-2`}>
          <Pressable
            onPress={handlePickTechnique}
            accessibilityRole="button"
            accessibilityLabel="Upload technique JSON file"
            style={({ pressed }) => [tw`w-9 h-9 rounded-lg items-center justify-center`, techFileName ? tw`bg-[#D9B382]` : tw`bg-white bg-opacity-20 border border-white border-opacity-10`, { opacity: pressed ? 0.7 : 1 }]}
          >
            <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'contents' }}>
              <FileText size={16} color={techFileName ? "#1A1308" : "#8B95B0"} />
            </motion.div>
          </Pressable>
        </View>
      </View>

      <motion.div whileHover={cardHoverProps} style={tw`bg-[#121419] rounded-2xl border border-white border-opacity-10 p-4 shadow-2xl mb-4 z-100`}>
         <View style={tw`mb-4`}>
            <View style={tw`flex-row justify-between items-center mb-2`}>
              <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-widest`}>Asset Selection</Text>
            </View>
            <View style={tw`flex-row flex-wrap gap-1.5`}>
              {symbols.map((s) => (
                <Pressable
                  key={s.name}
                  onPress={() => setStockName(s.name)}
                  style={({ pressed }) => [
                    tw`flex-1 min-w-[28%] py-2.5 rounded-lg border items-center flex-row justify-center`,
                    stockName === s.name ? tw`bg-[#D9B382] border-[#D9B382]` : tw`bg-black bg-opacity-20 border-white border-opacity-10`,
                    { opacity: pressed ? 0.7 : 1 }
                  ]}
                >
                  <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={[tw`mr-1.5 text-xs`, stockName === s.name ? tw`text-black` : tw`text-[#D9B382]`]}>{s.icon}</Text>
                    <Text style={[tw`text-[10px] font-black`, stockName === s.name ? tw`text-black` : tw`text-white`]}>{s.name}</Text>
                  </motion.div>
                </Pressable>
              ))}
            </View>
         </View>

         <View style={tw`flex-row flex-wrap gap-3 mb-4 z-50`}>
            <View style={tw`flex-1 min-w-[45%]`}>
               <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-wider mb-1.5`}>Graph TF</Text>
               <View style={tw`relative`}>
                    <Pressable
                    onPress={() => { setShowTfPicker(!showTfPicker); setShowDurPicker(false); }}
                    style={({ pressed }) => [tw`bg-black bg-opacity-20 border border-white border-opacity-10 h-10 rounded-lg px-3 flex-row items-center justify-between`, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={{ color: '#D9B382', fontWeight: '900', fontSize: 11 }}>{graphTimeframe}</Text>
                    <ChevronDown size={12} color="#D9B382" />
                  </Pressable>
                  {showTfPicker && (
                    <View style={[tw`absolute top-12 left-0 right-0 bg-[#2A2E39] border-2 border-[#D9B382] rounded-xl p-2 shadow-2xl`, { zIndex: 99999, elevation: 10 }]}>
                      {timeframes.map((tf) => (
                        <Pressable
                          key={tf}
                          onPress={() => { setGraphTimeframe(tf); setShowTfPicker(false); }}
                          style={({ pressed }) => [tw`py-4 px-3 rounded-lg border-b border-white border-opacity-10`, graphTimeframe === tf && tw`bg-[#D9B382]/20`, { opacity: pressed ? 0.7 : 1 }]}
                        >
                          <Text style={[tw`text-sm font-black`, graphTimeframe === tf ? tw`text-[#D9B382]` : tw`text-white`]}>{tf}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
               </View>
            </View>
            <View style={tw`flex-1 min-w-[45%]`}>
               <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-wider mb-1.5`}>Duration</Text>
               <View style={tw`relative`}>
                  <Pressable
                    onPress={() => { setShowDurPicker(!showDurPicker); setShowTfPicker(false); }}
                    style={({ pressed }) => [tw`bg-black bg-opacity-20 border border-white border-opacity-10 h-10 rounded-lg px-3 flex-row items-center justify-between`, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={{ color: '#D9B382', fontWeight: '900', fontSize: 11 }}>{investmentDuration}</Text>
                    <ChevronDown size={12} color="#D9B382" />
                  </Pressable>
                  {showDurPicker && (
                    <View style={[tw`absolute top-12 left-0 right-0 bg-[#2A2E39] border-2 border-[#D9B382] rounded-xl p-2 shadow-2xl`, { zIndex: 99999, elevation: 10 }]}>
                      {durations.map((d) => (
                        <Pressable
                          key={d}
                          onPress={() => { setInvestmentDuration(d); setShowDurPicker(false); }}
                          style={({ pressed }) => [tw`py-4 px-3 rounded-lg border-b border-white border-opacity-10`, investmentDuration === d && tw`bg-[#D9B382]/20`, { opacity: pressed ? 0.7 : 1 }]}
                        >
                          <Text style={[tw`text-sm font-black`, investmentDuration === d ? tw`text-[#D9B382]` : tw`text-white`]}>{d}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
               </View>
            </View>
         </View>

         <View style={tw`flex-row flex-wrap gap-3`}>
            <View style={tw`flex-1 min-w-[45%]`}>
               <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-wider mb-1.5`}>Capital</Text>
               <TextInput
                 style={tw`bg-black bg-opacity-20 border border-white border-opacity-10 h-10 rounded-lg px-3 text-white font-black text-xs w-full`}
                 value={investmentAmount}
                 onChangeText={setInvestmentAmount}
                 keyboardType="numeric"
                 placeholderTextColor="#4B5570"
               />
            </View>
            <View style={tw`flex-1 min-w-[45%]`}>
               <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-wider mb-1.5`}>Payout (%)</Text>
               <TextInput
                 style={tw`bg-black bg-opacity-20 border border-white border-opacity-10 h-10 rounded-lg px-3 text-[#22C55E] font-black text-xs w-full`}
                 value={profitabilityPercent}
                 onChangeText={setProfitabilityPercent}
                 keyboardType="numeric"
               />
            </View>
         </View>
      </motion.div>

      <View style={tw`bg-[#121419] rounded-2xl border border-white border-opacity-10 p-4 mb-4`}>
          <View style={tw`flex-row flex-wrap justify-between items-center gap-2 mb-3`}>
             <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-widest`}>Chart Feed</Text>
             <View style={tw`flex-row flex-wrap bg-black bg-opacity-20 rounded-lg p-0.5 border border-white border-opacity-10`}>
                {(['live', 'test', 'bulk'] as const).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    style={({ pressed }) => [tw`px-3 py-1 rounded-md flex-row items-center`, mode === m ? tw`bg-[#D9B382]` : tw`bg-transparent`, { opacity: pressed ? 0.7 : 1 }]}
                 >
                   {m === 'live' ? <Camera size={12} color={mode === m ? '#1A1308' : '#4B5570'} /> : m === 'bulk' ? <Layers size={12} color={mode === m ? '#1A1308' : '#4B5570'} /> : <Activity size={12} color={mode === m ? '#1A1308' : '#4B5570'} />}
                   <Text style={[tw`ml-1.5 text-[8px] font-black uppercase`, mode === m ? tw`text-[#1A1308]` : tw`text-[#4B5570]`]}>{m}</Text>
                 </Pressable>
               ))}
            </View>
         </View>

         {mode === 'live' && (
            <View style={tw`w-full bg-black bg-opacity-20 rounded-xl overflow-hidden border border-white border-opacity-10 items-center justify-center`}>
              {Platform.OS === 'web' && (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: 160, objectFit: 'cover' }}
                />
              )}
              {!isCameraActive && (
                <View style={tw`absolute inset-0 bg-black bg-opacity-20 items-center justify-center`}>
                  <Pressable
                     onPress={startCamera}
                     style={({ pressed }) => [tw`bg-[#D9B382] px-6 py-3 rounded-lg flex-row items-center`, { opacity: pressed ? 0.7 : 1 }]}
                   >
                     <Camera size={18} color="#1A1308" />
                     <Text style={tw`text-[#1A1308] font-black ml-2`}>Start Camera</Text>
                  </Pressable>
                </View>
              )}
              {isCameraActive && (
                <Pressable
                   onPress={stopCamera}
                   style={({ pressed }) => [tw`absolute top-2 right-2 bg-red-500/80 p-1.5 rounded-md`, { opacity: pressed ? 0.7 : 1 }]}
                 >
                  <Text style={tw`text-white font-bold text-[8px]`}>STOP</Text>
                </Pressable>
              )}
              {pipActive && (
                <View style={tw`absolute top-2 left-2 bg-[#22C55E]/20 border border-[#22C55E]/40 px-2 py-1 rounded-md flex-row items-center`}>
                  <View style={tw`w-1.5 h-1.5 rounded-full bg-[#22C55E] mr-1.5`} />
                  <Text style={tw`text-[#22C55E] font-black text-[8px] uppercase tracking-widest`}>PiP LIVE</Text>
                </View>
              )}
              {scoutActive && (
                <View style={tw`absolute bottom-2 left-2 right-2 bg-black bg-opacity-20 p-2 rounded-lg border ${scoutData?.action === 'ABORT' ? 'border-red-500' : scoutData?.action === 'WAIT' ? 'border-orange-500' : 'border-[#00FFFF]/30'}`}>
                   <View style={tw`flex-row justify-between items-center mb-1`}>
                      <View style={tw`flex-row items-center`}>
                        <View style={tw`w-2 h-2 rounded-full ${scoutData?.action === 'ABORT' ? 'bg-red-500' : scoutData?.action === 'WAIT' ? 'bg-orange-500' : 'bg-[#00FFFF]'} mr-2`} />
                        <Text style={tw`text-[#00FFFF] font-black text-[9px] uppercase tracking-widest`}>Live Tick Scout</Text>
                      </View>
                      <Text style={tw`font-black text-[10px] ${scoutData?.action === 'ABORT' ? 'text-red-400' : scoutData?.action === 'WAIT' ? 'text-orange-400' : scoutData?.action === 'BUILD' ? 'text-green-400' : 'text-white'}`}>
                         {scoutData ? scoutData.action : 'ANALYZING...'}
                      </Text>
                   </View>
                   {scoutData && (
                     <Text style={tw`text-white text-opacity-60 text-[9px] leading-3 font-medium`}>{scoutData.reason}</Text>
                   )}
                </View>
              )}
            </View>
         )}

         {mode === 'test' && (
           <Pressable
             onPress={handlePickImage}
             // @ts-expect-error React Native Web missing typings
             onDrop={handleDrop}
             onDragOver={preventDefault}
             onDragEnter={preventDefault}
             style={({ pressed }) => [
               tw`h-32 w-full rounded-xl bg-black bg-opacity-20 overflow-hidden border items-center justify-center`,
               selectedImage ? tw`border-[#D9B382] border-opacity-20 ` : tw`border-dashed border-white border-opacity-10`,
               { opacity: pressed ? 0.7 : 1 }
             ]}
           >
             {selectedImage ? (
               <Image source={{ uri: selectedImage }} style={tw`w-full h-full`} resizeMode="contain" />
             ) : (
               <View style={tw`items-center`}>
                 <Upload size={18} color="#D9B382" style={tw`mb-2`} />
                 <Text style={tw`text-[#4B5570] text-[9px] font-black uppercase tracking-wider`}>Sync Chart Image</Text>
               </View>
             )}
           </Pressable>
         )}

         <View style={mode === 'bulk' ? tw`flex` : tw`hidden`}>
           <BulkTestPanel
              techniquesList={techniquesList}
              encryptedSystemTokens={encryptedSystemTokens}
              saveToStats={saveToStats}
              stockName={stockName}
              graphTimeframe={graphTimeframe}
              investmentDuration={investmentDuration}
              investmentAmount={investmentAmount}
              profitabilityPercent={profitabilityPercent}
           />
         </View>
     </View>
    </>
  );
}
INNER_EOF

cat << 'INNER_EOF' > src/components/live-analysis/LiveAnalysisDebate.tsx
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
INNER_EOF

cat << 'INNER_EOF' > src/components/live-analysis/LiveAnalysisResult.tsx
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import tw from 'twrnc';
import { motion } from 'motion/react';
import { Brain, CheckCircle, AlertTriangle, XCircle, Terminal, Check, Zap, Sparkles } from 'lucide-react';

interface Props {
  analysis: any;
  mode: 'live' | 'test' | 'bulk';
  prefersReducedMotion: boolean;
  profitabilityPercent: string;
  investmentAmount: string;
  confirmedOutcome: 'WIN' | 'LOSS' | null;
  saveToStats: (analysisData: any, outcome: 'WIN' | 'LOSS') => void;
  setMode: (val: 'live' | 'test' | 'bulk') => void;
  tradingDirection: 'UP' | 'DOWN' | 'NO_TRADE' | null;
  actualDirection: 'UP' | 'DOWN' | null;
  testModeLeftSlice: string | null;
  testModeRightSlice: string | null;
  autoGradeStatus: 'idle' | 'grading' | 'done' | 'failed';
  autoGradeReason: string;
  autoGradeRawOutcome: string;
  autoGradeConfidence: number;
  handleRegrade: () => void;
  setConfirmedOutcome: (val: 'WIN' | 'LOSS' | null) => void;
  setAutoGradeStatus: (val: 'idle' | 'grading' | 'done' | 'failed') => void;
  handleReset: () => void;
  buttonHoverProps: any;
  buttonTapProps: any;
  springProps: any;
}

export function LiveAnalysisResult({
  analysis, mode, prefersReducedMotion, profitabilityPercent, investmentAmount,
  confirmedOutcome, saveToStats, setMode, tradingDirection, actualDirection,
  testModeLeftSlice, testModeRightSlice, autoGradeStatus, autoGradeReason,
  autoGradeRawOutcome, autoGradeConfidence, handleRegrade, setConfirmedOutcome,
  setAutoGradeStatus, handleReset, buttonHoverProps, buttonTapProps, springProps
}: Props) {
  if (!analysis) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[#14161C] rounded-[24px] border border-white border-opacity-10 p-6 shadow-2xl mb-8 overflow-hidden relative"
    >
      {/* Visual Polish: Glassmorphism/Tactical Background */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-[#D9B382]/5 rounded-full -mr-32 -mt-32 blur-3xl pointer-events-none" />

      <div style={tw`flex-row items-center justify-between mb-6 pb-4 border-b border-white border-opacity-10 relative z-10`}>
        <div style={tw`flex-row items-center`}>
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 4, repeat: Infinity }}
          >
            <Brain size={24} color="#D9B382" style={tw`mr-3`} />
          </motion.div>
          <View>
             <Text style={tw`text-lg font-bold text-white`}>Final Arbitrator Report</Text>
             <Text style={tw`text-[#8B95B0] text-[10px]`}>4-Judge Scoring Framework</Text>
          </View>
        </div>
        <motion.div
          whileHover={{ scale: 1.05 }}
          className={`px-3 py-1 rounded-full flex flex-row items-center ${analysis.judge.decision === 'STRONG SIGNAL' ? 'bg-green-500/10' : (analysis.judge.decision === 'MODERATE' ? 'bg-yellow-500/10' : 'bg-red-500/10')}`}
        >
          {analysis.judge.decision === 'STRONG SIGNAL' ? <CheckCircle size={14} color="#22C55E" /> : (analysis.judge.decision === 'MODERATE' ? <AlertTriangle size={14} color="#EAB308" /> : <XCircle size={14} color="#EF4444" />)}
          <Text style={[
            tw`ml-1 text-[10px] font-black`,
            analysis.judge.decision === 'STRONG SIGNAL' ? tw`text-green-500` : (analysis.judge.decision === 'MODERATE' ? tw`text-yellow-500` : tw`text-red-500`)
          ]}>{analysis.judge.decision}</Text>
        </motion.div>
      </div>

      {/* ASCII Report Display - High Tech Monospace Card */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="bg-black bg-opacity-20 rounded-2xl p-4 border border-[#D9B382] border-opacity-20  mb-6 group hover:border-[#D9B382] border-opacity-20  transition-colors"
      >
         <div className="absolute top-2 right-2 opacity-20"><Terminal size={12} color="#D9B382" /></div>
         <Text style={tw`text-[#D9B382] font-mono text-xs mb-2`}>{analysis.judge.formattedReport}</Text>
      </motion.div>

      {/* Dynamic Comparison Scorecards - Tactical Readouts */}
      {analysis.judge.cases ? (
        <div className="flex flex-row flex-wrap gap-3 mb-6">
          {['bull', 'bear'].map((side, idx) => {
            const data = analysis.judge.cases[side];
            const isWinner = side.toUpperCase() === analysis.judge.winner.toUpperCase();
            const sideColor = side === 'bull' ? '#22C55E' : '#EF4444';

            return (
              <motion.div
                key={side}
                initial={{ opacity: 0, x: side === 'bull' ? -20 : 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + (idx * 0.1) }}
                className={`flex-1 min-w-[200px] bg-black bg-opacity-20 rounded-2xl p-4 border relative overflow-hidden ${isWinner ? (side === 'bull' ? 'border-green-500/40' : 'border-red-500/40') : 'border-white/5'}`}
              >
                {isWinner && (
                  <div className="absolute top-0 right-0 p-1">
                    <Check size={8} color={sideColor} />
                  </div>
                )}

                <div className="flex flex-row items-center justify-between mb-3">
                  <Text style={[tw`text-[10px] font-black uppercase tracking-widest`, side === 'bull' ? tw`text-green-400` : tw`text-red-400`]}>
                    {side === 'bull' ? 'Case 1: Bull' : 'Case 2: Bear'}
                  </Text>
                </div>

                {[
                  { label: 'J1 reasoning', val: data.j1, max: 4 },
                  { label: 'J2 vehicle', val: data.j2, max: 4 },
                  { label: 'J3 reversal', val: data.j3, max: 3 },
                ].map((j, i) => (
                  <div key={i} className="mb-2">
                    <div className="flex flex-row justify-between items-center mb-1">
                      <Text style={tw`text-[8px] text-[#8B95B0] uppercase font-bold`}>{j.label}</Text>
                      <Text style={tw`text-white text-[9px] font-mono`}>{j.val}/{j.max}</Text>
                    </div>
                    <div className="h-1 bg-white bg-opacity-20 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(j.val / j.max) * 100}%` }}
                        transition={{ duration: 1, delay: 0.8 + (idx * 0.2) + (i * 0.1) }}
                        className="h-full"
                        style={{ backgroundColor: sideColor }}
                      />
                    </div>
                  </div>
                ))}

                <div className="mt-3 pt-3 border-t border-white border-opacity-10 flex flex-row justify-between items-center">
                  <Text style={tw`text-[8px] font-black text-[#D9B382] uppercase`}>Total</Text>
                  <motion.p
                    animate={isWinner ? { scale: [1, 1.1, 1] } : {}}
                    transition={{ duration: 2, repeat: Infinity }}
                    className={`text-xs font-black ${isWinner ? (side === 'bull' ? 'text-green-400' : 'text-red-400') : 'text-white'}`}
                  >
                    {data.total}/11.0
                  </motion.p>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <View style={tw`bg-black bg-opacity-20 rounded-2xl p-4 border border-white border-opacity-10 mb-6`}>
          <View style={tw`flex-row items-center mb-4`}>
              <Terminal size={14} color="#D9B382" style={tw`mr-2`} />
              <Text style={tw`text-[#D9B382] text-[10px] font-black uppercase tracking-widest`}>Judge Deliberations</Text>
          </View>
          {[
            { name: 'Judge 1 (Reasoning)', color: '#D9B382', text: `Score: ${analysis.judge.j1Score}/5. Analysis based on agent arguments and structural priors.` },
            { name: 'Judge 2 (Vehicle)', color: '#D9B382', text: `Score: ${analysis.judge.j2Score}/5. Analysis of trend momentum and bullish/bearish vehicles.` },
            { name: 'Judge 3 (Z-Score)', color: '#D9B382', text: `Score: ${analysis.judge.j3Score}/5. Statistical significance of recent candle movements.` }
          ].map((j, i) => (
            <View key={i} style={tw`mb-4 last:mb-0`}>
                <Text style={[tw`text-[9px] font-black uppercase mb-1`, { color: j.color }]}>{j.name}</Text>
                <Text style={tw`text-white text-[11px] leading-4`}>{j.text}</Text>
            </View>
          ))}
        </View>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mb-8"
      >
         <Text style={tw`text-[10px] font-black text-[#8B95B0] uppercase tracking-widest mb-2`}>Arbitrator Ruling</Text>
         <Text style={tw`text-white text-sm leading-5 font-medium`}>{analysis.judge.ruling}</Text>
      </motion.div>

      {analysis.judge.tradeDetails?.latencyAdjustedForecast && (
         <motion.div
           initial={{ opacity: 0, x: -10 }}
           animate={{ opacity: 1, x: 0 }}
           transition={{ delay: 1 }}
           className="mb-8 bg-[#D9B382]/10 p-4 rounded-xl border border-[#D9B382] border-opacity-20  border-l-4 border-l-[#D9B382]"
         >
           <div style={tw`flex-row items-center mb-2`}>
             <Zap size={14} color="#D9B382" style={tw`mr-2`} />
             <Text style={tw`text-[#D9B382] text-[10px] font-black uppercase tracking-widest`}>+90s Latency Adjusted Forecast</Text>
           </div>
           <Text style={tw`text-white text-xs leading-5 font-medium italic`}>{analysis.judge.tradeDetails.latencyAdjustedForecast}</Text>
         </motion.div>
      )}

      {/* Market Physics & Geometric Oracles Section */}
      {(analysis.structuralPriors || analysis.geometricOracles) && (
        <View style={tw`bg-black bg-opacity-20 rounded-2xl p-4 border border-blue-500/10 mb-8`}>
          <View style={tw`flex-row items-center mb-3`}>
            <Zap size={14} color="#60A5FA" style={tw`mr-2`} />
            <Text style={tw`text-[#60A5FA] text-[10px] font-black uppercase tracking-widest`}>Market Physics & Geometric Oracles</Text>
          </View>
          {analysis.structuralPriors && (
            <View style={tw`mb-4`}>
              <Text style={tw`text-[8px] font-black text-[#8B95B0] uppercase mb-1.5`}>Structural Priors (Market Gates)</Text>
              <Text style={tw`text-[#60A5FA] text-[10px] leading-4 font-bold`}>{analysis.structuralPriors}</Text>
            </View>
          )}
          {analysis.geometricOracles && (
            <View>
              <Text style={tw`text-[8px] font-black text-[#8B95B0] uppercase mb-1.5`}>Geometric Features (Deep Graph)</Text>
              <Text style={tw`text-white text-[10px] leading-4 opacity-80`}>{analysis.geometricOracles}</Text>
            </View>
          )}
        </View>
      )}

      {analysis.judge.tradeDetails?.techniquesUsed && (
        <View style={tw`mb-8`}>
           <Text style={tw`text-[10px] font-black text-[#8B95B0] uppercase tracking-widest mb-2`}>Technique Recognition ({analysis.techUsedCount} Found)</Text>
           <View style={tw`bg-black bg-opacity-20 p-4 rounded-xl border border-[#D9B382] border-opacity-20 `}>
              <Text style={tw`text-white text-xs leading-5 font-bold italic text-[#D9B382]`}>{analysis.judge.tradeDetails.techniquesUsed}</Text>
           </View>
        </View>
      )}

      <View style={tw`flex-row flex-wrap gap-4 mb-8`}>
        <View style={tw`flex-1 min-w-[120px] p-3 bg-black bg-opacity-20 rounded-xl border border-white border-opacity-10`}>
          <Text style={tw`text-[8px] font-black text-[#8B95B0] uppercase mb-1`}>Confidence</Text>
          <Text style={tw`text-white font-black text-lg`}>
            <motion.span key={analysis.judge.finalConfidence} initial={{ y: prefersReducedMotion ? 0 : -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}>
              {analysis.judge.finalConfidence}%
            </motion.span>
          </Text>
        </View>
        <View style={tw`flex-1 min-w-[120px] p-3 bg-black bg-opacity-20 rounded-xl border border-white border-opacity-10`}>
          <Text style={tw`text-[8px] font-black text-[#8B95B0] uppercase mb-1`}>Potential Profit</Text>
          <Text style={tw`text-[#22C55E] font-black text-lg`}>
            <motion.span key={((Number(profitabilityPercent)/100) * Number(investmentAmount)).toFixed(2)} initial={{ y: prefersReducedMotion ? 0 : -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}>
              +${((Number(profitabilityPercent)/100) * Number(investmentAmount)).toFixed(2)}
            </motion.span>
          </Text>
        </View>
        {analysis.judge.tradeDetails?.executionTimeMs !== undefined && (
          <View style={tw`flex-1 min-w-[120px] p-3 bg-black bg-opacity-20 rounded-xl border border-white border-opacity-10`}>
            <Text style={tw`text-[8px] font-black text-[#8B95B0] uppercase mb-1`}>Execution Time</Text>
            <Text style={tw`text-[#60A5FA] font-black text-lg`}>
              <motion.span key={analysis.judge.tradeDetails.executionTimeMs} initial={{ y: prefersReducedMotion ? 0 : -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}>
                {Math.floor(analysis.judge.tradeDetails.executionTimeMs / 60000) > 0 ? `${Math.floor(analysis.judge.tradeDetails.executionTimeMs / 60000)}m ` : ''}{((analysis.judge.tradeDetails.executionTimeMs % 60000) / 1000).toFixed(2)}s
              </motion.span>
            </Text>
          </View>
        )}
      </View>

      {/* Manual Trade Result Declaration */}
      {mode !== 'test' && (
        <View style={tw`mt-4 bg-black bg-opacity-20 rounded-2xl p-6 border border-[#D9B382] border-opacity-20  shadow-lg`}>
            <Text style={tw`text-[#D9B382] font-black uppercase tracking-[2px] text-xs mb-4 text-center`}>
                {confirmedOutcome ? 'TRADE RESULT FINALIZED' : 'DECLARE TRADE OUTCOME'}
            </Text>

            {!confirmedOutcome ? (
              <View style={tw`flex-row flex-wrap gap-4`}>
                <Pressable
                  onPress={() => saveToStats(analysis, 'WIN')}
                  style={({ pressed }) => [tw`flex-1 min-w-[120px] bg-green-600 h-12 rounded-xl items-center justify-center flex-row shadow-xl`, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <CheckCircle size={18} color="white" style={tw`mr-2`} />
                    <Text style={tw`text-white font-black uppercase text-sm`}>PROFIT</Text>
                  </motion.div>
                </Pressable>

                <Pressable
                  onPress={() => saveToStats(analysis, 'LOSS')}
                  style={({ pressed }) => [tw`flex-1 min-w-[120px] bg-red-600 h-12 rounded-xl items-center justify-center flex-row shadow-xl`, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <XCircle size={18} color="white" style={tw`mr-2`} />
                    <Text style={tw`text-white font-black uppercase text-sm`}>LOSS</Text>
                  </motion.div>
                </Pressable>
              </View>
            ) : (
              <View style={tw`items-center`}>
                <View style={tw`${confirmedOutcome === 'WIN' ? 'bg-green-600' : 'bg-red-600'} px-6 py-3 rounded-xl mb-4 flex-row items-center border border-white border-opacity-10 shadow-xl`}>
                  {confirmedOutcome === 'WIN' ? <CheckCircle size={24} color="white" style={tw`mr-3`} /> : <XCircle size={24} color="white" style={tw`mr-3`} />}
                  <Text style={tw`text-white text-xl font-black uppercase tracking-[3px]`}>{confirmedOutcome === 'WIN' ? 'PROFIT' : confirmedOutcome}</Text>
                </View>

                {confirmedOutcome === 'LOSS' && (
                  <Pressable
                    onPress={() => {
                      console.log('RUN LOSS AUTOPSY manual button clicked!');
                      setMode('bulk');
                    }}
                    style={({ pressed }) => [tw`bg-red-600 h-10 px-6 rounded-xl flex-row items-center justify-center shadow-xl mb-4`, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <AlertTriangle size={16} color="white" style={tw`mr-2`} />
                    <Text style={tw`text-white font-black uppercase text-xs tracking-[1px]`}>RUN LOSS AUTOPSY</Text>
                  </Pressable>
                )}
              </View>
            )}
        </View>
      )}

      {mode === 'test' && (
        <View style={tw`mt-4 bg-black bg-opacity-20 rounded-2xl p-6 border border-[#D9B382] border-opacity-20  shadow-lg`}>
          <Text style={tw`text-[#D9B382] font-black uppercase tracking-[2px] text-xs mb-4 text-center`}>
            AUTO-TEST RESULT
          </Text>

          {/* DUAL VERDICT: Predicted vs Actual */}
          {analysis && (
            <View style={tw`flex-row items-center justify-center mb-4 gap-2`}>
              <View style={tw`bg-black bg-opacity-30 border border-white border-opacity-10 rounded-lg px-4 py-2`}>
                <Text style={tw`text-white text-opacity-40 text-[9px] uppercase tracking-widest`}>Predicted</Text>
                <Text style={tw`font-black text-lg ${tradingDirection === 'UP' ? 'text-green-400' : tradingDirection === 'DOWN' ? 'text-red-400' : 'text-white text-opacity-50'}`}>
                  {tradingDirection === 'UP' ? '▲ UP' : tradingDirection === 'DOWN' ? '▼ DOWN' : '— NO TRADE'}
                </Text>
              </View>
              <Text style={tw`text-white text-opacity-30 text-xl`}>/</Text>
              <View style={tw`bg-black bg-opacity-30 border border-white border-opacity-10 rounded-lg px-4 py-2`}>
                <Text style={tw`text-white text-opacity-40 text-[9px] uppercase tracking-widest`}>Actual</Text>
                <Text style={tw`font-black text-lg ${actualDirection === 'UP' ? 'text-green-400' : actualDirection === 'DOWN' ? 'text-red-400' : 'text-white text-opacity-50'}`}>
                  {actualDirection === 'UP' ? '▲ PROFIT' : actualDirection === 'DOWN' ? '▼ LOSS' : '— FLAT'}
                </Text>
              </View>
            </View>
          )}

          {/* Slice preview — visual confirmation that the crop did what user expected */}
          {(testModeLeftSlice || testModeRightSlice) && (
            <View style={tw`flex-row gap-2 mb-4 justify-center`}>
              {testModeLeftSlice && (
                <View style={tw`items-center`}>
                  <Text style={tw`text-white text-opacity-60 text-[9px] uppercase mb-1`}>Analyzed (Past)</Text>
                  <img src={testModeLeftSlice} style={{ height: 60, borderRadius: 6, border: '1px solid rgba(217,179,130,0.4)' }} />
                </View>
              )}
              {testModeRightSlice && (
                <View style={tw`items-center`}>
                  <Text style={tw`text-yellow-400 text-[9px] uppercase mb-1`}>Outcome Window</Text>
                  <img src={testModeRightSlice} style={{ height: 60, borderRadius: 6, border: '1px solid rgba(239,68,68,0.5)' }} />
                </View>
              )}
            </View>
          )}

          {/* GRADING IN PROGRESS */}
          {autoGradeStatus === 'grading' && !confirmedOutcome && (
            <View style={tw`items-center py-4`}>
              <ActivityIndicator color="#D9B382" size="large" />
              <Text style={tw`text-[#D9B382] text-xs font-black uppercase tracking-widest mt-3`}>
                READING MARKET OUTCOME...
              </Text>
            </View>
          )}

          {/* AUTO-GRADE FAILED / NEUTRAL — show MANUAL fallback buttons */}
          {autoGradeStatus === 'failed' && !confirmedOutcome && (
            <View style={tw`items-center py-2`}>
              <AlertTriangle size={28} color="#f59e0b" style={tw`mb-2`} />
              <Text style={tw`text-yellow-400 font-black uppercase text-xs tracking-widest text-center mb-1`}>
                AUTO-GRADE NO TRADE
              </Text>
              <Text style={tw`text-white text-opacity-60 text-xs text-center mb-4 px-4`}>
                {autoGradeReason || 'Right slice was unreadable or price was flat. Declare manually below.'}
                {autoGradeRawOutcome && ` (Raw: ${autoGradeRawOutcome}, Conf: ${autoGradeConfidence}%)`}
              </Text>

              {/* Manual fallback buttons — same UX as live mode */}
              <View style={tw`flex-row flex-wrap gap-3 w-full mb-3`}>
                <Pressable
                  onPress={() => saveToStats(analysis, 'WIN')}
                  style={({ pressed }) => [tw`flex-1 min-w-[120px] bg-green-600 h-12 rounded-xl items-center justify-center flex-row shadow-xl`, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <CheckCircle size={18} color="white" style={tw`mr-2`} />
                  <Text style={tw`text-white font-black uppercase text-sm`}>PROFIT</Text>
                </Pressable>
                <Pressable
                  onPress={() => saveToStats(analysis, 'LOSS')}
                  style={({ pressed }) => [tw`flex-1 min-w-[120px] bg-red-600 h-12 rounded-xl items-center justify-center flex-row shadow-xl`, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <XCircle size={18} color="white" style={tw`mr-2`} />
                  <Text style={tw`text-white font-black uppercase text-sm`}>LOSS</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={handleRegrade}
                style={({ pressed }) => [tw`px-4 py-2 rounded-lg border border-[#D9B382] border-opacity-20  bg-[#D9B382]/10`, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={tw`text-[#D9B382] text-[11px] font-black uppercase tracking-wider`}>
                  🔄 RETRY AUTO-GRADE
                </Text>
              </Pressable>
            </View>
          )}

          {/* OUTCOME SUCCESS (Either Auto or Manual) */}
          {confirmedOutcome && (
            <View style={tw`items-center`}>
              <View style={tw`flex-row items-center mb-2`}>
                <Zap size={14} color="#D9B382" style={tw`mr-2`} />
                <Text style={tw`text-[#D9B382] text-[10px] font-black uppercase tracking-widest`}>
                  {autoGradeStatus === 'done' ? `AUTO-GRADED (${autoGradeConfidence || '—'}% conf)` : 'MANUALLY LOGGED'}
                </Text>
              </View>
              <View style={tw`${confirmedOutcome === 'WIN' ? 'bg-green-600' : 'bg-red-600'} px-6 py-3 rounded-xl mb-3 flex-row items-center border border-white border-opacity-10 shadow-xl`}>
                {confirmedOutcome === 'WIN'
                  ? <CheckCircle size={24} color="white" style={tw`mr-3`} />
                  : <XCircle size={24} color="white" style={tw`mr-3`} />}
                <Text style={tw`text-white text-xl font-black uppercase tracking-[3px]`}>
                  {confirmedOutcome === 'WIN' ? 'PROFIT' : confirmedOutcome}
                </Text>
              </View>
              {autoGradeReason && autoGradeStatus === 'done' && (
                <Text style={tw`text-white text-opacity-60 text-[11px] italic text-center px-4 mb-3`}>
                  “{autoGradeReason}”
                </Text>
              )}
              {confirmedOutcome === 'LOSS' && (
                <Pressable
                  onPress={() => {
                    console.log('RUN LOSS AUTOPSY button clicked!');
                    setMode('bulk');
                  }}
                  style={({ pressed }) => [tw`bg-red-600 h-10 px-6 rounded-xl flex-row items-center justify-center shadow-xl mb-2`, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <AlertTriangle size={16} color="white" style={tw`mr-2`} />
                  <Text style={tw`text-white font-black uppercase text-xs tracking-[1px]`}>
                    RUN LOSS AUTOPSY
                  </Text>
                </Pressable>
              )}
              {/* Override option in case user disagrees with the auto-grade */}
              {autoGradeStatus === 'done' && (
                <Pressable
                  onPress={() => {
                    setConfirmedOutcome(null);
                    setAutoGradeStatus('failed');
                  }}
                  style={tw`mt-1`}
                >
                  <Text style={tw`text-white text-opacity-60 text-[10px] underline`}>Override this grade</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* SAFETY NET — if for any reason none of the above conditions match, show manual buttons */}
          {!confirmedOutcome && autoGradeStatus !== 'grading' && autoGradeStatus !== 'failed' && (
            <View style={tw`flex-row flex-wrap gap-3`}>
              <Pressable
                onPress={() => saveToStats(analysis, 'WIN')}
                style={({ pressed }) => [tw`flex-1 min-w-[120px] bg-green-600 h-12 rounded-xl items-center justify-center flex-row`, { opacity: pressed ? 0.7 : 1 }]}
              >
                <CheckCircle size={18} color="white" style={tw`mr-2`} />
                <Text style={tw`text-white font-black uppercase text-sm`}>PROFIT</Text>
              </Pressable>
              <Pressable
                onPress={() => saveToStats(analysis, 'LOSS')}
                style={({ pressed }) => [tw`flex-1 min-w-[120px] bg-red-600 h-12 rounded-xl items-center justify-center flex-row`, { opacity: pressed ? 0.7 : 1 }]}
              >
                <XCircle size={18} color="white" style={tw`mr-2`} />
                <Text style={tw`text-white font-black uppercase text-sm`}>LOSS</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <Pressable
        onPress={handleReset}
        style={({ pressed }) => [tw`mt-6 bg-[#1A1308] border border-white border-opacity-10 h-14 rounded-2xl items-center justify-center flex-row shadow-2xl`, { opacity: pressed ? 0.7 : 1 }]}
      >
        <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <Sparkles size={20} color="#D9B382" style={tw`mr-3`} />
          <Text style={tw`text-white font-black uppercase tracking-[2px] text-sm`}>Start New Analysis</Text>
        </motion.div>
      </Pressable>
    </motion.div>
  );
}
INNER_EOF
