
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Platform } from 'react-native';
import tw from 'twrnc';
import { motion } from 'motion/react';
import { FileJson, UploadCloud, Play, AlertTriangle, Activity } from 'lucide-react';
import { BatchManifest, BatchManifestEntry, validateBatchManifest } from '../types/batchManifest';

import { BatchAutopsyReport } from './BatchAutopsyReport';
import { useWakeLock } from '../hooks/useWakeLock';

export type MasterAutopsySummary = {
  title: string;
  narrative: string;
  coreWeakness: string;
  recommendedAction: string;
  rawLosses?: any;
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

export type BatchRunStatus = 'Pending' | 'Running' | 'WIN' | 'LOSS' | 'NEUTRAL' | 'Error';

export interface BatchRun {
  entry: BatchManifestEntry;
  file?: File;
  status: BatchRunStatus;
  result?: any;
  error?: string;
  earlyDirection?: 'UP' | 'DOWN' | 'NO_TRADE';
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
    const entries: BatchManifestEntry[] = [];
    const CHUNK_SIZE = 5;

    for (let i = 0; i < images.length; i += CHUNK_SIZE) {
      const chunk = images.slice(i, i + CHUNK_SIZE);
      const chunkEntries = await Promise.all(chunk.map(async (file) => {
        const imageData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        return {
          imageFilename: file.name,
          expectedOutcome: 'UNKNOWN' as const,
          imageData,
          stock: stockName,
          graphTimeframe: graphTimeframe,
          investmentDuration: investmentDuration,
          investmentAmount: Number(investmentAmount) || 100,
          profitabilityPercent: Number(profitabilityPercent) || 85
        };
      }));
      entries.push(...chunkEntries);

      // Yield to the event loop to prevent UI blocking
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const manifest: BatchManifest = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      entries
    };

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.target = '_blank';
    a.href = url;
    a.download = `manifest_${performance.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Tab 2 State
  const [queue, setQueue] = useState<BatchRun[]>([]);
  const [autopsyingBatch, setAutopsyingBatch] = useState(false);
  const [masterSummary, setMasterSummary] = useState<MasterAutopsySummary | null>(null);
  const [manifestErrors, setManifestErrors] = useState<string[]>([]);
  const [isQueueRunning, setIsQueueRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const { requestLock, releaseLock } = useWakeLock();
  
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if ((Platform.OS as string) === 'web') {
      const handleGlobalDragOver = (e: any) => e.preventDefault();
      const handleGlobalDrop = (e: any) => e.preventDefault();

      window.addEventListener('dragover', handleGlobalDragOver, { passive: false });
      window.addEventListener('drop', handleGlobalDrop, { passive: false });

      return () => {
        window.removeEventListener('dragover', handleGlobalDragOver);
        window.removeEventListener('drop', handleGlobalDrop);
      };
    }
  }, []);

  useEffect(() => {
    if (isQueueRunning && !isPaused) {
      requestLock();
    } else {
      releaseLock();
    }
  }, [isQueueRunning, isPaused, requestLock, releaseLock]);

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

  const runQueue = async () => {
    if (queue.length === 0 || manifestErrors.length > 0) return;
    
    const missing = queue.filter(q => !q.file && !q.entry.imageData && q.status === 'Pending');
    if (missing.length > 0) {
      alert(`Missing ${missing.length} files. Please select them first.`);
      return;
    }

    setIsQueueRunning(true);
    setIsPaused(false);
    abortControllerRef.current = new AbortController();

    const CONCURRENCY_LIMIT = 1;
    let currentIndex = 0;
    const workerLoop = async () => {
      while (currentIndex < queue.length) {
        if (abortControllerRef.current?.signal.aborted || isPaused ) break;
        
        const i = currentIndex++;
        const item = queue[i];
        
        if (item.status === 'WIN' || item.status === 'LOSS' || item.status === 'NEUTRAL') {
          continue; // skip completed
        }

        setQueue(q => q.map((r, idx) => idx === i ? { ...r, status: 'Running', earlyDirection: undefined } : r));

        // Let UI update
        await new Promise(resolve => setTimeout(resolve, 10));

        try {
          let imageDataUrl = "";
          let isObjectUrl = false;
          
          if (item.file) {
             imageDataUrl = URL.createObjectURL(item.file);
             isObjectUrl = true;
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
            signal: abortControllerRef.current!.signal,
            isTestMode: true,
            onDirectionFound: (dir) => {
              setQueue(q => q.map((r, idx2) => 
                idx2 === i ? { ...r, earlyDirection: dir } : r
              ));
            }
          });
          
          if (isObjectUrl) {
             URL.revokeObjectURL(imageDataUrl);
          }

          if (result.outcome === 'WIN' || result.outcome === 'LOSS') {
             saveToStats(result.analysis, result.outcome);
          }
          
          const lightweightResult = { ...result };
          // We keep images here for the UI to display thumbnails

          setQueue(q => q.map((r, idx) => idx === i ? { ...r, status: result.outcome, result: lightweightResult } : r));
        } catch (err: any) {
          if (abortControllerRef.current?.signal.aborted || isPaused) {
            setQueue(q => q.map((r, idx) => idx === i ? { ...r, status: 'Pending' } : r));
            break;
          }
          console.error(`[BulkTest] Item ${i + 1} failed:`, err.message);
          setQueue(q => q.map((r, idx) => idx === i ? { ...r, status: 'Error', error: err.message } : r));

        }

        // No massive delay, just briefly yield to event loop
        await new Promise(r => setTimeout(r, 5));
      }
    };

    return Promise.all(Array.from({ length: CONCURRENCY_LIMIT }, () => workerLoop()))
      .finally(() => {
        setIsQueueRunning(false);

        // After running, fetch the latest queue state logically
        setQueue(currentQueue => {
          const losses = currentQueue.filter(q => q.status === 'LOSS' && q.result);
          if (losses.length > 0 && !abortControllerRef.current?.signal.aborted && !isPaused) {
            setTimeout(() => runMasterAutopsyChain(losses).catch(e => console.error("master autopsy error:", e)), 0);
          }
          return currentQueue;
        });
      });
  };


  const runMasterAutopsyChain = async (losses: BatchRun[]) => {
     setAutopsyingBatch(true);
     try {
       if (losses.length > 0) {
          const failuresData = losses.map(l => {
             const analysisCopy = l.result?.analysis ? JSON.parse(JSON.stringify(l.result.analysis)) : null;
             const confidence = Number(l.result?.confidence ?? analysisCopy?.confidence ?? 0);
             const expected = String(l.entry.expectedOutcome ?? '').toUpperCase();
             const predicted = String(analysisCopy?.decision ?? l.result?.direction ?? '').toUpperCase();
             return {
                fileName: l.file?.name || (l.entry as any).fileName || "unknown",
                stock: l.entry.stock,
                timeframe: l.entry.graphTimeframe,
                expectedOutcome: l.entry.expectedOutcome,
                actualResult: l.status,
                predictedDecision: predicted || 'UNKNOWN',
                confidence: Number.isFinite(confidence) ? confidence : 0,
                contradictedExpectation: expected !== 'UNKNOWN' && expected && predicted && expected !== predicted,
                analysis: analysisCopy,
                error: l.error,
             };
          });

          const contradictionCount = failuresData.filter(f => f.contradictedExpectation).length;
          const avgConfidence = failuresData.length
            ? failuresData.reduce((sum, f) => sum + f.confidence, 0) / failuresData.length
            : 0;
          const timeframeCounts: Record<string, number> = failuresData.reduce((acc, f) => {
            const tf = f.timeframe || 'unknown';
            acc[tf] = (acc[tf] || 0) + 1;
            return acc;
          }, {});
          const worstTimeframe = Object.entries(timeframeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

          setMasterSummary({
             title: `Batch Autopsy: ${losses.length} Loss(es) Analyzed`,
             narrative: `Detected ${contradictionCount} contradiction(s) versus expected outcomes. Average confidence on losing trades was ${avgConfidence.toFixed(1)}%.`,
             coreWeakness: `Most losses cluster on ${worstTimeframe} timeframe with ${timeframeCounts[worstTimeframe] || 0} failed run(s).`,
             recommendedAction: contradictionCount > 0
               ? 'Re-check label quality in manifest and tighten direction filters before entering trades.'
               : 'Tighten entry thresholds (confidence + pattern stability) for this timeframe and rerun the batch.',
             rawLosses: failuresData
          });
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
      case 'NEUTRAL': return 'text-gray-400';
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
            {(Platform.OS as string) === 'web' ? (
              <div
                onClick={() => {
                  document.getElementById('bulk-image-upload')?.click();
                }}
                onDragOver={handleDragOver as any}
                onDrop={handleDropImages as any}
                style={{ cursor: 'pointer', width: '100%', height: '100%' }}
                className="hover:opacity-70 transition-opacity"
              >
                <View style={tw`border-2 border-dashed border-white border-opacity-10 rounded-xl p-8 flex-col items-center justify-center bg-black bg-opacity-20 relative`}>

              {(Platform.OS as string) === 'web' && (
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
                Max Recommended Batch Size: Unlimited (Offline Engine)
              </Text>
              <Text style={tw`text-white text-opacity-50 text-xs text-center px-4`}>
                Drop chart screenshots here to generate a matching JSON manifest sequence.
              </Text>
              {images.length > 0 && (
                <View style={tw`mt-4 bg-[#D9B382] bg-opacity-10 py-1 px-3 rounded-md`}>
                  <Text style={tw`text-[#D9B382] font-black text-[10px]`}>{images.length} IMAGES LOADED</Text>
                </View>
              )}

                </View>
              </div>
            ) : (
              <Pressable
                onPress={() => {
                  if ((Platform.OS as string) === 'web') {
                    document.getElementById('bulk-image-upload')?.click();
                  }
                }}
                style={({ pressed }) => [
                  tw`border-2 border-dashed border-white border-opacity-10 rounded-xl p-8 flex-col items-center justify-center bg-black bg-opacity-20 relative`,
                  { opacity: pressed ? 0.7 : 1 }
                ]}
              >

              {(Platform.OS as string) === 'web' && (
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
                Max Recommended Batch Size: Unlimited (Offline Engine)
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
            )}

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
                 <View style={tw`bg-black bg-opacity-30 border-2 border-dashed border-white border-opacity-20 rounded-xl p-8 items-center justify-center relative overflow-hidden`}>
                   <UploadCloud size={32} color="#D9B382" className="mb-3 opacity-80" />
                   <Text style={tw`text-[#D9B382] font-black text-[12px] uppercase tracking-widest mb-1`}>1. Load Manifest JSON</Text>
                   <Text style={tw`text-white text-opacity-50 text-[10px]`}>Tap to select manifest file</Text>
                   <input type="file" accept=".json" onChange={loadManifest} className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" />
                   {manifestErrors.map((err, i) => (
                     <Text key={i} style={tw`text-red-400 text-xs mt-4`}>• {err}</Text>
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
                            <View style={tw`flex-row items-center justify-end`}>
                              {(() => {
                                const displayDir = item.result?.direction ?? item.earlyDirection;
                                const dirColorClass = item.status === 'Running' && !item.earlyDirection
                                  ? 'text-yellow-400 animate-pulse'
                                  : displayDir === 'UP' ? 'text-green-400'
                                  : displayDir === 'DOWN' ? 'text-red-400'
                                  : 'text-white text-opacity-30';
                                return (
                                  <Text style={tw`text-[10px] font-black uppercase tracking-widest ${dirColorClass}`}>
                                    {displayDir === 'UP' ? 'UP'
                                      : displayDir === 'DOWN' ? 'DOWN'
                                      : item.status === 'Running' ? '···'
                                      : '—'}
                                  </Text>
                                );
                              })()}
                              <Text style={tw`text-white text-opacity-30 text-[10px] mx-1`}>/</Text>
                              <Text style={[tw`text-[10px] font-black uppercase tracking-widest`, tw`${getStatusColor(item.status)}`]}>
                                {item.status === 'WIN' ? 'PROFIT' : item.status === 'NEUTRAL' ? 'NO TRADE' : item.status}
                              </Text>
                            </View>
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
                        onPress={runQueue}
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
