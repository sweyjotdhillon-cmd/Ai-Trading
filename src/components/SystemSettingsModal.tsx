import { useState, useEffect } from 'react';
import { 
  Modal, 
  View, 
  Text, 
  TextInput, 
  Pressable, 
  ScrollView
} from 'react-native';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShieldAlert, CheckCircle, Copy, Share2, Plus, Trash2 } from 'lucide-react';
import tw from 'twrnc';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';

interface Props {
  show: boolean;
  onClose: () => void;
}

export function SystemSettingsModal({ show, onClose }: Props) {

  
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  // Admin Token State
  const isAdmin = auth.currentUser?.email === 'kveerpal681@gmail.com' || auth.currentUser?.email === 'aitradinggemini@gmail.com';
  const [adminTokens, setAdminTokens] = useState<string[]>([]);
  const [newAdminToken, setNewAdminToken] = useState('');
  const [adminTokenStatus, setAdminTokenStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [systemTokenCount, setSystemTokenCount] = useState<number>(0);

  useEffect(() => {
    if (show) {
      getDoc(doc(db, 'settings', 'system')).then(snap => {
        if (snap.exists()) {
          const data = snap.data();
          if (typeof data.systemTokenCount === 'number') {
            setSystemTokenCount(data.systemTokenCount);
          }
          if (isAdmin && data.encryptedTokens) {
            setAdminTokens(["Tokens are encrypted. Requires backend to view."]);
          }
        }
      }).catch(console.error);
    }
  }, [show, isAdmin]);

  const saveAdminSystemTokens = async () => {
    setAdminTokenStatus('saving');
    try {
      // Backend is removed so we can no longer encrypt API keys this way.
      // We will just do a stub or error out.
      alert("Saving API tokens requires a backend. The API dependencies have been removed. System uses local inference Math Engine now.");
      setAdminTokenStatus('idle');
    } catch (e: any) {
      console.warn("Could not save admin tokens:", e);
      setAdminTokenStatus('idle');
    }
  };

  const addAdminToken = () => {
    if (!newAdminToken.trim()) return;
    setNewAdminToken('');
    saveAdminSystemTokens();
  };

  const removeAdminToken = () => {
    saveAdminSystemTokens();
  };

  const handleSave = () => {
    if (typeof window !== 'undefined') {
      // Explicitly make sure legacy keys are cleared
      localStorage.removeItem('app_user_hf_api_key');
      localStorage.removeItem('app_user_reasoning_engine');
      localStorage.removeItem('app_user_vision_model');
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
                          <Text style={tw`text-[#8B95B0] text-[10px]`}>Share this AI terminal with others</Text>
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

                <View style={tw`mb-6`}>
                  <Text style={tw`text-sm font-semibold text-[#8B95B0] uppercase tracking-wider mb-4`}>
                    AI Engine Configuration
                  </Text>
                  
                  <View style={tw`border border-white border-opacity-10 p-4 rounded-xl bg-black bg-opacity-20 mb-4`}>
                    <View style={tw`relative`}>
                      <Text style={tw`text-xs text-[#8B95B0] mb-2`}>Active AI Model</Text>
                      <View style={tw`w-full px-4 py-3 bg-black bg-opacity-20 border border-white border-opacity-10 rounded-xl flex-row flex-wrap justify-between items-center gap-2`}>
                        <Text style={tw`text-sm text-[#8B95B0]`}>Llama 3.2 90B Vision Instruct</Text>
                        <View style={tw`flex-row items-center gap-2`}>
                          <View style={tw`w-2 h-2 rounded-full ${systemTokenCount > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
                          <Text style={tw`text-xs ${systemTokenCount > 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {systemTokenCount > 0 ? 'Connected' : 'Offline'}
                          </Text>
                        </View>
                      </View>
                      <Text style={tw`mt-2 text-[10px] text-[#D9B382]/80 font-medium`}>
                        {systemTokenCount} system keys configured by Admin for automatic failover.
                      </Text>
                    </View>
                  </View>
    

                  {isAdmin && (
                    <View style={tw`mt-8 mb-4`}>
                      <View style={tw`flex-row items-center gap-2 mb-4`}>
                        <ShieldAlert size={16} color="#ef4444" />
                        <Text style={tw`text-sm font-bold text-red-500 uppercase tracking-wider`}>
                          Admin System Tokens {adminTokenStatus === 'saving' ? '(Saving...)' : adminTokenStatus === 'saved' ? '(Saved!)' : ''}
                        </Text>
                      </View>
                      
                      <View style={tw`border border-red-500 border-opacity-10 p-4 rounded-xl bg-black bg-opacity-20`}>
                        <Text style={tw`text-[10px] text-red-400/80 mb-4 leading-4`}>
                          Tokens added here are used chronologically for all users in the system to prevent rate limiting. These are hidden from standard users.
                        </Text>

                        {adminTokens.map((token, index) => (
                          <View key={index} style={tw`flex-row items-center gap-2 mb-2 p-3 bg-white bg-opacity-20 rounded-lg border border-white border-opacity-10`}>
                            <Text style={tw`flex-1 text-white text-xs`}>
                              {token}
                            </Text>
                            <Pressable 
                              onPress={() => removeAdminToken(index)}
                              style={({ pressed }) => [tw`p-2`, { opacity: pressed ? 0.7 : 1 }]}
                            >
                              <Trash2 size={14} color="#ef4444" />
                            </Pressable>
                          </View>
                        ))}

                        <View style={tw`flex-row items-center gap-2 mt-4`}>
                          <TextInput
                            placeholder="Add system token..."
                            placeholderTextColor="#4B5570"
                            value={newAdminToken}
                            onChangeText={setNewAdminToken}
                            style={tw`flex-1 px-4 py-3 bg-black bg-opacity-20 border border-white border-opacity-10 rounded-xl text-sm text-white`}
                          />
                          <Pressable
                            onPress={addAdminToken}
                            style={({ pressed }) => [
                              tw`p-3 bg-red-500/20 border border-red-500 border-opacity-10 rounded-xl`,
                              { opacity: pressed ? 0.7 : 1 }
                            ]}
                          >
                            <Plus size={20} color="#ef4444" />
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  )}

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
                </View>

                <View style={tw`bg-black bg-opacity-20 p-4 rounded-xl mb-4`}>
                  <Text style={tw`text-[10px] text-[#8B95B0] text-center italic`}>
                    AI analysis is powered by Google AI Studio. Models use an external API.
                  </Text>
                </View>
              </ScrollView>
            </motion.div>
          </View>
        )}
      </AnimatePresence>
    </Modal>
  );
}
