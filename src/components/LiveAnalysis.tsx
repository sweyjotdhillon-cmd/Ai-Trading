import { runSingleAnalysis, onStableSignal } from '../utils/singleAnalysis';
import { LiveAnalysisDashboard } from './live-analysis/LiveAnalysisDashboard';
import { LiveAnalysisDebate } from './live-analysis/LiveAnalysisDebate';
import { LiveAnalysisResult } from './live-analysis/LiveAnalysisResult';
import { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Platform } from 'react-native';
import { TIMEOUTS } from '../config/timeouts';

import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { 
  Sparkles, 
  AlertTriangle,
} from 'lucide-react';
import tw from 'twrnc';
import { isCalibrated } from '../vision/colorCalibration';
import { CalibrationOverlay } from './CalibrationOverlay';
























































import { useWakeLock } from '../hooks/useWakeLock';

let _seed = 0xC0FFEE;
function pseudoRandom() {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
};

// Utility to downscale images on the web before sending to server


export function LiveAnalysis() {
  const [stockName, setStockName] = useState('Bitcoin');
  const [graphTimeframe, setGraphTimeframe] = useState('3 minutes');
  const [loading, setLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [mode, setMode] = useState<'live' | 'test' | 'bulk'>('live');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [calibrationFrame, setCalibrationFrame] = useState<ImageData | null>(null);
  const [isStable, setIsStable] = useState(false);
  
  const { requestLock, releaseLock } = useWakeLock();

  // Live Trading Loop States
  const [tradingPhase, setTradingPhase] = useState<'IDLE' | 'ANALYSING_DIRECTION' | 'WAITING_FOR_ENTRY' | 'ENTRY_CONFIRMED'>('IDLE');
  const [tradingDirection, setTradingDirection] = useState<'UP' | 'DOWN' | 'NO_TRADE' | null>(null);
  
  // Real-Time Scout (10s Tick)
  const [scoutActive, setScoutActive] = useState(false);
  const [scoutData, setScoutData] = useState<{action: string, reason: string} | null>(null);

  // PiP Widget state
  const [pipActive, setPipActive]         = useState(false);
  const [pipSignal, setPipSignal]         = useState<'ANALYZING' | 'CALL' | 'PUT' | 'NO_TRADE' | 'IDLE'>('IDLE');
  const [pipConfidence, setPipConfidence] = useState<number>(0);
  const [pipSupported, setPipSupported]   = useState(false);

  useEffect(() => {
    if (isBusy || scoutActive) {
      requestLock();
    } else {
      releaseLock();
    }
  }, [isBusy, scoutActive, requestLock, releaseLock]);

  useEffect(() => {
    return onStableSignal((payload) => {
      if (payload.signal === 'CALL') setTradingDirection('UP');
      else if (payload.signal === 'PUT') setTradingDirection('DOWN');
      else setTradingDirection('NO_TRADE');
      setTradingPhase('ENTRY_CONFIRMED');
      setIsStable(true);
    }) as any;
  }, []);
  
  // Live Camera States
  const videoRef = useRef<any>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);


  
  // Offline deterministic mode -> tokens are always healthy (no tokens needed)
  const [encryptedSystemTokens] = useState<string | undefined>('offline-mode-active');
  
  useEffect(() => {
    // Offline mode, no snapshot needed
  }, []);

  useEffect(() => {
    // Check browser support for Picture-in-Picture API
    setPipSupported(
      typeof document !== 'undefined' &&
      'pictureInPictureEnabled' in document &&
      (document as any).pictureInPictureEnabled === true
    );
  }, []);

  // Parallel Judge Logs

    const [judgeLogs, setJudgeLogs] = useState({
     judge1: { text: "", status: 'idle' },
     judge2: { text: "", status: 'idle' },
     judge3: { text: "", status: 'idle' },
     judge4: { text: "", status: 'idle' },
     system: { text: "", status: 'idle' }
  });
  
  // UX Error Handling
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  
  // Dropdown States
  const [showTfPicker, setShowTfPicker] = useState(false);
  const [showDurPicker, setShowDurPicker] = useState(false);
  
  // Investment Details
  const [investmentAmount, setInvestmentAmount] = useState('100');
  const [investmentDuration, setInvestmentDuration] = useState('3m');
  const [profitabilityPercent, setProfitabilityPercent] = useState('85');

  // Technique Files
  const [techniquesList, setTechniquesList] = useState<string[]>([]);
  const [techFileName, setTechFileName] = useState<string | null>(null);

  const [confirmedOutcome, setConfirmedOutcome] = useState<'WIN' | 'LOSS' | null>(null);

  const [autoGradeStatus, setAutoGradeStatus] = useState<'idle' | 'grading' | 'done' | 'failed'>('idle');
  const [testModeLeftSlice, setTestModeLeftSlice] = useState<string | null>(null);
  const [testModeRightSlice, setTestModeRightSlice] = useState<string | null>(null);
  const [autoGradeReason, setAutoGradeReason] = useState<string>('');
  const [autoGradeConfidence, setAutoGradeConfidence] = useState<number>(0);
  const [autoGradeRawOutcome, setAutoGradeRawOutcome] = useState<string>('');
  const actualDirection: 'UP' | 'DOWN' | null =
    confirmedOutcome === 'WIN' ? 'UP' : confirmedOutcome === 'LOSS' ? 'DOWN' : null;
  const [statsData, setStatsData] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const existing = sessionStorage.getItem('stats_surface_data');
        if (existing) return JSON.parse(existing).stats || [];
      } catch {
        // ignore
      }
    }
    return [];
  });
  const [sessionIndex] = useState<number>(() => Math.floor(pseudoRandom() * 1000));

  const fileInputRef = useRef<any>(null);
  const techInputRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // PiP Signal Widget refs
  const pipCanvasRef    = useRef<HTMLCanvasElement | null>(null);
  const pipVideoRef     = useRef<HTMLVideoElement | null>(null);
  const pipStreamRef    = useRef<MediaStream | null>(null);
  const pipAnimFrameRef = useRef<number | null>(null);

  const prefersReducedMotion = useReducedMotion();
  const springProps = { type: "spring" as const, stiffness: 400, damping: 22 };
  const cardHoverProps = prefersReducedMotion ? {} : { y: -2, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" };
  const buttonHoverProps = prefersReducedMotion ? {} : { scale: 1.04 };
  const buttonTapProps = prefersReducedMotion ? {} : { scale: 0.96 };

  useEffect(() => {
    if (isCameraActive && videoRef.current && !isCalibrated()) {
      const v = videoRef.current;
      const captureCalibration = () => {
        if (v.readyState >= 2) {
            const canvas = document.createElement('canvas');
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              setCalibrationFrame(ctx.getImageData(0, 0, canvas.width, canvas.height));
            }
        } else {
            setTimeout(captureCalibration, 500);
        }
      };
      captureCalibration();
    }
  }, [isCameraActive]);

  useEffect(() => {
    const handleRecalibrate = () => {
      const v = videoRef.current;
      if (v && v.readyState >= 2) {
        const canvas = document.createElement('canvas');
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          setCalibrationFrame(ctx.getImageData(0, 0, canvas.width, canvas.height));
        }
      }
    };
    window.addEventListener('determinist:recalibrate', handleRecalibrate);
    return () => window.removeEventListener('determinist:recalibrate', handleRecalibrate);
  }, []);

  useEffect(() => {
    return () => {
      // Cleanup camera on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      closePip(true);
    };
  }, []);

  const symbols = [
    { name: 'Bitcoin', icon: '₿' },
    { name: 'Apple', icon: 'A' },
    { name: 'Google', icon: 'G' },
  ];

  const timeframes = ['5 minutes', '3 minutes'];
  const durations = ['3m', '5m'];



  const drawPipFrame = (signal: 'ANALYZING' | 'CALL' | 'PUT' | 'NO_TRADE' | 'IDLE', confidence: number = 0, subText: string = '') => { const canvas = pipCanvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return; const W = 480, H = 270; ctx.clearRect(0, 0, W, H); const bgColors: Record<string, string> = { ANALYZING: '#0d0d14', CALL: '#021a0b', PUT: '#1a0202', NO_TRADE: '#141008', IDLE: '#0d0d14' }; ctx.fillStyle = bgColors[signal] ?? '#0d0d14'; ctx.fillRect(0, 0, W, H); const accentColors: Record<string, string> = { ANALYZING: '#D9B382', CALL: '#22C55E', PUT: '#EF4444', NO_TRADE: '#F59E0B', IDLE: '#4B5570' }; const accent = accentColors[signal] ?? '#4B5570'; ctx.fillStyle = accent; ctx.fillRect(0, 0, W, 4); ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1; for (let x = 0; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = 0; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left'; ctx.fillText('AI TRADING · PRO TERMINAL', 16, 26); if (signal === 'ANALYZING') { ctx.fillStyle = '#D9B382'; ctx.beginPath(); ctx.arc(W - 20, 20, 5, 0, Math.PI * 2); ctx.fill(); } const signalLabels: Record<string, string> = { ANALYZING: 'ANALYZING...', CALL: 'CALL  ▲', PUT: 'PUT   ▼', NO_TRADE: 'NO TRADE', IDLE: 'STANDBY' }; const label = signalLabels[signal] ?? signal; ctx.font = 'bold 64px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = signal === 'ANALYZING' ? 0 : 20; ctx.fillText(label, W / 2, 165); ctx.shadowBlur = 0; if ((signal === 'CALL' || signal === 'PUT') && confidence > 0) { const barW = 280, barH = 6; const barX = (W - barW) / 2, barY = 190; ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); (ctx as any).roundRect(barX, barY, barW, barH, 3); ctx.fill(); ctx.fillStyle = accent; ctx.beginPath(); (ctx as any).roundRect(barX, barY, barW * (confidence / 100), barH, 3); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 13px monospace'; ctx.fillText(`${confidence}% CONFIDENCE`, W / 2, 218); } if (subText) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '12px monospace'; ctx.fillText(subText, W / 2, 245); } ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.font = '10px monospace'; ctx.fillText('Switch back to broker when ready', W / 2, H - 10); };

  const closePip = (exitPip = true) => { if (pipAnimFrameRef.current) { cancelAnimationFrame(pipAnimFrameRef.current); pipAnimFrameRef.current = null; } if (exitPip && document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); } pipStreamRef.current?.getTracks().forEach(t => t.stop()); pipStreamRef.current = null; if (pipVideoRef.current) { pipVideoRef.current.pause(); if (document.body.contains(pipVideoRef.current)) { document.body.removeChild(pipVideoRef.current); } pipVideoRef.current = null; } pipCanvasRef.current = null; setPipActive(false); setPipSignal('IDLE'); setPipConfidence(0); };

  const startPip = async (): Promise<boolean> => { if (!pipSupported) { alert('Picture-in-Picture is not supported in this browser. Use Chrome or Edge.'); return false; } try { const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270; pipCanvasRef.current = canvas; drawPipFrame('ANALYZING', 0, 'Switching to your broker now...'); const stream = canvas.captureStream(2); pipStreamRef.current = stream; const video = document.createElement('video'); video.srcObject = stream; video.muted = true; pipVideoRef.current = video; document.body.appendChild(video); await video.play(); await (video as any).requestPictureInPicture(); video.addEventListener('leavepictureinpicture', () => { setPipActive(false); setPipSignal('IDLE'); closePip(false); }); setPipActive(true); setPipSignal('ANALYZING'); const redraw = () => { drawPipFrame(pipSignal === 'IDLE' ? 'ANALYZING' : pipSignal, pipConfidence); pipAnimFrameRef.current = requestAnimationFrame(redraw); }; pipAnimFrameRef.current = requestAnimationFrame(redraw); return true; } catch (err: any) { console.error('[PiP] Failed to start:', err); if (err.name !== 'NotAllowedError') { alert(`PiP failed: ${err.message}`); } return false; } };

  // const updatePip = (signal: 'CALL' | 'PUT' | 'NO_TRADE', confidence: number) => { if (!pipActive || !pipCanvasRef.current) return; setPipSignal(signal); setPipConfidence(confidence); const subText = signal === 'NO_TRADE' ? 'Conditions unclear — skip this trade' : `${signal === 'CALL' ? 'Buy CALL' : 'Buy PUT'} — execute now`; drawPipFrame(signal, confidence, subText); if ('vibrate' in navigator) { navigator.vibrate(signal === 'NO_TRADE' ? [200] : [150, 80, 150]); } };

  const handleReset = () => {
    setAnalysis(null);
    setAnalysisStep(null);
    setAnalysisError(null);
    setSelectedImage(null);
    setTradingPhase('IDLE');
    setTradingDirection(null);
    setConfirmedOutcome(null);
    setAutoGradeStatus('idle');
    setTestModeLeftSlice(null);
    setAutoGradeReason('');
    setAutoGradeConfidence(0);
    setAutoGradeRawOutcome('');
    setMode('live');
    setMode('live');
    setStockName('Bitcoin');
    setGraphTimeframe('30 minutes');
    setInvestmentDuration('3m');
    setScoutActive(false);
    setScoutData(null);
    setLoading(false);
    setIsBusy(false);
    
    setJudgeLogs({
      judge1: { text: "", status: 'idle' },
      judge2: { text: "", status: 'idle' },
      judge3: { text: "", status: 'idle' },
      judge4: { text: "", status: 'idle' },
      system: { text: "", status: 'idle' }
    });

    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }
    if (videoRef.current) {
        videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);

    // Stop PiP on reset

    closePip(true);

    setTimeout(() => {
      alert("Analysis reset. Controls restored to defaults.");
    }, 300);
  };

  const startCamera = async () => {
    if (Platform.OS === 'web') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          } 
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setIsCameraActive(true);
      } catch (err) {
        console.error("Camera access error:", err);
        setTimeout(() => {
          alert("Camera access denied or not available. Please ensure you have granted permission.");
        }, 300);
      }
    } else {
      setTimeout(() => {
        alert("Live camera is supported on web interface only via standard browser APIs.");
      }, 300);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track: any) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  useEffect(() => {
    let isMounted = true;
    let isFetching = false;
    let worker: Worker | null = null;
    
    // Create a Web Worker for reliable background checking, preventing browser timeout throttling.
    if (typeof window !== 'undefined') {
      const code = `
        let timerId;
        self.onmessage = function(e) {
          if (e.data.command === 'start') {
             clearTimeout(timerId);
             timerId = setTimeout(() => self.postMessage('tick'), e.data.interval);
          } else if (e.data.command === 'stop') {
             clearTimeout(timerId);
          }
        };
      `;
      const blob = new Blob([code], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
    }

    const startScoutLoop = async () => {
      if (!isMounted || !scoutActive || !analysis || !isCameraActive || !videoRef.current) return;
      
      const currentInterval = (tradingPhase === 'WAITING_FOR_ENTRY' || tradingPhase === 'ENTRY_CONFIRMED') ? 2000 : 10000;
      const startTime = performance.now();

      if (!isFetching) {
        isFetching = true;
        try {
          const video = videoRef.current;
          const canvas = document.createElement('canvas');
          // Downscale for scout to run very fast
          canvas.width = 640;
          canvas.height = (video.videoHeight / video.videoWidth) * 640;
          const ctx = canvas.getContext('2d');
          
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const scoutImgDataUrl = canvas.toDataURL('image/jpeg', 0.6);
            
            // Run actual 100% offline deterministic engine live check
            const scoutController = new AbortController();
            const result = await runSingleAnalysis({
              imageDataUrl: scoutImgDataUrl,
              stock: stockName,
              graphTimeframe,
              investmentDuration,
              investmentAmount: investmentAmount as string,
              profitabilityPercent: profitabilityPercent as string,
              techniquesList,
              encryptedSystemTokens,
              signal: scoutController.signal,
              isTestMode: false,
              onProgress: () => {}, // silent
              onJudgeLogs: () => {}, // silent
            });
            
            if (isMounted) {
              let scoutJSON = { action: 'CONTINUE', reason: `Live check: ${result.direction} (Conf: ${result.confidence}%)` };
              
              if (tradingDirection && result.direction !== 'NO_TRADE' && result.direction !== tradingDirection && result.confidence >= 60) {
                 scoutJSON = { action: 'ABORT', reason: `Contradicting signal (${result.direction}) detected. Aborting trade.` };
                 // Save the aborting frame analysis for Loss Autopsy
                 setAnalysis(result.analysis);
              }
              
              setScoutData(scoutJSON);
              
              if (scoutJSON.action === 'ABORT' || scoutJSON.action === 'EXIT') {
                setAnalysisError(`Trade Aborted: ${scoutJSON.reason}`);
                setScoutActive(false);
                setTradingPhase('IDLE');
                setAnalysisStep('TRADE REJECTED - CONDITIONS INVALIDATED');
              }
            }
          }
        } catch (e) {
          console.error("Scout loop error", e);
        } finally {
          isFetching = false;
        }
      }
      
      if (isMounted) {
        // High-speed mode: subtract the time spent processing to hit the next window exactly
        const elapsed = performance.now() - startTime;
        const nextTick = Math.max(500, currentInterval - elapsed); 
        if (worker) {
           worker.postMessage({ command: 'start', interval: nextTick });
        }
      }
    };

    if (worker) {
      worker.onmessage = () => {
        if (isMounted) startScoutLoop().catch(console.error);
      };
    }

    if (scoutActive && analysis && isCameraActive && videoRef.current) {
      const initialInterval = (tradingPhase === 'WAITING_FOR_ENTRY' || tradingPhase === 'ENTRY_CONFIRMED') ? 2000 : 10000;
      if (worker) {
         worker.postMessage({ command: 'start', interval: initialInterval });
      }
    }
    
    return () => {
      isMounted = false;
      if (worker) {
        worker.postMessage({ command: 'stop' });
        worker.terminate();
      }
    };
  }, [scoutActive, analysis, isCameraActive, tradingPhase, encryptedSystemTokens, graphTimeframe, investmentAmount, investmentDuration, profitabilityPercent, stockName, techniquesList, tradingDirection]);

  const closePickers = () => {
    setShowTfPicker(false);
    setShowDurPicker(false);
  };

  const handlePickImage = () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click();
    }
  };


  const handleDrop = (e: any) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setSelectedImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };
  const preventDefault = (e: any) => e.preventDefault();

  const handlePickTechnique = () => {
    if (Platform.OS === 'web') {
      techInputRef.current?.click();
    }
  };

  const onFileChange = (e: any) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onTechniqueChange = (e: any) => {
    const file = e.target.files[0];
    if (file) {
      setTechFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          // Expecting either { techniques: [] } or a direct array
          const parsedList = Array.isArray(json) ? json : (json.techniques || []);
          const list = parsedList.map((item: any) => typeof item === 'object' ? (item.name || item.technique || JSON.stringify(item)) : item);
          setTechniquesList(list);
          setTimeout(() => {
            alert(`Successfully loaded ${list.length} techniques from ${file.name}.`);
          }, 300);
        } catch (err) {
          console.error("Failed to parse technique file:", err);
          setTimeout(() => {
            alert("Invalid technique file format. Please upload a JSON file containing a list of techniques.");
          }, 300);
        }
      };
      reader.readAsText(file);
    }
  };

  const saveToStats = (analysisData: any, outcome: 'WIN' | 'LOSS') => {
    try {
      const entryIdx = statsData.length + 1;
      const profitPct = Number(profitabilityPercent);
      const investAmt = Number(investmentAmount);
      const potentialProfit = (profitPct / 100) * investAmt;
      const now = new Date();

      const newEntry = {
        id: entryIdx,
        sessionName: `${stockName.replace('/', '_')}_${entryIdx}`,
        sessionIndex: sessionIndex,
        timestamp: now.toISOString(),
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString(),
        stock: stockName,
        timeframe: graphTimeframe,
        duration: investmentDuration,
        investment: investAmt,
        profitPercentage: profitPct,
        profitPotential: potentialProfit,
        lossPotential: investAmt,
        signal: analysisData?.judge?.winner === 'BULL' ? 'CALL' : 
                (analysisData?.judge?.winner === 'BEAR' ? 'PUT' : 'WAIT'),
        result: outcome,
        exactProfit: outcome === 'WIN' ? potentialProfit : -investAmt,
        profitAmount: outcome === 'WIN' ? potentialProfit : -investAmt,
        reasoning: analysisData?.judge?.ruling || 'N/A',
        confidence: analysisData?.judge?.finalConfidence || 0,
        totalScore: analysisData?.judge?.totalScore || 0,
        decision: analysisData?.judge?.decision || 'UNKNOWN',
        techniquesApplied: techniquesList,
        isAutoGraded: mode === 'test'
      };

      const updatedStats = [...statsData, newEntry];
      setStatsData(updatedStats);
      setConfirmedOutcome(outcome);

      const existing = sessionStorage.getItem('stats_surface_data');
      let localStats = { stats: [] };
      if (existing) localStats = JSON.parse(existing);
      localStats.stats.push(newEntry as never);
      sessionStorage.setItem('stats_surface_data', JSON.stringify(localStats));
    } catch (err) {
      console.error("Failed to save stats:", err);
    }
  };

  const handleAnalyze = async () => {
    if (loading || isBusy) return;
    setIsBusy(true);

    let finalImageToAnalyze = selectedImage;

    if (mode === 'live' && isCameraActive && videoRef.current) {
      // ── Existing camera capture (DO NOT CHANGE) ───────────────────────────────
      if (Platform.OS === 'web') {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        finalImageToAnalyze = canvas.toDataURL('image/jpeg');
      }
    }



    if (!finalImageToAnalyze) {
      const msg = 'Please start the camera or upload a chart image first.';
      setTimeout(() => alert(msg), 300);
      setIsBusy(false);
      return;
    }

    setTimeout(() => {
      (async () => {
        let controller: AbortController | undefined;
        let timeoutId: any;
        try {
          setLoading(true);
          setAnalysisStep('INITIATING OFFLINE ANALYSIS...');

          controller = new AbortController();

          timeoutId = setTimeout(() => {
            if (controller) controller.abort();
          }, TIMEOUTS.SINGLE_ANALYSIS_MS);

          const result = await runSingleAnalysis({
            imageDataUrl: finalImageToAnalyze,
            stock: stockName,
            graphTimeframe,
            investmentDuration,
            investmentAmount: investmentAmount as string,
            profitabilityPercent: profitabilityPercent as string,
            techniquesList,
            encryptedSystemTokens,
            signal: controller.signal,
            isTestMode: mode === 'test',
            onProgress: (step) => setAnalysisStep(step),
            onJudgeLogs: (logs) => setJudgeLogs(prev => ({...prev, ...logs}))
          });

          clearTimeout(timeoutId);

          setAnalysis(result.analysis);

          if (mode === 'test') {
             if (result.testModeRightSlice) {
               setTestModeRightSlice(result.testModeRightSlice);
             }
             if (result.finalImageForAnalysis) {
               setTestModeLeftSlice(result.finalImageForAnalysis);
             }
             setConfirmedOutcome(null);
             setAutoGradeReason(result.reason || '');
             setAutoGradeConfidence(Number(result.confidence) || 0);
             setAutoGradeRawOutcome(result.rawOutcome || '');

             if (result.outcome === 'WIN' || result.outcome === 'LOSS') {
                saveToStats(result.analysis, result.outcome);
                setAutoGradeStatus('done');
             } else {
                setAutoGradeStatus('failed');
             }
          }


          setTimeout(() => {
            if (result.direction !== 'NO_TRADE') {
               // Usually on stable signal we do this, but if we're not running stable logic here
            } else {
              setTradingPhase('IDLE');
              setAnalysisStep('LIVE TICK SCOUT ACTIVE');
              if (mode !== 'test') setTradingDirection(null);
            }
          }, 6000);

          setLoading(false);
          setIsBusy(false);
          setScoutActive(true);

        } catch (error: any) {
          clearTimeout(timeoutId);
          let msg = error.message || "Unknown error";
          const lowerMsg = msg.toLowerCase();
          
          if (error.name === 'AbortError' || lowerMsg.includes('aborted') || lowerMsg.includes('abort')) {
            msg = "Analysis timed out (240s limit). The models are deep in thought. Please try again.";
          } else if (lowerMsg.includes('failed to fetch') || lowerMsg.includes('fetch failed') || lowerMsg.includes('network error') || lowerMsg.includes('load failed')) {
            msg = "Network connection dropped (took too long or backend reset). Please try again or use a smaller chart timeframe.";
          }
          console.error("Analysis Debug Info:", msg);
          setAnalysisError(msg);
          setTradingPhase('IDLE');
          setLoading(false);
          setIsBusy(false);
        }
      })().catch(console.error);
    }, 10);
  };

  const handleRegrade = async () => {
    if (!testModeRightSlice) return;
    setAutoGradeStatus('grading');
    try {
      const j = {
        outcome: 'NEUTRAL',
        confidence: 0,
        reason: 'Engine not yet implemented',
        rawOutcome: 'Engine not yet implemented'
      };
      setAutoGradeReason(j.reason || '');
      setAutoGradeConfidence(Number(j.confidence) || 0);
      setAutoGradeRawOutcome(j.rawOutcome || '');
      if (j.outcome === 'UP' || j.outcome === 'DOWN') {
        const isWin =
          (tradingDirection === 'UP'   && j.outcome === 'UP') ||
          (tradingDirection === 'DOWN' && j.outcome === 'DOWN');
        saveToStats(analysis, isWin ? 'WIN' : 'LOSS');
        setAutoGradeStatus('done');
      } else {
        setAutoGradeStatus('failed');
      }
    } catch(e: any) {
      console.error('handleRegrade error', e);
      setAutoGradeReason(`Network or Server Error: ${e.message}`);
      setAutoGradeStatus('failed');
    }
  };

  return (
    <View style={tw`flex-1 bg-black relative`}>
      {calibrationFrame && (
        <CalibrationOverlay 
          frame={calibrationFrame} 
          onComplete={() => setCalibrationFrame(null)} 
          onCancel={() => setCalibrationFrame(null)} 
        />
      )}
      {/* Full Screen High-Intensity Overlays */}

      {tradingPhase === 'ENTRY_CONFIRMED' && !!tradingDirection && (
        <View style={tw`absolute top-0 bottom-0 left-0 right-0 z-50`}>
          <AnimatePresence>
            {(tradingPhase === 'ENTRY_CONFIRMED' && !!tradingDirection) && (
              <motion.div
                initial={{ scale: 1.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 2, opacity: 0 }}
                className={`flex-1 justify-center items-center absolute inset-0 ${tradingDirection === 'UP' ? 'bg-green-600' : (tradingDirection === 'DOWN' ? 'bg-red-600' : 'bg-yellow-700')}`}
                style={{ display: 'flex', zIndex: 50 }}
              >
               {/* High-speed scanning tech background */}
               <motion.div 
                 animate={{ opacity: [0.1, 0.3, 0.1] }}
                 transition={{ duration: 0.5, repeat: Infinity }}
                 className="absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,0,0,0.1)_2px,rgba(0,0,0,0.1)_4px)]"
               />
               
               <div style={tw`items-center px-10 relative z-10`}>
                 <motion.div
                   animate={{ scale: [1, 1.05, 1] }}
                   transition={{ duration: 0.2, repeat: Infinity }}
                 >
                   <Text style={tw`text-white font-[Anton] text-[120px] leading-[0.85] uppercase text-center mb-6`}>
                      {tradingDirection === 'UP' ? 'PULL UP' : (tradingDirection === 'DOWN' ? 'PULL DOWN' : 'HOLD')}
                   </Text>
                 </motion.div>
                 
                 <View style={tw`h-1 w-48 bg-white bg-opacity-20 mb-6`} />
                 
                 <motion.div
                   initial={{ y: 20, opacity: 0 }}
                   animate={{ y: 0, opacity: 1 }}
                   transition={{ delay: 0.2 }}
                 >
                   <Text style={tw`text-white font-black text-5xl tracking-tighter uppercase text-center`}>
                      {tradingDirection === 'UP' ? 'EXECUTE NOW' : (tradingDirection === 'DOWN' ? 'EXECUTE NOW' : 'SIGNAL ABORTED')}
                   </Text>
                   {isStable && (
                     <View style={tw`absolute -top-6 -right-6 bg-[#1A1308] border border-[#D9B382] px-3 py-1 rounded-full`}>
                       <Text style={tw`text-[#D9B382] text-[10px] font-black tracking-widest`}>STABLE 3/3</Text>
                     </View>
                   )}
                 </motion.div>

                 <motion.div 
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    style={tw`mt-10 px-6 py-2 border-2 border-white rounded-full`}
                 >
                    <Text style={tw`text-white font-black text-xl tracking-[5px]`}>STRIKE READY</Text>
                 </motion.div>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </View>
    )}

      {mode === 'live' && tradingPhase === 'WAITING_FOR_ENTRY' && tradingDirection && (
          <AnimatedArrows direction={tradingDirection} />
      )}

      <ScrollView 
        style={tw`flex-1 bg-black`}
        contentContainerStyle={[tw`pb-24`, { flexGrow: 1 }]}
        showsVerticalScrollIndicator={true}
        alwaysBounceVertical={true}
      >
        {Platform.OS === 'web' && (
          <>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={onFileChange} />
            <input type="file" ref={techInputRef} style={{ display: 'none' }} accept=".json" onChange={onTechniqueChange} />
          </>
        )}
      
      <View style={tw`p-4`}>
        {/* Compact Terminal Header */}
        <LiveAnalysisDashboard
        symbols={symbols}
        stockName={stockName}
        setStockName={setStockName}
        graphTimeframe={graphTimeframe}
        setGraphTimeframe={setGraphTimeframe}
        showTfPicker={showTfPicker}
        setShowTfPicker={setShowTfPicker}
        timeframes={timeframes}
        investmentDuration={investmentDuration}
        setInvestmentDuration={setInvestmentDuration}
        showDurPicker={showDurPicker}
        setShowDurPicker={setShowDurPicker}
        durations={durations}
        investmentAmount={investmentAmount}
        setInvestmentAmount={setInvestmentAmount}
        profitabilityPercent={profitabilityPercent}
        setProfitabilityPercent={setProfitabilityPercent}
        mode={mode}
        setMode={setMode}
        isCameraActive={isCameraActive}
        startCamera={startCamera}
        stopCamera={stopCamera}
        videoRef={videoRef}
        pipActive={pipActive}
        scoutActive={scoutActive}
        scoutData={scoutData}
        handlePickImage={handlePickImage}
        handleDrop={handleDrop}
        preventDefault={preventDefault}
        selectedImage={selectedImage}
        techniquesList={techniquesList}
        encryptedSystemTokens={encryptedSystemTokens}
        saveToStats={saveToStats}
        prefersReducedMotion={prefersReducedMotion ?? false}
        springProps={springProps}
        buttonHoverProps={buttonHoverProps}
        buttonTapProps={buttonTapProps}
        cardHoverProps={cardHoverProps}
        techFileName={techFileName}
        handlePickTechnique={handlePickTechnique}
      />

        {/* Action Bar / Live Debate UI Overlay */}

          <div className="flex flex-col mt-4">
            {!isCalibrated() && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 mb-3 flex items-center justify-center">
                <Text style={tw`text-red-400 font-bold text-xs uppercase tracking-widest`}>
                  ⚠ NOT CALIBRATED — Results will be unreliable
                </Text>
              </div>
            )}
            <Pressable
              onPress={() => {
                if (isBusy) return;
                closePickers();
                handleAnalyze();
              }}
              disabled={(mode === 'test' && !selectedImage) || (mode === 'live' && !isCameraActive) || isBusy}
              style={({ pressed }) => [
                tw`h-14 rounded-xl items-center justify-center`,
                ((mode === 'test' && !selectedImage) || (mode === 'live' && !isCameraActive) || isBusy) ? tw`bg-[#D9B382]/20` : tw`bg-[#D9B382]`,
                { opacity: (pressed && !isBusy) ? 0.7 : 1 }
              ]}
            >
              <View style={tw`flex-row items-center`}>
                <Sparkles size={18} color="#1A1308" style={tw`mr-2`} />
                <Text style={tw`text-[#1A1308] font-black uppercase tracking-[2px] text-base`}>
                   {mode === 'live' ? 'Start Camera Analysis' : 'Initiate Analysis'}
                </Text>
              </View>
            </Pressable>
            {mode === 'live' && isCameraActive && !loading && null}
            {mode === 'live' && !pipSupported && (
              <View style={tw`mt-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20`}>
                <Text style={tw`text-yellow-400 text-[9px] font-black uppercase tracking-wider text-center`}>PiP not available — use Chrome or Edge browser</Text>
              </View>
            )}
          </div>

        {analysisError && (
          <View style={tw`bg-red-500/10 border border-red-500 border-opacity-10 p-4 rounded-xl mt-4 flex-row items-center`}>
            <AlertTriangle size={20} color="#EF4444" style={tw`mr-3`} />
            <View style={tw`flex-1 flex-row justify-between items-center pr-2`}>
              <View style={tw`flex-1 pr-2`}>
                <Text style={tw`text-red-400 font-bold mb-1`}>Analysis Notice / Abort</Text>
                <Text style={tw`text-red-200 text-xs`}>{analysisError}</Text>
              </View>
              {analysisError.includes('Trade Aborted') && analysis && (
                 <Pressable
                   onPress={() => setMode('bulk')}
                   style={({ pressed }) => [tw`bg-red-600 px-3 py-2 rounded-lg`, { opacity: pressed ? 0.7 : 1 }]}
                 >
                   <Text style={tw`text-white font-bold text-[9px] uppercase`}>Run Loss Autopsy</Text>
                 </Pressable>
              )}
            </View>
          </View>
        )}

        <LiveAnalysisResult
          analysis={analysis}
          mode={mode}
          prefersReducedMotion={prefersReducedMotion ?? false}
          profitabilityPercent={profitabilityPercent}
          investmentAmount={investmentAmount}
          confirmedOutcome={confirmedOutcome}
          saveToStats={saveToStats}
          setMode={setMode}
          tradingDirection={tradingDirection}
          actualDirection={actualDirection}
          testModeLeftSlice={testModeLeftSlice}
          testModeRightSlice={testModeRightSlice}
          autoGradeStatus={autoGradeStatus}
          autoGradeReason={autoGradeReason}
          autoGradeRawOutcome={autoGradeRawOutcome}
          autoGradeConfidence={autoGradeConfidence}
          handleRegrade={handleRegrade}
          setConfirmedOutcome={setConfirmedOutcome}
          setAutoGradeStatus={setAutoGradeStatus}
          handleReset={handleReset}
          buttonHoverProps={buttonHoverProps}
          buttonTapProps={buttonTapProps}
          springProps={springProps}
        />
      </View>
    </ScrollView>
    </View>
  );
}

