import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  Pressable, 
  SafeAreaView, 
  StatusBar,
  Platform,
  ScrollView
} from 'react-native';
import { Settings, LogIn, Activity, RefreshCw, XCircle, User, Bot, Wallet, List, BarChart2 } from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'motion/react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User as FirebaseUser } from 'firebase/auth';
import { auth } from './services/firebase';

import { BotSetupScreen, BotStartPayload } from './components/BotSetupScreen';
import { BotDashboard } from './components/BotDashboard';
import { BalanceDashboard } from './components/BalanceDashboard';
import { BacktestScreen } from './components/BacktestScreen';
import { useBotLoop } from './hooks/useBotLoop';
import { registerUserProfile } from './services/botTradeService';
import { getDefaultScalpConfig } from './config/scalpConfig';
import { SystemSettingsModal } from './components/SystemSettingsModal';
import { HeroIntro } from './components/HeroIntro';
import { UserProfileModal } from './components/UserProfileModal';


class TerminalErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; errorMessage: string | null; errorStack: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: null, errorStack: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error?.message ?? 'Unknown error', errorStack: error?.stack ?? null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[TerminalErrorBoundary] Application crashed:', error, errorInfo);
    if (typeof window !== 'undefined') {
      (window as any).__liveAnalysisLastError = {
        message: error?.message ?? 'Unknown error',
        stack: error?.stack ?? null,
        componentStack: errorInfo?.componentStack ?? null,
        at: new Date().toISOString(),
      };
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Unable to load terminal.</Text>
          <Text style={styles.errorHint}>Please try again.</Text>
          <Pressable
             style={({ pressed }) => [
                {
                  marginTop: 20,
                  backgroundColor: "#D9B382",
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  opacity: pressed ? 0.7 : 1
                }
             ]}
             onPress={() => this.setState({ hasError: false, errorMessage: null, errorStack: null })}
          >
             <RefreshCw color="#1A1308" size={16} />
             <Text style={{ color: "#1A1308", fontWeight: "bold", marginLeft: 8 }}>Retry</Text>
          </Pressable>
          {this.state.errorMessage ? <Text style={styles.errorDetails}>{this.state.errorMessage}</Text> : null}
          {this.state.errorStack ? (
            <ScrollView style={{ marginTop: 10, maxHeight: 300, width: '90%', padding: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8 }}>
              <Text style={[styles.errorDetails, { textAlign: 'left', marginTop: 0 }]}>{this.state.errorStack}</Text>
            </ScrollView>
          ) : null}
        </View>
      );
    }

    return this.props.children;
  }
}
function App() {
  console.log("[App] Mounting...");
  const buildStamp = (import.meta as any).env?.VITE_BUILD_STAMP || 'dev';
  const [showSystemSettings, setShowSystemSettings] = useState(false);
  const [showProfileCard, setShowProfileCard] = useState(false);
  const [heroDismissed, setHeroDismissed] = useState(() => {
    try {
      const stored = localStorage.getItem('chartlens_hero_dismissed');
      return stored === 'true' || localStorage.getItem('chartlens_active_bot_payload') !== null;
    } catch {
      return false;
    }
  });

  const [activeTab, setActiveTab] = useState<'bot' | 'backtest' | 'balance'>('bot');
  const [botPayload, setBotPayload] = useState<BotStartPayload | null>(() => {
    try {
      const stored = localStorage.getItem('chartlens_active_bot_payload');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const bot = useBotLoop(
    botPayload?.symbol ?? null,
    botPayload?.timeframeMinutes ?? 3,
    botPayload?.capital ?? 100000,
    botPayload?.minConfidence ?? 70,
    botPayload?.config ?? getDefaultScalpConfig(),
    botPayload?.techniquesList ?? []
  );

  // Auto-start bot the moment the user completes setup
  useEffect(() => {
    if (botPayload) {
      bot.startBot();
      try {
        localStorage.setItem('chartlens_active_bot_payload', JSON.stringify(botPayload));
      } catch (e) {
        console.warn('Failed to save botPayload to localStorage:', e);
      }
    } else {
      try {
        localStorage.removeItem('chartlens_active_bot_payload');
      } catch (e) {
        console.warn('Failed to clean botPayload in localStorage:', e);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botPayload]);

  const handleStopBot = () => {
    bot.stopBot();
    setBotPayload(null);
  };
  const [user, setUser] = useState<FirebaseUser | null>(auth.currentUser);
  const [globalErrors, setGlobalErrors] = useState<{ message: string; stack?: string; time: string }[]>([]);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error('[Auth] Sign in failed from Gate:', err.message);
      setAuthError(err.message || 'Verification failed. Please try again.');
    } finally {
      setSigningIn(false);
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
  
  const handleLaunch = () => {
    setHeroDismissed(true);
    try {
      localStorage.setItem('chartlens_hero_dismissed', 'true');
    } catch (e) {
      console.warn('Storage failed:', e);
    }
  };

  const handleResetHero = () => {
    setHeroDismissed(false);
    try {
      localStorage.removeItem('chartlens_hero_dismissed');
    } catch (e) {
      console.warn('Storage clear failed:', e);
    }
  };

  const prefersReducedMotion = useReducedMotion();
  const transitionDuration = prefersReducedMotion ? 0 : 0.35;
  const transitionProps = { duration: transitionDuration, ease: "easeOut" as const };
  const springProps = { type: "spring" as const, stiffness: 400, damping: 22 };

  useEffect(() => {
    const handleError = (e: any) => {
      console.error("Global error caught:", e);
      setGlobalErrors(prev => [...prev, {
        message: e.message || 'Unknown Error',
        stack: e.error?.stack || undefined,
        time: new Date().toLocaleTimeString()
      }]);
    };
    const handleRejection = (e: any) => {
      console.error("Unhandled promise rejection:", e.reason);
      setGlobalErrors(prev => [...prev, {
        message: e.reason?.message || (typeof e.reason === 'string' ? e.reason : 'Unhandled Promise Rejection'),
        stack: e.reason?.stack || undefined,
        time: new Date().toLocaleTimeString()
      }]);
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Refined Android Header */}
      <motion.div
        initial={{ opacity: 0, y: prefersReducedMotion ? 0 : -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.4, ease: "easeOut" }}
        style={{ display: 'contents' }}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.iconBox}>
              <Activity color="#1A1308" size={18} />
            </View>
            <View>
              <Text style={styles.headerTitle}>CHARTLENS</Text>
              <Text style={styles.headerSubtitle}>PRO TERMINAL</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            {/* Code Update Time Bar */}
            <View style={styles.updateTimeBar}>
              <View style={styles.updateTimeIndicator} />
              <Text style={styles.updateTimeText}>UPDATED: {buildStamp}</Text>
            </View>

            <Pressable 
              style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => setTimeout(() => setShowSystemSettings(true), 10)}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <motion.div
                whileHover={prefersReducedMotion ? {} : { scale: 1.04 }}
                whileTap={prefersReducedMotion ? {} : { scale: 0.96 }}
                transition={springProps}
                style={{ display: 'contents' }}
              >
                <Settings color="#8E9299" size={20} />
              </motion.div>
            </Pressable>
            
            <View style={{ marginLeft: 10 }}>
              <Pressable
                style={({ pressed }) => [styles.profilePlaceholder, { marginLeft: 0, overflow: 'hidden' }, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => setShowProfileCard(true)}
                accessibilityRole="button"
                accessibilityLabel="Open profile"
              >
                <motion.div
                  whileHover={prefersReducedMotion ? {} : { scale: 1.04 }}
                  whileTap={prefersReducedMotion ? {} : { scale: 0.96 }}
                  transition={springProps}
                  style={{ display: 'contents' }}
                >
                  {user ? (
                    user.photoURL ? (
                      <img
                        src={user.photoURL}
                        referrerPolicy="no-referrer"
                        alt="profile"
                        style={{ width: 32, height: 32, borderRadius: 16 }}
                      />
                    ) : (
                      <Text style={{ color: '#1A1308', fontWeight: 'bold', fontSize: 13 }}>
                        {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
                      </Text>
                    )
                  ) : (
                    <User color="#1A1308" size={16} />
                  )}
                </motion.div>
              </Pressable>
            </View>
          </View>
        </View>
      </motion.div>

      {/* Main Content Area */}
      <View style={styles.main}>
        <LayoutGroup>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab === 'bot' ? (botPayload ? 'dashboard' : 'setup') : activeTab === 'backtest' ? 'backtest' : 'balance'}
              layout
              initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -12 }}
              transition={transitionProps}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, flexGrow: 1, overflow: 'hidden' }}
            >
              <TerminalErrorBoundary>
                {activeTab === 'bot' ? (
                  botPayload ? (
                    <BotDashboard
                      bot={bot}
                      capital={botPayload.capital}
                      symbol={botPayload.symbol}
                      onStop={handleStopBot}
                      onPause={() => bot.pauseBot()}
                    />
                  ) : (
                    <BotSetupScreen onStart={(payload) => setBotPayload(payload)} />
                  )
                ) : activeTab === 'backtest' ? (
                  <BacktestScreen />
                ) : (
                  <BalanceDashboard />
                )}
              </TerminalErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </LayoutGroup>
      </View>

      {/* Persistent Beautiful Responsive Bottom Tab Bar */}
      {(
        <View style={styles.bottomBar}>
          <Pressable 
            style={[styles.bottomBarItem]} 
            onPress={() => setActiveTab('bot')}
            id="tab-bot"
          >
            <View style={[styles.bottomBarIcon, activeTab === 'bot' && styles.bottomBarIconActive]}>
              <Bot color={activeTab === 'bot' ? '#1A1308' : '#8E9299'} size={18} />
            </View>
            <Text style={[styles.bottomBarText, activeTab === 'bot' && styles.bottomBarTextActive]}>Bot</Text>
          </Pressable>

          <Pressable 
            style={[styles.bottomBarItem]} 
            onPress={() => setActiveTab('backtest')}
            id="tab-backtest"
          >
            <View style={[styles.bottomBarIcon, activeTab === 'backtest' && styles.bottomBarIconActive]}>
              <BarChart2 color={activeTab === 'backtest' ? '#1A1308' : '#8E9299'} size={18} />
            </View>
            <Text style={[styles.bottomBarText, activeTab === 'backtest' && styles.bottomBarTextActive]}>Backtest</Text>
          </Pressable>

          <Pressable 
            style={[styles.bottomBarItem]} 
            onPress={() => setActiveTab('balance')}
            id="tab-balance"
          >
            <View style={[styles.bottomBarIcon, activeTab === 'balance' && styles.bottomBarIconActive]}>
              <Wallet color={activeTab === 'balance' ? '#1A1308' : '#8E9299'} size={18} />
            </View>
            <Text style={[styles.bottomBarText, activeTab === 'balance' && styles.bottomBarTextActive]}>Balance</Text>
          </Pressable>
        </View>
      )}

      <SystemSettingsModal 
        show={showSystemSettings} 
        onClose={() => setShowSystemSettings(false)} 
      />

      <UserProfileModal 
        show={showProfileCard}
        onClose={() => setShowProfileCard(false)}
        onResetHero={handleResetHero}
      />

      {globalErrors.length > 0 && (
        <View style={styles.globalErrorOverlay}>
          <View style={styles.globalErrorHeader}>
            <Text style={styles.globalErrorTitle}>{globalErrors.length} Application Error(s)</Text>
            <Pressable
              style={({ pressed }) => [styles.clearErrorsButton, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => setGlobalErrors([])}
            >
              <XCircle color="#ff4444" size={20} />
              <Text style={styles.clearErrorsText}>Dismiss All</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.globalErrorScroll}>
            {globalErrors.map((err, idx) => (
              <View key={idx} style={styles.globalErrorItem}>
                <Text style={styles.globalErrorTime}>{err.time}</Text>
                <Text style={styles.globalErrorMessage}>{err.message}</Text>
                {err.stack && <Text style={styles.globalErrorStack}>{err.stack}</Text>}
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    height: '100%',
    backgroundColor: '#0A0B0E',
    overflow: 'hidden',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0A0B0E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 20,
    color: '#D9B382',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorHint: {
    marginTop: 8,
    color: '#8E9299',
    fontSize: 13,
  },
  errorDetails: {
    marginTop: 8,
    color: '#B9BDC7',
    fontSize: 12,
    maxWidth: 500,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  authWrapper: {
    flex: 1,
    justifyContent: 'center',
    padding: 30,
  },
  authCard: {
    backgroundColor: '#14161C',
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(217,179,130,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  authTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#D9B382',
    marginBottom: 10,
  },
  authSubtitle: {
    fontSize: 14,
    color: '#8E9299',
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 20,
  },
  signInButton: {
    backgroundColor: '#D9B382',
    width: '100%',
    padding: 15,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signInButtonText: {
    color: '#1A1308',
    fontWeight: 'bold',
    fontSize: 16,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: '#0E1014',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 32,
    height: 32,
    backgroundColor: '#D9B382',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  headerTitle: {
    color: 'white',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  headerSubtitle: {
    color: '#D9B382',
    fontSize: 8,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  updateTimeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(217, 179, 130, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(217, 179, 130, 0.15)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: 4,
  },
  updateTimeIndicator: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#10B981',
    marginRight: 4,
  },
  updateTimeText: {
    color: '#D9B382',
    fontSize: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
  headerAction: {
    width: 36,
    height: 36,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  profileImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginLeft: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  profilePlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#D9B382',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  bottomBar: {
    flexDirection: 'row',
    height: 72,
    backgroundColor: '#111318',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingBottom: Platform.OS === 'ios' ? 20 : 0,
    paddingHorizontal: 30,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  bottomBarItem: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
  },
  bottomBarIcon: {
    width: 56,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  bottomBarIconActive: {
    backgroundColor: '#D9B382',
  },
  bottomBarText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#8E9299',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bottomBarTextActive: {
    color: 'white',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minHeight: 0,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    color: '#8E9299',
    fontSize: 12,
    marginTop: 10,
  },
  globalErrorOverlay: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    bottom: 20,
    backgroundColor: 'rgba(20, 22, 28, 0.95)',
    borderWidth: 1,
    borderColor: '#ff4444',
    borderRadius: 12,
    padding: 16,
    zIndex: 1000,
  },
  globalErrorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 68, 68, 0.3)',
  },
  globalErrorTitle: {
    color: '#ff4444',
    fontSize: 16,
    fontWeight: 'bold',
  },
  clearErrorsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  clearErrorsText: {
    color: '#ff4444',
    marginLeft: 6,
    fontWeight: 'bold',
    fontSize: 14,
  },
  globalErrorScroll: {
    flex: 1,
  },
  globalErrorItem: {
    marginBottom: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ff4444',
  },
  globalErrorTime: {
    color: '#8E9299',
    fontSize: 12,
    marginBottom: 4,
  },
  globalErrorMessage: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  globalErrorStack: {
    color: '#ff8888',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  }
});

export default App;
