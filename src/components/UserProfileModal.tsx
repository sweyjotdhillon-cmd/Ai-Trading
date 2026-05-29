import React, { useState } from 'react';
import { 
  Modal, 
  View, 
  Text, 
  Pressable, 
  ScrollView
} from 'react-native';
import { motion, AnimatePresence } from 'motion/react';
import { X, User, ShieldCheck, Mail, RefreshCw, KeyRound, LogOut } from 'lucide-react';
import tw from 'twrnc';

interface Props {
  show: boolean;
  onClose: () => void;
  userEmail: string;
  onResetHero: () => void;
}

export function UserProfileModal({ show, onClose, userEmail, onResetHero }: Props) {
  const [resetConfirm, setResetConfirm] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);

  const handleManualReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleReturnToLanding = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('chartlens_hero_dismissed');
    }
    onResetHero();
    onClose();
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
          <View style={tw`flex-1 justify-center items-center px-4 bg-black/60`}>
            {/* Click outside to close */}
            <Pressable 
              style={tw`absolute inset-0`}
              onPress={() => {
                setResetConfirm(false);
                setReloadConfirm(false);
                onClose();
              }}
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ flex: 1 }}
              />
            </Pressable>

            {/* Modal Card */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              className="w-full max-w-md bg-[#0E1014] border border-white border-opacity-10 rounded-2xl shadow-2xl overflow-hidden relative z-10 flex flex-col"
              style={{ maxHeight: '85%' }}
            >
              {/* Header */}
              <View style={tw`flex-row items-center justify-between p-5 border-b border-white border-opacity-5`}>
                <View style={tw`flex-row items-center gap-2.5`}>
                  <View style={tw`w-8 h-8 rounded-lg bg-[#D9B382]/15 items-center justify-center`}>
                    <User size={16} color="#D9B382" />
                  </View>
                  <Text style={tw`text-base font-bold text-white tracking-wide`}>Active Terminal Profile</Text>
                </View>
                <Pressable 
                  onPress={() => {
                    setResetConfirm(false);
                    setReloadConfirm(false);
                    onClose();
                  }} 
                  style={({ pressed }) => [tw`p-2 bg-white bg-opacity-5 rounded-full`, { opacity: pressed ? 0.7 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Close user profile"
                >
                  <X size={16} color="#8E9299" />
                </Pressable>
              </View>

              {/* Body */}
              <ScrollView style={tw`flex-grow p-6`}>
                {/* Profile Detail Badge */}
                <View style={tw`bg-black bg-opacity-40 p-4 border border-white border-opacity-5 rounded-xl mb-6 items-center`}>
                  <View style={tw`w-14 h-14 rounded-full bg-[#D9B382] justify-center items-center mb-3 shadow-lg`}>
                    <Text style={tw`text-[#1A1308] text-xl font-bold`}>
                      {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
                    </Text>
                  </View>
                  <Text style={tw`text-white font-bold text-base mb-1`}>Pro Terminal Inspector</Text>
                  <View style={tw`flex-row items-center gap-1.5 bg-[#4ADE80]/10 px-2.5 py-1 rounded-full border border-[#4ADE80]/20`}>
                    <ShieldCheck size={12} color="#4ADE80" />
                    <Text style={tw`text-[#4ADE80] font-mono font-bold text-[10px] tracking-wider uppercase`}>Logged In Session</Text>
                  </View>
                </View>

                {/* Identity Rows */}
                <View style={tw`gap-3 mb-6`}>
                  <View style={tw`flex-row items-center justify-between bg-white bg-opacity-[0.02] border border-white border-opacity-5 p-3 rounded-lg`}>
                    <View style={tw`flex-row items-center gap-2.5`}>
                      <Mail size={14} color="#8E9299" />
                      <Text style={tw`text-gray-400 text-xs`}>User Identity</Text>
                    </View>
                    <Text style={tw`text-white text-xs font-semibold`}>{userEmail || 'kveerpal681@gmail.com'}</Text>
                  </View>

                  <View style={tw`flex-row items-center justify-between bg-white bg-opacity-[0.02] border border-white border-opacity-5 p-3 rounded-lg`}>
                    <View style={tw`flex-row items-center gap-2.5`}>
                      <KeyRound size={14} color="#8E9299" />
                      <Text style={tw`text-gray-400 text-xs`}>Service Channel</Text>
                    </View>
                    <Text style={tw`text-[#D9B382] font-mono text-xs font-bold`}>SECURE_API_LOCAL</Text>
                  </View>
                </View>

                {/* Diagnostic and Redirection Actions */}
                <Text style={tw`text-gray-500 font-bold text-[10px] tracking-wider uppercase mb-3`}>Navigation & Diagnostics</Text>
                
                <View style={tw`gap-3`}>
                  {/* Landing screen navigation */}
                  <View style={tw`bg-white bg-opacity-[0.02] border border-white border-opacity-5 p-4 rounded-xl`}>
                    <Text style={tw`text-white text-xs font-bold mb-1`}>Landing Welcome Screen</Text>
                    <Text style={tw`text-gray-400 text-[11px] leading-4 mb-3`}>
                      Go back to the initial start screen to read introduction details or test-launch again. Note: This will temporarily hide the active live terminal state.
                    </Text>

                    {!resetConfirm ? (
                      <Pressable
                        onPress={() => setResetConfirm(true)}
                        style={({ pressed }) => [tw`bg-[#1C1D24] border border-white border-opacity-10 py-2.5 px-4 rounded-lg flex-row items-center justify-center gap-2`, { opacity: pressed ? 0.75 : 1 }]}
                      >
                        <LogOut size={13} color="#D9B382" />
                        <Text style={tw`text-[#D9B382] font-bold text-xs`}>Exit To Start Screen</Text>
                      </Pressable>
                    ) : (
                      <View style={tw`flex-row gap-2`}>
                        <Pressable
                          onPress={handleReturnToLanding}
                          style={tw`flex-1 bg-red-600 py-2.5 px-4 rounded-lg items-center justify-center`}
                        >
                          <Text style={tw`text-white font-bold text-xs`}>Confirm Exit</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setResetConfirm(false)}
                          style={tw`bg-[#1C1D24] px-4 rounded-lg justify-center border border-white border-opacity-5`}
                        >
                          <Text style={tw`text-gray-300 text-xs`}>Cancel</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>

                  {/* Manual Reload */}
                  <View style={tw`bg-white bg-opacity-[0.02] border border-white border-opacity-5 p-4 rounded-xl mb-6`}>
                    <Text style={tw`text-white text-xs font-bold mb-1`}>System Soft Restart</Text>
                    <Text style={tw`text-gray-400 text-[11px] leading-4 mb-3`}>
                      Trigger a dynamic web browser refresh in case you face HMR or connection stale indicators. This explicitly reloads the current page frame.
                    </Text>

                    {!reloadConfirm ? (
                      <Pressable
                        onPress={() => setReloadConfirm(true)}
                        style={({ pressed }) => [tw`bg-black bg-opacity-40 border border-white border-opacity-10 py-2.5 px-4 rounded-lg flex-row items-center justify-center gap-2`, { opacity: pressed ? 0.75 : 1 }]}
                      >
                        <RefreshCw size={13} color="#E4E4E7" />
                        <Text style={tw`text-gray-300 font-bold text-xs`}>Reload Web Frame</Text>
                      </Pressable>
                    ) : (
                      <View style={tw`flex-row gap-2`}>
                        <Pressable
                          onPress={handleManualReload}
                          style={tw`flex-1 bg-amber-600 py-2.5 px-4 rounded-lg items-center justify-center`}
                        >
                          <Text style={tw`text-[#1A1308] font-bold text-xs`}>Confirm Reload Now</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setReloadConfirm(false)}
                          style={tw`bg-[#1C1D24] px-4 rounded-lg justify-center border border-white border-opacity-5`}
                        >
                          <Text style={tw`text-gray-300 text-xs`}>Cancel</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                </View>

              </ScrollView>
            </motion.div>
          </View>
        )}
      </AnimatePresence>
    </Modal>
  );
}
