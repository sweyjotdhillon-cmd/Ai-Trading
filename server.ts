import express from "express";
import path from "path";
import cors from "cors";
import crypto from "crypto";
import admin from "firebase-admin";

import fs from 'fs';

// --- Firebase Admin init (verifies real ID tokens server-side) ---
if (!admin.apps.length) {
  let projectId = 'gen-lang-client-0935111175';
  try {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8'));
    if (config.projectId) projectId = config.projectId;
  } catch (e: any) {
    if (e.code !== 'ENOENT') console.warn('Could not read firebase config', e);
  }
  admin.initializeApp({ projectId });
}

const ADMIN_EMAILS = new Set(['kveerpal681@gmail.com', 'aitradinggemini@gmail.com']);

/**
 * Verify a Firebase ID token from the Authorization header.
 * Returns the decoded token if valid and the email is an admin, otherwise throws.
 */
async function verifyAdminToken(authHeader: string | undefined): Promise<admin.auth.DecodedIdToken> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }
  const idToken = authHeader.slice(7);
  const decoded = await admin.auth().verifyIdToken(idToken);
  if (!ADMIN_EMAILS.has(decoded.email ?? '')) {
    throw new Error('Not an admin account');
  }
  return decoded;
}

const MASTER_KEY = crypto.scryptSync(process.env.BACKEND_ENCRYPTION_KEY || 'ai_trading_assistant_secret_salt_2026', 'salt', 32);

function encryptTokens(tokens: string[]): string {
  const text = JSON.stringify(tokens);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', MASTER_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptTokens(encryptedText: string): string[] {
  if (!encryptedText) return [];
  try {
    const textParts = encryptedText.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encrypted = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', MASTER_KEY, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString());
  } catch (e) {
    console.error("Token decryption failed", e);
    return [];
  }
}

// Token cycle manager per request
class TokenManager {
  private tokens: string[] = [];
  private currentIndex: number = 0;
  
  constructor(encryptedString?: string) {
    if (encryptedString) {
      this.tokens = decryptTokens(encryptedString);
    }
  }
  
  getNext(): string | undefined {
    if (this.tokens.length === 0) return process.env.GITHUB_TOKEN;
    const token = this.tokens[this.currentIndex % this.tokens.length];
    this.currentIndex++;
    return token;
  }
  
  hasTokens(): boolean {
    return this.tokens.length > 0;
  }
}


import { 
  calculateCEF, 
  calculateTransferEntropy, 
  calculateVolatilityRegime, 
  calculatePredictability, 
  calculateRobustness,
  calculateWassersteinSimilarity,
  calculateRQA,
  calculatePersistentEntropy,
  calculateHamiltonianFlow,
  calculateBoundaryReversal
} from "./src/utils/mathEngine.ts";

import { BULL_PROMPT, BEAR_PROMPT, JUDGE_PROMPT, SKEPTIC_PROMPT } from "./src/constants/debatePrompts.ts";

import { GoogleGenAI } from "@google/genai";

