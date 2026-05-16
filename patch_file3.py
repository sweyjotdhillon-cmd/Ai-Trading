import re

with open("src/components/LiveAnalysis.tsx", "r") as f:
    content = f.read()

search = """        const result = await runSingleAnalysis({
          imageDataUrl: currentImage,
          stock: stockName,
          graphTimeframe,
          investmentDuration,
          investmentAmount,
          profitabilityPercent,
          techniquesList,
          encryptedSystemTokens,
          signal: abortControllerRef.current.signal,
          onProgress: setProcessingStep,
          onJudgeLogs: (logs) => setJudgeLogs(prev => ({ ...prev, ...logs })),
          isTestMode
        });

        if (!result.frameStable) {
          if (isTestMode) {
             console.log('Skipping frame in test mode because it is not stable.');
          }
        }

        // --- ONLY APPLY IF MOUNTED AND NOT CANCELLED ---
        if (isMounted.current && currentId === currentAnalysisId.current) {

          if (!isTestMode && result.outcome !== 'NEUTRAL') {
              console.log('Attempting outcome override logic... final score was:', result);
              const mappedOutcome = result.direction === 'UP' ? 'WIN' : (result.direction === 'DOWN' ? 'LOSS' : 'NEUTRAL');
              console.log('Mapped outcome:', mappedOutcome, result.direction);
              result.outcome = mappedOutcome;
          }"""

replace = """        const result = await runSingleAnalysis({
          imageDataUrl: currentImage,
          stock: stockName,
          graphTimeframe,
          investmentDuration,
          investmentAmount,
          profitabilityPercent,
          techniquesList,
          encryptedSystemTokens,
          signal: abortControllerRef.current.signal,
          onProgress: setProcessingStep,
          onJudgeLogs: (logs) => setJudgeLogs(prev => ({ ...prev, ...logs })),
          isTestMode
        });

        if (!result.frameStable) {
          if (isTestMode) {
             console.log('Skipping frame in test mode because it is not stable.');
          }
        }

        // --- ONLY APPLY IF MOUNTED AND NOT CANCELLED ---
        if (isMounted.current && currentId === currentAnalysisId.current) {

          if (!isTestMode && result.outcome !== 'NEUTRAL') {
              console.log('Attempting outcome override logic... final score was:', result);
              const mappedOutcome = result.direction === 'UP' ? 'WIN' : (result.direction === 'DOWN' ? 'LOSS' : 'NEUTRAL');
              console.log('Mapped outcome:', mappedOutcome, result.direction);
              result.outcome = mappedOutcome;
          }"""

new_content = content.replace(search, replace)

if new_content == content:
    print("Replace failed. Content not found.")
else:
    with open("src/components/LiveAnalysis.tsx", "w") as f:
        f.write(new_content)
    print("Replace succeeded.")
