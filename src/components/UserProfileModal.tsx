import React, { useState, useEffect } from 'react';
import { 
  Modal, 
  View, 
  Text, 
  Pressable, 
  ScrollView
} from 'react-native';
import { motion, AnimatePresence } from 'motion/react';
import { X, User, ShieldCheck, Mail, RefreshCw, KeyRound, LogOut, LogIn, Trash2 } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth } from '../services/firebase';
import { purgeAllSavedData, registerUserProfile, listAllUsers, resetAndPurgeUser, UserProfile } from '../services/botTradeService';
import tw from 'twrnc';

interface Props {
  show: boolean;
  onClose: () => void;
  onResetHero?: () => void;
}

export function UserProfileModal({ show, onClose, onResetHero }: Props) {
  const [resetConfirm, setResetConfirm] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(auth.currentUser);
  const [signingIn, setSigningIn] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const handlePurgeData = async () => {
    if (!user) return;
    setPurging(true);
    setPurgeError(null);

    // Safety backup timeout: if purge takes longer than 3.5 seconds, force-save local storage and reload
    const timeoutId = setTimeout(() => {
      console.warn('[Purge] Safety timeout backup action triggered.');
      if (typeof window !== 'undefined') {
        localStorage.setItem('user_virtual_balance', '100000');
        localStorage.setItem('ledger_cached_balance', '100000');
        window.location.reload();
      }
    }, 3500);

    try {
      await purgeAllSavedData(user.uid);
      clearTimeout(timeoutId);
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      }, 850);
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error('[Purge] Failed to clean up user data ledger:', err);
      // Ensure local state is recovered even on network fail
      localStorage.setItem('user_virtual_balance', '100000');
      localStorage.setItem('ledger_cached_balance', '100000');
      setPurgeError(err.message || 'Verification failed. Reloading to apply clean state.');
      setPurging(false);
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      }, 1500);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      if (u) {
        registerUserProfile(u.uid, u.email, u.displayName);
      }
    });
    return () => unsub();
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error('[Auth] Sign in failed:', err.message);
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleManualReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleReturnToLanding = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('chartlens_hero_dismissed');
    }
    if (onResetHero) onResetHero();
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
                setPurgeConfirm(false);
                setPurgeError(null);
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
                    setPurgeConfirm(false);
                    setPurgeError(null);
                    onClose();
                  }} 
                  style={({ pressed }) => [tw`p-2 bg-white bg-opacity-5 rounded-full`, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <X size={16} color="#8E9299" />
                </Pressable>
              </View>

              {/* Body */}
              <ScrollView style={tw`flex-grow p-6`}>
                {user ? (
                  <View style={tw`bg-black bg-opacity-40 p-5 border border-white border-opacity-5 rounded-xl mb-6 items-center`}>
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        referrerPolicy="no-referrer"
                        alt="profile"
                        style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: 'rgba(217,179,130,0.4)', marginBottom: 12 }}
                      />
                    ) : (
                      <View style={tw`w-14 h-14 rounded-full bg-[#D9B382] justify-center items-center mb-3 shadow-lg`}>
                        <Text style={tw`text-[#1A1308] text-xl font-bold`}>
                          {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
                        </Text>
                      </View>
                    )}
                    <Text style={tw`text-white font-bold text-base mb-1`}>{user.displayName ?? 'Terminal Inspector'}</Text>
                    <Text style={tw`text-zinc-400 text-xs mb-1`}>{user.email}</Text>
                    
                    <View style={tw`flex-row items-center gap-1.5 bg-[#4ADE80]/10 px-2.5 py-1 rounded-full border border-[#4ADE80]/20 mb-3`}>
                      <ShieldCheck size={12} color="#4ADE80" />
                      <Text style={tw`text-[#4ADE80] font-mono font-bold text-[10px] tracking-wider uppercase`}>Logged In Session</Text>
                    </View>

                    <Text style={tw`text-zinc-600 text-[10px] font-mono mb-3`}>
                      UID: {user.uid.slice(0, 12)}...
                    </Text>

                    <Pressable
                      onPress={handleSignOut}
                      style={({ pressed }) => [tw`px-6 py-2 bg-zinc-800 rounded-xl border border-zinc-700`, { opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Text style={tw`text-zinc-400 text-xs font-bold`}>Sign Out</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={tw`bg-black bg-opacity-40 p-5 border border-white border-opacity-5 rounded-xl mb-6 items-center`}>
                    <Text style={tw`text-zinc-400 text-sm text-center mb-4 leading-5`}>
                      Sign in to save trade history and P&L across sessions.
                    </Text>
                    <Pressable
                      onPress={handleSignIn}
                      disabled={signingIn}
                      style={({ pressed }) => [
                        tw`flex-row items-center justify-center gap-3 px-6 py-3 rounded-xl w-full`,
                        { backgroundColor: '#D9B382', opacity: (pressed || signingIn) ? 0.7 : 1 }
                      ]}
                    >
                      <LogIn color="#1A1308" size={16} />
                      <Text style={tw`text-[#1A1308] font-black text-sm`}>
                        {signingIn ? 'Signing in...' : 'Sign in with Google'}
                      </Text>
                    </Pressable>
                    <Text style={tw`text-zinc-500 text-[10px] text-center mt-4 leading-3`}>
                      P&L storage requires sign-in. Bot works offline but trades won't be saved.
                    </Text>
                  </View>
                )}

                {/* Diagnostic and Redirection Actions */}
                <Text style={tw`text-gray-500 font-bold text-[10px] tracking-wider uppercase mb-3`}>Navigation & Diagnostics</Text>
                
                <View style={tw`gap-3`}>
                  {/* Landing screen navigation */}
                  <View style={[tw`border border-[#1E2230] p-4 rounded-xl`, { backgroundColor: '#11131a' }]}>
                    <Text style={tw`text-white text-xs font-bold mb-1`}>Landing Welcome Screen</Text>
                    <Text style={tw`text-zinc-400 text-[11px] leading-4 mb-3`}>
                      Go back to the initial start screen to read introduction details or test-launch again. Note: This will temporarily hide the active live terminal state.
                    </Text>

                    {!resetConfirm ? (
                      <Pressable
                        onPress={() => setResetConfirm(true)}
                        style={({ pressed }) => [tw`bg-[#1C1D24] border border-zinc-700 py-2.5 px-4 rounded-lg flex-row items-center justify-center gap-2`, { opacity: pressed ? 0.75 : 1 }]}
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
                  <View style={[tw`border border-[#1E2230] p-4 rounded-xl mb-6`, { backgroundColor: '#11131a' }]}>
                    <Text style={tw`text-white text-xs font-bold mb-1`}>System Soft Restart</Text>
                    <Text style={tw`text-zinc-400 text-[11px] leading-4 mb-3`}>
                      Trigger a dynamic web browser refresh in case you face HMR or connection stale indicators. This explicitly reloads the current page frame.
                    </Text>

                    {!reloadConfirm ? (
                      <Pressable
                        onPress={() => setReloadConfirm(true)}
                        style={({ pressed }) => [tw`bg-[#12131a] border border-zinc-700 py-2.5 px-4 rounded-lg flex-row items-center justify-center gap-2`, { opacity: pressed ? 0.75 : 1 }]}
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

                  {/* Database Purge Ledger */}
                  {user && (
                    <View style={[tw`border border-[#3d161a] p-4 rounded-xl mb-6`, { backgroundColor: '#1c0f12' }]}>
                      <Text style={tw`text-red-400 text-xs font-bold mb-1 uppercase tracking-wider`}>Danger Zone: Purge Ledger</Text>
                      <Text style={tw`text-zinc-400 text-[11px] leading-4 mb-3`}>
                        Permanently purge all transaction records and P&L statistics on the Firebase database. This resets data usage to zero bytes and begins a fresh ledger.
                      </Text>

                      {purgeError && (
                        <View style={tw`bg-red-950/20 border border-red-500/30 p-2.5 rounded-lg mb-3`}>
                          <Text style={tw`text-red-400 font-mono text-[10px] text-center`}>{purgeError}</Text>
                        </View>
                      )}

                      {!purgeConfirm ? (
                        <Pressable
                          onPress={() => setPurgeConfirm(true)}
                          disabled={purging}
                          style={({ pressed }) => [
                            tw`bg-red-950/30 border border-red-500/20 py-2.5 px-4 rounded-lg flex-row items-center justify-center gap-2`,
                            { opacity: pressed || purging ? 0.75 : 1 }
                          ]}
                        >
                          <Trash2 size={13} color="#EF4444" />
                          <Text style={tw`text-red-400 font-bold text-xs`}>
                            {purging ? 'Purging Ledger...' : 'Zero-out Database'}
                          </Text>
                        </Pressable>
                      ) : (
                        <View style={tw`flex-col gap-2`}>
                          <Text style={tw`text-red-400 text-[10px] font-mono text-center mb-1 font-bold`}>
                            ⚠️ Are you sure? This cannot be undone!
                          </Text>
                          <View style={tw`flex-row gap-2`}>
                            <Pressable
                              onPress={handlePurgeData}
                              disabled={purging}
                              style={({ pressed }) => [
                                tw`flex-1 bg-red-600 py-2.5 px-4 rounded-lg items-center justify-center flex-row gap-1.5`,
                                { opacity: pressed || purging ? 0.75 : 1 }
                              ]}
                            >
                              {purging ? (
                                <motion.div
                                  animate={{ rotate: 360 }}
                                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                                  style={{ display: 'inline-flex' }}
                                >
                                  <RefreshCw size={11} color="#FFFFFF" />
                                </motion.div>
                              ) : (
                                <Trash2 size={11} color="#FFFFFF" />
                              )}
                              <Text style={tw`text-white font-bold text-xs`}>
                                {purging ? 'Wiping...' : 'Destroy Trade History'}
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={() => setPurgeConfirm(false)}
                              disabled={purging}
                              style={tw`bg-[#1C1D24] px-4 rounded-lg justify-center border border-white border-opacity-5`}
                            >
                              <Text style={tw`text-gray-300 text-xs`}>Cancel</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </View>

              </ScrollView>
            </motion.div>
          </View>
        )}
      </AnimatePresence>
    </Modal>
  );
}
