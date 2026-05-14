const fs = require('fs');

let content = fs.readFileSync('src/components/LiveAnalysis.tsx', 'utf8');

// 1. Image capture block
const imageCaptureSearch = `    let finalImageToAnalyze = selectedImage;

    if (mode === 'live' && isCameraActive && videoRef.current) {
      if (Platform.OS === 'web') {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        finalImageToAnalyze = canvas.toDataURL('image/jpeg');
      }
    }`;

const imageCaptureReplace = `    let finalImageToAnalyze = selectedImage;

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

    if (mode === 'screen' && isScreenActive && screenVideoRef.current) {
      // ── NEW: Screen capture — grab one frame from the shared screen feed ──────
      if (Platform.OS === 'web') {
        const sv = screenVideoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width  = sv.videoWidth  || 1280;
        canvas.height = sv.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(sv, 0, 0, canvas.width, canvas.height);
        finalImageToAnalyze = canvas.toDataURL('image/jpeg');
      }
    }`;

content = content.replace(imageCaptureSearch, imageCaptureReplace);

// 2. Alert message
const alertSearch = `    if (!finalImageToAnalyze) {
      setTimeout(() => alert("Please start the camera or upload a chart image first."), 300);
      setIsBusy(false);
      return;
    }`;

const alertReplace = `    if (!finalImageToAnalyze) {
      const msg = mode === 'screen'
        ? 'Please start screen sharing first, then tap Analyze.'
        : 'Please start the camera or upload a chart image first.';
      setTimeout(() => alert(msg), 300);
      setIsBusy(false);
      return;
    }`;

content = content.replace(alertSearch, alertReplace);

// 3. Launch PiP
const launchPipSearch = `          setLoading(true);
          setAnalysisError(null);`;

const launchPipReplace = `          setLoading(true);
          // ── Launch PiP widget when in screen mode ────────────────────────────────────
          if (mode === 'screen' && pipSupported) {
            startPip().catch(console.error); // Non-blocking — analysis continues even if PiP fails
          }
          setAnalysisError(null);`;

content = content.replace(launchPipSearch, launchPipReplace);

// 4. Push result to PiP
const pushResultSearch = `          setAnalysis(result.analysis);

          if (pipActive) {`;

const pushResultReplace = `          setAnalysis(result.analysis);

          // ── Push result to PiP widget ─────────────────────────────────────────────────
          if (pipActive && mode === 'screen') {
            const pipDir: 'CALL' | 'PUT' | 'NO_TRADE' =
              result.direction === 'UP'   ? 'CALL'  :
              result.direction === 'DOWN' ? 'PUT'   :
              'NO_TRADE';
            updatePip(pipDir, result.analysis.judge?.finalConfidence ?? 0);
          }

          if (pipActive) {`;

content = content.replace(pushResultSearch, pushResultReplace);


// 5. handleReset
const resetSearch = `    setIsCameraActive(false);
    closePip(true);

    setTimeout(() => {`;

const resetReplace = `    setIsCameraActive(false);

    // Stop screen share and PiP on reset
    stopScreenShare();
    closePip(true);

    setTimeout(() => {`;

content = content.replace(resetSearch, resetReplace);

fs.writeFileSync('src/components/LiveAnalysis.tsx', content);
