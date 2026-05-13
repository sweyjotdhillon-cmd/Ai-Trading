import { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  Pressable, 
  SafeAreaView, 
  ActivityIndicator,
  Image,
  StatusBar,
  Platform
} from 'react-native';
import { Settings, LogIn, Activity } from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'motion/react';

import { LiveAnalysis } from './components/LiveAnalysis';
import { SystemSettingsModal } from './components/SystemSettingsModal';
import { HeroIntro } from './components/HeroIntro';

function App() {
  console.log("[App] Mounting...");
  const [showSystemSettings, setShowSystemSettings] = useState(false);
  const [heroDismissed, setHeroDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('heroDismissed') === 'true';
    }
    return false;
  });
  
  const handleLaunch = () => {
    setHeroDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('heroDismissed', 'true');
    }
  };

  const prefersReducedMotion = useReducedMotion();
  const transitionDuration = prefersReducedMotion ? 0 : 0.35;
  const transitionProps = { duration: transitionDuration, ease: "easeOut" as const };
  const springProps = { type: "spring" as const, stiffness: 400, damping: 22 };

  useEffect(() => {
    const handleError = (e: any) => {
      console.error("Global error caught:", e);
    };
    const handleRejection = (e: any) => {
      console.error("Unhandled promise rejection:", e.reason);
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
              <Text style={styles.headerTitle}>AI TRADING</Text>
              <Text style={styles.headerSubtitle}>PRO TERMINAL</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Pressable 
              style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => setTimeout(() => setShowSystemSettings(true), 10)}
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
              <View style={[styles.profilePlaceholder, { marginLeft: 0 }]}>
                <LogIn color="#1A1308" size={16} />
              </View>
            </View>
          </View>
        </View>
      </motion.div>

      {/* Main Content Area */}
      <View style={styles.main}>
        <LayoutGroup>
          <AnimatePresence mode="wait">
            {!heroDismissed ? (
              <motion.div
                key="hero"
                layout
                initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -12, filter: prefersReducedMotion ? 'none' : 'blur(4px)' }}
                transition={transitionProps}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, flexGrow: 1 }}
              >
                <HeroIntro onLaunch={handleLaunch} />
              </motion.div>
            ) : (
              <motion.div
                key="live"
                layout
                initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -12 }}
                transition={transitionProps}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, flexGrow: 1 }}
              >
                <LiveAnalysis />
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
      </View>

      <SystemSettingsModal 
        show={showSystemSettings} 
        onClose={() => setShowSystemSettings(false)} 
      />
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
    position: 'absolute',
    top: Platform.OS === 'ios' ? 44 : 0,
    left: 0,
    right: 0,
    zIndex: 100,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
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
    fontSize: 13,
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
    justifyContent: 'space-between',
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
  }
});

export default App;

