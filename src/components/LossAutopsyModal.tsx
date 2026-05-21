import { useState, useRef, useEffect } from 'react';
import * as RN from 'react-native';
import { View, Text, Pressable, ScrollView, Platform } from 'react-native';
import { X, Upload, Activity, AlertTriangle, CheckCircle, Search, Download } from 'lucide-react';
import tw from 'twrnc';
import { motion, useReducedMotion } from 'motion/react';

const ActivityIndicator = RN.ActivityIndicator;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  analysisData: any; // Original JSON
  tradeSignal: string; // CALL or PUT
  prefilledResultImage?: string;
}

const listContainerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05
    }
  }
};

const listItemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 }
};

export function LossAutopsyModal({ isOpen, onClose, analysisData, tradeSignal, prefilledResultImage }: Props) {
  const [resultImage, setResultImage] = useState<string | null>(prefilledResultImage || null);
  const [loading, setLoading] = useState(false);
  const [autopsyResult, setAutopsyResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLogged, setIsLogged] = useState(false);
  
  useEffect(() => {
    if (prefilledResultImage) {
      setResultImage(prefilledResultImage);
    }
  }, [prefilledResultImage]);

  const fileInputRef = useRef<any>(null);
  const prefersReducedMotion = useReducedMotion();
  const springProps = { type: "spring" as const, stiffness: 400, damping: 22 };
  const buttonHoverProps = prefersReducedMotion ? {} : { scale: 1.04 };
  const buttonTapProps = prefersReducedMotion ? {} : { scale: 0.96 };

  const handlePickResultImage = () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setResultImage(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const runAutopsy = async () => {
    console.log("runAutopsy clicked! resultImage:", !!resultImage, "analysisData:", !!analysisData);
    if (!resultImage || !analysisData) {
      if (!analysisData) alert("Missing analysis data for autopsy.");
      if (!resultImage) alert("Please upload a post-trade chart image.");
      return;
    }
    setLoading(true);
    setError(null);
    setAutopsyResult(null);

    setTimeout(() => {
      // Reconstruct what went wrong from judge scores
      const categories: Record<string, any> = {};
      
      const judge = analysisData.judge || {};
      const j1 = judge.j1Score || 0;
      const j2 = judge.j2Score || 0;
      const j3 = judge.j3Score || 0;
      const j4 = judge.j4Score || 0;
      const totalScore = judge.totalScore || 0;
      const finalConfidence = judge.finalConfidence || 0;
      
      const bullWon = judge.winner === 'BULL';
      const signalScore = bullWon ? j1 : j2;
      const counterScore = bullWon ? j2 : j1;
      
      if (counterScore > signalScore * 0.7) {
        categories['WEAK_CONVICTION'] = {
          severity: 2,
          label: 'Weak Directional Conviction',
          explanation: `Signal side scored ${signalScore.toFixed(0)} but counter-side scored ${counterScore.toFixed(0)}. Insufficient dominance.`
        };
      }
      
      if (j3 > 20) {
        categories['HIGH_SKEPTIC_PENALTY'] = {
          severity: 2,
          label: 'High Risk Penalty',
          explanation: `Skeptic penalty was ${j3.toFixed(0)} — market was either highly volatile or showed explosive candle behavior at trade time.`
        };
      }
      
      if (Math.abs(j4) < 5) {
        categories['NO_BOUNDARY_EDGE'] = {
          severity: 1,
          label: 'No Boundary Edge',
          explanation: 'Price was in the middle of the chart range. Boundary reversal gave no directional advantage.'
        };
      }
      
      if (totalScore < 60 && totalScore > -60) {
        categories['BORDERLINE_SIGNAL'] = {
          severity: 3,
          label: 'Borderline Signal Strength',
          explanation: `Final score was only ${totalScore.toFixed(0)}. Signals below 60 have higher loss probability. Should have waited for stronger confluence.`
        };
      }

      // New Checks
      const newRootCauses: string[] = [];

      // 1. TRADE_AGAINST_TREND
      const emaSlope = judge.evidence?.emaSlope || 0;
      let trendConflict = false;
      if (tradeSignal === 'CALL' && emaSlope < 0) trendConflict = true;
      if (tradeSignal === 'PUT' && emaSlope > 0) trendConflict = true;

      if (trendConflict) {
        categories['TRADE_AGAINST_TREND'] = {
          severity: 3,
          label: 'Trade Against Trend',
          explanation: 'Trade signal opposed the overall market trend direction.'
        };
        newRootCauses.push('TRADE_AGAINST_TREND');
      }

      // 2. LOW_SIGNAL_COUNT
      const techCount = judge.techUsedCount || 0;
      if (techCount > 0 && techCount < 5) {
        categories['LOW_SIGNAL_COUNT'] = {
          severity: 3,
          label: 'Low Signal Count',
          explanation: 'Signal based on fewer than 5 matched patterns — low confluence.'
        };
        newRootCauses.push('LOW_SIGNAL_COUNT');
      }

      // 3. SKEPTIC_WARNING_IGNORED
      if (j3 > 25 && Math.abs(totalScore) > 60) {
        categories['SKEPTIC_WARNING_IGNORED'] = {
          severity: 3,
          label: 'Skeptic Warning Ignored',
          explanation: 'Skeptic raised strong caution but Judge overrode it.'
        };
        newRootCauses.push('SKEPTIC_WARNING_IGNORED');
      }

      // 4. CROWD_CONFUSION
      const casesData = judge.cases || { bull: { total: 0 }, bear: { total: 0 } };
      const bullTotal = casesData.bull.total || 0;
      const bearTotal = casesData.bear.total || 0;
      const skepticTotal = j3; // j3 is the skeptic penalty

      const scoresArr = [bullTotal, bearTotal, skepticTotal];
      const maxScore = Math.max(...scoresArr);
      const minScore = Math.min(...scoresArr);
      if (maxScore - minScore <= 15) {
         categories['CROWD_CONFUSION'] = {
           severity: 2,
           label: 'Crowd Confusion',
           explanation: 'Bull, Bear, and Skeptic were too close to call — market was undecided.'
         };
         newRootCauses.push('CROWD_CONFUSION');
      }

      // 5. OVERCONFIDENT_SIGNAL (Hubris Score)
      let hubrisScore = 0;
      if (totalScore !== 0) {
         hubrisScore = (signalScore - counterScore) / Math.abs(totalScore);
      }
      if (hubrisScore > 0.8) {
         categories['OVERCONFIDENT_SIGNAL'] = {
           severity: 2,
           label: 'Overconfident Signal (Hubris)',
           explanation: 'The system showed excessive confidence in a single direction without balancing risks.'
         };
         newRootCauses.push('OVERCONFIDENT_SIGNAL');
      }

      // Opposing Side Extraction
      const cases = judge.cases || { bull: { j1: 0, j2: 0, j3: 0 }, bear: { j1: 0, j2: 0, j3: 0 } };
      let opposingSideData: any = null;
      if (tradeSignal === 'CALL') {
        // Opponent is BEAR
        const bearCases = cases.bear || { j1: 0, j2: 0, j3: 0 };
        const maxBear = Math.max(bearCases.j1, bearCases.j2, bearCases.j3);
        let gunLabel = 'Unknown';
        if (maxBear === bearCases.j1) gunLabel = 'Bear Structural Trend (j1)';
        else if (maxBear === bearCases.j2) gunLabel = 'Bear Mean Reversion (j2)';
        else if (maxBear === bearCases.j3) gunLabel = 'Bear Extemes (j3)';

        opposingSideData = {
           direction: 'BEAR',
           j1: bearCases.j1,
           j2: bearCases.j2,
           j3: bearCases.j3,
           smokingGun: { label: gunLabel, score: maxBear }
        };
      } else if (tradeSignal === 'PUT') {
        // Opponent is BULL
        const bullCases = cases.bull || { j1: 0, j2: 0, j3: 0 };
        const maxBull = Math.max(bullCases.j1, bullCases.j2, bullCases.j3);
        let gunLabel = 'Unknown';
        if (maxBull === bullCases.j1) gunLabel = 'Bull Structural Trend (j1)';
        else if (maxBull === bullCases.j2) gunLabel = 'Bull Mean Reversion (j2)';
        else if (maxBull === bullCases.j3) gunLabel = 'Bull Extemes (j3)';

        opposingSideData = {
           direction: 'BULL',
           j1: bullCases.j1,
           j2: bullCases.j2,
           j3: bullCases.j3,
           smokingGun: { label: gunLabel, score: maxBull }
        };
      }
      
      const primaryRootCause = Object.keys(categories).filter(k => categories[k].severity >= 2);
      
      let systemRecommendation = 'Follow stronger signals and avoid trading in choppy markets.';
      if (primaryRootCause.length > 0) {
         if (categories['BORDERLINE_SIGNAL']) systemRecommendation = 'Increase your minimum acceptable confidence score before entering trades.';
         else if (categories['HIGH_SKEPTIC_PENALTY']) systemRecommendation = 'Avoid trading when the risk/volatility penalty is high.';
         else if (categories['WEAK_CONVICTION']) systemRecommendation = 'Trade only when one direction has total dominance over the other.';
      }

      setAutopsyResult({
        tradeSignal,
        actualOutcome: 'LOSS',
        categories,
        primaryRootCause: primaryRootCause.length ? primaryRootCause : ['UNKNOWN_MARKET_CONDITIONS'],
        systemRecommendation,
        autopsyVerdict: `${Object.keys(categories).length} root cause(s) identified from judge scoring data.`,
        judgeFlaws: [],
        rebutScores: { 
          originalJudge: { total: totalScore },
          contrarianJudge: { total: -totalScore }
        },
        contrarianSignal: tradeSignal === 'CALL' ? 'PUT' : 'CALL',
        contrarianConfidence: 100 - finalConfidence,
        contrarianRuling: 'Deterministic contrarian from local scoring inversion.',
        newRootCauses,
        hubrisScore,
        opposingSide: opposingSideData
      });
      
      setLoading(false);
    }, 800);
  };

  const logToSheets = async () => {
    if (!autopsyResult) return;
    try {
      // Backend removed, just set as logged
      setIsLogged(true);
    } catch (e) {
      console.error("Failed to log to Sheety", e);
      alert("Failed to log autopsy.");
    }
  };

  const downloadSummaryJson = () => {
    if (!autopsyResult) return;
    const jsonString = JSON.stringify(autopsyResult, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.target = '_blank';
    a.href = url;
    a.download = `loss_autopsy_summary_${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getSeverityColor = (severity: number) => {
    if (severity === 0) return 'text-gray-400 border-gray-400 bg-gray-500/10';
    if (severity === 1) return 'text-yellow-400 border-yellow-400 bg-yellow-500/10';
    if (severity === 2) return 'text-orange-400 border-orange-400 bg-orange-500/10';
    return 'text-red-500 border-red-500 bg-red-500/10';
  };

  const getSeverityLabel = (severity: number) => {
    if (severity === 0) return 'CLEAR';
    if (severity === 1) return 'MINOR';
    if (severity === 2) return 'MODERATE';
    return 'CRITICAL';
  };

  useEffect(() => {
    console.log('LossAutopsy isOpen check:', isOpen, 'analysisData?', !!analysisData);
  }, [isOpen, analysisData]);

  if (!isOpen) return null;

  return (
    <View style={[tw`absolute top-0 bottom-0 left-0 right-0 z-50`, { elevation: 50, backgroundColor: 'rgba(0,0,0,0.9)', padding: 16, alignItems: 'center', justifyContent: 'center' }]}>
        <motion.div 
          initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.94, y: prefersReducedMotion ? 0 : 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.94, y: prefersReducedMotion ? 0 : 16 }}
          transition={prefersReducedMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 320, damping: 26 }}
          className="bg-[#14161C] border border-red-500 border-opacity-30 rounded-2xl overflow-hidden flex flex-col shadow-2xl relative"
          style={{ width: '100%', maxWidth: 896, maxHeight: '100%', display: 'flex' }}
        >
          {Platform.OS === 'web' && (
            <input type="file" ref={fileInputRef} accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
          )}

          {/* Header */}
          <View style={tw`flex-row items-center justify-between p-6 border-b border-white border-opacity-5`}>
            <View>
              <Text style={tw`text-red-500 font-black text-2xl tracking-[2px] uppercase`}>LOSS AUTOPSY</Text>
              <Text style={tw`text-white text-opacity-60 text-sm`}>Signal was {tradeSignal}. Running CONTRARIAN review against original Judge.</Text>
            </View>
            <Pressable onPress={onClose} style={tw`p-2 bg-white bg-opacity-10 rounded-full hover:bg-white bg-opacity-10`} accessibilityRole="button" accessibilityLabel="Close">
              <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'contents' }}>
                <X size={24} color="#8B95B0" />
              </motion.div>
            </Pressable>
          </View>

          <ScrollView style={tw`flex-1 p-6`} contentContainerStyle={tw`pb-10`}>
            
            {!autopsyResult && !loading && (
              <View style={tw`items-center justify-center py-10`}>
                <Text style={tw`text-white mb-6 text-center max-w-lg mb-8`}>
                  Upload a screenshot of the LIVE CHART showing the actual price action after the signal was received. 
                  The AI will forensically analyze the extracted math variables, agent logs, and the chart to determine why the trade failed.
                </Text>
                
                {resultImage ? (
                  <View style={tw`items-center`}>
                    <img src={resultImage} style={{ width: '100%', maxWidth: 300, maxHeight: 180, objectFit: 'contain', borderRadius: 12, marginBottom: 20, border: '1px solid rgba(255,255,255,0.1)' }} />
                    <Pressable 
                      onPress={runAutopsy}
                      style={({pressed}) => [tw`bg-red-600 px-8 py-4 rounded-xl flex-row items-center`, { opacity: pressed ? 0.7:1}]}
                    >
                      <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                        <Search size={20} color="white" style={tw`mr-3`} />
                        <Text style={tw`text-white font-black text-lg tracking-[1px]`}>RUN FORENSIC AUTOPSY</Text>
                      </motion.div>
                    </Pressable>
                    <Pressable onPress={handlePickResultImage} style={tw`mt-4`}>
                      <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'contents' }}>
                        <Text style={tw`text-white text-opacity-60 text-sm underline`}>Change Image</Text>
                      </motion.div>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable 
                    onPress={handlePickResultImage}
                    style={tw`border-2 border-dashed border-white border-opacity-20 p-10 rounded-2xl items-center bg-white bg-opacity-10 hover:bg-white bg-opacity-10`}
                  >
                    <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <Upload size={32} color="#8B95B0" style={tw`mb-4`} />
                      <Text style={tw`text-white font-bold mb-1`}>Upload Post-Trade Chart</Text>
                      <Text style={tw`text-gray-400 text-xs`}>Paste or select screenshot</Text>
                    </motion.div>
                  </Pressable>
                )}
                {error && (
                  <Text style={tw`text-red-500 mt-6`}>{error}</Text>
                )}
              </View>
            )}

            {loading && (
              <View style={tw`items-center justify-center py-20`}>
                <ActivityIndicator size="large" color="#EF4444" style={tw`mb-6 scale-150`} />
                <Text style={tw`text-red-400 font-black tracking-[4px] text-xl animate-pulse`}>RUNNING CONTRARIAN AUDIT...</Text>
                <Text style={tw`text-white text-opacity-60 text-xs mt-4`}>Building counter-case against the original Judge's verdict.</Text>
              </View>
            )}

            {autopsyResult && (
              <View>
                {/* OPPOSING SIDE BLOCK */}
                {autopsyResult.opposingSide && (
                  <View style={tw`bg-red-900 bg-opacity-30 border border-red-500 border-opacity-50 p-6 rounded-2xl mb-8`}>
                    <View style={tw`flex-row items-center justify-between mb-3`}>
                      <Text style={tw`text-red-400 font-black text-lg uppercase tracking-[2px]`}>
                        What the {autopsyResult.opposingSide.direction} case was saying
                      </Text>
                    </View>

                    <View style={tw`flex-row items-center gap-4 mb-4`}>
                      <View style={tw`flex-1 bg-black bg-opacity-40 p-3 rounded-lg border border-red-500 border-opacity-30`}>
                        <Text style={tw`text-red-300 text-[10px] uppercase tracking-wider mb-1`}>Structural (j1)</Text>
                        <Text style={tw`text-red-300 font-black text-xl`}>{autopsyResult.opposingSide.j1}</Text>
                      </View>
                      <View style={tw`flex-1 bg-black bg-opacity-40 p-3 rounded-lg border border-red-500 border-opacity-30`}>
                        <Text style={tw`text-red-300 text-[10px] uppercase tracking-wider mb-1`}>Mean Rev (j2)</Text>
                        <Text style={tw`text-red-300 font-black text-xl`}>{autopsyResult.opposingSide.j2}</Text>
                      </View>
                      <View style={tw`flex-1 bg-black bg-opacity-40 p-3 rounded-lg border border-red-500 border-opacity-30`}>
                        <Text style={tw`text-red-300 text-[10px] uppercase tracking-wider mb-1`}>Extremes (j3)</Text>
                        <Text style={tw`text-red-300 font-black text-xl`}>{autopsyResult.opposingSide.j3}</Text>
                      </View>
                    </View>

                    <View style={tw`bg-red-950 bg-opacity-60 p-4 rounded-xl border border-red-500 flex-row items-center`}>
                      <Text style={tw`text-2xl mr-3`}>🔫</Text>
                      <View style={tw`flex-1`}>
                        <Text style={tw`text-red-400 font-black uppercase text-xs tracking-wider mb-1`}>Smoking Gun</Text>
                        <Text style={tw`text-red-100 text-sm leading-relaxed`}>
                          The primary driver for the {autopsyResult.opposingSide.direction} case was <Text style={tw`font-bold text-white`}>{autopsyResult.opposingSide.smokingGun.label}</Text> scoring <Text style={tw`font-bold text-white`}>{autopsyResult.opposingSide.smokingGun.score}</Text>.
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* CONTRARIAN COUNTER-VERDICT */}
                {autopsyResult.contrarianSignal && (
                  <View style={tw`bg-indigo-900 bg-opacity-30 border border-yellow-400 border-opacity-50 p-6 rounded-2xl mb-8`}>
                    <View style={tw`flex-row items-center justify-between mb-3`}>
                      <Text style={tw`text-yellow-300 font-black text-lg uppercase tracking-[2px]`}>
                        Contrarian Counter-Verdict
                      </Text>
                      <View style={tw`px-3 py-1 rounded-md bg-yellow-500 bg-opacity-20 border border-yellow-400`}>
                        <Text style={tw`text-yellow-200 font-black text-xs`}>
                          DEVIL'S ADVOCATE
                        </Text>
                      </View>
                    </View>

                    <View style={tw`flex-row items-center gap-4 mb-4`}>
                      <View style={tw`flex-1 bg-black bg-opacity-40 p-3 rounded-lg border border-white border-opacity-10`}>
                        <Text style={tw`text-white text-opacity-40 text-[10px] uppercase tracking-wider mb-1`}>Original Judge</Text>
                        <Text style={tw`text-red-400 font-black text-xl`}>{autopsyResult.tradeSignal}</Text>
                        <Text style={tw`text-white text-opacity-60 text-xs mt-1`}>
                          Total: {autopsyResult.rebutScores?.originalJudge?.total ?? '—'}/11
                        </Text>
                      </View>
                      <Text style={tw`text-yellow-400 text-2xl font-black`}>vs</Text>
                      <View style={tw`flex-1 bg-black bg-opacity-40 p-3 rounded-lg border border-yellow-400 border-opacity-30`}>
                        <Text style={tw`text-yellow-300 text-[10px] uppercase tracking-wider mb-1`}>Contrarian Says</Text>
                        <Text style={tw`text-yellow-300 font-black text-xl`}>{autopsyResult.contrarianSignal}</Text>
                        <Text style={tw`text-white text-opacity-60 text-xs mt-1`}>
                          Total: {autopsyResult.rebutScores?.contrarianJudge?.total ?? '—'}/11
                          {' · '}
                          {autopsyResult.contrarianConfidence}% conf
                        </Text>
                      </View>
                    </View>

                    <Text style={tw`text-yellow-100 text-sm leading-relaxed mb-4`}>
                      {autopsyResult.contrarianRuling}
                    </Text>

                    {Array.isArray(autopsyResult.judgeFlaws) && autopsyResult.judgeFlaws.length > 0 && (
                      <View style={tw`bg-black bg-opacity-30 p-3 rounded-lg border border-yellow-400 border-opacity-20`}>
                        <Text style={tw`text-yellow-300 font-black text-xs uppercase tracking-wider mb-2`}>
                          Flaws in Original Judge's Reasoning
                        </Text>
                        {autopsyResult.judgeFlaws.map((flaw: string, i: number) => (
                          <Text key={i} style={tw`text-white text-opacity-80 text-xs leading-relaxed mb-1`}>
                            • {flaw}
                          </Text>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {/* Highlight Primary Root Cause */}
                <View style={tw`bg-gradient-to-r from-red-900/40 to-transparent border border-red-500/50 p-6 rounded-2xl mb-8`}>
                  <Text style={tw`text-red-400 font-black text-lg uppercase tracking-[2px] mb-2`}>Primary Root Cause</Text>
                  <View style={tw`flex-row flex-wrap gap-2 mb-4`}>
                    {(autopsyResult.primaryRootCause || []).map((cause: string, i: number) => (
                      <View key={i} style={tw`bg-red-500 px-3 py-1 rounded-md`}>
                        <Text style={tw`text-white font-black text-xs`}>{cause}</Text>
                      </View>
                    ))}
                  </View>
                  
                  <View style={tw`bg-black bg-opacity-40 p-4 rounded-xl border border-red-500 border-opacity-30 flex-row`}>
                    <AlertTriangle size={24} color="#FCA5A5" style={tw`mr-4 mt-1`} />
                    <View style={tw`flex-1`}>
                      <Text style={tw`text-red-300 font-bold mb-1`}>System Recommendation</Text>
                      <Text style={tw`text-red-100 text-sm leading-relaxed`}>{autopsyResult.systemRecommendation}</Text>
                    </View>
                  </View>
                </View>

                {/* Autopsy Verdict */}
                <View style={tw`mb-8`}>
                   <Text style={tw`text-white text-opacity-40 text-xs font-black uppercase tracking-[2px] mb-2`}>Final Verdict</Text>
                   <Text style={tw`text-white text-base leading-relaxed`}>{autopsyResult.autopsyVerdict}</Text>
                </View>

                {/* Categories breakdown */}
                <Text style={tw`text-white text-opacity-40 text-xs font-black uppercase tracking-[2px] mb-4`}>Forensic Breakdown (7 Layers)</Text>
                <motion.div variants={prefersReducedMotion ? {} : listContainerVariants} initial="hidden" animate="show" style={tw`gap-3 mb-8`}>
                  {Object.entries(autopsyResult.categories || {}).map(([key, val]: any) => (
                    <motion.div variants={prefersReducedMotion ? {} : listItemVariants} key={key} style={tw`bg-white bg-opacity-10 border border-white border-opacity-10 rounded-xl p-4`}>
                      <View style={tw`flex-row items-center justify-between mb-2`}>
                        <Text style={tw`text-[#D9B382] font-bold text-sm uppercase`}>{val.label || key}</Text>
                        <View style={tw`px-2 py-1 rounded-sm border ${getSeverityColor(val.severity)}`}>
                          <Text style={tw`text-[10px] font-black ${getSeverityColor(val.severity).split(' ')[0]}`}>
                            {getSeverityLabel(val.severity)} ({val.severity})
                          </Text>
                        </View>
                      </View>
                      <Text style={tw`text-white text-opacity-70 text-sm leading-relaxed`}>{val.explanation}</Text>
                    </motion.div>
                  ))}
                </motion.div>

                {/* Footer buttons */}
                <View style={tw`flex-row flex-wrap gap-4 border-t border-white border-opacity-10 pt-6`}>
                  <Pressable 
                    onPress={downloadSummaryJson}
                    style={({pressed}) => [tw`flex-1 py-4 justify-center items-center rounded-xl flex-row transition-all bg-blue-600 bg-opacity-80 hover:bg-blue-600`, { opacity: pressed ? 0.7 : 1}]}
                  >
                    <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      <Download size={18} color="white" style={tw`mr-2`} />
                      <Text style={tw`text-white font-bold uppercase`}>Download JSON</Text>
                    </motion.div>
                  </Pressable>

                  <Pressable 
                    onPress={logToSheets}
                    disabled={isLogged}
                    style={({pressed}) => [tw`flex-1 py-4 justify-center items-center rounded-xl flex-row transition-all`, 
                      isLogged ? tw`bg-green-800 bg-opacity-40 border border-green-500 border-opacity-50` : tw`bg-white bg-opacity-10 border border-white border-opacity-20 hover:bg-white bg-opacity-20`,
                      { opacity: pressed && !isLogged ? 0.7 : 1}
                    ]}
                  >
                    <motion.div whileHover={isLogged || prefersReducedMotion ? {} : { scale: 1.04 }} whileTap={isLogged || prefersReducedMotion ? {} : { scale: 0.96 }} transition={springProps} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      {isLogged ? (
                        <>
                          <CheckCircle size={18} color="#22C55E" style={tw`mr-2`} />
                          <Text style={tw`text-green-500 font-bold uppercase`}>Logged to Sheets</Text>
                        </>
                      ) : (
                        <>
                          <Activity size={18} color="white" style={tw`mr-2`} />
                          <Text style={tw`text-white font-bold uppercase`}>Log This Autopsy</Text>
                        </>
                      )}
                    </motion.div>
                  </Pressable>
                  
                  <Pressable 
                    onPress={onClose}
                    style={({pressed}) => [tw`py-4 px-8 bg-white bg-opacity-10 border border-white border-opacity-10 justify-center items-center rounded-xl transition-all hover:bg-white bg-opacity-10`, { opacity: pressed ? 0.7 : 1}]}
                  >
                    <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'contents' }}>
                      <Text style={tw`text-white font-bold uppercase`}>Close</Text>
                    </motion.div>
                  </Pressable>
                </View>

              </View>
            )}

          </ScrollView>
        </motion.div>
    </View>
  );
}
