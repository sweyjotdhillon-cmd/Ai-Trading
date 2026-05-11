import { quotaTracker } from '../utils/quotaTracker';
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Platform } from 'react-native';
import tw from 'twrnc';
import { motion } from 'motion/react';
import { FileJson, UploadCloud, Play, AlertTriangle, Activity,  } from 'lucide-react';
import { BatchManifest, BatchManifestEntry, validateBatchManifest } from '../types/batchManifest';

import { BatchAutopsyReport } from './BatchAutopsyReport';

export type MasterAutopsySummary = {
  title: string;
  narrative: string;
  coreWeakness: string;
  recommendedAction: string;
};

import { runSingleAnalysis } from '../utils/singleAnalysis';

interface BulkTestPanelProps {
  techniquesList: string[];
  encryptedSystemTokens?: string;
  saveToStats: (analysisData: any, outcome: 'WIN' | 'LOSS') => void;
  // Global context passes
  stockName: string;
  graphTimeframe: string;
  investmentDuration: string;
  investmentAmount: string;
  profitabilityPercent: string;
}

export type BatchRunStatus = 'Pending' | 'Running' | 'WIN' | 'LOSS' | 'INCONCLUSIVE' | 'Error';

export interface BatchRun {
  entry: BatchManifestEntry;
  file?: File;
  status: BatchRunStatus;
  result?: any;
  error?: string;
}

