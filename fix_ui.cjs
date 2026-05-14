const fs = require('fs');

let content = fs.readFileSync('src/components/LiveAnalysis.tsx', 'utf8');

const targetStr = `{/* Action Bar / Live Debate UI Overlay */}`;

const newUI = `{/* ─────────────────────────────────────────────────────────────────────────
    SCREEN SHARE + PiP CARD
    This is a SEPARATE card — not inside the existing Chart Feed card.
    Shows a toggle at the top to activate screen mode.
───────────────────────────────────────────────────────────────────────── */}
<View style={tw\`bg-[#121419] rounded-2xl border border-white border-opacity-10 p-4 mb-4\`}>

  {/* ── Card Header with Toggle ──────────────────────────────────────────── */}
  <View style={tw\`flex-row justify-between items-center mb-3\`}>
    <View style={tw\`flex-row items-center\`}>
      <View style={tw\`w-2 h-2 rounded-full mr-2 \${mode === 'screen' ? 'bg-[#D9B382]' : 'bg-[#4B5570]'}\`} />
      <Text style={tw\`text-[8px] font-black text-[#4B5570] uppercase tracking-widest\`}>
        Screen Share Mode
      </Text>
    </View>

    {/* Toggle button — activates/deactivates screen mode */}
    <Pressable
      onPress={() => {
        if (mode === 'screen') {
          stopScreenShare();
          setMode('live');
        } else {
          // Pause current camera if active (don't stop it — just switch mode view)
          setMode('screen');
          setScreenError(null);
        }
      }}
      style={({ pressed }) => [
        tw\`px-4 py-1.5 rounded-full border\`,
        mode === 'screen'
          ? tw\`bg-[#D9B382]/20 border-[#D9B382]/50\`
          : tw\`bg-transparent border-white/10\`,
        { opacity: pressed ? 0.7 : 1 }
      ]}
    >
      <Text style={[
        tw\`text-[9px] font-black uppercase tracking-widest\`,
        mode === 'screen' ? tw\`text-[#D9B382]\` : tw\`text-[#4B5570]\`
      ]}>
        {mode === 'screen' ? 'Active ✓' : 'Enable'}
      </Text>
    </Pressable>
  </View>

  {/* ── iOS Not Supported Message ─────────────────────────────────────────── */}
  {isIOS && (
    <View style={tw\`bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 items-center\`}>
      <Text style={tw\`text-yellow-400 font-black text-[10px] uppercase tracking-wider text-center\`}>
        Screen sharing is not supported on iOS
      </Text>
      <Text style={tw\`text-yellow-400/60 text-[9px] text-center mt-1\`}>
        Use Chrome or Edge on desktop for this feature
      </Text>
    </View>
  )}

  {/* ── Screen Mode Content (non-iOS only) ───────────────────────────────── */}
  {!isIOS && mode === 'screen' && (
    <View>
      {/* Screen Preview Area */}
      <View style={[tw\`w-full bg-black rounded-xl overflow-hidden border border-white/10 items-center justify-center mb-3\`, { minHeight: 160 }]}>

        {/* Hidden video element that receives the screen stream */}
        {Platform.OS === 'web' && (
          <video
            ref={screenVideoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', height: 160, objectFit: 'contain', background: '#000' }}
          />
        )}

        {/* Overlay when screen not yet shared */}
        {!isScreenActive && (
          <View style={tw\`absolute inset-0 bg-black/80 items-center justify-center\`}>
            <Pressable
              onPress={startScreenShare}
              style={({ pressed }) => [
                tw\`bg-[#D9B382] px-6 py-3 rounded-xl flex-row items-center\`,
                { opacity: pressed ? 0.7 : 1 }
              ]}
            >
              {/* Use Monitor icon — add to your lucide imports */}
              <Monitor size={18} color="#1A1308" style={tw\`mr-2\`} />
              <Text style={tw\`text-[#1A1308] font-black text-sm uppercase tracking-wider\`}>
                Share Your Broker Screen
              </Text>
            </Pressable>
            <Text style={tw\`text-white/30 text-[9px] mt-3 text-center px-6\`}>
              Chrome will ask you to pick a tab, window, or full screen.{'\\n'}
              Select your broker chart window.
            </Text>
          </View>
        )}
      </View>
    </View>
  )}
</View>

        {/* Action Bar / Live Debate UI Overlay */}`;

content = content.replace(targetStr, newUI);
fs.writeFileSync('src/components/LiveAnalysis.tsx', content);
