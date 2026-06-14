/* eslint-disable no-empty */
import { antiImagine } from "./antiImagine";
import { simulateScalpTrade } from "../quant/pathSimulator";
import { loadScalpConfig } from "../config/scalpConfig";
import { computeRoundTripCharges } from "../quant/brokerCharges";
import { featureFlags } from "../config/featureFlags";
import { TradeAnalysisScalpAddon } from "../types";
let msgCounter = 0;
import { dataUrlToImageData } from "./imageUtils";
import { loadCalibration } from "../vision/colorCalibration";
import { buildPipelineResult } from "../vision/pipeline";

const WORKER_POOL_SIZE =
  typeof navigator !== "undefined" && navigator.hardwareConcurrency
    ? Math.max(1, Math.min(8, navigator.hardwareConcurrency))
    : 4;
const workers: Worker[] = [];
let currentWorkerIndex = 0;

type Listener = (payload: any) => void;
const messageResolvers = new Map<
  string,
  { resolve: (val: any) => void; reject: (err: any) => void }
>();
const stableListeners = new Set<Listener>();

const progressListeners = new Map<string, (step: string) => void>();
const judgeLogListeners = new Map<string, (logs: any) => void>();

function getWorker(): Worker {
  if (workers.length === 0) {
    for (let i = 0; i < WORKER_POOL_SIZE; i++) {
      const w = new Worker(
        new URL("../workers/analysisWorker.ts", import.meta.url),
        { type: "module" },
      );

      const cal = loadCalibration();
      if (cal) {
        w.postMessage({
          type: "CALIBRATE",
          payload: { bullColor: cal.bull, bearColor: cal.bear },
        });
      }

      w.onmessage = (e: MessageEvent) => {
        const { ok, stage, ms, payload } = e.data;
        if (!ok) {
          console.error(
            `Worker Fault [${stage}] ${ms.toFixed(1)}ms:`,
            payload.message,
          );
          antiImagine.log("ERROR", `worker_fault_${stage}`, payload.message);
          if (payload.msgId) {
            const res = messageResolvers.get(payload.msgId);
            if (res) {
              res.resolve({ type: "ERROR", message: payload.message });
              messageResolvers.delete(payload.msgId);
            }
          }
          return;
        }

        const { type } = payload;

        // Log incidents collected from worker
        if (payload.incidents && Array.isArray(payload.incidents)) {
          payload.incidents.forEach((inc: any) => {
            antiImagine.log(inc.type, inc.module, inc.message, inc.details);
          });
        }

        if (type === "FRAME_RESULT" && payload.msgId) {
          const res = messageResolvers.get(payload.msgId);
          if (res) {
            res.resolve(payload);
            messageResolvers.delete(payload.msgId);
            progressListeners.delete(payload.msgId);
            judgeLogListeners.delete(payload.msgId);
          }
        } else if (type === "JUDGE_LOG" && payload.msgId) {
          const listener = judgeLogListeners.get(payload.msgId);
          if (listener) listener(payload.logs);
        } else if (type === "STABLE_SIGNAL") {
          stableListeners.forEach((l) => l(payload));
        } else if (type === "PROGRESS" && payload.msgId) {
          const listener = progressListeners.get(payload.msgId);
          if (listener) {
            listener(payload.step);
          }
        }
      };
      workers.push(w);
    }
  }

  const selectedWorker = workers[currentWorkerIndex];
  currentWorkerIndex = (currentWorkerIndex + 1) % WORKER_POOL_SIZE;
  return selectedWorker;
}

export function onStableSignal(cb: Listener) {
  stableListeners.add(cb);
  return () => stableListeners.delete(cb);
}

export function resetWorkerStability() {
  if (workers.length > 0) {
    workers.forEach((w) => w.postMessage({ type: "RESET" }));
  } else {
    getWorker().postMessage({ type: "RESET" });
  }
}

export function calibrateWorker(bullColor: any, bearColor: any) {
  if (workers.length > 0) {
    workers.forEach((w) =>
      w.postMessage({ type: "CALIBRATE", payload: { bullColor, bearColor } }),
    );
  } else {
    getWorker().postMessage({
      type: "CALIBRATE",
      payload: { bullColor, bearColor },
    });
  }
}

function generateId() {
  return String(performance.now()).replace(".", "") + String(++msgCounter);
}