export function BulkTestPanel({
  techniquesList,
  encryptedSystemTokens,
  saveToStats,
  stockName,
  graphTimeframe,
  investmentDuration,
  investmentAmount,
  profitabilityPercent
}: BulkTestPanelProps) {
  const [tab, setTab] = useState<'build' | 'run'>('build');
  
  // Tab 1 state
  const [images, setImages] = useState<File[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  
  const handleDropImages = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      setImages(prev => [...prev, ...filesArray]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      setImages(prev => [...prev, ...filesArray]);
    }
  };

  const handleGenerateManifest = async () => {
    if (images.length === 0) return;
    
    // Only image info and backtest expectations are needed in the JSON
    // The execution info (asset, duration, risk) is piped from the global terminal UI
    const entries: BatchManifestEntry[] = await Promise.all(images.map(async (file) => {
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      return {
        imageFilename: file.name,
        expectedOutcome: 'UNKNOWN',
        imageData,
        stock: stockName,
        graphTimeframe: graphTimeframe,
        investmentDuration: investmentDuration,
        investmentAmount: Number(investmentAmount) || 100,
        profitabilityPercent: Number(profitabilityPercent) || 85
      };
    }));

    const manifest: BatchManifest = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      entries
    };

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manifest_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Tab 2 State
  const [queue, setQueue] = useState<BatchRun[]>([]);
  const [manifestErrors, setManifestErrors] = useState<string[]>([]);
  const [isQueueRunning, setIsQueueRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
      const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Attempt hydration from sessionStorage
    try {
      const existing = sessionStorage.getItem('bulk_queue_state');
      if (existing) {
         setQueue(JSON.parse(existing));
         setTab('run'); // switch to run tab if we have a persisted session
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (queue.length > 0) {
       try {
         sessionStorage.setItem('bulk_queue_state', JSON.stringify(queue.map(q => {
            const persistItem = { ...q, file: undefined };
            if (persistItem.result) {
              persistItem.result = {
                ...persistItem.result,
                finalImageForAnalysis: '',
                testModeRightSlice: '',
                entryAnchorBase64: ''
              };
            }
            return persistItem;
         })));
       } catch {
         console.warn("Could not save bulk queue state to session storage (QuotaExceeded).");
       }
    }
  }, [queue]);

  const loadManifest = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const { valid, errors } = validateBatchManifest(json);
        if (!valid) {
          setManifestErrors(errors);
        } else {
          setManifestErrors([]);
          const manifest = json as BatchManifest;
          setQueue(manifest.entries.map(entry => ({
            entry,
            status: 'Pending'
          })));
        }
      } catch (err: any) {
        setManifestErrors([`Failed to parse JSON: ${err.message}`]);
      }
    };
    reader.readAsText(file);
  };

  const loadRunImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const fileArray = Array.from(files);
    
    setQueue(prev => {
      const updated = [...prev];
      let hasError = false;
      const missingFiles: string[] = [];

      for (let i = 0; i < updated.length; i++) {
        const match = fileArray.find(f => f.name === updated[i].entry.imageFilename);
        if (match) {
          updated[i].file = match;
        } else {
          hasError = true;
          missingFiles.push(updated[i].entry.imageFilename);
        }
      }
      if (hasError) {
         setManifestErrors([`Missing images in selection: ${missingFiles.slice(0, 3).join(', ')}${missingFiles.length > 3 ? '...' : ''}`]);
      } else {
         setManifestErrors(errs => errs.filter(e => !e.startsWith('Missing images')));
      }
      return updated;
    });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const runBatch = async () => {
    if (queue.length === 0 || manifestErrors.length > 0) return;
    
    // Quota Check
    if (!quotaTracker.check('batch_run', queue.length)) {
       alert('Insufficient quota to run this batch.');
       return;
    }
    
    const missing = queue.filter(q => !q.file && !q.entry.imageData && q.status === 'Pending');
    if (missing.length > 0) {
      alert(`Missing ${missing.length} files. Please select them first.`);
      return;
    }

    setIsQueueRunning(true);
    setIsPaused(false);
    abortControllerRef.current = new AbortController();

    for (let i = 0; i < queue.length; i++) {
      if (abortControllerRef.current?.signal.aborted || isPaused) break;
      
      const item = queue[i];
      if (item.status === 'WIN' || item.status === 'LOSS' || item.status === 'INCONCLUSIVE') {
        continue; // skip completed
      }

      setQueue(q => q.map((r, idx) => idx === i ? { ...r, status: 'Running' } : r));

      try {
        let imageDataUrl = "";
        
        if (item.file) {
           imageDataUrl = await fileToBase64(item.file);
        } else if (item.result?.imageDataUrl) {
           imageDataUrl = item.result.imageDataUrl; // recover from persistance? unlikely but safe
        } else if (item.entry.imageData) {
           imageDataUrl = item.entry.imageData; // use embedded payload
        } else {
           throw new Error("Missing image file for entry");
        }

        const result = await runSingleAnalysis({
          imageDataUrl,
          stock: item.entry.stock || stockName,
          graphTimeframe: item.entry.graphTimeframe || graphTimeframe,
          investmentDuration: item.entry.investmentDuration || investmentDuration,
          investmentAmount: item.entry.investmentAmount ? String(item.entry.investmentAmount) : investmentAmount,
          profitabilityPercent: item.entry.profitabilityPercent ? String(item.entry.profitabilityPercent) : profitabilityPercent,
          techniquesList: item.entry.techniqueOverrides || techniquesList,
          encryptedSystemTokens,
          signal: abortControllerRef.current.signal,
          isTestMode: true
        });

        if (result.outcome === 'WIN' || result.outcome === 'LOSS') {
           saveToStats(result.analysis, result.outcome);
        }
        
        setQueue(q => q.map((r, idx) => idx === i ? { ...r, status: result.outcome, result } : r));
      } catch (err: any) {
        if (abortControllerRef.current?.signal.aborted) {
          setQueue(q => q.map((r, idx) => idx === i ? { ...r, status: 'Pending' } : r));
          break;
        }
        setQueue(q => q.map((r, idx) => idx === i ? { ...r, status: 'Error', error: err.message } : r));
        alert(`Analysis Error on item ${i + 1}: ${err.message}\nBatch run halted.`);
        break;
      }

      // Small delay between calls to avoid banhammer
      await new Promise(r => setTimeout(r, 1000));
    }


    setIsQueueRunning(false);

    // After running, fetch the latest queue state logically
    setQueue(currentQueue => {
       const losses = currentQueue.filter(q => q.status === 'LOSS' && q.result);
       if (losses.length > 0) {
          setTimeout(() => runMasterAutopsyChain(losses).catch(e => console.error("master autopsy error:", e)), 0);
       }
       return currentQueue;
    });

  };


  const [autopsyingBatch, setAutopsyingBatch] = useState(false);
  const [masterSummary, setMasterSummary] = useState<MasterAutopsySummary | null>(null);

  const runMasterAutopsyChain = async (losses: BatchRun[]) => {
     setAutopsyingBatch(true);
     try {
       const individualAutopsies = [];
       // Chain individual autopsies
       for (const loss of losses) {
          const res = await fetch('/api/autopsy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
               analysisData: loss.result.analysis, 
               encryptedSystemTokens 
            })
          });
          if (res.ok) {
             const data = await res.json();
             individualAutopsies.push(data);
          }
       }

       if (individualAutopsies.length > 0) {
          const sumRes = await fetch('/api/autopsy-summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
               allLosses: individualAutopsies,
               encryptedSystemTokens
            })
          });
          if (sumRes.ok) {
             const summaryData = await sumRes.json();
             setMasterSummary(summaryData);
          }
       }
     } catch (e) {
       console.error("Master autopsy chain failed:", e);
     } finally {
       setAutopsyingBatch(false);
     }
  };

  const abortBatch = () => {
    if (abortControllerRef.current) {
       abortControllerRef.current.abort();
    }
    setIsQueueRunning(false);
  };

  const getStatusColor = (status: BatchRunStatus) => {
    switch(status) {
      case 'Running': return 'text-yellow-400';
      case 'WIN': return 'text-green-500';
      case 'LOSS': return 'text-red-500';
      case 'Error': return 'text-orange-500';
      default: return 'text-white text-opacity-50';
    }
  };

  const clearQueue = () => {
    if (isQueueRunning) return;
    setQueue([]);
    setManifestErrors([]);
    sessionStorage.removeItem('bulk_queue_state');
  };

  return (
    <View style={tw`w-full bg-black bg-opacity-20 rounded-2xl border border-white border-opacity-10 overflow-hidden`}>
      {/* Tabs */}
      <View style={tw`flex-row border-b border-white border-opacity-10`}>
        <Pressable 
          onPress={() => !isQueueRunning && setTab('build')}
          style={[tw`flex-1 py-4 items-center justify-center border-b-2`, tab === 'build' ? tw`border-[#D9B382] bg-[#D9B382] bg-opacity-10` : tw`border-transparent bg-black bg-opacity-40`]}
        >
          <Text style={[tw`text-xs font-black tracking-widest`, tab === 'build' ? tw`text-[#D9B382]` : tw`text-white text-opacity-40`]}>1. BUILD MANIFEST</Text>
        </Pressable>
        <Pressable 
          onPress={() => !isQueueRunning && setTab('run')}
          style={[tw`flex-1 py-4 items-center justify-center border-b-2`, tab === 'run' ? tw`border-[#D9B382] bg-[#D9B382] bg-opacity-10` : tw`border-transparent bg-black bg-opacity-40`]}
        >
          <Text style={[tw`text-xs font-black tracking-widest`, tab === 'run' ? tw`text-[#D9B382]` : tw`text-white text-opacity-40`]}>2. RUN BATCH</Text>
        </Pressable>
      </View>

      <View style={tw`p-6`}>
        {tab === 'build' ? (
          <View style={tw`gap-6`}>
            {/* Same Tab 1 as before */}
            <Pressable 
              onPress={() => {
                if (Platform.OS === 'web') {
                  document.getElementById('bulk-image-upload')?.click();
                }
              }}
              style={({ pressed }) => [
                tw`border-2 border-dashed border-white border-opacity-10 rounded-xl p-8 flex-col items-center justify-center bg-black bg-opacity-20 relative`,
                { opacity: pressed ? 0.7 : 1 }
              ]}
              // @ts-expect-error React Native type discrepancy for web events
              onDragOver={handleDragOver} 
              onDrop={handleDropImages}
            >
              {Platform.OS === 'web' && (
                <input 
                  id="bulk-image-upload" 
                  type="file" 
                  multiple 
                  accept="image/*" 
                  onChange={handleFileSelect} 
                  style={{ display: 'none' }}
                />
              )}
              <UploadCloud size={32} color="#D9B382" style={{ opacity: 0.8, marginBottom: 16 }} />
              <Text style={tw`text-white font-black text-sm uppercase tracking-widest mb-2`}>
                Drag & Drop or Click to Upload
              </Text>
              <Text style={tw`text-white text-[10px] text-opacity-40 uppercase font-bold tracking-widest mb-3 text-center`}>
                Max Recommended Batch Size: 25 Image Files (API Rate Limits)
              </Text>
              <Text style={tw`text-white text-opacity-50 text-xs text-center px-4`}>
                Drop chart screenshots here to generate a matching JSON manifest sequence.
              </Text>
              {images.length > 0 && (
                <View style={tw`mt-4 bg-[#D9B382] bg-opacity-10 py-1 px-3 rounded-md`}>
                  <Text style={tw`text-[#D9B382] font-black text-[10px]`}>{images.length} IMAGES LOADED</Text>
                </View>
              )}
            </Pressable>

            <View style={tw`pt-4 border-t border-white border-opacity-10`}>
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Pressable 
                  onPress={handleGenerateManifest}
                  disabled={images.length === 0}
                  style={tw`flex-row items-center justify-center bg-[#D9B382] ${images.length === 0 ? 'opacity-50' : 'opacity-100'} h-12 rounded-xl px-6`}
                >
                  <FileJson size={16} color="#1A1308" />
                  <Text style={tw`text-[#1A1308] font-black text-xs uppercase tracking-widest ml-2`}>
                    Download Manifest JSON
                  </Text>
                </Pressable>
              </motion.div>
            </View>
          </View>
        ) : (
          <View style={tw`gap-6`}>
             {queue.length === 0 ? (
               <View style={tw`gap-4`}>
                 <View style={tw`bg-black bg-opacity-30 border border-white border-opacity-10 rounded-xl p-6`}>
                   <Text style={tw`text-white font-black text-[10px] uppercase tracking-widest mb-4`}>1. Load Manifest JSON</Text>
                   <input type="file" accept=".json" onChange={loadManifest} className="text-white text-xs opacity-70" />
                   {manifestErrors.map((err, i) => (
                     <Text key={i} style={tw`text-red-400 text-xs mt-2`}>• {err}</Text>
                   ))}
                 </View>
               </View>
             ) : (
               <View style={tw`gap-4`}>
                  <View style={tw`flex-row justify-between items-center`}>
                    <Text style={tw`text-white font-black text-[10px] uppercase tracking-widest`}>
                      Queue ({queue.length} items)
                    </Text>
                    {manifestErrors.length > 0 && (
                      <Text style={tw`text-red-400 text-[10px] font-bold`}>{manifestErrors[0]}</Text>
                    )}
                  </View>

                  {/* Missing images check */}
                  {queue.some(q => !q.file && !q.entry.imageData) && !isQueueRunning && (
                    <View style={tw`bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 flex-row items-center`}>
                      <AlertTriangle size={16} color="#F97316" />
                      <View style={tw`ml-3 flex-1`}>
                        <Text style={tw`text-orange-400 font-bold text-xs mb-1`}>Missing image references</Text>
                        <Text style={tw`text-white text-opacity-70 text-[10px]`}>Please select the images that map to the manifest.</Text>
                      </View>
                      <input type="file" multiple accept="image/*" onChange={loadRunImages} className="text-white text-xs opacity-0 absolute inset-0 cursor-pointer" />
                      <View style={tw`bg-orange-500/20 px-3 py-1.5 rounded pr-4`}>
                        <Text style={tw`text-orange-400 font-bold text-xs`}>Browse Images</Text>
                      </View>
                    </View>
                  )}

                  <ScrollView style={tw`max-h-64 border border-white border-opacity-10 rounded-xl bg-black bg-opacity-20`}>
                    {queue.map((item, idx) => (
                      <View key={idx} style={tw`border-b border-white border-opacity-5 ${idx % 2 === 0 ? 'bg-transparent' : 'bg-white bg-opacity-5'}`}>
                        <Pressable 
                          onPress={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                          style={tw`flex-row items-center p-3`}
                        >
                          <Text style={tw`text-white text-opacity-40 text-[10px] w-6`}>{(idx + 1).toString().padStart(2, '0')}</Text>
                          <View style={tw`flex-1`}>
                            <Text style={tw`text-white text-xs font-bold`} numberOfLines={1}>{item.entry.imageFilename}</Text>
                            {(item.entry.stock || item.entry.investmentDuration) && (
                              <Text style={tw`text-white text-opacity-50 text-[9px] uppercase tracking-widest mt-0.5`}>
                                {item.entry.stock || stockName} • {item.entry.investmentDuration || investmentDuration}
                              </Text>
                            )}
                            {item.entry.expectedOutcome && item.entry.expectedOutcome !== 'UNKNOWN' && (
                               <Text style={tw`text-white text-opacity-50 text-[9px] uppercase tracking-widest mt-0.5`}>
                                 Expects: {item.entry.expectedOutcome}
                               </Text>
                            )}
                          </View>
                          <View style={tw`px-3`}>
                            <Text style={[tw`text-[10px] font-black uppercase tracking-widest text-right`, tw`${getStatusColor(item.status)}`]}>
                              {item.status}
                            </Text>
                            {item.error && <Text style={tw`text-orange-400 text-[8px]`} numberOfLines={1}>{item.error.substring(0, 20)}</Text>}
                            {!item.error && item.result && (
                              <Text style={tw`text-white text-opacity-40 text-[8px] text-right uppercase tracking-widest mt-0.5`}>
                                {item.result.confidence}% conf
                              </Text>
                            )}
                          </View>
                        </Pressable>
                        {expandedIdx === idx && item.result && (
                          <View style={tw`px-4 pb-4 pt-1 gap-3`}>
                            <View style={tw`flex-row gap-2`}>
                              {item.result.finalImageForAnalysis && (
                                <View style={tw`flex-1`}>
                                  <Text style={tw`text-white text-opacity-50 text-[8px] uppercase tracking-widest mb-1`}>Analyzed Past</Text>
                                  <img src={item.result.finalImageForAnalysis} style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)' }} />
                                </View>
                              )}
                              {item.result.testModeRightSlice && (
                                <View style={tw`flex-1`}>
                                  <Text style={tw`text-yellow-400 text-opacity-70 text-[8px] uppercase tracking-widest mb-1`}>Outcome Window</Text>
                                  <img src={item.result.testModeRightSlice} style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)' }} />
                                </View>
                              )}
                            </View>
                            <View style={tw`bg-black bg-opacity-30 rounded-lg p-3 border border-white border-opacity-5`}>
                               <Text style={tw`text-white text-[10px] font-bold mb-1`}>
                                 Trade Direction: <Text style={tw`${item.result.direction === 'UP' ? 'text-green-400' : 'text-red-400'}`}>{item.result.direction}</Text>
                               </Text>
                               <Text style={tw`text-white text-opacity-70 text-[9px]`}>
                                 {item.result.reason || "Outcome confirmed visually via test bounds."}
                               </Text>
                            </View>
                          </View>
                        )}
                      </View>
                    ))}
                  </ScrollView>

                  <View style={tw`flex-row gap-3 pt-2`}>
                    {!isQueueRunning ? (
                      <Pressable 
                        onPress={runBatch}
                        disabled={queue.some(q => !q.file && !q.entry.imageData && q.status === 'Pending') || manifestErrors.length > 0}
                        style={({ pressed }) => [
                           tw`flex-1 bg-[#D9B382] h-12 rounded-xl flex-row items-center justify-center p-3`, 
                           { opacity: pressed || queue.some(q => !q.file && !q.entry.imageData && q.status === 'Pending') || manifestErrors.length > 0 ? 0.5 : 1 }
                        ]}
                      >
                        <Play size={16} color="#1A1308" />
                        <Text style={tw`text-[#1A1308] font-black text-xs uppercase tracking-widest ml-2`}>Run Batch Test</Text>
                      </Pressable>
                    ) : (
                      <Pressable 
                        onPress={abortBatch}
                        style={({ pressed }) => [tw`flex-1 bg-red-500/20 border border-red-500/50 h-12 rounded-xl flex-row items-center justify-center`, { opacity: pressed ? 0.5 : 1 }]}
                      >
                        <Activity size={16} color="#EF4444" className="animate-pulse" />
                        <Text style={tw`text-red-400 font-black text-xs uppercase tracking-widest ml-2`}>Abort Run</Text>
                      </Pressable>
                    )}
                    
                    {!isQueueRunning && queue.length > 0 && (
                      <Pressable 
                        onPress={clearQueue}
                        style={({ pressed }) => [tw`bg-black bg-opacity-30 border border-white border-opacity-10 px-4 rounded-xl items-center justify-center`, { opacity: pressed ? 0.5 : 1 }]}
                      >
                        <Text style={tw`text-white text-opacity-50 font-black text-[10px] uppercase tracking-widest`}>Clear</Text>
                      </Pressable>
                    )}
                  </View>

                  {/* Auto-chained Master Loss Autopsy */}
                  {(autopsyingBatch || masterSummary) && (
                     <BatchAutopsyReport 
                        summary={masterSummary} 
                        loading={autopsyingBatch} 
                        onClear={() => setMasterSummary(null)} 
                     />
                  )}
               </View>
             )}
          </View>
        )}
      </View>
    </View>
  );
}
