let _seed = 0xC0FFEE;
function pseudoRandom() {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
};
import { runSingleAnalysis, onStableSignal } from '../utils/singleAnalysis';
import { BulkTestPanel } from './BulkTestPanel';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
export function useWakeLock() {
  const wakeLockRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isRequestedRef = useRef(false);

  useEffect(() => {
    // Create a silent audio element to play in the background to prevent the browser from throttling/killing the page.
    const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    audio.loop = true;
    audioRef.current = audio;
  }, []);

  const requestLock = useCallback(async () => {
    isRequestedRef.current = true;
    audioRef.current?.play().catch((err: any) => console.log('Audio playback failed:', err.message));
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      try {
        if (wakeLockRef.current) return;
        const lock = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current = lock;
        console.log('Screen Wake Lock active');
        
        lock.addEventListener('release', () => {
          console.log('Screen Wake Lock was released');
          wakeLockRef.current = null;
        });
      } catch (err: any) {
        console.log(`Wake Lock request failed: ${err.message}`);
      }
    }
  }, []);

  const releaseLock = useCallback(async () => {
    isRequestedRef.current = false;
    audioRef.current?.pause();
    if (wakeLockRef.current !== null) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Screen Wake Lock intentionally released');
      } catch (err: any) {
        console.log(`Wake Lock release failed: ${err.message}`);
      }
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isRequestedRef.current) {
        requestLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [requestLock]);

  return { requestLock, releaseLock };
}

import {   View, 
  Text, 
  Pressable, 
  ScrollView, 
  ActivityIndicator, 
  TextInput,
  Image,
  Modal
} from 'react-native';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { 
  CheckCircle, 
  Camera, 
  Upload, 
  Sparkles, 
  Brain,
  AlertTriangle,
  FileText,
  Terminal,
  Activity,
  Layers,
  XCircle,
  ChevronDown,
  Check,
  Zap,
} from 'lucide-react';
import tw from 'twrnc';
import { LossAutopsyModal } from './LossAutopsyModal';
import { isCalibrated } from '../vision/colorCalibration';
import { CalibrationOverlay } from './CalibrationOverlay';



