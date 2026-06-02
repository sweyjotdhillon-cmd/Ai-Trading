
/* eslint-disable no-empty */
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Platform } from 'react-native';
import tw from 'twrnc';
import { motion } from 'motion/react';
import { FileJson, UploadCloud, Play, AlertTriangle, Activity, X, Terminal } from 'lucide-react';
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
  techniquesList: any[];
  encryptedSystemTokens?: string;
  saveToStats: (analysisData: any, outcome: 'WIN' | 'LOSS') => void;
  // Global context passes
  stockName: string;
  graphTimeframe: string;
  investmentDuration: string;
  investmentAmount: string;
  profitabilityPercent: string;
}

export type BatchRunStatus = 'Pending' | 'Running' | 'WIN' | 'LOSS' | 'NEUTRAL' | 'INVALID' | 'Error';

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
  const [buildDuration, setBuildDuration] = useState<'3:00' | '5:00'>('3:00');
  const [generationProgress, setGenerationProgress] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [existingManifest, setExistingManifest] = useState<BatchManifest | null>(null);
  const existingManifestRef = useRef<HTMLInputElement>(null);
  
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
    if (images.length === 0 && !existingManifest) return;
    
    setIsGenerating(true);
    setGenerationProgress(`Analyzing ${images.length} images...`);
    
    const entries: BatchManifestEntry[] = [];
    if (existingManifest && existingManifest.entries) {
      entries.push(...existingManifest.entries);
    }
    
    try {
      setGenerationProgress(`Extracting & profiling candle histories (0/${images.length})...`);
      const results: BatchManifestEntry[] = [];
      const MAX_PAYLOAD_KB = 500; // Limit payload to keep JSON small
      
      for (let i = 0; i < images.length; i++) {
        const file = images[i];
        setGenerationProgress(`Extracting history (${i + 1}/${images.length})...`);
        
        let imageData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Run Single deterministic analysis using the real testMode
        let detectedOutcome: 'UP' | 'DOWN' | 'UNKNOWN' = 'UNKNOWN';
        let entryStartCandle: any = null;
        let entryThreePriorCandles: any[] = [];
        let entryAutoGradeGeometry: any = null;

        try {
          const result = await runSingleAnalysis({
            imageDataUrl: imageData,
            stock: stockName,
            graphTimeframe: graphTimeframe,
            investmentDuration: buildDuration, 
            investmentAmount: '100',
            profitabilityPercent: '85',
            techniquesList: techniquesList,
            encryptedSystemTokens,
            signal: new AbortController().signal,
            isManifestCheck: true 
          });
          
          if (result && (result.actualDirection === 'UP' || result.actualDirection === 'DOWN')) {
            detectedOutcome = result.actualDirection;
          }
          if (result && result.startCandle) {
            entryStartCandle = result.startCandle;
          }
          if (result && result.threePriorCandles) {
            entryThreePriorCandles = result.threePriorCandles;
          }
          if (result && result.autoGradeGeometry) {
            entryAutoGradeGeometry = result.autoGradeGeometry;
          }
        } catch (err) {
          console.warn(`Analysis failed on manifest build for ${file.name}:`, err);
        }

        const isBullStart = entryStartCandle ? (entryStartCandle.close >= entryStartCandle.open) : false;
        const notesSummary = entryStartCandle 
          ? `Trade Entry Price [${isBullStart ? 'Broad Bottom' : 'Broad Top'}]: ${entryStartCandle.open?.toFixed(2)}.` + (entryThreePriorCandles.length > 0 ? ` Prior Close: ${entryThreePriorCandles[entryThreePriorCandles.length - 1]?.close?.toFixed(2)}.` : '')
          : '';

        results.push({
          imageFilename: file.name,
          expectedOutcome: detectedOutcome,
          autoGradeGeometry: entryAutoGradeGeometry,
          imageData: imageData.length < MAX_PAYLOAD_KB * 1024 ? imageData : undefined, // ommit gigantic images to stop OOM
          stock: stockName,
          graphTimeframe: graphTimeframe,
          investmentDuration: buildDuration,
          investmentAmount: Number(investmentAmount) || 100,
          profitabilityPercent: Number(profitabilityPercent) || 85,
          notes: notesSummary,
          startCandle: entryStartCandle,
          threePriorCandles: entryThreePriorCandles
        });
      }

      entries.push(...results);

      setGenerationProgress('Packaging manifest content...');

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
    } catch (e: any) {
      console.error('Failed to generate manifest:', e);
      showBulkNotice('Error during manifest creation: ' + e.message, 'error');
    } finally {
      setIsGenerating(false);
      setGenerationProgress('');
      setImages([]); // clear images after build
      setExistingManifest(null); // clear existing manifest after build
    }
  };

  const loadExistingManifest = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const parsed = JSON.parse(text) as BatchManifest;
        if (!parsed.entries || !Array.isArray(parsed.entries)) {
          throw new Error("Invalid manifest format");
        }
        setExistingManifest(parsed);
        showBulkNotice(`Loaded existing manifest with ${parsed.entries.length} entries. New images will be appended.`, 'success');
      } catch (err: any) {
        showBulkNotice("Failed to parse manifest JSON: " + err.message, 'error');
      }
      if (existingManifestRef.current) existingManifestRef.current.value = "";
    };
    reader.readAsText(file);
  };

  // Tab 2 State
  const [queue, setQueue] = useState<BatchRun[]>([]);
  const [isQueueLoaded, setIsQueueLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    import('idb-keyval').then(({ get }) => {
      if (!mounted) return;
      get('bulkTestQueue').then((stored) => {
        if (stored && mounted) {
          try {
            const parsed = stored as BatchRun[];
            setQueue(parsed.map(q => q.status === 'Running' ? { ...q, status: 'Pending' } : q));
          } catch (e) {
            console.warn('Failed to parse queue from idb', e);
          }
        }
      }).catch(e => {
        console.warn('Failed to load queue from idb', e);
      }).finally(() => {
        if (mounted) setIsQueueLoaded(true);
      });
      
      // Migration from localStorage if it exists
      if (typeof window !== 'undefined') {
        try {
          const legacy = localStorage.getItem('bulkTestQueue');
          if (legacy && mounted) {
            const parsed = JSON.parse(legacy) as BatchRun[];
            setQueue(parsed.map(q => q.status === 'Running' ? { ...q, status: 'Pending' } : q));
            localStorage.removeItem('bulkTestQueue');
          }
        } catch(e) {}
      }
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!isQueueLoaded) return;
    import('idb-keyval').then(({ set, del }) => {
      try {
        if (queue.length > 0) {
          const serializableQueue = queue.map(q => {
            const { file, ...rest } = q;
            return rest;
          });
          set('bulkTestQueue', serializableQueue).catch(e => console.warn('IDB save error', e));
        } else {
          del('bulkTestQueue').catch(e => console.warn('IDB del error', e));
        }
      } catch (e) {
        console.warn('Failed to save queue to idb', e);
      }
    });
  }, [queue, isQueueLoaded]);

  const [autopsyingBatch, setAutopsyingBatch] = useState(false);
  const [masterSummary, setMasterSummary] = useState<MasterAutopsySummary | null>(null);
  const [manifestErrors, setManifestErrors] = useState<string[]>([]);
  const [bulkNotice, setBulkNotice] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showBulkNotice = (text: string, type: 'success' | 'info' | 'error' = 'info') => {
    setBulkNotice({ text, type });
    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        setBulkNotice(prev => {
          if (prev?.text === text) return null;
          return prev;
        });
      }, 5000);
    }
  };
  const [isQueueRunning, setIsQueueRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const { requestLock, releaseLock } = useWakeLock();
  
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if ((Platform.OS as string) === 'web') {
      const handleGlobalDragOver = (e: any) => e.preventDefault();
      const handleGlobalDrop = (e: any) => e.preventDefault();
      const handleBeforeUnload = (e: any) => {
        if (isQueueRunning) {
           e.preventDefault();
           e.returnValue = 'Bulk test is running. Are you sure you want to leave?';
        }
      };

      window.addEventListener('dragover', handleGlobalDragOver, { passive: false });
      window.addEventListener('drop', handleGlobalDrop, { passive: false });
      window.addEventListener('beforeunload', handleBeforeUnload);

      return () => {
        window.removeEventListener('dragover', handleGlobalDragOver);
        window.removeEventListener('drop', handleGlobalDrop);
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }
  }, [isQueueRunning]);

  useEffect(() => {
    if (isQueueRunning && !isPaused) {
      requestLock();
    } else {
      releaseLock();
    }
  }, [isQueueRunning, isPaused, requestLock, releaseLock]);

  useEffect(() => {
    // SessionStorage removed because large image data exceeds 5MB quota and causes silent crashes/reloads
  }, []);

  useEffect(() => {
    // Do not attempt to persist the queue to sessionStorage to avoid QuotaExceededError
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
      showBulkNotice(`Missing ${missing.length} files. Please select them first.`, 'error');
      return;
    }

    setIsQueueRunning(true);
    setIsPaused(false);
    abortControllerRef.current = new AbortController();

    const CONCURRENCY_LIMIT = Math.min(5, queue.length > 0 ? queue.length : 1); // 5 concurrent to be fast but avoid memory crash
    let currentIndex = 0;
    const workerLoop = async () => {
      while (currentIndex < queue.length) {
        if (abortControllerRef.current?.signal.aborted || isPaused ) break;
        
        const i = currentIndex++;
        const item = queue[i];
        
        if (item.status === 'WIN' || item.status === 'LOSS' || item.status === 'NEUTRAL' || item.status === 'INVALID') {
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

          let finalOutcome: BatchRunStatus = result.outcome;
          const expected = String(item.entry.expectedOutcome ?? '').toUpperCase();
          const predicted = result.direction;

          if (result.rawOutcome === 'AUTO_GRADE_INVALID' || (result.autoGradeGeometry && !result.autoGradeGeometry.valid)) {
            finalOutcome = 'INVALID';
          } else if (expected === 'UP' || expected === 'DOWN') {
            if (predicted === 'NO_TRADE') {
              finalOutcome = 'NEUTRAL';
            } else {
              finalOutcome = predicted === expected ? 'WIN' : 'LOSS';
            }
          }

          if (finalOutcome === 'WIN' || finalOutcome === 'LOSS') {
             saveToStats(result.analysis, finalOutcome);
          }
          
          const lightweightResult = { 
            ...result, 
            outcome: finalOutcome,
            actualDirection: (expected === 'UP' || expected === 'DOWN') ? (expected as 'UP' | 'DOWN') : result.actualDirection
          };
          // We keep images here for the UI to display thumbnails

          setQueue(q => q.map((r, idx) => idx === i ? { ...r, status: finalOutcome, result: lightweightResult } : r));
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
          const timeframeCounts: Record<string, number> = failuresData.reduce((acc: any, f) => {
            const tf = f.timeframe || 'unknown';
            acc[tf] = (acc[tf] || 0) + 1;
            return acc;
          }, {});
          const worstTimeframe = Object.entries(timeframeCounts as any).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || 'unknown';

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
      case 'INVALID': return 'text-purple-500';
      case 'Error': return 'text-orange-500';
      default: return 'text-white text-opacity-50';
    }
  };

  const clearQueue = () => {
    if (isQueueRunning) return;
    setQueue([]);
    setManifestErrors([]);
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
        {bulkNotice && (
          <View style={[
            tw`mb-4 p-4 rounded-xl flex-row items-center justify-between border-2`,
            bulkNotice.type === 'success' ? tw`bg-[#22c55e] border-[#16a34a]` :
            bulkNotice.type === 'error' ? tw`bg-[#ef4444] border-[#dc2626]` :
            tw`bg-[#f59e0b] border-[#d97706]`
          ]}>
            <View style={tw`flex-row items-center flex-1 mr-3`}>
              <View style={[
                tw`w-2 h-2 rounded-full mr-2.5 bg-black bg-opacity-50`,
              ]} />
              <Text style={[
                tw`text-sm font-black text-black`,
              ]}>
                {bulkNotice.text}
              </Text>
            </View>
            <Pressable onPress={() => setBulkNotice(null)} style={tw`p-1.5 bg-black/20 rounded-full`}>
              <X size={14} color="#000" />
            </Pressable>
          </View>
        )}
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
              <Text style={tw`text-white text-[10px] text-opacity-70 uppercase font-bold tracking-widest mb-3 text-center`}>
                Max Recommended Batch Size: Unlimited (Offline Engine)
              </Text>
              <Text style={tw`text-white text-opacity-80 text-xs text-center px-4`}>
                Drop chart screenshots here to generate a matching JSON manifest sequence.
              </Text>
              {images.length > 0 && (
                <View style={tw`mt-4 bg-[#D9B382] py-2 px-4 rounded-md`}>
                  <Text style={tw`text-[#1A1308] font-black text-[11px]`}>{images.length} IMAGES LOADED</Text>
                </View>
              )}
              {existingManifest && existingManifest.entries && (
                <View style={tw`mt-2 bg-[#D9B382] py-2 px-4 rounded-md`}>
                  <Text style={tw`text-[#1A1308] font-black text-[11px]`}>{existingManifest.entries.length} PREVIOUS MANIFEST ENTRIES LOADED</Text>
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
              <Text style={tw`text-white text-[10px] text-opacity-70 uppercase font-bold tracking-widest mb-3 text-center`}>
                Max Recommended Batch Size: Unlimited (Offline Engine)
              </Text>
              <Text style={tw`text-white text-opacity-80 text-xs text-center px-4`}>
                Drop chart screenshots here to generate a matching JSON manifest sequence.
              </Text>
              {images.length > 0 && (
                <View style={tw`mt-4 bg-[#D9B382] py-2 px-4 rounded-md`}>
                  <Text style={tw`text-[#1A1308] font-black text-[11px]`}>{images.length} IMAGES LOADED</Text>
                </View>
              )}
              {existingManifest && existingManifest.entries && (
                <View style={tw`mt-2 bg-[#D9B382] py-2 px-4 rounded-md`}>
                  <Text style={tw`text-[#1A1308] font-black text-[11px]`}>{existingManifest.entries.length} PREVIOUS MANIFEST ENTRIES LOADED</Text>
                </View>
              )}

              </Pressable>
            )}


            <View style={tw`flex-row justify-between items-center bg-black bg-opacity-20 border border-white border-opacity-10 rounded-xl p-4`}>
              <View>
                <Text style={tw`text-white font-bold text-[10px] uppercase tracking-widest`}>Append to Existing</Text>
                <Text style={tw`text-white text-opacity-70 text-[9px] uppercase tracking-widest mt-1`}>Upload JSON to merge</Text>
              </View>
              <Pressable 
                onPress={() => existingManifestRef.current?.click()}
                style={({pressed}) => [tw`bg-white/5 border border-white/10 px-3 py-2 rounded-lg`, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={tw`text-[#D9B382] text-[10px] font-black tracking-widest`}>LOAD JSON</Text>
              </Pressable>
            </View>
            <input type="file" ref={existingManifestRef} accept=".json,application/json" onChange={loadExistingManifest} style={{display: 'none'}} />

            <View style={tw`pt-4 border-t border-white border-opacity-10`}>
               <Text style={tw`text-[10px] font-black text-[#94a3b8] uppercase tracking-wider mb-2 text-center`}>Investment Duration (Cut Target Window)</Text>
               <View style={tw`flex-row gap-2`}>
                  <Pressable
                    onPress={() => setBuildDuration('3:00')}
                    style={({ pressed }) => [tw`flex-1 h-10 rounded-lg flex-row items-center justify-center border`, buildDuration === '3:00' ? tw`bg-[#D9B382]/20 border-[#D9B382]` : tw`bg-black bg-opacity-20 border-white border-opacity-10`, { opacity: pressed ? 0.7 : 1 }]}
                  >
                     <Text style={[tw`text-[10px] font-black tracking-widest`, buildDuration === '3:00' ? tw`text-[#D9B382]` : tw`text-white text-opacity-50`]}>3 MINUTES</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setBuildDuration('5:00')}
                    style={({ pressed }) => [tw`flex-1 h-10 rounded-lg flex-row items-center justify-center border`, buildDuration === '5:00' ? tw`bg-[#D9B382]/20 border-[#D9B382]` : tw`bg-black bg-opacity-20 border-white border-opacity-10`, { opacity: pressed ? 0.7 : 1 }]}
                  >
                     <Text style={[tw`text-[10px] font-black tracking-widest`, buildDuration === '5:00' ? tw`text-[#D9B382]` : tw`text-white text-opacity-50`]}>5 MINUTES</Text>
                  </Pressable>
               </View>
            </View>

            <View style={tw`pt-4`}>
              {isGenerating ? (
                <View style={tw`items-center justify-center gap-2 h-14 bg-[#D9B382] rounded-xl px-4 flex-row`}>
                  <Activity size={16} color="#1A1308" className="animate-spin" />
                  <Text style={tw`text-[#1A1308] font-black text-xs uppercase tracking-widest`}>
                    {generationProgress}
                  </Text>
                </View>
              ) : (
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Pressable 
                    onPress={handleGenerateManifest}
                    disabled={images.length === 0 && !existingManifest}
                    style={tw`flex-row items-center justify-center bg-[#D9B382] ${(images.length === 0 && !existingManifest) ? 'opacity-50' : 'opacity-100'} h-12 rounded-xl px-6`}
                  >
                    <FileJson size={16} color="#1A1308" />
                    <Text style={tw`text-[#1A1308] font-black text-xs uppercase tracking-widest ml-2`}>
                      Generate & Download Manifest
                    </Text>
                  </Pressable>
                </motion.div>
              )}
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
                            {!!(item.entry.stock || item.entry.investmentDuration) && (
                              <Text style={tw`text-white text-opacity-50 text-[9px] uppercase tracking-widest mt-0.5`}>
                                {item.entry.stock || stockName} • {item.entry.investmentDuration || investmentDuration}
                              </Text>
                            )}
                            {!!(item.entry.expectedOutcome && item.entry.expectedOutcome !== 'UNKNOWN') && (
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
                                {item.status === 'WIN' ? 'WIN' : item.status === 'NEUTRAL' ? 'NO TRADE' : item.status}
                              </Text>
                            </View>
                            {!!item.error && <Text style={tw`text-orange-400 text-[8px]`} numberOfLines={1}>{item.error.substring(0, 20)}</Text>}
                            {!item.error && !!item.result && (
                              <Text style={tw`text-white text-opacity-40 text-[8px] text-right uppercase tracking-widest mt-0.5`}>
                                {item.result.confidence}% conf
                              </Text>
                            )}
                          </View>
                        </Pressable>
                        {expandedIdx === idx && !!item.result && (
                          <View style={tw`px-4 pb-4 pt-1 gap-3`}>
                            <View style={tw`flex-row justify-center relative w-full h-[180px] mt-4 overflow-hidden rounded-lg`}>
                              {!!item.result.finalImageForAnalysis && (
                                <View style={tw`flex-auto relative h-full flex flex-col`}>
                                  <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                    <img src={item.result.finalImageForAnalysis} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                  </div>
                                </View>
                              )}

                              {!!item.result.testModeRightSlice && (
                                <View style={tw`flex-1 relative h-full flex flex-col`}>
                                  <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                    <img src={item.result.testModeRightSlice} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                    {(() => {
                                      const geom: any = item.result.autoGradeGeometry;
                                      if (!geom || !geom.valid) return null;
                                      
                                      const yEntryPct = geom.entryY * 100;
                                      const yExitPct  = geom.exitY  * 100;
                                      const xExitPct  = geom.exitX  * 100;
                                      const predictedBull = item.result.direction === 'UP';
                                      
                                      return (
                                        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}>
                                          <defs>
                                            <filter id="glowGreenBulk" x="-20%" y="-20%" width="140%" height="140%">
                                              <feGaussianBlur stdDeviation="3" result="blur" />
                                              <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                            </filter>
                                            <filter id="glowRedBulk" x="-20%" y="-20%" width="140%" height="140%">
                                              <feGaussianBlur stdDeviation="3" result="blur" />
                                              <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                            </filter>
                                          </defs>
                                          <line
                                            x1="0%"
                                            y1={`${yEntryPct}%`}
                                            x2="100%"
                                            y2={`${yEntryPct}%`}
                                            stroke="#eab308"
                                            strokeWidth="2"
                                            strokeDasharray="4,4"
                                            opacity="0.8"
                                          />
                                          <line
                                            x1="0%"
                                            y1={`${yExitPct}%`}
                                            x2={`${xExitPct}%`}
                                            y2={`${yExitPct}%`}
                                            stroke={predictedBull ? '#10b981' : '#f43f5e'}
                                            strokeWidth="2"
                                            strokeDasharray="4,4"
                                            opacity="0.8"
                                          />
                                          <circle 
                                            cx={`${xExitPct}%`}
                                            cy={`${yExitPct}%`}
                                            r="3.5"
                                            fill={predictedBull ? '#10b981' : '#f43f5e'}
                                            filter={predictedBull ? "url(#glowGreenBulk)" : "url(#glowRedBulk)"}
                                          />
                                        </svg>
                                      );
                                    })()}
                                  </div>
                                </View>
                              )}

                            </View>

                            {/* Dynamic Real Prices / Math Engine Box */}
                            {item.result.entryClose !== undefined && item.result.exitClose !== undefined && item.result.entryClose !== null && item.result.exitClose !== null && (
                              <View style={tw`bg-[#1e293b]/35 border border-[#38bdf8]/10 rounded-xl p-3 mt-1`}>
                                <View style={tw`flex-row justify-between items-center mb-2`}>
                                  <View style={tw`flex-row items-center`}>
                                    <Terminal size={12} color="#38bdf8" style={tw`mr-1`} />
                                    <Text style={tw`text-[#38bdf8] text-[9px] font-black uppercase tracking-wider`}>
                                      MATH ENGINE EVALUATION
                                    </Text>
                                  </View>
                                  <Text style={tw`text-[#38bdf8] text-[8px] font-bold uppercase tracking-widest opacity-80`}>
                                    Batch Entry Run
                                  </Text>
                                </View>

                                <View style={tw`flex-row justify-between mb-2 gap-2`}>
                                  <View style={tw`flex-1 bg-[#0f172a]/70 p-2 rounded-lg border border-white/5`}>
                                    <Text style={tw`text-white/40 text-[8px] font-black uppercase tracking-wider`}>
                                      Entry Candle (Trade Opening)
                                    </Text>
                                    <Text style={tw`text-yellow-400 text-sm font-black font-mono mt-0.5`}>
                                      {item.result.entryClose.toFixed(2)}
                                    </Text>
                                  </View>

                                  <View style={tw`flex-1 bg-[#0f172a]/70 p-2 rounded-lg border border-white/5`}>
                                    <Text style={tw`text-white/40 text-[8px] font-black uppercase tracking-wider`}>
                                      Final Outcome Rate
                                    </Text>
                                    <Text style={tw`text-green-400 text-sm font-black font-mono mt-0.5`}>
                                      {item.result.exitClose.toFixed(2)}
                                    </Text>
                                  </View>
                                </View>

                                <View style={tw`flex-row justify-between items-center bg-[#070b12]/50 p-2 rounded-lg border border-white/5`}>
                                  <View>
                                    <Text style={tw`text-white/40 text-[8px] font-bold uppercase`}>Price Delta</Text>
                                    <Text style={tw`text-white text-xs font-bold font-mono mt-0.5`}>
                                      {(item.result.exitClose - item.result.entryClose) >= 0 ? '+' : ''}{(item.result.exitClose - item.result.entryClose).toFixed(2)}
                                      <Text style={tw`text-[10px] ml-1 font-bold ${item.result.exitClose >= item.result.entryClose ? 'text-green-500' : 'text-red-500'}`}>
                                        ({item.result.exitClose >= item.result.entryClose ? '▲ UP' : '▼ DOWN'})
                                      </Text>
                                    </Text>
                                  </View>

                                  <View style={tw`items-end`}>
                                    <Text style={tw`text-white/40 text-[8px] font-bold uppercase`}>Alignment Verdict</Text>
                                    <Text style={tw`text-xs font-black uppercase mt-0.5 ${
                                      ((item.result.direction === 'UP' && item.result.exitClose >= item.result.entryClose) || (item.result.direction === 'DOWN' && item.result.exitClose < item.result.entryClose))
                                        ? 'text-green-400'
                                        : 'text-red-400'
                                    }`}>
                                      {((item.result.direction === 'UP' && item.result.exitClose >= item.result.entryClose) || (item.result.direction === 'DOWN' && item.result.exitClose < item.result.entryClose))
                                        ? 'WORTH IT (MATCH)'
                                        : 'LOSS (CONTRARY)'}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            )}

                            {/* Candle Trajectory Analysis */}
                            {((item.result.startCandle) || (item.result.threePriorCandles && item.result.threePriorCandles.length > 0)) && (
                              <View style={tw`bg-[#131d30]/75 border border-[#fbbf24]/10 rounded-xl p-3 mt-2 mb-2`}>
                                <View style={tw`flex-row justify-between items-center mb-2`}>
                                  <View style={tw`flex-row items-center gap-1`}>
                                    <View style={tw`w-2 h-2 rounded-full bg-yellow-400`} />
                                    <Text style={tw`text-yellow-400 text-[9px] font-black uppercase tracking-wider`}>
                                      CANDLE TRAJECTORY LOGS
                                    </Text>
                                  </View>
                                  <Text style={tw`text-white/40 text-[8px] font-bold uppercase`}>
                                    1st Candle + 3 Prior
                                  </Text>
                                </View>

                                {/* Three Prior Candles */}
                                {item.result.threePriorCandles && item.result.threePriorCandles.length > 0 && (
                                  <View style={tw`mb-2.5`}>
                                    <Text style={tw`text-white/50 text-[8px] font-black uppercase tracking-wide mb-1`}>
                                      Preceding 3 Candles (Historical Trend)
                                    </Text>
                                    <View style={tw`flex-row gap-1.5`}>
                                      {item.result.threePriorCandles.map((c: any, cidx: number) => {
                                        const isBull = c.close >= c.open;
                                        return (
                                          <View key={cidx} style={tw`flex-1 bg-[#1e293b]/50 p-1.5 rounded-lg border ${isBull ? 'border-green-500/10' : 'border-red-500/10'}`}>
                                            <Text style={tw`text-white/30 text-[7px] font-bold`}>
                                              PRIOR {3 - cidx}
                                            </Text>
                                            <Text style={tw`text-[10px] font-bold font-mono ${isBull ? 'text-green-400' : 'text-red-400'} mt-0.5`}>
                                              {c.close?.toFixed(2)}
                                            </Text>
                                            <Text style={tw`text-[6px] text-white/45 font-mono mt-0.5`}>
                                              O:{c.open?.toFixed(1)} H:{c.high?.toFixed(1)} L:{c.low?.toFixed(1)}
                                            </Text>
                                          </View>
                                        );
                                      })}
                                    </View>
                                  </View>
                                )}

                                {/* Star First Candle */}
                                {item.result.startCandle && (
                                  <View style={tw`bg-[#1e293b]/80 p-2 rounded-lg border border-yellow-400/20`}>
                                    <View style={tw`flex-row justify-between items-center mb-1`}>
                                      <Text style={tw`text-yellow-400 text-[8px] font-black uppercase tracking-widest`}>
                                        ★ STAR FIRST CANDLE (TRADE START)
                                      </Text>
                                      <View style={tw`bg-yellow-400/10 px-1.5 py-0.5 rounded`}>
                                        <Text style={tw`text-yellow-400 text-[7px] font-black`}>TRIGGER</Text>
                                      </View>
                                    </View>
                                    <View style={tw`flex-row justify-between items-center`}>
                                      <View>
                                        <Text style={tw`text-white/40 text-[7px] font-semibold uppercase`}>
                                          Reference Entry {item.result.startCandle.close >= item.result.startCandle.open ? '(Broad Bottom)' : '(Broad Top)'}
                                        </Text>
                                        <Text style={tw`text-yellow-400 text-xs font-black font-mono mt-0.5`}>
                                          {item.result.startCandle.open?.toFixed(2)}
                                        </Text>
                                      </View>
                                      <View style={tw`items-end`}>
                                        <Text style={tw`text-white/40 text-[7px] font-semibold uppercase`}>Candle Close (Outcome Base)</Text>
                                        <Text style={tw`text-white/85 text-[10px] font-mono mt-0.5`}>
                                          {item.result.startCandle.close?.toFixed(2)}
                                        </Text>
                                      </View>
                                    </View>
                                  </View>
                                )}
                              </View>
                            )}

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
}
