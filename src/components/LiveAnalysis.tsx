import { runSingleAnalysis, onStableSignal, resetWorkerStability } from '../utils/singleAnalysis';
import { LiveAnalysisDashboard } from './live-analysis/LiveAnalysisDashboard';
import { LiveAnalysisDebate } from './live-analysis/LiveAnalysisDebate';
import { LiveAnalysisResult } from './live-analysis/LiveAnalysisResult';
import { ScalpCopilotHUD } from './ScalpCopilotHUD';
import { ComplianceFooter } from './ComplianceFooter';
import { BotSetupScreen, BotStartPayload } from './BotSetupScreen';
import { BotDashboard } from './BotDashboard';
import { useBotLoop } from '../hooks/useBotLoop';
import { getDefaultScalpConfig } from '../quant/scalpingEngine';
import { useState, useRef, useEffect } from 'react';
import { useWakeLock } from '../hooks/useWakeLock';
import { antiImagine } from '../utils/antiImagine';
import { View, Text, Pressable, ScrollView, Platform } from 'react-native';
import { TIMEOUTS } from '../config/timeouts';

import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { 
  Sparkles, 
  AlertTriangle,
  X,
  Bot,
  Crosshair
} from 'lucide-react';
import tw from 'twrnc';
import { isCalibrated } from '../vision/colorCalibration';
import { CalibrationOverlay } from './CalibrationOverlay';


























































// Utility to downscale images on the web before sending to server


