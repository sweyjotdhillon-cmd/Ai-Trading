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
        <View style={tw`mb-4`}>
           <Text style={tw`text-[10px] font-black text-[#8B95B0] uppercase tracking-widest mb-2`}>Technique Recognition (User Uploaded: {analysis.techUsedCount})</Text>
           <View style={tw`bg-black bg-opacity-20 p-4 rounded-xl border border-[#D9B382] border-opacity-20 `}>
              <Text style={tw`text-white text-xs leading-5 font-bold italic text-[#D9B382]`}>{analysis.judge.tradeDetails.techniquesUsed}</Text>
           </View>
        </View>
      )}

      {analysis.judge.tradeDetails?.repoPatternsDetected && (
        <View style={tw`mb-8`}>
           <Text style={tw`text-[10px] font-black text-[#8B95B0] uppercase tracking-widest mb-2`}>Technique Recognition (Repo Detected: {analysis.judge.tradeDetails?.repoPatternCount})</Text>
           <View style={tw`bg-black bg-opacity-20 p-4 rounded-xl border border-purple-500/20 `}>
              <Text style={tw`text-white text-xs leading-5 font-bold italic text-purple-400`}>{analysis.judge.tradeDetails.repoPatternsDetected}</Text>
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
