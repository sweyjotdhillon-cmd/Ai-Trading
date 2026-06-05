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
  holdingMinutes: string;
  setHoldingMinutes: (val: string) => void;
  showDurPicker: boolean;
  setShowDurPicker: (val: boolean) => void;
  durations: string[];
  investmentAmount: string;
  setInvestmentAmount: (val: string) => void;

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
  techniquesList: any[];
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
  holdingMinutes, setHoldingMinutes, showDurPicker, setShowDurPicker, durations,
  investmentAmount, setInvestmentAmount,
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
              <Text style={tw`text-[8px] font-black text-[#94A3B8] uppercase tracking-widest`}>Asset Selection</Text>
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
               <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-wider mb-1.5`}>Holding mins</Text>
               <View style={tw`relative`}>
                  <Pressable
                    onPress={() => { setShowDurPicker(!showDurPicker); setShowTfPicker(false); }}
                    style={({ pressed }) => [tw`bg-black bg-opacity-20 border border-white border-opacity-10 h-10 rounded-lg px-3 flex-row items-center justify-between`, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={{ color: '#D9B382', fontWeight: '900', fontSize: 11 }}>{holdingMinutes}</Text>
                    <ChevronDown size={12} color="#D9B382" />
                  </Pressable>
                  {showDurPicker && (
                    <View style={[tw`absolute top-12 left-0 right-0 bg-[#2A2E39] border-2 border-[#D9B382] rounded-xl p-2 shadow-2xl`, { zIndex: 99999, elevation: 10 }]}>
                      {durations.map((d) => (
                        <Pressable
                           key={d}
                           onPress={() => { setHoldingMinutes(d); setShowDurPicker(false); }}
                           style={({ pressed }) => [tw`py-4 px-3 rounded-lg border-b border-white border-opacity-10`, holdingMinutes === d && tw`bg-[#D9B382]/20`, { opacity: pressed ? 0.7 : 1 }]}
                        >
                          <Text style={[tw`text-sm font-black`, holdingMinutes === d ? tw`text-[#D9B382]` : tw`text-white`]}>{d}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
               </View>
            </View>
         </View>

         <View style={tw`flex-row flex-wrap gap-3`}>
            <View style={tw`flex-1 w-full`}>
               <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-wider mb-1.5`}>Capital</Text>
               <TextInput
                 style={tw`bg-black bg-opacity-20 border border-white border-opacity-10 h-10 rounded-lg px-3 text-white font-black text-xs w-full`}
                 value={investmentAmount}
                 onChangeText={setInvestmentAmount}
                 keyboardType="numeric"
                 placeholderTextColor="#4B5570"
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
                   accessibilityRole="button"
                   accessibilityLabel="Stop Camera"
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
              holdingMinutes={holdingMinutes}
              investmentAmount={investmentAmount}
           />
         </View>
     </View>
    </>
  );
}