import { parseDurationToMinutes } from "../quant/horizon";
import {
  buildAutoGradeGeometry,
  AutoGradeGeometry,
} from "../quant/autoGradeGeometry";
import { NumericOHLC } from "../vision/pipeline";

export async function runSingleAnalysis(params: {
  imageDataUrl: string;
  directOhlcv?: NumericOHLC[];
  livePrice?: number;
  stock: string;
  graphTimeframe: string;
  holdingMinutes?: string;
  investmentAmount: string;
  techniquesList: any[];
  signal: AbortSignal;
  onProgress?: (step: string) => void;
  onJudgeLogs?: (logs: any) => void;
  isTestMode?: boolean;
  isManifestCheck?: boolean;
  minConfidence?: number;  // Bug #23 fix: user's threshold forwarded to worker
  onDirectionFound?: (direction: "LONG" | "SHORT" | "NO_TRADE") => void;
}): Promise<{
  analysis: any;
  direction: "LONG" | "SHORT" | "NO_TRADE";
  outcome: "WIN" | "LOSS" | "NEUTRAL";
  confidence: number;
  reason: string;
  testModeRightSlice: string | null;
  finalImageForAnalysis: string;
  entryAnchorBase64: string | null;
  rawOutcome?: string;
  frameStable?: boolean;
  actualDirection?: "UP" | "DOWN" | "FLAT" | null;
  entryClose?: number;
  exitClose?: number;
  candlesCut?: number;
  startCandle?: any;
  threePriorCandles?: any[];
  autoGradeGeometry?: AutoGradeGeometry | null;
  splitXPercent?: number | null;
  absoluteMin?: number | null;
  absoluteMax?: number | null;
  ohlcQuality?: "REAL_PRICE" | "NORMALIZED_FALLBACK";
}> {
  const t0 = performance.now();
  const { imageDataUrl, onJudgeLogs, isTestMode, onDirectionFound } = params;

  const activeDuration = params.holdingMinutes || "5m";

  const msgId = generateId();
  if (params.onProgress) {
    progressListeners.set(msgId, params.onProgress);
  }
  if (params.onJudgeLogs) {
    judgeLogListeners.set(msgId, params.onJudgeLogs);
  }
  const w = getWorker();

  let imgData: ImageData | undefined;
  if (!params.directOhlcv || params.isTestMode || params.isManifestCheck) {
    try {
      imgData = await dataUrlToImageData(imageDataUrl);
    } catch (err: any) {
      if (onJudgeLogs) {
        onJudgeLogs({
          system: {
            text: `Error decoding image: ${err.message}`,
            status: "error",
          },
        });
      }
      throw err;
    }
  }

  const tfM = parseDurationToMinutes(params.graphTimeframe);
  const durM = parseDurationToMinutes(activeDuration);

  if (params.isManifestCheck) {
    try {
      const pipe = buildPipelineResult(imgData!);
      const ohlc = pipe.ohlcSeries || [];

      let actualDir: "UP" | "DOWN" | "FLAT" | null = null;
      let startCandle: any = null;
      const threePriorCandles: any[] = [];
      let autoGradeGeometry: AutoGradeGeometry | null = null;

      if (ohlc.length > 0) {
        const cutoff = Math.max(1, Math.round(durM || 3));
        const N = ohlc.length;

        if (N > cutoff) {
          startCandle = ohlc[N - cutoff];

          const exitNode = ohlc[N - 1];
          if (exitNode.close > startCandle.open) {
            actualDir = "UP";
          } else if (exitNode.close < startCandle.open) {
            actualDir = "DOWN";
          } else {
            actualDir = "FLAT";
          }

          // In manifest check, we need to extract right slice and build autoGradeGeometry
          try {
            const rawCandles = pipe.rawCandles;
            let leftWidth = imgData.width;
            if (rawCandles && rawCandles.length > 5) {
              const entryIndex = N - 1 - cutoff;
              if (entryIndex >= 0 && entryIndex < N - 1) {
                const cEntry = rawCandles[entryIndex];
                const cNext = rawCandles[entryIndex + 1];
                if (
                  cEntry &&
                  cNext &&
                  typeof cEntry.xCenter === "number" &&
                  typeof cNext.xCenter === "number"
                ) {
                  leftWidth = Math.floor((cEntry.xCenter + cNext.xCenter) / 2);
                }
              }
            }
            if (leftWidth > 20 && leftWidth < imgData.width - 20) {
              const rightWidth = imgData.width - leftWidth;
              const canvas = document.createElement("canvas");
              canvas.width = imgData!.width;
              canvas.height = imgData!.height;
              const ctx = canvas.getContext("2d")!;
              ctx.putImageData(imgData!, 0, 0);

              const rightCanvas = document.createElement("canvas");
              rightCanvas.width = rightWidth;
              rightCanvas.height = imgData!.height;
              rightCanvas
                .getContext("2d")!
                .drawImage(
                  canvas,
                  leftWidth,
                  0,
                  rightWidth,
                  imgData!.height,
                  0,
                  0,
                  rightWidth,
                  imgData!.height,
                );

              const rightDataUrl = rightCanvas.toDataURL("image/jpeg", 0.5);
              const rightImgData = await dataUrlToImageData(rightDataUrl);
              const rightPipe = buildPipelineResult(rightImgData);

              autoGradeGeometry = buildAutoGradeGeometry(
                rightPipe.ohlcSeries,
                rightPipe.meta.candleCentersX || [],
                startCandle.open,
              );
            }
          } catch (e) {}

          // Extract 3 candles prior to startCandle (indices N-cutoff-1, N-cutoff-2, N-cutoff-3)
          for (let idx = 3; idx >= 1; idx--) {
            const pIdx = N - cutoff - idx;
            if (pIdx >= 0) {
              threePriorCandles.push(ohlc[pIdx]);
            }
          }
        } else {
          const lastCandle = ohlc[N - 1];
          if (lastCandle.close > lastCandle.open) {
            actualDir = "UP";
          } else if (lastCandle.close < lastCandle.open) {
            actualDir = "DOWN";
          } else {
            actualDir = "FLAT";
          }
          startCandle = lastCandle;
        }
      }

      return {
        analysis: {},
        direction: "NO_TRADE",
        actualDirection: actualDir,
        outcome: "NEUTRAL",
        confidence: 0,
        reason: "Fast manifest check completed",
        testModeRightSlice: null,
        finalImageForAnalysis: imageDataUrl,
        entryAnchorBase64: null,
        rawOutcome: "FAST_CHECK",
        frameStable: true,
        startCandle,
        threePriorCandles,
        autoGradeGeometry,
      };
    } catch (e: any) {
      throw new Error(e.message || "Error running fast manifest check");
    }
  }

  const payloadPromise = new Promise<any>((resolve, reject) => {
    messageResolvers.set(msgId, { resolve, reject });
    try {
      const strictNeutrality =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("strict_neutrality_mode") !== "false"
          : true;
      const biasCorrectionStrength =
        typeof localStorage !== "undefined"
          ? parseFloat(
              localStorage.getItem("bias_correction_strength") || "0.05",
            )
          : 0.05;
      const noTradePreference =
        typeof localStorage !== "undefined"
          ? parseFloat(localStorage.getItem("no_trade_preference") || "0.05")
          : 0.05;

      w.postMessage({
        type: "ANALYZE",
        msgId,
        ...(params.directOhlcv && !params.isTestMode && !params.isManifestCheck
          ? { directOhlcv: params.directOhlcv }
          : { imageData: imgData, livePrice: params.livePrice }),
        graphTimeframeMinutes: tfM,
        graphTimeframe: params.graphTimeframe,
        holdingMinutesVal: durM,
        techniquesList: params.techniquesList,
        isTestMode: params.isTestMode,
        isManifestCheck: params.isManifestCheck,
        minConfidence: params.minConfidence,  // Bug #23 fix: pass user threshold to worker
        neutralityConfig: {
          strictNeutrality,
          biasCorrectionStrength,
          noTradePreference,
        },
      });
    } catch (e: any) {
      messageResolvers.delete(msgId);
      reject(e);
    }
    params.signal.addEventListener("abort", () => {
      messageResolvers.delete(msgId);
      reject(new Error("Aborted"));
    });
  });

  const payload = await payloadPromise;

  if (payload.type === "ERROR") {
    if (onJudgeLogs) {
      onJudgeLogs({
        judge1: { text: "FAULT", status: "error" },
        judge2: { text: "FAULT", status: "error" },
        judge3: { text: "FAULT", status: "error" },
        judge4: { text: "FAULT", status: "error" },
        system: { text: `System Fault: ${payload.message}`, status: "error" },
      });
    }
    return {
      analysis: {
        judge: {
          winner: "NONE",
          decision: "FAULT",
          finalConfidence: 0,
          j1Score: 0,
          j2Score: 0,
          j3Score: 0,
          j4Score: 0,
          ruling: payload.message,
          totalScore: 0,
          tradeDetails: {
            latencyAdjustedForecast: "",
            techniquesUsed: "",
            executionTimeMs: performance.now() - t0,
          },
        },
        bull: { reasoning: "FAULT" },
        bear: { reasoning: "FAULT" },
        skeptic: { riskVerdict: "FAULT" },
        techUsedCount: 0,
      },
      direction: "NO_TRADE",
      outcome: "NEUTRAL",
      confidence: 0,
      reason: payload.message,
      testModeRightSlice: null,
      finalImageForAnalysis: imageDataUrl,
      entryAnchorBase64: null,
      rawOutcome: "ERROR",
      frameStable: false,
      actualDirection: null,
      startCandle: undefined,
      threePriorCandles: undefined,
      autoGradeGeometry: undefined,
      splitXPercent: undefined,
    };
  }

  const { frameStable, debugTrace } = payload;
  const decision = debugTrace.decision;
  const meta = debugTrace.meta;
  const initialMappedDirection =
    decision.winner === "BULL"
      ? "LONG"
      : decision.winner === "BEAR"
        ? "SHORT"
        : "NO_TRADE";
  if (onDirectionFound) {
    onDirectionFound(initialMappedDirection);
  }

  if (meta.reason === "NO_CALIBRATION" || meta.candlesLength === 0) {
    const errorText =
      meta.candlesLength === 0
        ? "No candles detected. Verify clean historical data feed."
        : "Data error: Verify historical series formatting.";
    if (onJudgeLogs) {
      onJudgeLogs({
        judge1: { text: "STANDBY", status: "idle" },
        judge2: { text: "STANDBY", status: "idle" },
        judge3: { text: "STANDBY", status: "idle" },
        judge4: { text: "STANDBY", status: "idle" },
        system: { text: errorText, status: "idle" },
      });
    }
    return {
      analysis: {
        judge: {
          winner: "NO_TRADE",
          decision: "WEAK",
          finalConfidence: 0,
          j1Score: 0,
          j2Score: 0,
          j3Score: 0,
          j4Score: 100,
          ruling: `NO_TRADE — ${errorText}`,
          totalScore: 0,
          tradeDetails: {
            latencyAdjustedForecast: "Signal: NO_TRADE",
            techniquesUsed: "",
            executionTimeMs: performance.now() - t0,
          },
          formattedReport: `┌─────────────────────────────────────┐\n│  ARBITRATOR FINAL VERDICT           │\n│  Signal: NO_TRADE                   │\n│  Confidence: 0%                     │\n├─────────────────────────────────────┤\n│  RULING:                            │\n│  NO_TRADE — No candles detected     │\n│  in feed.                           │\n└─────────────────────────────────────┘`,
        },
        bull: { reasoning: "N/A" },
        bear: { reasoning: "N/A" },
        skeptic: { riskVerdict: "WEAK" },
        techUsedCount: 0,
      },
      direction: "NO_TRADE",
      outcome: "NEUTRAL",
      confidence: 0,
      reason: errorText,
      testModeRightSlice: null,
      finalImageForAnalysis: imageDataUrl,
      entryAnchorBase64: null,
      rawOutcome: "NO_CANDLES_DETECTED",
      frameStable: false,
      actualDirection: null,
      startCandle: undefined,
      threePriorCandles: undefined,
      autoGradeGeometry: undefined,
      splitXPercent: undefined,
    };
  }

  // Predict outcome if testMode
  let outcome: "WIN" | "LOSS" | "NEUTRAL" = "NEUTRAL";
  let testModeRightSlice: string | null = null;
  let finalImageForAnalysis = imageDataUrl;

  let finalDecision = decision;
  let FS = finalDecision.finalScore;
  let entryClose: number | undefined;
  let exitClose: number | undefined;
  let actualDirection: "UP" | "DOWN" | "FLAT" | null = null;
  let candlesCut: number | undefined;
  let splitXPercent: number | null = null;
  let autoGradeGeometry: AutoGradeGeometry | null = null;
  let tempRightPipe: any = null;
  let scalpAddon: any = null;

  if (isTestMode && meta.candlesLength && meta.candlesLength > 5) {
    const tfMinTest = parseDurationToMinutes(params.graphTimeframe);
    const durMinTest = parseDurationToMinutes(activeDuration);

    // User request: Determine the step back purely and directly from the investment duration in minutes.
    // If investment duration is 3 min, move back exactly 3 candles. If 5 min, move back exactly 5 candles.
    const targetCutCount = Math.max(1, Math.round(durMinTest || 3));
    candlesCut = targetCutCount;
    const cropRatio = targetCutCount / meta.candlesLength;

    if (cropRatio < 0.5) {
      const canvas = document.createElement("canvas");
      canvas.width = imgData.width;
      canvas.height = imgData.height;
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(imgData, 0, 0);

      let leftWidth = imgData.width;
      let hasCustomSlice = false;

      const rawCandles = debugTrace?.rawCandles;
      if (rawCandles && Array.isArray(rawCandles) && rawCandles.length > 5) {
        const N = rawCandles.length;
        const entryIndex = N - 1 - targetCutCount;
        if (entryIndex >= 0 && entryIndex < N - 1) {
          const cEntry = rawCandles[entryIndex];
          const cNext = rawCandles[entryIndex + 1];
          if (
            cEntry &&
            cNext &&
            typeof cEntry.xCenter === "number" &&
            typeof cNext.xCenter === "number"
          ) {
            leftWidth = Math.floor((cEntry.xCenter + cNext.xCenter) / 2);
            if (leftWidth > 20 && leftWidth < imgData.width - 20) {
              hasCustomSlice = true;
            }
          }
        }
      }

      if (!hasCustomSlice) {
        const clampedRatio = Math.max(0.05, Math.min(0.4, cropRatio));
        const cutWidth = Math.floor(imgData.width * clampedRatio);
        leftWidth = imgData.width - cutWidth;
      }

      splitXPercent = (leftWidth / imgData.width) * 100;

      const leftCanvas = document.createElement("canvas");
      leftCanvas.width = leftWidth;
      leftCanvas.height = imgData.height;
      leftCanvas
        .getContext("2d")!
        .drawImage(
          canvas,
          0,
          0,
          leftWidth,
          imgData.height,
          0,
          0,
          leftWidth,
          imgData.height,
        );

      const rightWidth = imgData.width - leftWidth;
      const rightCanvas = document.createElement("canvas");
      rightCanvas.width = rightWidth;
      rightCanvas.height = imgData.height;
      rightCanvas
        .getContext("2d")!
        .drawImage(
          canvas,
          leftWidth,
          0,
          rightWidth,
          imgData.height,
          0,
          0,
          rightWidth,
          imgData.height,
        );

      const rightDataUrl = rightCanvas.toDataURL("image/jpeg", 0.5);
      testModeRightSlice = rightDataUrl;

      // Build autoGradeGeometry
      try {
        const rightImgDataRaw = await dataUrlToImageData(rightDataUrl);
        tempRightPipe = buildPipelineResult(rightImgDataRaw);
      } catch (e) {}

      finalImageForAnalysis = leftCanvas.toDataURL("image/jpeg", 0.5);

      canvas.width = 0;
      canvas.height = 0;
      leftCanvas.width = 0;
      leftCanvas.height = 0;
      rightCanvas.width = 0;
      rightCanvas.height = 0;

      const leftImgData = await dataUrlToImageData(finalImageForAnalysis);

      const payloadPromise2 = new Promise<any>((resolve, reject) => {
        messageResolvers.set(msgId, { resolve, reject });
        try {
          w.postMessage({
            type: "ANALYZE",
            msgId,
            imageData: leftImgData,
            livePrice: params.livePrice,
            graphTimeframeMinutes: tfM,
            holdingMinutesVal: durM,
            techniquesList: params.techniquesList,
            isTestMode: true,
            minConfidence: params.minConfidence, // Bug #23 fix: pass user threshold to worker
          });
        } catch (e: any) {
          reject(e);
        }
        params.signal.addEventListener("abort", () => {
          messageResolvers.delete(msgId);
          reject(new Error("Aborted"));
        });
      });

      const payload2 = await payloadPromise2;

      if (payload2.type !== "ERROR") {
        finalDecision =
          payload2.debugTrace?.decision || payload2.decision || finalDecision;
        FS = finalDecision.finalScore || 0;

        const backtestOhlc = debugTrace?.ohlcSeries || [];
        const N_backtest = backtestOhlc.length;
        let triggerCandle: any = null;
        if (N_backtest > 0) {
          const targetCutCount =
            candlesCut !== undefined
              ? candlesCut
              : Math.max(
                  1,
                  Math.round(parseDurationToMinutes(activeDuration) || 3),
                );
          if (N_backtest > targetCutCount) {
            triggerCandle = backtestOhlc[N_backtest - targetCutCount];
          } else {
            triggerCandle = backtestOhlc[N_backtest - 1];
          }
        }
        if (triggerCandle) {
          // In bull candle, the broad bottom is the opening point (open)
          // In bear candle, the broad top is the opening point (open)
          entryClose = triggerCandle.open;
        } else {
          entryClose = finalDecision?.evidence?.lastClose;
        }
        if (N_backtest > 0) {
          exitClose = backtestOhlc[N_backtest - 1].close;
        } else {
          exitClose = decision?.evidence?.lastClose;
        }

        if (tempRightPipe && entryClose !== undefined) {
          autoGradeGeometry = buildAutoGradeGeometry(
            tempRightPipe.ohlcSeries,
            tempRightPipe.meta.candleCentersX || [],
            entryClose,
          );
        }

        if (
          featureFlags.USE_SCALPING_MODE &&
          payload2.debugTrace?.scalpDecision
        ) {
          const scalpDecision = payload2.debugTrace.scalpDecision;
          const pcfg = loadScalpConfig();

          let simulated: any = undefined;
          if (scalpDecision.signal === "BUY" && scalpDecision.plan) {
            const futureCandles = tempRightPipe?.ohlcSeries || [];
            simulated = simulateScalpTrade(
              scalpDecision.plan,
              futureCandles,
              pcfg,
              (entry, exit, size) =>
                computeRoundTripCharges(entry, exit, size, pcfg.instrument),
            );
          }

          scalpAddon = {
            isScalpTrade: true,
            scalpSignal: scalpDecision.signal,
            confluenceScore: scalpDecision.confluenceScore,
            blockers: scalpDecision.blockers,
            features: scalpDecision.features,
            plan: scalpDecision.plan || null,
            outcome: simulated ? simulated.outcome : null,
            exitPrice: simulated ? simulated.exitPrice : null,
            realizedPnL: simulated ? simulated.realizedPnL : null,
            realizedPnLGross: simulated ? simulated.realizedPnLGross : null,
            brokerChargesUsed: simulated ? simulated.brokerChargesUsed : null,
          };

          if (scalpDecision.signal !== "BUY") {
            outcome = "NEUTRAL";
          } else if (simulated) {
            if (simulated.outcome.startsWith("TP")) {
              outcome = "WIN";
            } else if (simulated.outcome.startsWith("SL")) {
              outcome = "LOSS";
            } else if (simulated.outcome === "TRAIL_HIT") {
              outcome =
                simulated.realizedPnLGross > 0
                  ? "WIN"
                  : simulated.realizedPnLGross < 0
                    ? "LOSS"
                    : "NEUTRAL";
            } else {
              outcome =
                simulated.realizedPnLGross > 0
                  ? "WIN"
                  : simulated.realizedPnLGross < 0
                    ? "LOSS"
                    : "NEUTRAL";
            }
          }
        } else if (entryClose !== undefined && exitClose !== undefined) {
          if (exitClose > entryClose) {
            actualDirection = "UP";
          } else if (exitClose < entryClose) {
            actualDirection = "DOWN";
          } else {
            actualDirection = "FLAT";
          }

          if (
            actualDirection === "FLAT" ||
            finalDecision.winner === "NO_TRADE"
          ) {
            outcome = "NEUTRAL";
          } else if (finalDecision.winner === "BULL") {
            outcome = actualDirection === "UP" ? "WIN" : "LOSS";
          } else if (finalDecision.winner === "BEAR") {
            outcome = "NEUTRAL";
          }
        }
      }
    }
  }

  // Populate startCandle and threePriorCandles from the full image detection payload
  const fullOhlc = debugTrace?.ohlcSeries || [];
  const N_ohlc = fullOhlc.length;
  let startCandle: any = null;
  const threePriorCandles: any[] = [];

  if (N_ohlc > 0) {
    const targetCutCount =
      candlesCut !== undefined
        ? candlesCut
        : isTestMode
          ? Math.max(1, Math.round(parseDurationToMinutes(activeDuration) || 3))
          : 1;
    if (isTestMode && N_ohlc > targetCutCount) {
      startCandle = fullOhlc[N_ohlc - targetCutCount];
      for (let idx = 3; idx >= 1; idx--) {
        const pIdx = N_ohlc - targetCutCount - idx;
        if (pIdx >= 0) {
          threePriorCandles.push(fullOhlc[pIdx]);
        }
      }
    } else {
      // Live/standard mode baseline: last candle of the series
      startCandle = fullOhlc[N_ohlc - 1];
      for (let idx = 3; idx >= 1; idx--) {
        const pIdx = N_ohlc - 1 - idx;
        if (pIdx >= 0) {
          threePriorCandles.push(fullOhlc[pIdx]);
        }
      }
    }
  }

  const mappedDirection =
    finalDecision.winner === "BULL"
      ? "LONG"
      : "NO_TRADE";

  const cases = finalDecision.cases || {
    bull: { j1: 0, j2: 0, j3: 0, total: 0 },
    bear: { j1: 0, j2: 0, j3: 0, total: 0 },
  };
  const J1 = cases.bull.j1 + cases.bear.j1;
  const J2 = cases.bull.j2 + cases.bear.j2;
  const J3 = cases.bull.j3 + cases.bear.j3;
  const J4 = finalDecision.skepticMultiplier || 1.0;

  if (onJudgeLogs) {
    onJudgeLogs({
      judge1: {
        text: `Bull Score: ${cases.bull.total.toFixed(1)}`,
        status: "success",
      },
      judge2: {
        text: `Bear Score: ${cases.bear.total.toFixed(1)}`,
        status: "success",
      },
      judge3: {
        text: `Margin: ${finalDecision.margin.toFixed(1)}`,
        status: "success",
      },
      judge4: {
        text: `Skeptic Veto: ${(J4 * 100).toFixed(0)}%`,
        status: "success",
      },
      system: {
        text: `Pipeline: ${(meta.latencyMs || 0).toFixed(0)}ms | Stable: ${frameStable ? "YES" : "NO"}`,
        status: "success",
      },
    });
  }

  const tTotal = performance.now() - t0;

  return {
    ...scalpAddon,
    analysis: {
      ...scalpAddon,
      judge: {
        ...scalpAddon,
        cases: cases,
        winner: finalDecision.winner,
        decision:
          finalDecision.winner === "NO_TRADE" ? "WEAK" : "STRONG SIGNAL",
        finalConfidence: finalDecision.finalConfidence,
        j1Score: J1,
        j2Score: J2,
        j3Score: J3,
        j4Score: finalDecision.skepticPenalty,
        ruling: finalDecision.ruling,
        totalScore: FS,
        evidence: finalDecision.evidence,
        techniquesEvaluation: finalDecision.techniquesEvaluation,
        tradeDetails: {
          latencyAdjustedForecast: `Signal: ${finalDecision.signal}`,
          techniquesUsed: finalDecision.techniquesUsed || "None",
          executionTimeMs: tTotal,
        },
      },
      bull: { reasoning: `Score ${cases.bull.total}` },
      bear: { reasoning: `Score ${cases.bear.total}` },
      skeptic: { riskVerdict: `Multiplier ${J4}` },
      techUsedCount: finalDecision.techUsedCount || 0,
    },
    direction: mappedDirection,
    actualDirection,
    outcome:
      autoGradeGeometry && !autoGradeGeometry.valid ? "NEUTRAL" : outcome,
    confidence: finalDecision.finalConfidence,
    reason:
      autoGradeGeometry && !autoGradeGeometry.valid
        ? `AutoGrade Geometry Invalid: ${autoGradeGeometry.invalidReason}`
        : `Engine completed with finalScore=${FS}`,
    testModeRightSlice,
    finalImageForAnalysis,
    entryAnchorBase64: null,
    rawOutcome:
      autoGradeGeometry && !autoGradeGeometry.valid
        ? "AUTO_GRADE_INVALID"
        : finalDecision.signal,
    frameStable,
    entryClose,
    exitClose,
    candlesCut,
    splitXPercent,
    startCandle,
    threePriorCandles,
    absoluteMin:
      debugTrace?.absoluteMin !== undefined ? debugTrace.absoluteMin : null,
    absoluteMax:
      debugTrace?.absoluteMax !== undefined ? debugTrace.absoluteMax : null,
    ohlcQuality: debugTrace?.meta?.ohlcQuality ?? 'REAL_PRICE',
    autoGradeGeometry,
  };
}