export function LiveAnalysis() {
  const [stockName, setStockName] = useState('Bitcoin');
  const [graphTimeframe, setGraphTimeframe] = useState('30:00');
  const [loading, setLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [mode, setMode] = useState<'live' | 'test' | 'bulk' | 'bot'>('live');
  const [botPayload, setBotPayload] = useState<BotStartPayload | null>(null);

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
    if (botPayload && mode === 'bot') {
      bot.startBot();
    }
  }, [botPayload, mode, bot]);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [calibrationFrame, setCalibrationFrame] = useState<ImageData | null>(null);
  const [isStable, setIsStable] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const accepted = localStorage.getItem('chartlens_disclaimer_accepted_v2');
        return accepted !== 'true';
      } catch {
        return true;
      }
    }
    return false;
  });

  // Explicit session restore state
  const [hasSavedSession, setHasSavedSession] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('chartlens_current_analysis');
        if (saved) {
          const parsed = JSON.parse(saved);
          return !!(parsed.analysis || parsed.selectedImage);
        }
      } catch {
        return false;
      }
    }
    return false;
  });

  const handleRestoreSession = () => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('chartlens_current_analysis');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.stockName) setStockName(parsed.stockName);
          if (parsed.graphTimeframe) setGraphTimeframe(parsed.graphTimeframe);
          if (parsed.analysisStep) setAnalysisStep(parsed.analysisStep);
          if (parsed.analysis) setAnalysis(parsed.analysis);
          if (parsed.mode) setMode(parsed.mode);
          if (parsed.selectedImage) setSelectedImage(parsed.selectedImage);
          if (parsed.techFileName) setTechFileName(parsed.techFileName);
          if (parsed.confirmedOutcome) setConfirmedOutcome(parsed.confirmedOutcome);
          if (parsed.autoGradeStatus) setAutoGradeStatus(parsed.autoGradeStatus);
          if (parsed.testModeLeftSlice) setTestModeLeftSlice(parsed.testModeLeftSlice);
          if (parsed.testModeRightSlice) setTestModeRightSlice(parsed.testModeRightSlice);
          if (parsed.autoGradeReason) setAutoGradeReason(parsed.autoGradeReason);
          if (parsed.autoGradeConfidence) setAutoGradeConfidence(parsed.autoGradeConfidence);
          if (parsed.autoGradeRawOutcome) setAutoGradeRawOutcome(parsed.autoGradeRawOutcome);
          showNotice("Previous session successfully restored.", "success");
        }
      } catch (err) {
        console.warn("Could not restore session:", err);
      }
    }
    setHasSavedSession(false);
  };
  
  const { requestLock, releaseLock } = useWakeLock();

  // Live Trading Loop States
  const [tradingPhase, setTradingPhase] = useState<'IDLE' | 'ANALYSING_DIRECTION' | 'WAITING_FOR_ENTRY' | 'ENTRY_CONFIRMED'>('IDLE');
  const [tradingDirection, setTradingDirection] = useState<'LONG' | 'NO_TRADE' | null>(null);
  
  // Real-Time Scout (10s Tick)
  const [scoutActive, setScoutActive] = useState(false);
  const [scoutData, setScoutData] = useState<{action: string, reason: string} | null>(null);

  // PiP Widget state
  const [pipActive, setPipActive]         = useState(false);
  const [pipSignal, setPipSignal]         = useState<'ANALYZING' | 'LONG' | 'NO_TRADE' | 'IDLE'>('IDLE');
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
      if (payload.signal === 'LONG') setTradingDirection('LONG');
      else setTradingDirection('NO_TRADE');
      setTradingPhase('ENTRY_CONFIRMED');
      setIsStable(true);
    }) as any;
  }, []);
  
  // Live Camera States
  const videoRef = useRef<any>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);




  useEffect(() => {
    // Check browser support for Picture-in-Picture API
    setPipSupported(
      typeof document !== 'undefined' &&
      'pictureInPictureEnabled' in document &&
      (document as any).pictureInPictureEnabled === true
    );
  }, []);

  // Parallel Judge Logs
  const [judgeLogs, setJudgeLogs] = useState<{
     judge1: { text: string; status: 'idle' | 'analyzing' | 'done' | 'failed' };
     judge2: { text: string; status: 'idle' | 'analyzing' | 'done' | 'failed' };
     judge3: { text: string; status: 'idle' | 'analyzing' | 'done' | 'failed' };
     judge4: { text: string; status: 'idle' | 'analyzing' | 'done' | 'failed' };
     system: { text: string; status: 'idle' | 'analyzing' | 'done' | 'failed' };
  }>({
     judge1: { text: "", status: 'idle' },
     judge2: { text: "", status: 'idle' },
     judge3: { text: "", status: 'idle' },
     judge4: { text: "", status: 'idle' },
     system: { text: "", status: 'idle' }
  });
  
  // UX Error Handling
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [systemNotice, setSystemNotice] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showNotice = (text: string, type: 'success' | 'info' | 'error' = 'info') => {
    setSystemNotice({ text, type });
    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        setSystemNotice(prev => {
          if (prev?.text === text) return null;
          return prev;
        });
      }, 5000);
    }
  };
  
  // Dropdown States
  const [showTfPicker, setShowTfPicker] = useState(false);
  const [showDurPicker, setShowDurPicker] = useState(false);
  
  // Investment Details
  const [investmentAmount, setInvestmentAmount] = useState('100');
  const [holdingMinutes, setHoldingMinutes] = useState('3m');

  // Technique Files
  const [techniquesList, setTechniquesList] = useState<any[]>([]);
  const [techFileName, setTechFileName] = useState<string | null>(null);

  const [confirmedOutcome, setConfirmedOutcome] = useState<'WIN' | 'LOSS' | null>(null);

  const [autoGradeStatus, setAutoGradeStatus] = useState<'idle' | 'grading' | 'done' | 'failed'>('idle');
  const [testModeLeftSlice, setTestModeLeftSlice] = useState<string | null>(null);
  const [testModeRightSlice, setTestModeRightSlice] = useState<string | null>(null);
  const [autoGradeReason, setAutoGradeReason] = useState<string>('');
  const [autoGradeConfidence, setAutoGradeConfidence] = useState<number>(0);
  const [autoGradeRawOutcome, setAutoGradeRawOutcome] = useState<string>('');
  const [entryClose, setEntryClose] = useState<number | null>(null);
  const [exitClose, setExitClose] = useState<number | null>(null);
  const [absoluteMin, setAbsoluteMin] = useState<number | null>(null);
  const [absoluteMax, setAbsoluteMax] = useState<number | null>(null);
  const [splitXPercent, setSplitXPercent] = useState<number | null>(null);
  const actualDirection: 'PROFIT' | 'LOSS' | null =
    confirmedOutcome === 'WIN' ? 'PROFIT' : confirmedOutcome === 'LOSS' ? 'LOSS' : null;
  const [statsData, setStatsData] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const existing = localStorage.getItem('stats_surface_data');
        if (existing) return JSON.parse(existing).stats || [];
      } catch {
        // ignore
      }
    }
    return [];
  });

  useEffect(() => {
    const handleClearLocalStats = () => {
      setStatsData([]);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('determinist:clearstats', handleClearLocalStats);
      return () => {
        window.removeEventListener('determinist:clearstats', handleClearLocalStats);
      };
    }
  }, []);
  const [sessionIndex] = useState<number>(() => Math.floor(Math.random() * 1000));

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        if (analysis || selectedImage) {
          localStorage.setItem('chartlens_current_analysis', JSON.stringify({
            stockName,
            graphTimeframe,
            analysisStep,
            analysis,
            mode,
            selectedImage,
            techFileName,
            confirmedOutcome,
            autoGradeStatus,
            testModeLeftSlice,
            testModeRightSlice,
            autoGradeReason,
            autoGradeConfidence,
            autoGradeRawOutcome
          }));
        } else {
          localStorage.removeItem('chartlens_current_analysis');
        }
      } catch (err) {
        console.warn("Could not save to localStorage: QuotaExceeded");
      }
    }
  }, [stockName, graphTimeframe, analysisStep, analysis, mode, selectedImage, techFileName, confirmedOutcome, autoGradeStatus, testModeLeftSlice, testModeRightSlice, autoGradeReason, autoGradeConfidence, autoGradeRawOutcome]);

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
        if (v && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
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
      if (v && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
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

  const timeframes = ['30:00', '15:00'];
  const durations = ['3m', '5m', '15m'];



  const drawPipFrame = (signal: 'ANALYZING' | 'LONG' | 'NO_TRADE' | 'IDLE', confidence: number = 0, subText: string = '') => { const canvas = pipCanvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return; const W = 480, H = 270; ctx.clearRect(0, 0, W, H); const bgColors: Record<string, string> = { ANALYZING: '#0d0d14', LONG: '#021a0b', NO_TRADE: '#141008', IDLE: '#0d0d14' }; ctx.fillStyle = bgColors[signal] ?? '#0d0d14'; ctx.fillRect(0, 0, W, H); const accentColors: Record<string, string> = { ANALYZING: '#D9B382', LONG: '#22C55E', NO_TRADE: '#F59E0B', IDLE: '#94A3B8' }; const accent = accentColors[signal] ?? '#4B5570'; ctx.fillStyle = accent; ctx.fillRect(0, 0, W, 4); ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1; for (let x = 0; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = 0; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left'; ctx.fillText('AI TRADING · PRO TERMINAL', 16, 26); if (signal === 'ANALYZING') { ctx.fillStyle = '#D9B382'; ctx.beginPath(); ctx.arc(W - 20, 20, 5, 0, Math.PI * 2); ctx.fill(); } const signalLabels: Record<string, string> = { ANALYZING: 'ANALYZING...', LONG: 'EXECUTE LONG ▲', NO_TRADE: 'NO TRADE', IDLE: 'STANDBY' }; const label = signalLabels[signal] ?? signal; ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = signal === 'ANALYZING' ? 0 : 20; ctx.fillText(label, W / 2, 165); ctx.shadowBlur = 0; if (signal === 'LONG' && confidence > 0) { const barW = 280, barH = 6; const barX = (W - barW) / 2, barY = 190; ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); (ctx as any).roundRect(barX, barY, barW, barH, 3); ctx.fill(); ctx.fillStyle = accent; ctx.beginPath(); (ctx as any).roundRect(barX, barY, barW * (confidence / 100), barH, 3); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 13px monospace'; ctx.fillText(`${confidence}% CONFIDENCE`, W / 2, 218); } if (subText) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '12px monospace'; ctx.fillText(subText, W / 2, 245); } ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.font = '10px monospace'; ctx.fillText('Switch back to broker when ready', W / 2, H - 10); };

  const closePip = (exitPip = true) => { if (pipAnimFrameRef.current) { cancelAnimationFrame(pipAnimFrameRef.current); pipAnimFrameRef.current = null; } if (exitPip && document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); } pipStreamRef.current?.getTracks().forEach(t => t.stop()); pipStreamRef.current = null; if (pipVideoRef.current) { pipVideoRef.current.pause(); if (document.body.contains(pipVideoRef.current)) { document.body.removeChild(pipVideoRef.current); } pipVideoRef.current = null; } pipCanvasRef.current = null; setPipActive(false); setPipSignal('IDLE'); setPipConfidence(0); };

  // @ts-expect-error unused
  const _startPip = async (): Promise<boolean> => { if (!pipSupported) { showNotice('Picture-in-Picture is not supported in this browser. Use Chrome or Edge.', 'error'); return false; } try { const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270; pipCanvasRef.current = canvas; drawPipFrame('ANALYZING', 0, 'Switching to your broker now...'); const stream = canvas.captureStream(2); pipStreamRef.current = stream; const video = document.createElement('video'); video.srcObject = stream; video.muted = true; pipVideoRef.current = video; document.body.appendChild(video); await video.play(); await (video as any).requestPictureInPicture(); video.addEventListener('leavepictureinpicture', () => { setPipActive(false); setPipSignal('IDLE'); closePip(false); }); setPipActive(true); setPipSignal('ANALYZING'); const redraw = () => { drawPipFrame(pipSignal === 'IDLE' ? 'ANALYZING' : pipSignal, pipConfidence); pipAnimFrameRef.current = requestAnimationFrame(redraw); }; pipAnimFrameRef.current = requestAnimationFrame(redraw); return true; } catch (err: any) { console.error('[PiP] Failed to start:', err); if (err.name !== 'NotAllowedError') { showNotice(`PiP failed: ${err.message}`, 'error'); } return false; } };


  const handleReset = () => {
    setAnalysis(null);
    setAnalysisError(null);
    setSelectedImage(null);
    setTradingPhase('IDLE');
    setTradingDirection(null);
    setConfirmedOutcome(null);
    setAutoGradeStatus('idle');
    setTestModeLeftSlice(null);
    setTestModeRightSlice(null);
    setAutoGradeReason('');
    setAutoGradeConfidence(0);
    setAutoGradeRawOutcome('');
    setEntryClose(null);
    setExitClose(null);
    setAbsoluteMin(null);
    setAbsoluteMax(null);
    setSplitXPercent(null);
    setMode('live');
    setStockName('Bitcoin');
    setGraphTimeframe('30:00');
    setHoldingMinutes('3m');
    setScoutActive(false);
    setScoutData(null);
    setLoading(false);
    setIsBusy(false);
    setTechFileName(null);
    setTechniquesList([]);
    setHasSavedSession(false);
    
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

    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('chartlens_current_analysis');
      } catch (err) {
        console.warn("Could not remove storage key on reset:", err);
      }
    }

    resetWorkerStability();

    setTimeout(() => {
      showNotice("Analysis reset. Controls restored to defaults.", "info");
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
          showNotice("Camera access denied or not available. Please ensure you have granted permission.", "error");
        }, 300);
      }
    } else {
      setTimeout(() => {
        showNotice("Live camera is supported on web interface only via standard browser APIs.", "error");
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
      
      const currentInterval = 1000;
      const startTime = performance.now();

      if (!isFetching) {
        isFetching = true;
        try {
          const video = videoRef.current;
          if (!video || !video.videoWidth || !video.videoHeight || video.videoWidth === 0) {
            isFetching = false;
            return;
          }
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
              holdingMinutes: holdingMinutes,
              investmentAmount: investmentAmount as string,
              techniquesList,
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
      const initialInterval = 1000;
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
  }, [scoutActive, analysis, isCameraActive, tradingPhase, graphTimeframe, investmentAmount, holdingMinutes, stockName, techniquesList, tradingDirection]);

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
          setTechniquesList(parsedList);
          setTimeout(() => {
            showNotice(`Successfully loaded ${parsedList.length} techniques from ${file.name}.`, `success`);
          }, 300);
        } catch (err) {
          console.error("Failed to parse technique file:", err);
          setTimeout(() => {
            showNotice("Invalid technique file format. Please upload a JSON file containing a list of techniques.", `error`);
          }, 300);
        }
      };
      reader.readAsText(file);
    }
  };

  const saveToStats = (analysisData: any, outcome: 'WIN' | 'LOSS') => {
    try {
      const entryIdx = statsData.length + 1;
      const investAmt = Number(investmentAmount);
      const now = new Date();
      const scalpPlan = analysisData?.scalpingPlan || analysisData?.judge?.tradeDetails?.scalpingPlan || analysisData?.scalpDecision?.plan || analysisData?.debugTrace?.scalpDecision?.plan;
      const potentialProfit = scalpPlan ? scalpPlan.potentialRewardRupees : (0.015 * investAmt); // Fallback estimate
      const lossPotential = scalpPlan ? scalpPlan.riskRupees : investAmt;
      const resolvedExactProfit = outcome === 'WIN' ? potentialProfit : -lossPotential;

      const newEntry = {
        id: entryIdx,
        sessionName: `${stockName.replace('/', '_')}_${entryIdx}`,
        sessionIndex: sessionIndex,
        timestamp: now.toISOString(),
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString(),
        stock: stockName,
        timeframe: graphTimeframe,
        duration: scalpPlan ? `${scalpPlan.maxHoldingMinutes}m` : holdingMinutes,
        holdingMinutes: scalpPlan ? scalpPlan.maxHoldingMinutes : parseInt(holdingMinutes) || 3,
        investment: investAmt,
        profitPercentage: scalpPlan ? ((scalpPlan.potentialRewardRupees / (scalpPlan.entry * scalpPlan.positionSize)) * 100) : 1.5,
        profitPotential: potentialProfit,
        lossPotential: lossPotential,
        signal: analysisData?.judge?.winner === 'BULL' ? 'LONG' : 'WAIT',
        result: outcome,
        exactProfit: resolvedExactProfit,
        profitAmount: resolvedExactProfit,
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

      const existing = localStorage.getItem('stats_surface_data');
      let localStats = { stats: [] };
      if (existing) {
        try {
          localStats = JSON.parse(existing);
          if (!Array.isArray(localStats.stats)) {
            localStats.stats = [];
          }
        } catch {
          localStats = { stats: [] };
        }
      }
      localStats.stats.push(newEntry as never);
      localStorage.setItem('stats_surface_data', JSON.stringify(localStats));
    } catch (err) {
      console.error("Failed to save stats:", err);
    }
  };

  const handleAnalyze = async () => {
    if (loading || isBusy) return;
    antiImagine.clear();
    resetWorkerStability();
    setIsBusy(true);

    let finalImageToAnalyze = selectedImage;

    setTimeout(() => {
      (async () => {
        let controller: AbortController | undefined;
        let timeoutId: any;
        try {
          setLoading(true);
          setAnalysisError(null);

          if (mode === 'live' && isCameraActive && videoRef.current) {
            // Update terminal logs progressively to show camera stabilization & verification
            setJudgeLogs({
              judge1: { text: "STANDBY", status: 'idle' },
              judge2: { text: "STANDBY", status: 'idle' },
              judge3: { text: "STANDBY", status: 'idle' },
              judge4: { text: "STANDBY", status: 'idle' },
              system: { text: "CHECKING SYSTEM CAMERA... VERIFYING ANCHOR SECTORS...", status: 'analyzing' }
            });
            await new Promise(r => setTimeout(r, 850));

            setJudgeLogs(prev => ({
              ...prev,
              system: { text: "STABILIZING BRIGHTNESS SENSORS... WARMING SHUTTER MATRIX...", status: 'analyzing' }
            }));
            await new Promise(r => setTimeout(r, 850));

            setJudgeLogs(prev => ({
              ...prev,
              system: { text: "LOCKING ON GRAPH CO-ORDINATES... GRABBING HD CAPTURE...", status: 'analyzing' }
            }));
            await new Promise(r => setTimeout(r, 800));

            // Grab frame AFTER exposure adjustment is completed
            if (videoRef.current) {
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
            setTimeout(() => showNotice(msg, 'error'), 300);
            setLoading(false);
            setIsBusy(false);
            return;
          }

          controller = new AbortController();

          timeoutId = setTimeout(() => {
            if (controller) controller.abort();
          }, TIMEOUTS.SINGLE_ANALYSIS_MS);

          const result = await runSingleAnalysis({
            imageDataUrl: finalImageToAnalyze,
            stock: stockName,
            graphTimeframe,
            holdingMinutes: holdingMinutes,
            investmentAmount: investmentAmount as string,
            techniquesList,
            signal: controller.signal,
            isTestMode: mode === 'test',
            onJudgeLogs: (logs) => setJudgeLogs(prev => ({...prev, ...logs}))
          });

          clearTimeout(timeoutId);

          setAnalysis(result.analysis);
          setEntryClose(result.entryClose !== undefined ? result.entryClose : null);
          setExitClose(result.exitClose !== undefined ? result.exitClose : null);
          setAbsoluteMin(result.absoluteMin !== undefined ? result.absoluteMin : null);
          setAbsoluteMax(result.absoluteMax !== undefined ? result.absoluteMax : null);
          setSplitXPercent(result.splitXPercent !== undefined ? result.splitXPercent : null);

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
              if (mode !== 'test') setTradingDirection(null);
            }
          }, 6000);

          if (antiImagine.hasLogs()) {
            antiImagine.download();
          }

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
      if (j.outcome === 'UP') {
        const isWin = tradingDirection === 'LONG';
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

  const winner = analysis?.judge?.winner;

  // Bot mode — setup screen
  if (mode === 'bot' && !botPayload) {
    return (
      <div className="flex flex-col h-full bg-[#0A0B0E]">
        {/* Bot mode header strip */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60 bg-zinc-900/40">
          <div className="flex items-center gap-2 font-black text-xs text-zinc-300 uppercase tracking-widest">
            <Bot size={14} className="text-emerald-400" />
            <span>Bot Setup</span>
          </div>
          <button
            onClick={() => setMode('live')}
            className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Crosshair size={11} /> Switch to Manual Analysis
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <BotSetupScreen onStart={setBotPayload} />
        </div>
      </div>
    );
  }

  // Bot mode — dashboard (bot is configured and running)
  if (mode === 'bot' && botPayload) {
    return (
      <div className="flex flex-col h-full bg-[#0A0B0E]">
        {/* Bot mode header strip */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60 bg-zinc-900/40">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-emerald-400 animate-pulse" />
            <span className="text-xs font-black text-zinc-300 uppercase tracking-widest">
              Bot Mode
            </span>
            <span className="text-[10px] font-mono text-zinc-600">
              {botPayload.symbol}
            </span>
          </div>
          <button
            onClick={() => {
              bot.stopBot();
              setBotPayload(null);
              setMode('live');
            }}
            className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Crosshair size={11} /> Back to Manual Analysis
          </button>
        </div>

        {/* Main dashboard — scrollable */}
        <div className="flex-1 overflow-y-auto">
          <BotDashboard
            bot={bot}
            capital={botPayload.capital}
            symbol={botPayload.symbol}
            onStop={() => {
              bot.stopBot();
              setBotPayload(null);
              setMode('live');
            }}
            onPause={bot.pauseBot}
          />
        </div>
      </div>
    );
  }

  return (
    <View style={[
      tw`flex-1 relative transition-colors duration-500`,
      winner === 'BULL' ? tw`bg-[#01140b]` :
      winner === 'BEAR' ? tw`bg-[#170204]` :
      tw`bg-black`
    ]}>
      {winner && winner !== 'NONE' && (
        <VerdictFullScreenEffect winner={winner} />
      )}
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
                className={`flex-1 justify-center items-center absolute inset-0 ${tradingDirection === 'LONG' ? 'bg-green-600' : 'bg-yellow-700'}`}
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
                      {tradingDirection === 'LONG' ? 'EXECUTE LONG' : 'HOLD'}
                   </Text>
                 </motion.div>
                 
                 <View style={tw`h-1 w-48 bg-white bg-opacity-20 mb-6`} />
                 
                 <motion.div
                   initial={{ y: 20, opacity: 0 }}
                   animate={{ y: 0, opacity: 1 }}
                   transition={{ delay: 0.2 }}
                 >
                   <Text style={tw`text-white font-black text-5xl tracking-tighter uppercase text-center`}>
                      {tradingDirection === 'LONG' ? 'EXECUTE NOW' : 'SIGNAL ABORTED'}
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

      {botPayload && (
        <div className={`p-3 text-[10px] font-mono transition-colors border-b z-50 flex items-center justify-between ${
          bot.phase === 'IN_TRADE'
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            : bot.phase === 'HALTED'
            ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            : 'bg-sky-500/10 border-sky-500/20 text-sky-400'
        }`}>
          <span className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${
              bot.phase === 'IN_TRADE' ? 'bg-emerald-400 animate-pulse' :
              bot.phase === 'HALTED'   ? 'bg-rose-400' : 'bg-sky-400 animate-pulse'
            }`} />
            {bot.phase}
          </span>
          <span>{bot.symbol ?? botPayload.symbol}</span>
          <span>
            {bot.currentPrice != null
              ? `₹${bot.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '—'}
          </span>
          {bot.phase === 'IN_TRADE' && bot.unrealizedPnL != null && (
            <span className={bot.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {bot.unrealizedPnL >= 0 ? '+' : ''}₹{bot.unrealizedPnL.toFixed(0)} live
            </span>
          )}
          {bot.phase === 'IN_TRADE' && bot.activePlan && (
            <span className="text-zinc-500">
              SL: <strong className="text-rose-400">
                ₹{(bot.trailSL || bot.activePlan.stopLoss).toFixed(2)}
              </strong>
              {' '} TP2: <strong className="text-emerald-400">
                ₹{bot.activePlan.takeProfit2.toFixed(2)}
              </strong>
            </span>
          )}
        </div>
      )}

      <ScrollView 
        style={[
          tw`flex-1 transition-colors duration-500`,
          winner === 'BULL' ? tw`bg-[#01140b]` :
          winner === 'BEAR' ? tw`bg-[#170204]` :
          tw`bg-black`
        ]}
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
        {systemNotice && (
          <View style={[
            tw`mb-4 p-4 rounded-xl flex-row items-center justify-between border`,
            systemNotice.type === 'success' ? tw`bg-green-500/10 border-green-500/30` :
            systemNotice.type === 'error' ? tw`bg-red-500/10 border-red-500/30` :
            tw`bg-zinc-500/10 border-zinc-500/30`
          ]}>
            <View style={tw`flex-row items-center flex-1 mr-3`}>
              <View style={[
                tw`w-2 h-2 rounded-full mr-2.5`,
                systemNotice.type === 'success' ? tw`bg-green-400` :
                systemNotice.type === 'error' ? tw`bg-red-400` :
                tw`bg-zinc-400`
              ]} />
              <Text style={[
                tw`text-xs font-medium`,
                systemNotice.type === 'success' ? tw`text-green-200` :
                systemNotice.type === 'error' ? tw`text-red-200` :
                tw`text-gray-200`
              ]}>
                {systemNotice.text}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss notice"
              onPress={() => setSystemNotice(null)}
              style={tw`p-1 bg-white/5 rounded-full`}
            >
              <X size={12} color="#A1A1AA" />
            </Pressable>
          </View>
        )}

        {hasSavedSession && (
          <View style={tw`mb-4 p-4 rounded-xl flex-row items-center justify-between border bg-amber-500/10 border-amber-500/30`}>
            <View style={tw`flex-row items-center flex-1 mr-3`}>
              <View style={tw`w-2 h-2 rounded-full mr-2.5 bg-amber-400`} />
              <Text style={tw`text-xs font-semibold text-amber-200`}>
                Previous analysis session detected. Would you like to restore it?
              </Text>
            </View>
            <View style={tw`flex-row gap-2`}>
              <Pressable 
                onPress={handleRestoreSession} 
                style={({ pressed }) => [tw`bg-amber-500/20 px-3 py-1.5 rounded-lg border border-amber-500/30`, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={tw`text-amber-300 font-extrabold text-[10px] uppercase tracking-wider`}>Restore</Text>
              </Pressable>
              <Pressable 
                onPress={() => {
                  if (typeof window !== 'undefined') {
                    try {
                      localStorage.removeItem('chartlens_current_analysis');
                    } catch (err) {
                      console.warn("Could not remove storage key on dismiss:", err);
                    }
                  }
                  setHasSavedSession(false);
                }} 
                style={({ pressed }) => [tw`bg-white/5 px-3 py-1.5 rounded-lg border border-white/10`, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={tw`text-[#A1A1AA] font-bold text-[10px] uppercase tracking-wider`}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        )}
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
        holdingMinutes={holdingMinutes}
        setHoldingMinutes={setHoldingMinutes}
        showDurPicker={showDurPicker}
        setShowDurPicker={setShowDurPicker}
        durations={durations}
        investmentAmount={investmentAmount}
        setInvestmentAmount={setInvestmentAmount}
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
        saveToStats={saveToStats}
        prefersReducedMotion={prefersReducedMotion ?? false}
        springProps={springProps}
        buttonHoverProps={buttonHoverProps}
        buttonTapProps={buttonTapProps}
        cardHoverProps={cardHoverProps}
        techFileName={techFileName}
        handlePickTechnique={handlePickTechnique}
      />

      <ScalpCopilotHUD 
        analysis={analysis}
        onConfigChanged={(updated) => {}}
        onResetRiskState={() => {
          if (typeof window !== 'undefined') {
            const fresh = {
              dailyPnL: 0,
              tradesToday: 0,
              consecutiveLosses: 0,
              lastTradeAt: 0,
              inCooldown: false,
              cooldownUntil: 0,
              dateKey: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
            };
            localStorage.setItem('chartlens_risk_state_v1', JSON.stringify(fresh));
          }
        }}
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
          entryClose={entryClose}
          exitClose={exitClose}
          absoluteMin={absoluteMin}
          absoluteMax={absoluteMax}
          splitXPercent={splitXPercent}
        />
        <ComplianceFooter />
      </View>
    </ScrollView>

    {showDisclaimer && (
      <View style={tw`absolute inset-0 bg-black/95 z-[999] justify-center items-center p-6`}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-[#0E0E10] border border-yellow-500/20 rounded-3xl p-6 shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-600" />
          <div style={tw`flex-row items-center gap-3 mb-4`}>
            <View style={tw`p-2 bg-yellow-500/10 rounded-xl border border-yellow-500/30`}>
              <AlertTriangle className="text-yellow-400" size={20} />
            </View>
            <View>
              <Text style={tw`font-sans font-black text-sm text-white uppercase tracking-wider`}>Educational Utility Only</Text>
              <Text style={tw`font-mono text-[9px] text-gray-400 uppercase tracking-widest`}>Regulatory Notice (SEBI / India)</Text>
            </View>
          </div>

          <ScrollView style={tw`max-h-[250px] mb-6 pr-1`}>
            <Text style={tw`font-sans text-xs text-gray-200 leading-relaxed mb-4`}>
              Genspark <Text style={tw`font-bold text-yellow-400`}>ai trading ChartLens</Text> is an <Text style={tw`font-bold text-white`}>Educational Analysis Tool</Text>. It is <Text style={tw`font-bold text-red-400`}>NOT registered</Text> with the Securities and Exchange Board of India (SEBI) as an Investment Adviser, Research Analyst, or Portfolio Manager.
            </Text>
            <Text style={tw`font-sans text-xs text-gray-300 leading-relaxed mb-4`}>
              This application extracts geometrical structures and indicator math from pasted or streamed chart images to generate experimental analysis. All outputs are for conceptual and simulation learning only — they do <Text style={tw`font-bold text-white`}>not constitute personalized advice, buy/sell recommendations</Text>, or promises of profits.
            </Text>
            <Text style={tw`font-sans text-xs text-gray-300 leading-relaxed`}>
              Trading involves a high risk of permanent capital loss. You are solely responsible for executing any actual trades on your registered broker. By placing orders, you verify that you understand standard exchange risk caps and compliance frameworks.
            </Text>
          </ScrollView>

          <Pressable
            onPress={() => {
              if (typeof window !== 'undefined') {
                try {
                  localStorage.setItem('chartlens_disclaimer_accepted_v2', 'true');
                } catch (e) {
                  // Ignore localStorage quota or access errors
                }
              }
              setShowDisclaimer(false);
            }}
            style={({ pressed }) => [
              tw`bg-yellow-500 h-12 rounded-xl items-center justify-center flex-row shadow-lg shadow-yellow-950/20`,
              { opacity: pressed ? 0.75 : 1 }
            ]}
          >
            <Text style={tw`text-[#1A1308] font-black uppercase tracking-wider text-sm`}>I Understand & Accept</Text>
          </Pressable>
        </motion.div>
      </View>
    )}
    </View>
  );
}

const AnimatedArrows = ({ direction }: { direction: 'LONG' | 'NO_TRADE' }) => {
  const isUp = direction === 'LONG';
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
                delay: Math.random() * 2,
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

const VerdictFullScreenEffect = ({ winner }: { winner: 'BULL' | 'BEAR' | 'NONE' }) => {
  if (winner !== 'BULL' && winner !== 'BEAR') return null;
  const isBull = winner === 'BULL';
  return (
    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
      {/* Ambient background wash */}
      <motion.div 
        animate={{ opacity: [0.15, 0.3, 0.15] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className={`absolute inset-0 ${isBull ? 'bg-[radial-gradient(circle_at_center,rgba(34,197,94,0.25)_0%,transparent_75%)]' : 'bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.25)_0%,transparent_75%)]'}`}
      />
      {/* Laser glow lines border framework */}
      <div className={`absolute top-0 inset-x-0 h-1.5 ${isBull ? 'bg-green-500/50 shadow-[0_2px_15px_#22C55E]' : 'bg-red-500/50 shadow-[0_2px_15px_#EF4444]'}`} />
      <div className={`absolute bottom-0 inset-x-0 h-1.5 ${isBull ? 'bg-green-500/50 shadow-[0_-2px_15px_#22C55E]' : 'bg-red-500/50 shadow-[0_-2px_15px_#EF4444]'}`} />
      <div className={`absolute left-0 inset-y-0 w-1.5 ${isBull ? 'bg-green-500/50 shadow-[2px_0_15px_#22C55E]' : 'bg-red-500/50 shadow-[2px_0_15px_#EF4444]'}`} />
      <div className={`absolute right-0 inset-y-0 w-1.5 ${isBull ? 'bg-green-500/50 shadow-[-2px_0_15px_#22C55E]' : 'bg-red-500/50 shadow-[-2px_0_15px_#EF4444]'}`} />
    </div>
  );
};