const AnimatedArrows = ({ direction }: { direction: 'UP' | 'DOWN' | 'NO_TRADE' }) => {
  const isUp = direction === 'UP';
  const isNeutral = direction === 'NO_TRADE';

  return (
    <div className="fixed inset-0 pointer-events-none z-[100] flex flex-col justify-center items-center">
      {isNeutral ? (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.4, 0.6, 0.4] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="flex flex-col items-center"
        >
          <div className="text-9xl mb-4">✋</div>
          <Text style={tw`text-yellow-500 font-black text-4xl uppercase tracking-[10px]`}>SIGNAL ADVISORY</Text>
        </motion.div>
      ) : (
        <div className="absolute inset-0 flex flex-row flex-wrap justify-around content-around opacity-20">
          {[...Array(24)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ y: isUp ? 1000 : -1000, opacity: 0 }}
              animate={{ 
                y: isUp ? -1000 : 1000, 
                opacity: [0, 0.8, 0] 
              }}
              transition={{ 
                duration: 2, 
                repeat: Infinity, 
                delay: pseudoRandom() * 2,
                ease: "linear"
              }}
              style={{ fontSize: 120 }}
              className={`font-black ${isUp ? 'text-green-500' : 'text-red-500'}`}
            >
              {isUp ? '▲' : '▼'}
            </motion.div>
          ))}
        </div>
      )}
      
      {/* Dynamic Scan Line for Added Tech Feel */}
      {!isNeutral && (
        <motion.div
          animate={{ x: ['-100%', '100%'] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          className={`absolute inset-y-0 w-1 ${isUp ? 'bg-green-500 shadow-[0_0_20px_#22C55E]' : 'bg-red-500 shadow-[0_0_20px_#EF4444]'} opacity-30`}
        />
      )}
    </div>
  );
};
