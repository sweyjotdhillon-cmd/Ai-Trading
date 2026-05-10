const fs = require('fs');

let live = fs.readFileSync('src/components/LiveAnalysis.tsx', 'utf8');

const importStr = "import { BulkTestPanel } from './BulkTestPanel';\n";
if (!live.includes('BulkTestPanel')) {
  live = live.replace(/(import .*?\n)(?!import)/, '$1' + importStr);
}

const target = `            {mode === 'camera' ? (`;
const split1 = live.indexOf(target);
if (split1 === -1) {
  console.log('Target not found');
  process.exit(1);
}

const endTarget = `                )}
              </Pressable>
            )}`;
const split2 = live.indexOf(endTarget, split1) + endTarget.length;

if (split2 === -1) {
  console.log('End target not found');
  process.exit(1);
}

const newBlock = `            {mode === 'camera' && (
               <View style={tw\`w-full bg-black bg-opacity-20 rounded-xl overflow-hidden border border-white border-opacity-10 items-center justify-center\`}>
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
                   <View style={tw\`absolute inset-0 bg-black bg-opacity-20 items-center justify-center\`}>
                     <Pressable
                        onPress={startCamera}
                        style={({ pressed }) => [tw\`bg-[#D9B382] px-6 py-3 rounded-lg flex-row items-center\`, { opacity: pressed ? 0.7 : 1 }]}
                      >
                        <Camera size={18} color="#1A1308" />
                        <Text style={tw\`text-[#1A1308] font-black ml-2\`}>Start Camera</Text>
                     </Pressable>
                   </View>
                 )}
                 {isCameraActive && (
                   <Pressable 
                      onPress={stopCamera} 
                      style={({ pressed }) => [tw\`absolute top-2 right-2 bg-red-500/80 p-1.5 rounded-md\`, { opacity: pressed ? 0.7 : 1 }]}
                    >
                     <Text style={tw\`text-white font-bold text-[8px]\`}>STOP</Text>
                   </Pressable>
                 )}
                 {scoutActive && (
                   <View style={tw\`absolute bottom-2 left-2 right-2 bg-black bg-opacity-20 p-2 rounded-lg border \${scoutData?.action === 'ABORT' ? 'border-red-500' : scoutData?.action === 'WAIT' ? 'border-orange-500' : 'border-[#00FFFF]/30'}\`}>
                      <View style={tw\`flex-row justify-between items-center mb-1\`}>
                         <View style={tw\`flex-row items-center\`}>
                           <View style={tw\`w-2 h-2 rounded-full \${scoutData?.action === 'ABORT' ? 'bg-red-500' : scoutData?.action === 'WAIT' ? 'bg-orange-500' : 'bg-[#00FFFF]'} mr-2\`} />
                           <Text style={tw\`text-[#00FFFF] font-black text-[9px] uppercase tracking-widest\`}>Live Tick Scout</Text>
                         </View>
                         <Text style={tw\`font-black text-[10px] \${scoutData?.action === 'ABORT' ? 'text-red-400' : scoutData?.action === 'WAIT' ? 'text-orange-400' : scoutData?.action === 'BUILD' ? 'text-green-400' : 'text-white'}\`}>
                            {scoutData ? scoutData.action : 'ANALYZING...'}
                         </Text>
                      </View>
                      {scoutData && (
                        <Text style={tw\`text-white text-opacity-60 text-[9px] leading-3 font-medium\`}>{scoutData.reason}</Text>
                      )}
                   </View>
                 )}
               </View>
            )}
            
            {(mode === 'upload' || mode === 'test') && (
              <Pressable
                onPress={handlePickImage}
                style={({ pressed }) => [
                  tw\`h-32 w-full rounded-xl bg-black bg-opacity-20 overflow-hidden border items-center justify-center\`,
                  selectedImage ? tw\`border-[#D9B382] border-opacity-20 \` : tw\`border-dashed border-white border-opacity-10\`,
                  { opacity: pressed ? 0.7 : 1 }
                ]}
              >
                {selectedImage ? (
                  <Image source={{ uri: selectedImage }} style={tw\`w-full h-full\`} resizeMode="contain" />
                ) : (
                  <View style={tw\`items-center\`}>
                    <Upload size={18} color="#D9B382" style={tw\`mb-2\`} />
                    <Text style={tw\`text-[#4B5570] text-[9px] font-black uppercase tracking-wider\`}>Sync Chart Image</Text>
                  </View>
                )}
              </Pressable>
            )}

            {mode === 'bulk' && (
              <BulkTestPanel />
            )}`;

live = live.substring(0, split1) + newBlock + live.substring(split2);
if (live.includes('import { Activity }')) {
  live = live.replace('import { Activity }', 'import { Activity, Layers }');
} else {
  live = live.replace(/import \{(.*?Activity.*?)\} from 'lucide-react';/, "import {$1, Layers} from 'lucide-react';");
}

fs.writeFileSync('src/components/LiveAnalysis.tsx', live);
console.log('Replaced block!');
