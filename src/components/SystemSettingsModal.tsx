import { useState } from 'react';
import { 
  Modal, 
  View, 
  Text, 
  Pressable, 
  ScrollView
} from 'react-native';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShieldAlert, CheckCircle, Copy, Share2, Activity, Trash2 } from 'lucide-react';
import tw from 'twrnc';
import { ComplianceFooter } from './ComplianceFooter';

interface Props {
  show: boolean;
  onClose: () => void;
}

export function SystemSettingsModal({ show, onClose }: Props) {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [clearStatsStatus, setClearStatsStatus] = useState<'idle' | 'cleared'>('idle');

  const [strictNeutrality, setStrictNeutrality] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('strict_neutrality_mode') !== 'false';
    }
    return true;
  });

  const [biasCorrection, setBiasCorrection] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('bias_correction_strength');
      return v ? parseFloat(v) : 0.05;
    }
    return 0.05;
  });

  const [noTradePref, setNoTradePref] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('no_trade_preference');
      return v ? parseFloat(v) : 0.05;
    }
    return 0.05;
  });

  const handleClearTradeStats = () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('stats_surface_data');
        window.dispatchEvent(new Event('determinist:clearstats'));
        setClearStatsStatus('cleared');
        setTimeout(() => setClearStatsStatus('idle'), 2000);
      } catch (err) {
        console.warn("Could not clear trade stats", err);
      }
    }
  };

  const handleSave = () => {
    if (typeof window !== 'undefined') {
      // Explicitly make sure legacy keys are cleared
      localStorage.removeItem('app_user_hf_api_key');
      localStorage.removeItem('app_user_reasoning_engine');
      localStorage.removeItem('app_user_vision_model');

      // Save our custom neutrality Calibration settings
      localStorage.setItem('strict_neutrality_mode', String(strictNeutrality));
      localStorage.setItem('bias_correction_strength', String(biasCorrection));
      localStorage.setItem('no_trade_preference', String(noTradePref));

      // Dispatch event to workers/others to reset context with new settings if needed
      window.dispatchEvent(new Event('determinist:settingsChanged'));
    }
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      // Use current origin as the link
      const link = window.location.href;
      navigator.clipboard.writeText(link).then(() => {
        setCopyStatus('copied');
        setTimeout(() => setCopyStatus('idle'), 2000);
      }).catch(err => {
        console.warn("Clipboard write failed", err);
      });
    }
  };

  return (
    <Modal
      visible={show}
      transparent={true}
      animationType="none"
      onRequestClose={onClose}
    >
      <AnimatePresence>
        {show && (
          <View style={tw`flex-1 justify-center items-center px-4`}>
              <Pressable 
                style={tw`absolute inset-0 bg-black bg-opacity-20`}
                onPress={() => setTimeout(onClose, 10)}
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{ flex: 1 }}
                />
              </Pressable>
            
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="w-full max-w-md bg-[#14161C] border border-white border-opacity-10 rounded-2xl shadow-2xl overflow-hidden relative z-10 flex flex-col"
              style={{ maxHeight: '85%' }}
            >
              <View style={tw`flex-row items-center justify-between p-4 border-b border-white border-opacity-10`}>
                <View style={tw`flex-row items-center`}>
                  <ShieldAlert style={tw`mr-2 text-[#D9B382]`} size={20} />
                  <Text style={tw`text-lg font-bold text-white`}>System Settings</Text>
                </View>
                <Pressable 
                  onPress={() => setTimeout(onClose, 10)} 
                  style={({ pressed }) => [tw`p-2 hover:bg-white bg-opacity-20 rounded-full`, { opacity: pressed ? 0.7 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Close modal"
                >
                  <X size={20} color="#8B95B0" />
                </Pressable>
              </View>
              
              <ScrollView style={tw`flex-1 p-6`} contentContainerStyle={tw`pb-20`}>
                <View style={tw`mb-8`}>
                  <Text style={tw`text-sm font-semibold text-[#8B95B0] uppercase tracking-wider mb-4`}>
                    Share Application
                  </Text>
                  <View style={tw`border border-white border-opacity-10 p-4 rounded-xl bg-black bg-opacity-20 mb-4`}>
                    <View style={tw`flex-row items-center justify-between`}>
                      <View style={tw`flex-row items-center gap-3`}>
                        <View style={tw`w-10 h-10 rounded-lg bg-[#D9B382]/10 items-center justify-center`}>
                          <Share2 size={18} color="#D9B382" />
                        </View>
                        <View>
                          <Text style={tw`text-white font-bold text-sm`}>Public Share Link</Text>
                          <Text style={tw`text-[#8B95B0] text-[10px]`}>Share this offline terminal with others</Text>
                        </View>
                      </View>
                      <Pressable 
                        onPress={handleCopyLink}
                        style={({ pressed }) => [
                          tw`px-3 py-2 rounded-lg flex-row items-center gap-2`,
                          copyStatus === 'copied' ? tw`bg-green-500/10` : tw`bg-[#D9B382]/10`,
                          { opacity: pressed ? 0.7 : 1 }
                        ]}
                      >
                        {copyStatus === 'copied' ? (
                          <CheckCircle size={14} color="#22C55E" />
                        ) : (
                          <Copy size={14} color="#D9B382" />
                        )}
                        <Text style={[tw`text-[10px] font-black uppercase`, copyStatus === 'copied' ? tw`text-green-500` : tw`text-[#D9B382]`]}>
                          {copyStatus === 'copied' ? 'Copied' : 'Copy'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </View>

                {/* Bias & Neutrality Calibration (Calibration Knob - Deliverable 8) */}
                <View style={tw`bg-gray-800 bg-opacity-50 p-4 rounded-xl border border-white border-opacity-10 mb-6`}>
                    <View style={tw`flex-row items-center justify-between mb-2`}>
                      <View style={tw`flex-row items-center flex-1`}>
                        <ShieldAlert size={20} color="#D9B382" />
                        <Text style={tw`text-white font-bold ml-2 text-base`}>Bias & Neutrality</Text>
                      </View>
                    </View>
                    <Text style={tw`text-gray-400 text-xs mb-4 leading-4`}>
                      Fine-tune directional symmetry thresholds to eliminate long-run BULL/BEAR skewness.
                    </Text>

                    {/* Strict Neutrality Toggle */}
                    <View style={tw`flex-row items-center justify-between mb-4`}>
                      <View style={tw`flex-1 mr-2`}>
                        <Text style={tw`text-white font-semibold text-xs`}>Strict Neutrality Gate</Text>
                        <Text style={tw`text-gray-400 text-[10px]`}>Enforces mirror mathematical symmetry</Text>
                      </View>
                      <Pressable
                        onPress={() => setStrictNeutrality(!strictNeutrality)}
                        style={tw`px-3 py-1.5 rounded-lg ${strictNeutrality ? 'bg-green-500/20 border border-green-500/50' : 'bg-gray-700/50 border border-gray-600'}`}
                      >
                        <Text style={tw`text-xs font-bold ${strictNeutrality ? 'text-green-400' : 'text-gray-400'}`}>
                          {strictNeutrality ? 'ON' : 'OFF'}
                        </Text>
                      </Pressable>
                    </View>

                    {/* Bias Correction Slider */}
                    <View style={tw`mb-4`}>
                      <View style={tw`flex-row justify-between mb-1`}>
                        <Text style={tw`text-white text-xs font-medium`}>Anti-Bias Strength</Text>
                        <Text style={tw`text-[#D9B382] text-xs font-mono`}>{biasCorrection.toFixed(3)}</Text>
                      </View>
                      <input
                        type="range"
                        min="0.00"
                        max="0.15"
                        step="0.01"
                        value={biasCorrection}
                        onChange={(e) => setBiasCorrection(parseFloat(e.target.value))}
                        className="w-full accent-[#D9B382] cursor-pointer"
                        style={{ height: '4px', borderRadius: '2px', background: '#374151', border: 'none', padding: 0 }}
                      />
                      <Text style={tw`text-gray-500 text-[9px] mt-1`}>NEL adjustment multiplier for skewed sequences (0.0 to 0.15)</Text>
                    </View>

                    {/* NO_TRADE preference / epsilon tie */}
                    <View style={tw`mb-2`}>
                      <View style={tw`flex-row justify-between mb-1`}>
                        <Text style={tw`text-white text-xs font-medium`}>NO_TRADE Preference (ε)</Text>
                        <Text style={tw`text-[#D9B382] text-xs font-mono`}>{noTradePref.toFixed(2)}</Text>
                      </View>
                      <input
                        type="range"
                        min="0.01"
                        max="0.20"
                        step="0.01"
                        value={noTradePref}
                        onChange={(e) => setNoTradePref(parseFloat(e.target.value))}
                        className="w-full accent-[#D9B382] cursor-pointer"
                        style={{ height: '4px', borderRadius: '2px', background: '#374151', border: 'none', padding: 0 }}
                      />
                      <Text style={tw`text-gray-500 text-[9px] mt-1`}>Epsilon tie-breaker. Higher values expand the neutral safety zone.</Text>
                    </View>
                    
                    <Pressable
                       onPress={handleSave}
                       style={({ pressed }) => [
                         tw`flex-row items-center justify-center bg-[#D9B382] h-10 rounded-lg mt-4`,
                         { opacity: pressed ? 0.7 : 1 }
                       ]}
                    >
                       <Text style={tw`text-[#1A1308] font-bold uppercase tracking-wider text-xs`}>
                         {saveStatus === 'saved' ? 'Settings Saved ✓' : 'Save Calibration'}
                       </Text>
                    </Pressable>
                </View>

                {/* Clear Trade Statistics */}
                <View style={tw`bg-gray-800 bg-opacity-50 p-4 rounded-xl border border-white border-opacity-10 mb-6`}>
                   <View style={tw`flex-row items-center justify-between mb-2`}>
                     <View style={tw`flex-row items-center flex-1`}>
                       <Trash2 size={20} color="#EF4444" />
                       <Text style={tw`text-white font-bold ml-2 text-base`}>Clear Local Statistics</Text>
                     </View>
                   </View>
                   <Text style={tw`text-gray-400 text-sm mb-4 leading-5`}>
                     Permanently delete compiled batch runs and live trade statistics stored on your local device.
                   </Text>
                   <Pressable
                      onPress={handleClearTradeStats}
                      style={({ pressed }) => [
                        tw`flex-row items-center justify-center h-12 rounded-lg border border-red-500/30`,
                        clearStatsStatus === 'cleared' ? tw`bg-green-500/20` : tw`bg-red-500/10`,
                        { opacity: pressed ? 0.7 : 1 }
                      ]}
                   >
                      <Text style={[
                        tw`font-bold uppercase tracking-wider text-xs`,
                        clearStatsStatus === 'cleared' ? tw`text-green-400` : tw`text-red-400`
                      ]}>
                        {clearStatsStatus === 'cleared' ? 'Statistics Cleared ✓' : 'Clear Trade Stats'}
                      </Text>
                   </Pressable>
                </View>

                <Pressable
                  onPress={handleSave}
                  style={({ pressed }) => [
                    tw`mt-8 w-full py-4 rounded-xl flex-row items-center justify-center`,
                    saveStatus === 'saved' 
                      ? tw`bg-green-500/20 border border-green-500 border-opacity-10` 
                      : tw`bg-[#D9B382]`,
                    { opacity: pressed ? 0.7 : 1 }
                  ]}
                >
                  {saveStatus === 'saved' && <CheckCircle style={tw`mr-2 text-green-400`} size={18} />}
                  <Text style={[
                    tw`text-sm font-bold`,
                    saveStatus === 'saved' ? tw`text-green-400` : tw`text-[#1A1308]`
                  ]}>
                    {saveStatus === 'saved' ? 'Settings Saved' : 'Save Settings'}
                  </Text>
                </Pressable>

                <View style={tw`bg-black bg-opacity-20 p-4 rounded-xl mt-4 mb-4`}>
                  <Text style={tw`text-[10px] text-[#8B95B0] text-center italic`}>
                    Offline Math Engine is Active. No external APIs used.
                  </Text>
                </View>
                <ComplianceFooter />
              </ScrollView>
            </motion.div>
          </View>
        )}
      </AnimatePresence>
    </Modal>
  );
}