async function callModel(params: {
  model: string,
  prompt: string,
  image?: string,
  userEndpoint?: string,
  jsonMode?: boolean,
  tokenManager: TokenManager
}) {
  let currentApiKey = params.tokenManager.getNext();
  
  // FALLBACK TO GEMINI if no GitHub keys are provided
  if (!currentApiKey || typeof currentApiKey !== 'string' || currentApiKey.length < 5) {
     if (process.env.GEMINI_API_KEY) {
        console.warn("GitHub Token missing or invalid. Falling back to Gemini...");
        return await callGeminiModel(params);
     }
     throw new Error("GitHub Token is missing. Please add it in Settings.");
  }

  const baseUrl = params.userEndpoint || process.env.GITHUB_API_BASE_URL || "https://models.inference.ai.azure.com";
  // Trim trailing slash and ensure /chat/completions is present
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const endpoint = normalizedBase.includes("/chat/completions") ? normalizedBase : `${normalizedBase}/chat/completions`;

  const payload: any = {
    model: params.model,
    messages: [
      {
        role: "user",
        content: params.image 
          ? [
              { type: "text", text: params.prompt },
              { type: "image_url", image_url: { url: params.image.startsWith("data:") ? params.image : `data:image/jpeg;base64,${params.image}` } }
            ]
          : params.prompt
      }
    ],
    max_tokens: 3000,
  };

  if (params.jsonMode) {
    payload.response_format = { type: "json_object" };
  }

  let networkRetries = 2; // General fetch errors
  let rateLimitRetries = 6; // Increased specifically for GitHub burst limits
  let delay = 3000;

  while (networkRetries >= 0 && rateLimitRetries >= 0) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s per individual call limit
    try {
      const response = await fetch(
        endpoint,
        {
          method: "POST",
          headers: {
             "Authorization": `Bearer ${currentApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        }
      );

    if (response.status === 429) {
      if (rateLimitRetries === 0) {
        throw new Error(`GitHub Models API Rate Limit Exceeded (429) after all retries. Please wait 30+ seconds.`);
      }
      
      // If there are multiple system tokens, cycle the token
      if (params.tokenManager.hasTokens()) {
         console.warn(`Rate limited (429). Switching to next system API token...`);
         currentApiKey = params.tokenManager.getNext();
         if (!currentApiKey) {
           if (process.env.GEMINI_API_KEY) return await callGeminiModel(params);
           throw new Error("No available GitHub tokens to rotate to.");
         }
         // When rotating, try immediately with minimal jitter
         const jitter = 500 + Math.floor(Math.random() * 500);
         await new Promise(resolve => setTimeout(resolve, jitter));
      } else {
         const jitter = 1000 + Math.floor(Math.random() * 3000);
         const totalDelay = Math.min(delay + jitter, 30000); // Cap retry delay at 30 seconds
         console.warn(`Rate limited (429). Retrying in ${totalDelay}ms... (${rateLimitRetries} retries left)`);
         await new Promise(resolve => setTimeout(resolve, totalDelay));
         delay *= 1.5; 
      }
      rateLimitRetries--;
      continue;
    }

    if (!response.ok) {
      const errText = await response.text();
      let errorJson;
      try { errorJson = JSON.parse(errText); } catch { /* ignore parse error */ }
      const msg = errorJson?.error?.message || errorJson?.error || errText || response.statusText;
      console.error(`GitHub API Error (${response.status}):`, msg);
      
      // Handle 401 Unauthorized by cycling tokens if possible
      if (response.status === 401) {
        if (params.tokenManager.hasTokens() && networkRetries > 0) {
           console.warn(`Unauthorized (401). Switching to next system API token...`);
           currentApiKey = params.tokenManager.getNext();
           if (!currentApiKey) {
             if (process.env.GEMINI_API_KEY) return await callGeminiModel(params);
             throw new Error(`GitHub Models API Error (401): Bad credentials. The provided API key is invalid.`);
           }
           networkRetries--;
           continue;
        }
        if (process.env.GEMINI_API_KEY) return await callGeminiModel(params);
        throw new Error(`GitHub Models API Error (401): Bad credentials. The provided API key is invalid.`);
      }

      // If it's a 4xx error (other than 429 or handled 401), don't retry as it's likely a permanent error (e.g. bad prompt/image)
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`GitHub Models API Error: ${msg}`);
      }
      
      // For 5xx errors, allow falling through to catch block for network retry
      throw new Error(`GitHub Models API Temporary Error (${response.status}): ${msg}`);
    }

    const result = await response.json();
    return result.choices[0].message.content || "";
    } catch (err: any) {
      const msg = err?.message || "";
      
      // If the error was explicitly thrown as a persistent 429 or 4xx, rethrow it without using networkRetries
      if (msg.includes("Rate Limit Exceeded") || msg.includes("API Error:")) {
        throw err;
      }

      if (err.name === 'AbortError' || msg.includes('aborted') || msg.includes('abort')) {
        throw new Error("GitHub Models API Request Timed Out (60s call limit reached).");
      }

      if (networkRetries === 0) {
        throw err;
      }
      console.warn(`System noise/Fetch error, retrying (${networkRetries} left):`, err.message);
      // Wait longer for non-429 errors
      await new Promise(resolve => setTimeout(resolve, delay * 2));
      networkRetries--;
      delay *= 1.5;
      continue;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return "";
}

async function callGeminiModel(params: {
  model: string,
  prompt: string,
  image?: string,
  jsonMode?: boolean
}): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const contents = [];
  if (params.image) {
     const mimeType = params.image.startsWith("data:") ? params.image.split(";")[0].split(":")[1] : "image/jpeg";
     const base64Data = params.image.includes(",") ? params.image.split(",")[1] : params.image;
     contents.push({ inlineData: { mimeType, data: base64Data } });
  }
  contents.push({ text: params.prompt });

  const geminiModel = params.model.includes('mini') ? 'gemini-2.5-flash' : 'gemini-2.5-pro';

  const response = await ai.models.generateContent({
    model: geminiModel,
    contents: contents,
    config: {
       responseMimeType: params.jsonMode ? "application/json" : "text/plain",
    }
  });

  return response.text || "";
}

const VISION_EXTRACTION_PROMPT = `
You are an expert financial chart OCR and analysis tool. Analyze the provided candlestick chart with extreme scrutiny. 
Your primary task is to extract high-precision numerical data AND qualitative context for mathematical behavior analysis.

Respond ONLY with a valid JSON object matching this structure exactly:
{
  "recentOHLC": [
    {"index": 0, "open": numeric, "high": numeric, "low": numeric, "close": numeric, "volume_relative": "low|medium|high"}
  ],
  "candleBodies": [list_of_20_approx_body_sizes_in_pixels],
  "currentPrice": numeric_value,
  "priceYPercent": "numeric_percentage_0_to_100 (0 means price is at the very bottom of the chart image, 100 means price is at the very top of the chart image)",
  "keyLevels": [balance_of_supports_and_resistances],
  "marketStage": "ACCUMULATION|TRENDING_UP|DISTRIBUTION|TRENDING_DOWN|VOLATILE_RANGE",
  "anomalyDetected": "string_describing_any_weird_wicks_or_gaps",
  "trendStrength": number_0_to_100,
  "dominantColor": "GREEN|RED|MIXED",
  "priceActionContext": "Detailed description of the LAST 5 candles and their relation to the previous 15"
}

CRITICAL: Do not generalize. If the chart is messy, say it is messy in 'marketStage'. If one candle is 5x bigger than others, note it in 'anomalyDetected'.
`;

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Add process-level error handling to prevent mysterious crashes
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
  });

  app.use(cors({ origin: '*' })); // Keep wildcard cors for now to support AI studio iframes, but reduce limits
  
  // Exception limit for high-bandwidth endpoints like image analysis
  app.use('/api/debate', express.json({ limit: '50mb' }));
  app.use('/api/debate', express.urlencoded({ limit: '50mb', extended: true }));
  app.use('/api/read-outcome', express.json({ limit: '50mb' }));
  app.use('/api/read-outcome', express.urlencoded({ limit: '50mb', extended: true }));

  // Apply a standard 2mb limit globally to prevent broad DoS
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ limit: '2mb', extended: true }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/config", (req, res) => {
    res.json({ 
      hasFirebase: true, 
      serverStatus: "ok"
    });
  });

  app.post("/api/admin/secrets/encrypt", async (req, res) => {
    try {
      await verifyAdminToken(req.headers['authorization'] as string | undefined);
    } catch (e: any) {
      return res.status(403).json({ error: "Unauthorized: " + e.message });
    }
    const { tokens } = req.body;
    if (Array.isArray(tokens)) {
      res.json({ success: true, encryptedTokens: encryptTokens(tokens) });
    } else {
      res.status(400).json({ error: "Invalid tokens payload" });
    }
  });

  app.post("/api/admin/secrets/decrypt", async (req, res) => {
    try {
      await verifyAdminToken(req.headers['authorization'] as string | undefined);
    } catch (e: any) {
      return res.status(403).json({ error: "Unauthorized: " + e.message });
    }
    const { encryptedTokens } = req.body;
    res.json({ tokens: decryptTokens(encryptedTokens) });
  });

  app.post("/api/pre-analysis", async (req, res) => {
    const { priceHistory, correlatedAssets, liquidityMap } = req.body;
    
    try {
      // 1. Structural Priors (CEF & Transfer Entropy)
      let structuralPriors = "No structural data provided.";
      let geometricOracles = "No geometric data provided.";
      let marketGates = {
        volatility: { status: 'UNKNOWN', zScore: 0 },
        predictability: { isPredictable: false, type: 'UNKNOWN' },
        robustness: { robustness: 0, isStable: false }
      };

      if (priceHistory && priceHistory.length > 0) {
        const cef = calculateCEF(priceHistory, liquidityMap || { [priceHistory[priceHistory.length-1]]: 1 });
        
        // Judge 1 & 2 structural analysis

        // New Gates
        const volRegime = calculateVolatilityRegime(priceHistory.map((p: number, i: number) => {
          const prev = priceHistory[i-1] || p;
          const next = priceHistory[i+1] || p;
          // Simulate some range since we only have closes
          const high = Math.max(p, prev, next) * 1.001; 
          const low = Math.min(p, prev, next) * 0.999;
          return { high, low, close: p, prevClose: prev };
        }));
        const predictability = calculatePredictability(priceHistory);
        const robustness = calculateRobustness(priceHistory);

        marketGates = {
          volatility: volRegime,
          predictability,
          robustness
        };

        // Geometric & Physical Oracles
        const rqa = calculateRQA(priceHistory);
        const tda = calculatePersistentEntropy(priceHistory);
        const flow = calculateHamiltonianFlow(priceHistory[priceHistory.length-1], priceHistory[priceHistory.length-1] - (priceHistory[priceHistory.length-2] || priceHistory[priceHistory.length-1]));
        
        // Wasserstein similarity to a "perfect" trend prototype (linear sequence)
        const perfectTrend = Array.from({ length: priceHistory.length }, (_, i) => priceHistory[0] + (priceHistory[priceHistory.length-1] - priceHistory[0]) * (i / (priceHistory.length - 1)));
        const wasserstein = calculateWassersteinSimilarity(priceHistory, perfectTrend);

        geometricOracles = `
- Wasserstein Distance to Trend Prototype: ${wasserstein.toFixed(4)}
- RQA Determinism: ${(rqa.determinism * 100).toFixed(2)}%
- RQA Laminarity: ${(rqa.laminarity * 100).toFixed(2)}%
- Persistent Entropy (TDA): ${tda.entropy.toFixed(4)} (${tda.featureCount} features)
- Hamiltonian Flow (Next 3 steps): ${flow.slice(0, 3).map(f => f.toFixed(2)).join(', ')}
        `.trim();

        let teInfo = "";
        if (correlatedAssets) {
          const influence: Record<string, number> = {};
          for (const [name, prices] of Object.entries(correlatedAssets)) {
            influence[name] = calculateTransferEntropy(prices as number[], priceHistory);
          }
          const leader = Object.entries(influence).sort((a, b) => b[1] - a[1])[0];
          teInfo = leader ? `\n- Transfer Entropy Leader: ${leader[0]} (Influence: ${leader[1].toFixed(4)})` : "";
        }

        structuralPriors = `
- Causal Entropic Force Direction: ${cef.predictedDirection}
- CEF Confidence: ${(cef.confidence * 100).toFixed(2)}%${teInfo}
- Market Physics: Smart money is currently gravitating toward ${cef.predictedDirection === 'UP' ? 'higher' : 'lower'} liquidity zones to maintain future optionality.
- Volatility Regime: ${volRegime.status} (Z-Score: ${volRegime.zScore.toFixed(2)})
- Predictability: ${predictability.type} (Ratio: ${predictability.ratios.combined?.toFixed(2)})
- Signal Robustness: ${(robustness.robustness * 100).toFixed(0)}% Stable
        `.trim();
      }

      res.json({
        structuralPriors,
        geometricOracles,
        marketGates
      });

    } catch (error: any) {
      console.error("Pre-analysis error:", error);
      res.status(500).json({ error: error.message || "Pre-analysis failed" });
    }
  });

  app.post("/api/debate", async (req, res) => {
    const bodySize = JSON.stringify(req.body).length;
    console.log(`[API] Received debate request at ${new Date().toISOString()} - Approx Size: ${(bodySize / 1024 / 1024).toFixed(2)}MB`);
    const { image, symbol, timeframe, investment, structuralPriors, geometricOracles, techniqueData, encryptedSystemTokens } = req.body;
    const tokenManager = new TokenManager(encryptedSystemTokens);
    
    if (!image) {
      console.error("[API] Missing image in request body");
      return res.status(400).json({ error: "Missing image data" });
    }
    
    // Prompt Injection Protection: Sanitize user bounds
    const safeSymbol = (symbol || "Unknown").replace(/[\n\r]/g, ' ');
    const safeTimeframe = (timeframe || "").replace(/[\n\r]/g, ' ');
    const safeDuration = (investment?.duration || "").replace(/[\n\r]/g, ' ');
    const safeAmount = (investment?.amount || "").replace(/[\n\r]/g, ' ');

    // session context
    const binaryContext = `\nESSENTIAL BINARY CONTEXT:\nAsset Symbol: ${safeSymbol}\nGraph Timeframe: ${safeTimeframe}\nInvestment Duration: ${safeDuration}\nInvestment Amount: $${safeAmount}\n`;
    const techContext = techniqueData && Array.isArray(techniqueData) 
      ? `\nTECHNIQUES AVAILABLE:\n${techniqueData.map((t) => `- ${t}`).join('\n')}`
      : (techniqueData ? `\nTECHNIQUES AVAILABLE:\n${JSON.stringify(techniqueData, null, 2)}` : "None specific provided.");

    try {
      const optimizedBase64 = image.replace(/^data:image\/\w+;base64,/, "");

      // Helper function for serial model calls with timeout and model fallback
      const safeCall = async (prompt: string, img?: string, json: boolean = true, highReasoning: boolean = false) => {
        // Fallback chain for vision vs reasoning
        const modelChain = highReasoning 
          ? ["gpt-4o", "gpt-4o-mini", "Llama-3.2-90B-Vision-Instruct"] 
          : ["gpt-4o-mini", "Llama-3.2-90B-Vision-Instruct", "gpt-4o"];

        let lastError = "";

        for (const modelName of modelChain) {
          try {
            const raw = await callModel({ 
              model: modelName, 
              prompt, 
              image: img, 
              jsonMode: json,
              tokenManager
            });
            if (!raw) continue;
            
            // Enhanced cleanup
            const clean = raw.replace(/```json|```/g, '').trim();
            if (json) {
              const start = clean.indexOf('{');
              const end = clean.lastIndexOf('}');
              if (start !== -1 && end !== -1) {
                return clean.substring(start, end + 1);
              }
            }
            return clean;
          } catch (e: any) {
            lastError = e.message;
            console.warn(`[DEBATE] Call failed for model ${modelName}, trying next... :`, e.message);
            // Immediately try fallback model without long artificial wait
          }
        }

        console.error(`[DEBATE] All models in chain failed. Last error: ${lastError}`);
        return null;
      };

      // 1. Vision Extractions (Primary only)
      const visionResults = await Promise.allSettled([
        safeCall(VISION_EXTRACTION_PROMPT, optimizedBase64)
      ]);

      const visionExtractionRaw = visionResults[0].status === 'fulfilled' ? visionResults[0].value : null;

      if (!visionExtractionRaw) {
        console.error("[DEBATE] CRITICAL: Vision extraction returned null.");
        throw new Error("Vision extraction failed. The chart screenshot might be too blurry or the API is under heavy load. Please try a clearer screenshot.");
      }

      let extractedData: any = {};
      try {
        extractedData = JSON.parse(visionExtractionRaw);
      } catch {
        console.warn("Failed to parse chartData, using fallback defaults");
        extractedData = { recentOHLC: [], keyLevels: [], currentPrice: 0 };
      }

      // Calculate Math-Based Scores
      const ohlc = (extractedData.recentOHLC || []).map((c: any) => ({
        open: Number(c.open || 0),
        close: Number(c.close || 0),
        high: Number(c.high || 0),
        low: Number(c.low || 0)
      }));

      let bodies = extractedData.candleBodies || [];
      if (bodies.length > 0 && typeof bodies[0] === 'number') {
        bodies = bodies.map((b: number) => ({ open: 0, close: b, high: b, low: 0 }));
      }
      
      const boundaryResult = calculateBoundaryReversal(Number(extractedData.priceYPercent || 50), ohlc);

      // --- NEW: Calculate Advanced Metrics from Vision Data ---
      let visionStructuralPriors = structuralPriors || "";
      let visionGeometricOracles = geometricOracles || "";
      
      const priceHistory = ohlc.map(c => c.close);
      if (priceHistory.length >= 10) {
        // BUILD A REAL LIQUIDITY MAP from keyLevels
        const liquidityMap: Record<number, number> = {};
        (extractedData.keyLevels || []).forEach((lvl: any) => {
          const l = Number(lvl);
          if (!isNaN(l)) {
            liquidityMap[l] = (liquidityMap[l] || 0) + 1;
          }
        });
        
        // Ensure there's at least some data if keyLevels is empty
        if (Object.keys(liquidityMap).length === 0) {
          liquidityMap[priceHistory[priceHistory.length - 1]] = 1;
          // Add a few points above and below to give the simulation room
          const range = Math.max(...priceHistory) - Math.min(...priceHistory) || priceHistory[0] * 0.01;
          liquidityMap[priceHistory[priceHistory.length - 1] + range * 0.02] = 0.5;
          liquidityMap[priceHistory[priceHistory.length - 1] - range * 0.02] = 0.5;
        }

        const cef = calculateCEF(priceHistory, liquidityMap);
        const cefDirSymbol = cef.predictedDirection === 'UP' ? '▲' : '▼';
        const cefConfidenceText = cef.confidence > 0.4 ? "Strongly Suggests" : (cef.confidence > 0.1 ? "Leans Toward" : "Neutral/Unclear (Ambiguous)");

        const volRegime = calculateVolatilityRegime(ohlc.map((c, i) => ({
          high: c.high, low: c.low, close: c.close, prevClose: ohlc[i-1]?.close || c.close
        })));
        const predictability = calculatePredictability(priceHistory);
        const robustness = calculateRobustness(priceHistory);
        
        const rqa = calculateRQA(priceHistory);
        const tda = calculatePersistentEntropy(priceHistory);
        const flow = calculateHamiltonianFlow(priceHistory[priceHistory.length-1], priceHistory[priceHistory.length-1] - (priceHistory[priceHistory.length-2] || priceHistory[priceHistory.length-1]));
        const perfectTrend = Array.from({ length: priceHistory.length }, (_, i) => priceHistory[0] + (priceHistory[priceHistory.length-1] - priceHistory[0]) * (i / (priceHistory.length - 1)));
        const wasserstein = calculateWassersteinSimilarity(priceHistory, perfectTrend);

        visionGeometricOracles = `
- Wasserstein Distance to Trend Prototype: ${wasserstein.toFixed(4)}
- RQA Determinism: ${(rqa.determinism * 100).toFixed(2)}%
- RQA Laminarity: ${(rqa.laminarity * 100).toFixed(2)}%
- Persistent Entropy (TDA): ${tda.entropy.toFixed(4)} (${tda.featureCount} features)
- Hamiltonian Flow (Next 3 steps): ${flow.slice(0, 3).map(f => f.toFixed(2)).join(', ')}
        `.trim();

        visionStructuralPriors = `
- Causal Entropic Force (CEF): ${cefDirSymbol} ${cef.predictedDirection} (${cefConfidenceText})
- CEF Confidence Score: ${(cef.confidence * 100).toFixed(2)}%
- Market Physics: Smart money ${cef.confidence > 0.1 ? `gravitating toward ${cef.predictedDirection === 'UP' ? 'higher' : 'lower'} liquidity` : 'is currently in a high-entropy state with no clear gravitational bias'}.
- Volatility Regime: ${volRegime.status} (Z-Score: ${volRegime.zScore.toFixed(2)})
- Predictability: ${predictability.type} (Ratio: ${predictability.ratios.combined?.toFixed(2)})
- Signal Robustness: ${(robustness.robustness * 100).toFixed(0)}% Stable
- Chart Boundary: ${boundaryResult.label} (Position: ${boundaryResult.yPercent.toFixed(1)}%)
        `.trim();
      }

      const statScoresContext = `
JUDGE 4 (Boundary Reversal) Bias: ${boundaryResult.label} -> ALREADY CALCULATED POINTS: Bull Gets +${boundaryResult.bullPoints.toFixed(1)}, Bear Gets +${boundaryResult.bearPoints.toFixed(1)}
`;

      // 2. Run Bull, Bear, and Skeptic in parallel
      const dataContext = `\nEXTRACTED CHART DATA (JSON):\n${visionExtractionRaw}${techContext}${binaryContext}`;
      const isHighReq = true;

      const bullPrompt = BULL_PROMPT.replace('{{STRUCTURAL_PRIORS}}', visionStructuralPriors) + dataContext;
      const bearPrompt = BEAR_PROMPT.replace('{{STRUCTURAL_PRIORS}}', visionStructuralPriors) + dataContext;
      const skepticPrompt = SKEPTIC_PROMPT + `\nGEOMETRIC ORACLES: ${visionGeometricOracles}` + dataContext;

      // Parallelize core arguments with INCREASED STAGGERED starts to avoid burst rate limits
      const agentResults = await Promise.allSettled([
        (async () => {
          try {
            return await safeCall(bullPrompt, undefined, true, isHighReq);
          } catch (e) {
            console.error("[DEBATE] Bull Agent failed permanently:", e);
            return null;
          }
        })(),
        (async () => {
          try {
            await new Promise(r => setTimeout(r, 6000)); // 6s stagger
            return await safeCall(bearPrompt, undefined, true, isHighReq);
          } catch (e) {
            console.error("[DEBATE] Bear Agent failed permanently:", e);
            return null;
          }
        })(),
        (async () => {
          try {
            await new Promise(r => setTimeout(r, 12000)); // 12s stagger
            return await safeCall(skepticPrompt, undefined, true, isHighReq);
          } catch (e) {
            console.error("[DEBATE] Skeptic Agent failed permanently:", e);
            return null;
          }
        })()
      ]);

      const bullRaw = agentResults[0].status === 'fulfilled' ? agentResults[0].value : null;
      const bearRaw = agentResults[1].status === 'fulfilled' ? agentResults[1].value : null;
      const skepticRaw = agentResults[2].status === 'fulfilled' ? agentResults[2].value : null;

      const parseResponse = (raw: string | null) => {
        if (!raw) return { reasoning: "Model call failed.", flippedSignal: "UNKNOWN", riskVerdict: "RISK UNKNOWN", riskProbability: 50 };
        try {
           // Advanced clean up: remove markdown then find the first { and last }
           const text = raw.replace(/```json|```/g, '').trim();
           const start = text.indexOf('{');
           const end = text.lastIndexOf('}');
           
           let jsonStr = text;
           if (start !== -1 && end !== -1) {
             jsonStr = text.substring(start, end + 1);
           }
           
           return JSON.parse(jsonStr);
        } catch {
           console.error("Parse failure on raw text:", (raw || "").substring(0, 100));
           // Try to find the winner manually as a last resort
           const winner = (raw || "").match(/winner["\s:]+["']?(BULL|BEAR|NO_TRADE)["']?/i)?.[1]?.toUpperCase();
           const signal = (raw || "").match(/signal["\s:]+["']?(CALL|PUT|NO TRADE)["']?/i)?.[1]?.toUpperCase();
           
           return { 
             reasoning: "Parsing failed, but extracted signal.", 
             winner: winner || "NO_TRADE", 
             tradeDetails: { signal: signal || "UNKNOWN" },
             flippedSignal: "UNKNOWN", 
             riskVerdict: "RISK UNKNOWN",
             riskProbability: 50
           };
        }
      };

      const bull = parseResponse(bullRaw);
      const bear = parseResponse(bearRaw);
      const skeptic = parseResponse(skepticRaw);

      // 3. Final Arbitrator Call
      const judgePrompt = JUDGE_PROMPT
        .replace('{{STRUCTURAL_PRIORS}}', visionStructuralPriors)
        .replace('{{TECHNIQUES}}', techContext)
        .replace('{{STAT_SCORES}}', statScoresContext)
        .replace('{{GEOMETRIC_ORACLES}}', visionGeometricOracles) + 
        `\n\nAGENT BULL ARGUMENT: ${bull.reasoning}\nBULL TECHNIQUES: ${bull.techniquesApplied?.join(', ') || 'None provided'}\n\nAGENT BEAR ARGUMENT: ${bear.reasoning}\nBEAR TECHNIQUES: ${bear.techniquesApplied?.join(', ') || 'None provided'}\n\nRISK ANALYST REPORT: ${skeptic.riskVerdict} (${skeptic.riskProbability}%)\n` + 
        dataContext;

      const judgeRaw = await safeCall(judgePrompt, undefined, true, true);
      const judge = parseResponse(judgeRaw);

      // ENFORCE MATHEMATICAL CONSISTENCY
      // If the LLM declared a winner that actually has a lower score, we correct it to match the math.
      if (judge && judge.cases && (judge.winner === 'BULL' || judge.winner === 'BEAR')) {
        const calculateTotal = (data: any) => {
          return Number(data.j1 || 0) + Number(data.j2 || 0) + Number(data.j4 || 0);
        };

        const bullComputed = calculateTotal(judge.cases.bull);
        const bearComputed = calculateTotal(judge.cases.bear);
        
        // Update totals to be accurate
        if (judge.cases.bull) judge.cases.bull.total = bullComputed;
        if (judge.cases.bear) judge.cases.bear.total = bearComputed;

        if (judge.winner === 'BULL' && bearComputed > bullComputed) {
           console.warn(`[ARBITRATOR] Inconsistency corrected: BEAR (${bearComputed}) > BULL (${bullComputed}) but LLM chose BULL. Swapping winner to BEAR.`);
           judge.winner = 'BEAR';
           if (judge.tradeDetails) judge.tradeDetails.signal = 'PUT';
        } else if (judge.winner === 'BEAR' && bullComputed > bearComputed) {
           console.warn(`[ARBITRATOR] Inconsistency corrected: BULL (${bullComputed}) > BEAR (${bearComputed}) but LLM chose BEAR. Swapping winner to BULL.`);
           judge.winner = 'BULL';
           if (judge.tradeDetails) judge.tradeDetails.signal = 'CALL';
        }
      }

      // Count techniques explicitly listed by scanning the markdown list format
      const techUsed = judge.tradeDetails?.techniquesUsed || "";
      const techUsedCount = techUsed.split('\n').filter((line: string) => line.trim().startsWith('-') || line.trim().startsWith('*')).length;

      res.json({
        bull,
        bear,
        skeptic,
        mirror: { reasoning: "Mirror check disabled." },
        judge,
        techUsedCount,
        structuralPriors: visionStructuralPriors,
        geometricOracles: visionGeometricOracles
      });
    } catch (error: any) {
      console.error("Debate error:", error);
      res.status(500).json({ error: error.message || "Debate failed" });
    }
  });

  app.post("/api/read-outcome", async (req, res) => {
    try {
      const { image, encryptedSystemTokens } = req.body;
      const tokenManager = new TokenManager(encryptedSystemTokens);
      if (!image) {
        return res.status(400).json({ error: "Missing image data" });
      }

      const optimizedBase64 = image.replace(/^data:image\/\w+;base64,/, "");

      const prompt = `You are a strict binary-options trade grader.

The image shows two regions stitched together left-to-right:
  • LEFT region (~15% of width): the ENTRY candle — this is the price the
    trader entered at.
  • RIGHT region (~85% of width): the FUTURE candles after entry.

Your ONLY job: decide whether the CLOSING price of the LAST candle on the
far right is HIGHER or LOWER than the CLOSING price of the entry candle
on the far left.

Rules:
- HIGHER right close   -> "UP"
- LOWER  right close   -> "DOWN"
- Identical to the pixel (extremely rare) -> "FLAT"
- Even a 1-pixel difference counts. "FLAT" is forbidden unless the two
  closes are visually indistinguishable.
- Ignore wicks. Use candle BODY closes only.
- Ignore grid lines, watermarks, axis labels, tooltips.

Return STRICT JSON:
{
  "outcome": "UP" | "DOWN" | "FLAT",
  "confidence": 0-100,
  "entryY": approximate y-pixel of entry close,
  "exitY": approximate y-pixel of last candle close,
  "reason": "short visual explanation"
}`;

      const response = await callModel({
        model: "gpt-4o",
        prompt,
        image: optimizedBase64,
        jsonMode: true,
        tokenManager
      });

      let parsed: any;
      try {
        parsed = JSON.parse(response.replace(/```json|```/g, '').trim());
      } catch {
        parsed = { outcome: 'FLAT', confidence: 0, reason: 'Parser failure' };
      }

      let outcome = ['UP','DOWN','FLAT'].includes(parsed.outcome) ? parsed.outcome : 'FLAT';
      const confidenceNum = Number(parsed.confidence) || 0;

      // Pixel-coordinate fallback: if model gave us entryY/exitY we can derive
      // outcome geometrically even when it said FLAT.
      if ((outcome === 'FLAT' || confidenceNum < 30) &&
          typeof parsed.entryY === 'number' && typeof parsed.exitY === 'number' &&
          Math.abs(parsed.entryY - parsed.exitY) > 4) {
        // In screen coords, smaller Y = higher price.
        outcome = parsed.exitY < parsed.entryY ? 'UP' : 'DOWN';
      }

      // Final inconclusive only if we STILL have nothing
      const isInconclusive = outcome === 'FLAT' && confidenceNum < 30;

      console.log(`[ReadOutcome] outcome=${outcome} conf=${confidenceNum} ` +
                  `entryY=${parsed.entryY} exitY=${parsed.exitY} inc=${isInconclusive}`);

      return res.json({
        outcome: isInconclusive ? 'INCONCLUSIVE' : outcome,
        rawOutcome: outcome,
        confidence: confidenceNum,
        reason: parsed.reason || ''
      });
    } catch (error: any) {
      console.error("Read outcome error:", error);
      res.status(500).json({ error: error.message || "Read outcome failed" });
    }
  });

  app.post("/api/scout", async (req, res) => {
    try {
      const { image, anchorThesis, encryptedSystemTokens } = req.body;
      const tokenManager = new TokenManager(encryptedSystemTokens);
      if (!image || !anchorThesis) return res.status(400).json({ error: "Missing image or thesis" });
      
      const prompt = `
      Perform a precision analysis of the micro-movements on the right edge of this chart.
      
      ANCHOR THESIS:
      ${anchorThesis}
      
      CRITICAL FOCUS:
      - Detect "Micro-Noise": Is the price wiggling indecisively? 
      - Detect "Late Candle Weakness": Are wicks forming against the thesis?
      - Detect "Opposite Spikes": Is there a sudden counter-move?
      
      ACTIONS:
      - "ABORT": Thesis is invalidated by a strong opposite move or spike.
      - "WAIT": Conditions are noisy/volatile; wait for the current candle to settle before entry.
      - "BUILD": Price action perfectly confirms thesis with strong momentum.
      - "HOLD": Neutral but still valid.
      - "EXIT": Trend is slowing down, prepare to wrap up.

      Respond ONLY with a valid JSON object:
      {
        "action": "ABORT" | "WAIT" | "BUILD" | "HOLD" | "EXIT",
        "reason": "1 short sentence explaining why (e.g., 'Late wick forming', 'Indecisive noise')"
      }
      `;

      // We use gpt-4o to prevent 401 errors on restrictive tokens
      const rawResponse = await callModel({
        model: "gpt-4o",
        prompt,
        image,
        jsonMode: true,
        tokenManager
      });

      if (!rawResponse) {
        throw new Error("Scout model returned empty response");
      }

      let cleanRaw = rawResponse.replace(/```json|```/g, '').trim();
      const start = cleanRaw.indexOf('{');
      const end = cleanRaw.lastIndexOf('}');
      if (start !== -1 && end !== -1) cleanRaw = cleanRaw.substring(start, end + 1);

      try {
        res.json(JSON.parse(cleanRaw));
      } catch {
        console.error("Scout JSON parse failed:", cleanRaw);
        res.json({ action: "HOLD", reason: "Analysis temporarily unavailable (Syncing...)" });
      }
    } catch (error: any) {
      console.error("Scout error:", error);
      res.status(500).json({ error: "Scout processing failed", details: error.message });
    }
  });

  app.post("/api/autopsy", async (req, res) => {
    try {
      const { image, debateData, tradeSignal, encryptedSystemTokens } = req.body;
      const tokenManager = new TokenManager(encryptedSystemTokens);
      if (!image || !debateData) return res.status(400).json({ error: "Missing inputs" });
      
      const prompt = `
You are the CONTRARIAN AUTOPSY JUDGE. A binary options signal was issued and the market 
moved AGAINST it (confirmed LOSS). The original Judge agent already scored Bull vs Bear 
using J1 (Argument Quality), J2 (Context Alignment), J4 (Boundary Reversal) and declared 
a winner.

YOUR ROLE IS NOT TO AGREE WITH THE LOSS. 
YOUR ROLE IS TO BUILD THE STRONGEST POSSIBLE CASE THAT THE ORIGINAL JUDGE WAS WRONG — 
even when the loss outcome seems to confirm the Judge was already wrong, you must still 
argue contrarian to the Judge's REASONING (not the outcome). In other words:

  • If the Judge said BULL won (CALL) and price went down -> argue that BEAR was actually 
    the correct read AND that the Judge's J1/J2/J4 reasoning for picking BULL was flawed.
  • If the Judge said BEAR won (PUT) and price went up -> argue that BULL was the correct 
    read AND expose the flaws in the bearish reasoning.
  • If the Judge said NO_TRADE but a directional move occurred -> argue which direction 
    SHOULD have been called and why the Judge's caution was misplaced.

You are the loyal opposition. You are forbidden from agreeing with the original Judge's 
ruling. You MUST attack it with specific evidence from the post-trade chart.

────────────────────────────────────────
INPUTS YOU RECEIVE
────────────────────────────────────────
1. Original Judge verdict + Bull/Bear reasoning + Skeptic report (JSON below).
2. The post-trade chart image showing what actually happened.
3. The trade signal that was issued: ${tradeSignal}

────────────────────────────────────────
WHAT YOU MUST PRODUCE
────────────────────────────────────────
A counter-verdict mirroring the Judge's own scoring schema, but with the OPPOSITE winner.

For each of the 7 forensic categories below, you must phrase the explanation as a 
DIRECT REBUTTAL to the original Judge's logic. Severity = how badly the Judge was wrong 
on that axis (0 = Judge was fine here, 3 = Judge was catastrophically wrong here).

CATEGORY 1 — VISION EXTRACTION (rebut what the Judge "saw")
Argue that the Judge mis-read specific candles/levels. Cite exact wick ratios, 
candle positions, and what the chart ACTUALLY shows now in hindsight.

CATEGORY 2 — CEF / MATH ORACLE MISFIRE (rebut the math priors)
Argue that the Hamiltonian Flow / Wasserstein / RQA values supported the OPPOSITE 
direction and the Judge ignored or misweighted them.

CATEGORY 3 — J4 BOUNDARY REVERSAL (rebut J4 points)
Argue that the J4 boundary points were assigned to the wrong side, OR that the 
Y-coordinate logic was inverted given how price actually behaved.

CATEGORY 4 — JUDGE SCORING BIAS on J1/J2 (the core attack)
This is your strongest weapon. Argue that the J1 (Argument Quality) and J2 
(Context Alignment) points awarded to the original winner should have gone to 
the LOSING side. Reassign points: "J1 should have been Bull 3.5 / Bear 1.5 instead 
of Bull 1.0 / Bear 3.0".

CATEGORY 5 — AGENT ARGUMENT WEAKNESS (rebut the winning agent)
Argue that the winning agent's reasoning was generic, lazy, or template-like, 
and that the LOSING agent actually cited stronger candle-specific evidence.

CATEGORY 6 — MARKET CONDITION MISREAD
Argue that the market was actually the opposite regime than what was reported 
(if Judge said CLEAN, argue CHOPPY/FLAT or vice versa) and how this flipped the call.

CATEGORY 7 — LATENCY / TIMING REBUTTAL
Argue that the 90-second projected forecast was directionally inverted relative 
to what would have been correct.

────────────────────────────────────────
CONTRARIAN VERDICT (MANDATORY)
────────────────────────────────────────
You must produce a counterVerdict object that flips the Judge's call:

  • If Judge said CALL  -> contrarianSignal = "PUT"
  • If Judge said PUT   -> contrarianSignal = "CALL"
  • If Judge said NO TRADE -> contrarianSignal = whichever direction the post-trade 
    chart shows was actually correct ("CALL" or "PUT").

You must also re-score the Bull and Bear cases with INVERTED bias. The contrarian total 
for the side the Judge dismissed must be HIGHER than the side the Judge picked.

────────────────────────────────────────
OUTPUT — STRICT JSON ONLY, NO PREAMBLE
────────────────────────────────────────
{
  "tradeSignal": "${tradeSignal}",
  "actualOutcome": "Brief description of what price actually did",

  "contrarianSignal": "CALL" | "PUT",
  "contrarianConfidence": number (0-100),
  "contrarianRuling": "2-4 sentence rebuttal of the original Judge's verdict, citing the strongest counter-evidence from the post-trade chart",

  "rebutScores": {
    "originalJudge":   { "j1": number, "j2": number, "j4": number, "total": number, "winner": "BULL" | "BEAR" | "NO_TRADE" },
    "contrarianJudge": { "j1": number, "j2": number, "j4": number, "total": number, "winner": "BULL" | "BEAR" }
  },

  "judgeFlaws": [
    "Specific flaw #1 in the original Judge's reasoning (must reference J1, J2, J4 or technique selection)",
    "Specific flaw #2 ...",
    "Specific flaw #3 ..."
  ],

  "categories": {
    "visionExtraction":        { "severity": 0, "label": "Vision Rebuttal",        "explanation": "Direct rebuttal of what the Judge claimed to see" },
    "mathOracleMisfire":       { "severity": 0, "label": "Math Oracle Rebuttal",   "explanation": "Why the math priors actually supported the opposite side" },
    "j4BoundaryError":         { "severity": 0, "label": "J4 Inversion",            "explanation": "Why J4 points were on the wrong side" },
    "judgeScoringBias":        { "severity": 0, "label": "J1/J2 Score Reversal",    "explanation": "How J1/J2 should have been distributed" },
    "agentArgumentWeakness":   { "severity": 0, "label": "Winning Agent Was Weak",  "explanation": "Why the LOSING agent had the better argument" },
    "marketConditionMismatch": { "severity": 0, "label": "Market Regime Misread",   "explanation": "Why the market was actually a different regime" },
    "latencyTimingMismatch":   { "severity": 0, "label": "Latency Inversion",       "explanation": "Why the 90s forecast was directionally wrong" }
  },

  "primaryRootCause": ["judgeScoringBias"],
  "systemRecommendation": "ONE concrete fix: name the exact prompt section, function, or scoring rule in JUDGE_PROMPT / debatePrompts.ts that allowed this misjudgement",
  "autopsyVerdict": "2-3 sentence plain-English contrarian summary stating WHY the Judge was wrong and what direction was actually correct"
}

────────────────────────────────────────
HARD RULES
────────────────────────────────────────
• You are FORBIDDEN from agreeing with the original Judge's winner. contrarianJudge.winner 
  MUST differ from originalJudge.winner (unless originalJudge.winner was NO_TRADE — then 
  pick CALL or PUT based on the post-trade chart).
• Cite SPECIFIC candle evidence from the result image (wick ratios, level rejections, 
  position numbers). No generic statements.
• Severity scores must reflect how badly each layer of the Judge's logic failed, NOT 
  whether the trade lost.
• rebutScores.contrarianJudge.total MUST be greater than rebutScores.originalJudge.total 
  for the side you are championing.

────────────────────────────────────────
ORIGINAL DEBATE DATA (the thing you are arguing AGAINST):
────────────────────────────────────────
${JSON.stringify(debateData, null, 2)}
`;

      const rawResponse = await callModel({
        model: "gpt-4o",
        prompt,
        image,
        jsonMode: true,
        tokenManager
      });

      if (!rawResponse) throw new Error("Empty response from AI");
      
      let cleanRaw = rawResponse.replace(/```json|```/g, '').trim();
      const start = cleanRaw.indexOf('{');
      const end = cleanRaw.lastIndexOf('}');
      if (start !== -1 && end !== -1) cleanRaw = cleanRaw.substring(start, end + 1);

      res.json(JSON.parse(cleanRaw));
    } catch (error: any) {
      console.error("Autopsy error:", error);
      res.status(500).json({ error: "Autopsy failed", details: error.message });
    }
  });

  app.post("/api/log-autopsy", async (req, res) => {
    try {
      console.log("[Sheety Log Mock] Received autopsy log:", req.body);
      // Mocking sheety response
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Catch-all for unhandled API routes to prevent fallback to HTML index
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.url} not found on this server.` });
  });

  // Global Error Handler (Keep at bottom of API routes, before Vite/Static)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Server Error:", err);
    if (err instanceof SyntaxError && 'status' in err && 'body' in err) {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }
    res.status(err.status || 500).json({ 
      error: err.message || "Internal Server Error",
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite middleware...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      console.log('Hitting SSR fallback for', req.originalUrl);
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).send(template);
      } catch (e: any) {
        console.error('SSR error', e);
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), 'dist');
    console.log(`Serving static files from: ${distPath}`);
    app.use(express.static(distPath));
    app.use((req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      res.sendFile(indexPath);
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
  
  // Dramatically increase Node timeouts to prevent "Failed to fetch" socket hangups.
  // The frontend will gracefully abort at 300s, so the backend should comfortably outlast that.
  server.timeout = 360000;
  server.keepAliveTimeout = 360000;
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