// Utility to downscale images on the web before sending to server
export function LiveAnalysis() {
  const [stockName, setStockName] = useState('Bitcoin');
  const [graphTimeframe, setGraphTimeframe] = useState('30 minutes');
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
  const [encryptedSystemTokens, setEncryptedSystemTokens] = useState<string | undefined>('offline-mode-active');
  
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
     judge1: { text: "Waiting to initiate...", status: 'idle' },
     judge2: { text: "Waiting to initiate...", status: 'idle' },
     judge3: { text: "Waiting to initiate...", status: 'idle' },
     judge4: { text: "Locating boundaries...", status: 'idle' },
     system: { text: "Awaiting context...", status: 'idle' }
  });
  
  // UX Error Handling
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  
  // Dropdown States
  const [showTfPicker, setShowTfPicker] = useState(false);
  const [showDurPicker, setShowDurPicker] = useState(false);
  
  // Investment Details
  const [investmentAmount, setInvestmentAmount] = useState('100');
  const [investmentDuration, setInvestmentDuration] = useState('5m');
  const [profitabilityPercent, setProfitabilityPercent] = useState('85');

  // Technique Files
  const [techniquesList, setTechniquesList] = useState<string[]>([]);
  const [techFileName, setTechFileName] = useState<string | null>(null);

  const [confirmedOutcome, setConfirmedOutcome] = useState<'WIN' | 'LOSS' | null>(null);
  const [showAutopsyModal, setShowAutopsyModal] = useState(false);
  const [testModeRightSlice, setTestModeRightSlice] = useState<string | null>(null);
  const [autoGradeStatus, setAutoGradeStatus] = useState<'idle' | 'grading' | 'done' | 'failed'>('idle');
  const [testModeLeftSlice, setTestModeLeftSlice] = useState<string | null>(null);
  const [autoGradeReason, setAutoGradeReason] = useState<string>('');
  const [autoGradeConfidence, setAutoGradeConfidence] = useState<number>(0);
  const [autoGradeRawOutcome, setAutoGradeRawOutcome] = useState<string>('');
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

  const timeframes = ['30 minutes', '15 minutes', '5 minutes', '3 minutes'];
  const durations = ['3m', '5m'];



  const drawPipFrame = (signal: 'ANALYZING' | 'CALL' | 'PUT' | 'NO_TRADE' | 'IDLE', confidence: number = 0, subText: string = '') => { const canvas = pipCanvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return; const W = 480, H = 270; ctx.clearRect(0, 0, W, H); const bgColors: Record<string, string> = { ANALYZING: '#0d0d14', CALL: '#021a0b', PUT: '#1a0202', NO_TRADE: '#141008', IDLE: '#0d0d14' }; ctx.fillStyle = bgColors[signal] ?? '#0d0d14'; ctx.fillRect(0, 0, W, H); const accentColors: Record<string, string> = { ANALYZING: '#D9B382', CALL: '#22C55E', PUT: '#EF4444', NO_TRADE: '#F59E0B', IDLE: '#4B5570' }; const accent = accentColors[signal] ?? '#4B5570'; ctx.fillStyle = accent; ctx.fillRect(0, 0, W, 4); ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1; for (let x = 0; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = 0; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left'; ctx.fillText('AI TRADING · PRO TERMINAL', 16, 26); if (signal === 'ANALYZING') { ctx.fillStyle = '#D9B382'; ctx.beginPath(); ctx.arc(W - 20, 20, 5, 0, Math.PI * 2); ctx.fill(); } const signalLabels: Record<string, string> = { ANALYZING: 'ANALYZING...', CALL: 'CALL  ▲', PUT: 'PUT   ▼', NO_TRADE: 'NO TRADE', IDLE: 'STANDBY' }; const label = signalLabels[signal] ?? signal; ctx.font = 'bold 64px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = signal === 'ANALYZING' ? 0 : 20; ctx.fillText(label, W / 2, 165); ctx.shadowBlur = 0; if ((signal === 'CALL' || signal === 'PUT') && confidence > 0) { const barW = 280, barH = 6; const barX = (W - barW) / 2, barY = 190; ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); (ctx as any).roundRect(barX, barY, barW, barH, 3); ctx.fill(); ctx.fillStyle = accent; ctx.beginPath(); (ctx as any).roundRect(barX, barY, barW * (confidence / 100), barH, 3); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 13px monospace'; ctx.fillText(`${confidence}% CONFIDENCE`, W / 2, 218); } if (subText) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '12px monospace'; ctx.fillText(subText, W / 2, 245); } ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.font = '10px monospace'; ctx.fillText('Switch back to broker when ready', W / 2, H - 10); };

  const closePip = (exitPip = true) => { if (pipAnimFrameRef.current) { cancelAnimationFrame(pipAnimFrameRef.current); pipAnimFrameRef.current = null; } if (exitPip && document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); } pipStreamRef.current?.getTracks().forEach(t => t.stop()); pipStreamRef.current = null; if (pipVideoRef.current) { pipVideoRef.current.pause(); if (document.body.contains(pipVideoRef.current)) { document.body.removeChild(pipVideoRef.current); } pipVideoRef.current = null; } pipCanvasRef.current = null; setPipActive(false); setPipSignal('IDLE'); setPipConfidence(0); };

  const startPip = async (): Promise<boolean> => { if (!pipSupported) { alert('Picture-in-Picture is not supported in this browser. Use Chrome or Edge.'); return false; } try { const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270; pipCanvasRef.current = canvas; drawPipFrame('ANALYZING', 0, 'Switching to your broker now...'); const stream = canvas.captureStream(2); pipStreamRef.current = stream; const video = document.createElement('video'); video.srcObject = stream; video.muted = true; pipVideoRef.current = video; document.body.appendChild(video); await video.play(); await (video as any).requestPictureInPicture(); video.addEventListener('leavepictureinpicture', () => { setPipActive(false); setPipSignal('IDLE'); closePip(false); }); setPipActive(true); setPipSignal('ANALYZING'); const redraw = () => { drawPipFrame(pipSignal === 'IDLE' ? 'ANALYZING' : pipSignal, pipConfidence); pipAnimFrameRef.current = requestAnimationFrame(redraw); }; pipAnimFrameRef.current = requestAnimationFrame(redraw); return true; } catch (err: any) { console.error('[PiP] Failed to start:', err); if (err.name !== 'NotAllowedError') { alert(`PiP failed: ${err.message}`); } return false; } };

  const updatePip = (signal: 'CALL' | 'PUT' | 'NO_TRADE', confidence: number) => { if (!pipActive || !pipCanvasRef.current) return; setPipSignal(signal); setPipConfidence(confidence); const subText = signal === 'NO_TRADE' ? 'Conditions unclear — skip this trade' : `${signal === 'CALL' ? 'Buy CALL' : 'Buy PUT'} — execute now`; drawPipFrame(signal, confidence, subText); if ('vibrate' in navigator) { navigator.vibrate(signal === 'NO_TRADE' ? [200] : [150, 80, 150]); } };

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
    setShowAutopsyModal(false);
    setMode('live');
    setStockName('Bitcoin');
    setGraphTimeframe('30 minutes');
    setInvestmentDuration('5m');
    setScoutActive(false);
    setScoutData(null);
    setLoading(false);
    setIsBusy(false);
    
    setJudgeLogs({
      judge1: { text: "Standby...", status: 'idle' },
      judge2: { text: "Standby...", status: 'idle' },
      judge3: { text: "Standby...", status: 'idle' },
      judge4: { text: "Standby...", status: 'idle' },
      system: { text: "Standby...", status: 'idle' }
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
  }, [scoutActive, analysis, isCameraActive, tradingPhase, encryptedSystemTokens]);

  const closePickers = () => {
    setShowTfPicker(false);
    setShowDurPicker(false);
  };

  const handlePickImage = () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click();
    }
  };

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
          const list = Array.isArray(json) ? json : (json.techniques || []);
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
          }, 360000);

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

          if (pipActive) {
            const pipDir = result.direction === 'UP' ? 'CALL' : result.direction === 'DOWN' ? 'PUT' : 'NO_TRADE';
            updatePip(pipDir, result.analysis.judge?.finalConfidence ?? 0);
          }

          if (result.direction !== 'NO_TRADE') {
            setTradingDirection(result.direction);
            setTradingPhase('WAITING_FOR_ENTRY');
          } else {
            setTradingDirection(null);
            setTradingPhase('IDLE');
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
            msg = "Analysis timed out (360s limit). The models are deep in thought. Please try again.";
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
      <LossAutopsyModal
        isOpen={showAutopsyModal}
        onClose={() => setShowAutopsyModal(false)}
        analysisData={analysis}
        tradeSignal={analysis?.judge?.winner === 'BULL' ? 'CALL' : (analysis?.judge?.winner === 'BEAR' ? 'PUT' : 'WAIT')}
        prefilledResultImage={testModeRightSlice || undefined}
      />
      {tradingPhase === 'ENTRY_CONFIRMED' && !!tradingDirection && (
        <View style={tw`absolute top-0 bottom-0 left-0 right-0 z-50`}>
          <AnimatePresence>
            {(tradingPhase === 'ENTRY_CONFIRMED' && !!tradingDirection) && (
              <motion.div
                initial={{ scale: 1.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 2, opacity: 0 }}
                className={`flex-1 justify-center items-center absolute inset-0 ${tradingDirection === 'UP' ? 'bg-green-600' : (tradingDirection === 'DOWN' ? 'bg-red-600' : 'bg-yellow-700')}`}
                style={{ display: 'flex', zIndex: 50, elevation: 50 }}
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

      {tradingPhase === 'WAITING_FOR_ENTRY' && tradingDirection && (
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
        <View style={tw`flex-row justify-between items-end mb-4 px-1 mt-12`}>
          <View>
            <Text style={tw`text-[#D9B382] text-[8px] font-black tracking-[3px] uppercase`}>Pro Terminal v2</Text>
            <Text style={tw`text-white text-2xl font-black`}>DASHBOARD</Text>
          </View>
          <View style={tw`flex-row gap-2`}>
            <Pressable 
              onPress={handlePickTechnique}
              style={({ pressed }) => [tw`w-9 h-9 rounded-lg items-center justify-center`, techFileName ? tw`bg-[#D9B382]` : tw`bg-white bg-opacity-20 border border-white border-opacity-10`, { opacity: pressed ? 0.7 : 1 }]}
            >
              <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'contents' }}>
                <FileText size={16} color={techFileName ? "#1A1308" : "#8B95B0"} />
              </motion.div>
            </Pressable>
          </View>
        </View>

        {/* Compact Dashboard Grid */}
        <motion.div whileHover={cardHoverProps} style={tw`bg-[#121419] rounded-2xl border border-white border-opacity-10 p-4 shadow-2xl mb-4 z-100`}>
           <View style={tw`mb-4`}>
              <View style={tw`flex-row justify-between items-center mb-2`}>
                <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-widest`}>Asset Selection</Text>
              </View>
              <View style={tw`flex-row flex-wrap gap-1.5`}>
                {symbols.map((s) => (
                  <Pressable
                    key={s.name}
                    onPress={() => setStockName(s.name)}
                    style={({ pressed }) => [
                      tw`flex-1 min-w-[28%] py-2.5 rounded-lg border items-center flex-row justify-center`,
                      stockName === s.name ? tw`bg-[#D9B382] border-[#D9B382]` : tw`bg-black bg-opacity-20 border-white border-opacity-10`,
                      { opacity: pressed ? 0.7 : 1 }
                    ]}
                  >
                    <motion.div whileHover={buttonHoverProps} whileTap={buttonTapProps} transition={springProps} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={[tw`mr-1.5 text-xs`, stockName === s.name ? tw`text-black` : tw`text-[#D9B382]`]}>{s.icon}</Text>
                      <Text style={[tw`text-[10px] font-black`, stockName === s.name ? tw`text-black` : tw`text-white`]}>{s.name}</Text>
                    </motion.div>
                  </Pressable>
                ))}
              </View>
           </View>

           <View style={tw`flex-row flex-wrap gap-3 mb-4 z-50`}>
              <View style={tw`flex-1 min-w-[45%]`}>
                 <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-wider mb-1.5`}>Graph TF</Text>
                 <View style={tw`relative`}>
                      <Pressable 
                      onPress={() => { setShowTfPicker(!showTfPicker); setShowDurPicker(false); }}
                      style={({ pressed }) => [tw`bg-black bg-opacity-20 border border-white border-opacity-10 h-10 rounded-lg px-3 flex-row items-center justify-between`, { opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Text style={{ color: '#D9B382', fontWeight: '900', fontSize: 11 }}>{graphTimeframe}</Text>
                      <ChevronDown size={12} color="#D9B382" />
                    </Pressable>
                    {showTfPicker && (
                      <View style={[tw`absolute top-12 left-0 right-0 bg-[#2A2E39] border-2 border-[#D9B382] rounded-xl p-2 shadow-2xl`, { zIndex: 99999, elevation: 10 }]}>
                        {timeframes.map((tf) => (
                          <Pressable
                            key={tf}
                            onPress={() => { setGraphTimeframe(tf); setShowTfPicker(false); }}
                            style={({ pressed }) => [tw`py-4 px-3 rounded-lg border-b border-white border-opacity-10`, graphTimeframe === tf && tw`bg-[#D9B382]/20`, { opacity: pressed ? 0.7 : 1 }]}
                          >
                            <Text style={[tw`text-sm font-black`, graphTimeframe === tf ? tw`text-[#D9B382]` : tw`text-white`]}>{tf}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                 </View>
              </View>
              <View style={tw`flex-1 min-w-[45%]`}>
                 <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-wider mb-1.5`}>Duration</Text>
                 <View style={tw`relative`}>
                    <Pressable 
                      onPress={() => { setShowDurPicker(!showDurPicker); setShowTfPicker(false); }}
                      style={({ pressed }) => [tw`bg-black bg-opacity-20 border border-white border-opacity-10 h-10 rounded-lg px-3 flex-row items-center justify-between`, { opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Text style={{ color: '#D9B382', fontWeight: '900', fontSize: 11 }}>{investmentDuration}</Text>
                      <ChevronDown size={12} color="#D9B382" />
                    </Pressable>
                    {showDurPicker && (
                      <View style={[tw`absolute top-12 left-0 right-0 bg-[#2A2E39] border-2 border-[#D9B382] rounded-xl p-2 shadow-2xl`, { zIndex: 99999, elevation: 10 }]}>
                        {durations.map((d) => (
                          <Pressable
                            key={d}
                            onPress={() => { setInvestmentDuration(d); setShowDurPicker(false); }}
                            style={({ pressed }) => [tw`py-4 px-3 rounded-lg border-b border-white border-opacity-10`, investmentDuration === d && tw`bg-[#D9B382]/20`, { opacity: pressed ? 0.7 : 1 }]}
                          >
                            <Text style={[tw`text-sm font-black`, investmentDuration === d ? tw`text-[#D9B382]` : tw`text-white`]}>{d}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                 </View>
              </View>
           </View>

           <View style={tw`flex-row flex-wrap gap-3`}>
              <View style={tw`flex-1 min-w-[45%]`}>
                 <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-wider mb-1.5`}>Capital</Text>
                 <TextInput
                   style={tw`bg-black bg-opacity-20 border border-white border-opacity-10 h-10 rounded-lg px-3 text-white font-black text-xs w-full`}
                   value={investmentAmount}
                   onChangeText={setInvestmentAmount}
                   keyboardType="numeric"
                   placeholderTextColor="#4B5570"
                 />
              </View>
              <View style={tw`flex-1 min-w-[45%]`}>
                 <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-wider mb-1.5`}>Payout (%)</Text>
                 <TextInput
                   style={tw`bg-black bg-opacity-20 border border-white border-opacity-10 h-10 rounded-lg px-3 text-[#22C55E] font-black text-xs w-full`}
                   value={profitabilityPercent}
                   onChangeText={setProfitabilityPercent}
                   keyboardType="numeric"
                 />
              </View>
                          </View>
         </motion.div>

         {/* Dense Evidence Row */}
         <View style={tw`bg-[#121419] rounded-2xl border border-white border-opacity-10 p-4 mb-4`}>
             <View style={tw`flex-row flex-wrap justify-between items-center gap-2 mb-3`}>
                <Text style={tw`text-[8px] font-black text-[#4B5570] uppercase tracking-widest`}>Chart Feed</Text>
                <View style={tw`flex-row flex-wrap bg-black bg-opacity-20 rounded-lg p-0.5 border border-white border-opacity-10`}>
                   {(['live', 'test', 'bulk'] as const).map((m) => (
                     <Pressable
                       key={m}
                       onPress={() => setMode(m)}
                       style={({ pressed }) => [tw`px-3 py-1 rounded-md flex-row items-center`, mode === m ? tw`bg-[#D9B382]` : tw`bg-transparent`, { opacity: pressed ? 0.7 : 1 }]}
                    >
                      {m === 'live' ? <Camera size={12} color={mode === m ? '#1A1308' : '#4B5570'} /> : m === 'bulk' ? <Layers size={12} color={mode === m ? '#1A1308' : '#4B5570'} /> : <Activity size={12} color={mode === m ? '#1A1308' : '#4B5570'} />}
                      <Text style={[tw`ml-1.5 text-[8px] font-black uppercase`, mode === m ? tw`text-[#1A1308]` : tw`text-[#4B5570]`]}>{m}</Text>
                    </Pressable>
                  ))}
               </View>
            </View>

            {mode === 'live' && (
               <View style={tw`w-full bg-black bg-opacity-20 rounded-xl overflow-hidden border border-white border-opacity-10 items-center justify-center`}>
                 {Platform.OS === 'web' && (
                   <video 
                     ref={videoRef} 
                     autoPlay 
                     playsInline 
                     muted 
                     style={{ width: '100%', height: 160, objectFit: 'cover' }} 
                   />
                 )}
                 {!isCameraActive && (
                   <View style={tw`absolute inset-0 bg-black bg-opacity-20 items-center justify-center`}>
                     <Pressable
                        onPress={startCamera}
                        style={({ pressed }) => [tw`bg-[#D9B382] px-6 py-3 rounded-lg flex-row items-center`, { opacity: pressed ? 0.7 : 1 }]}
                      >
                        <Camera size={18} color="#1A1308" />
                        <Text style={tw`text-[#1A1308] font-black ml-2`}>Start Camera</Text>
                     </Pressable>
                   </View>
                 )}
                 {isCameraActive && (
                   <Pressable 
                      onPress={stopCamera} 
                      style={({ pressed }) => [tw`absolute top-2 right-2 bg-red-500/80 p-1.5 rounded-md`, { opacity: pressed ? 0.7 : 1 }]}
                    >
                     <Text style={tw`text-white font-bold text-[8px]`}>STOP</Text>
                   </Pressable>
                 )}
                 {pipActive && (
                   <View style={tw`absolute top-2 left-2 bg-[#22C55E]/20 border border-[#22C55E]/40 px-2 py-1 rounded-md flex-row items-center`}>
                     <View style={tw`w-1.5 h-1.5 rounded-full bg-[#22C55E] mr-1.5`} />
                     <Text style={tw`text-[#22C55E] font-black text-[8px] uppercase tracking-widest`}>PiP LIVE</Text>
                   </View>
                 )}
                 {scoutActive && (
                   <View style={tw`absolute bottom-2 left-2 right-2 bg-black bg-opacity-20 p-2 rounded-lg border ${scoutData?.action === 'ABORT' ? 'border-red-500' : scoutData?.action === 'WAIT' ? 'border-orange-500' : 'border-[#00FFFF]/30'}`}>
                      <View style={tw`flex-row justify-between items-center mb-1`}>
                         <View style={tw`flex-row items-center`}>
                           <View style={tw`w-2 h-2 rounded-full ${scoutData?.action === 'ABORT' ? 'bg-red-500' : scoutData?.action === 'WAIT' ? 'bg-orange-500' : 'bg-[#00FFFF]'} mr-2`} />
                           <Text style={tw`text-[#00FFFF] font-black text-[9px] uppercase tracking-widest`}>Live Tick Scout</Text>
                         </View>
                         <Text style={tw`font-black text-[10px] ${scoutData?.action === 'ABORT' ? 'text-red-400' : scoutData?.action === 'WAIT' ? 'text-orange-400' : scoutData?.action === 'BUILD' ? 'text-green-400' : 'text-white'}`}>
                            {scoutData ? scoutData.action : 'ANALYZING...'}
                         </Text>
                      </View>
                      {scoutData && (
                        <Text style={tw`text-white text-opacity-60 text-[9px] leading-3 font-medium`}>{scoutData.reason}</Text>
                      )}
                   </View>
                 )}
               </View>
            )}
            
            {mode === 'test' && (
              <Pressable
                onPress={handlePickImage}
                style={({ pressed }) => [
                  tw`h-32 w-full rounded-xl bg-black bg-opacity-20 overflow-hidden border items-center justify-center`,
                  selectedImage ? tw`border-[#D9B382] border-opacity-20 ` : tw`border-dashed border-white border-opacity-10`,
                  { opacity: pressed ? 0.7 : 1 }
                ]}
              >
                {selectedImage ? (
                  <Image source={{ uri: selectedImage }} style={tw`w-full h-full`} resizeMode="contain" />
                ) : (
                  <View style={tw`items-center`}>
                    <Upload size={18} color="#D9B382" style={tw`mb-2`} />
                    <Text style={tw`text-[#4B5570] text-[9px] font-black uppercase tracking-wider`}>Sync Chart Image</Text>
                  </View>
                )}
              </Pressable>
            )}

            <View style={mode === 'bulk' ? tw`flex` : tw`hidden`}>
              <BulkTestPanel 
                 techniquesList={techniquesList} 
                 encryptedSystemTokens={encryptedSystemTokens} 
                 saveToStats={saveToStats} 
                 stockName={stockName}
                 graphTimeframe={graphTimeframe}
                 investmentDuration={investmentDuration}
                 investmentAmount={investmentAmount}
                 profitabilityPercent={profitabilityPercent}
              />
            </View>
        </View>


        {/* Action Bar / Live Debate UI Overlay */}
        {loading ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#14161C] rounded-2xl border border-[#D9B382] border-opacity-20  p-4 mt-4 shadow-2xl relative overflow-hidden"
          >
            {/* Visual Scanning Background */}
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div className="absolute inset-0 bg-[radial-gradient(#D9B382_1px,transparent_1px)] [background-size:16px_16px]" />
              <motion.div 
                animate={{ y: [0, 200, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="absolute top-0 left-0 right-0 h-px bg-[#D9B382] shadow-[0_0_15px_#D9B382]"
              />
            </div>

            <div style={tw`flex-row items-center justify-between mb-4 border-b border-white border-opacity-10 pb-3 relative z-10`}>
              <div style={tw`flex-row items-center gap-2`}>
                 <ActivityIndicator color="#D9B382" size="small" />
                 <motion.div animate={prefersReducedMotion ? {} : { scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} style={{ display: 'contents' }}>
                 <Text style={[tw`font-black uppercase tracking-widest`, { fontSize: 10, color: '#D9B382' }]}>
                   {analysisStep || 'Live Neural Debate Active'}
                 </Text>
                 </motion.div>
              </div>
              <Text style={[tw`tracking-widest uppercase`, { fontSize: 8, color: '#8B95B0' }]}>Simultaneous execution</Text>
            </div>

            <div style={tw`gap-3 relative z-10`}>
              {[
                { key: 'system', label: 'System Context', color: '#00FFFF', bg: 'rgba(0, 255, 255, 0.05)' },
                { key: 'judge1', label: 'Judge 1: Trend & Momentum', color: '#FF00FF', bg: 'rgba(255, 0, 255, 0.05)' },
                { key: 'judge2', label: 'Judge 2: Oscillator Consensus', color: '#FF1493', bg: 'rgba(255, 20, 147, 0.05)' },
                { key: 'judge3', label: 'Skeptic: Veto Multiplier', color: '#39FF14', bg: 'rgba(57, 255, 20, 0.05)' },
                { key: 'judge4', label: 'Judge 3: Boundary/Reversal', color: '#EAB308', bg: 'rgba(234, 179, 8, 0.05)' }
              ].map((item, idx) => (
                <motion.div
                  key={item.key}
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: idx * 0.1 }}
                  className="bg-black bg-opacity-20 p-3 rounded-lg flex-row items-center justify-between border-l-4"
                  style={{ borderColor: item.color, backgroundColor: item.bg }}
                >
                  <div style={tw`flex-1`}>
                    <div className="flex flex-row items-center gap-2 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <Text style={[tw`font-black uppercase tracking-widest`, { fontSize: 9, color: item.color }]}>{item.label}</Text>
                    </div>
                    <motion.p
                      key={judgeLogs[item.key as keyof typeof judgeLogs].text}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-white font-bold text-xs"
                    >
                      {judgeLogs[item.key as keyof typeof judgeLogs].text}
                    </motion.p>
                  </div>
                  {judgeLogs[item.key as keyof typeof judgeLogs].status === 'done' ? (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-2">
                      <Check size={16} color={item.color} />
                    </motion.div>
                  ) : (
                    <div className="flex flex-row items-end gap-0.5 h-3">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          animate={{ height: [2, 8, 2] }}
                          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                          className="w-0.5 bg-white/20"
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        ) : (
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
            {mode === 'live' && isCameraActive && !loading && (
              <Pressable onPress={async () => { if (pipActive) { closePip(true); return; } const launched = await startPip(); if (launched) { handleAnalyze(); } }} style={({ pressed }) => [tw`h-12 rounded-xl items-center justify-center mt-2 flex-row`, pipActive ? tw`bg-[#22C55E]/10 border border-[#22C55E]/40` : tw`bg-[#D9B382]/10 border border-[#D9B382]/30`, { opacity: pressed ? 0.7 : 1 }]}><>{pipActive && (<View style={tw`w-2 h-2 rounded-full bg-[#22C55E] mr-2`} />)}<Text style={[tw`font-black uppercase tracking-[2px] text-xs`, pipActive ? tw`text-[#22C55E]` : tw`text-[#D9B382]`]}>{pipActive ? '📺 PiP Active — Tap to Close' : '📺 Float Signal & Switch App'}</Text></></Pressable>
            )}
            {mode === 'live' && !pipSupported && (
              <View style={tw`mt-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20`}>
                <Text style={tw`text-yellow-400 text-[9px] font-black uppercase tracking-wider text-center`}>PiP not available — use Chrome or Edge browser</Text>
              </View>
            )}
          </div>
        )}

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
                   onPress={() => setShowAutopsyModal(true)}
                   style={({ pressed }) => [tw`bg-red-600 px-3 py-2 rounded-lg`, { opacity: pressed ? 0.7 : 1 }]}
                 >
                   <Text style={tw`text-white font-bold text-[9px] uppercase`}>Run Loss Autopsy</Text>
                 </Pressable>
              )}
            </View>
          </View>
        )}

        {analysis && (
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
              <View style={tw`mb-8`}>
                 <Text style={tw`text-[10px] font-black text-[#8B95B0] uppercase tracking-widest mb-2`}>Technique Recognition ({analysis.techUsedCount} Found)</Text>
                 <View style={tw`bg-black bg-opacity-20 p-4 rounded-xl border border-[#D9B382] border-opacity-20 `}>
                    <Text style={tw`text-white text-xs leading-5 font-bold italic text-[#D9B382]`}>{analysis.judge.tradeDetails.techniquesUsed}</Text>
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
                            setShowAutopsyModal(true);
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
                          setShowAutopsyModal(true);
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
        )}
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
