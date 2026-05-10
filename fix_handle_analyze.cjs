const fs = require('fs');

let content = fs.readFileSync('src/components/LiveAnalysis.tsx', 'utf8');

const startStr = '  const handleAnalyze = async () => {';
const endStr = '  const handleRegrade = async () => {';

const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr);

if (startIndex === -1 || endIndex === -1) {
  console.error('Could not find boundaries');
  process.exit(1);
}

const replacement = `  const handleAnalyze = async () => {
    if (loading || isBusy) return;
    setIsBusy(true);

    let finalImageToAnalyze = selectedImage;

    if (mode === 'camera' && isCameraActive && videoRef.current) {
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
      setTimeout(() => alert("Please start the camera or upload a chart image first."), 300);
      setIsBusy(false);
      return;
    }

    setTimeout(() => {
      (async () => {
        let controller: AbortController | undefined;
        let timeoutId: any;
        try {
          setLoading(true);
          setAnalysisError(null);
          setAutoGradeStatus('idle');
          setAnalysis(null);
          setTradingPhase('ANALYSING_DIRECTION');
          setAnalysisStep(\`SYNCHRONIZING \${techniquesList.length} TECHNIQUES...\`);

          controller = new AbortController();
          timeoutId = setTimeout(() => controller?.abort(), 360000);

          if (mode === 'test') setAutoGradeStatus('grading');

          const result = await runSingleAnalysis({
            imageDataUrl: finalImageToAnalyze!,
            stock: stockName,
            graphTimeframe,
            investmentDuration,
            investmentAmount: investmentAmount as string,
            profitabilityPercent: profitabilityPercent as string,
            techniquesList,
            encryptedSystemTokens,
            signal: controller.signal,
            onProgress: setAnalysisStep,
            onJudgeLogs: setJudgeLogs,
            isTestMode: mode === 'test'
          });

          clearTimeout(timeoutId);
          setLoading(false);
          setIsBusy(false);

          setJudgeLogs({
            judge1: { text: \`Bull: \${(result.analysis.bull?.reasoning || "Analyzing...").substring(0, 30)}...\`, status: 'done' },
            judge2: { text: \`Bear: \${(result.analysis.bear?.reasoning || "Analyzing...").substring(0, 30)}...\`, status: 'done' },
            judge3: { text: \`Risk: \${(result.analysis.skeptic?.riskVerdict || result.analysis.skeptic?.skepticVerdict || "Analyzing...").substring(0, 30)}...\`, status: 'done' },
            judge4: { text: \`Boundary: \${result.analysis.judge?.ruling?.substring(0, 30) || "Detected"}...\`, status: 'done' },
            system: { text: \`\${result.analysis.techUsedCount} Patterns Identified ✅\`, status: 'done' }
          });

          setAnalysisStep(\`Analysis Complete: \${result.analysis.techUsedCount}/\${techniquesList.length} Techniques Found\`);

          if (mode === 'test') {
            setTestModeRightSlice(result.testModeRightSlice);
            setTestModeLeftSlice(result.finalImageForAnalysis);
            setAutoGradeReason(result.reason);
            setAutoGradeConfidence(result.confidence);
            setAutoGradeRawOutcome(result.rawOutcome || '');

            if (result.outcome === 'WIN' || result.outcome === 'LOSS') {
              setTimeout(() => {
                saveToStats(result.analysis, result.outcome);
                setAutoGradeStatus('done');
                setAnalysisStep(\`AUTO-GRADED: Signal=\${result.direction} | \${result.outcome === 'WIN' ? '✅ WIN' : '❌ LOSS'} (\${result.confidence}%)\`);
              }, 800);
            } else {
              setAutoGradeStatus('failed');
              setAnalysisStep(\`AUTO-GRADE INCONCLUSIVE — please declare WIN or LOSS manually.\`);
            }
          }
          
          setTradingDirection(result.direction);
          
          if (mode === 'camera') {
            setTradingPhase('WAITING_FOR_ENTRY');
            setAnalysisStep(result.direction === 'NO_TRADE' ? (result.analysis.judge.finalConfidence < 70 ? \`LOW CONFIDENCE (\${result.analysis.judge.finalConfidence}%) - NO TRADE\` : 'CONFIRMING NO-TRADE SIGNAL...') : 'HUNTING PERFECT ENTRY POINT...');
            await new Promise(r => setTimeout(r, 4000));
            setTradingPhase('ENTRY_CONFIRMED');
            setAnalysisStep(result.direction === 'NO_TRADE' ? 'SIGNAL ABORTED' : 'EXECUTE NOW!');
            setScoutActive(true);
          } else {
            setTradingPhase('ENTRY_CONFIRMED');
            setAnalysisStep(result.direction === 'NO_TRADE' ? (result.analysis.judge.finalConfidence < 70 ? \`LOW CONFIDENCE (\${result.analysis.judge.finalConfidence}%) - ABORTED\` : 'SIGNAL ABORTED') : 'SIGNAL CONFIRMED - EXECUTE NOW!');
          }

          setAnalysis(result.analysis);

          setTimeout(() => {
            setTradingPhase('IDLE');
            setAnalysisStep('LIVE TICK SCOUT ACTIVE');
            if (mode !== 'test') setTradingDirection(null);
          }, 6000);

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

`;

const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);

fs.writeFileSync('src/components/LiveAnalysis.tsx', newContent);
console.log('Replaced handleAnalyze!');
