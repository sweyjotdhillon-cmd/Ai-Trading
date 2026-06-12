export interface TechniqueCondition {
  field: string;
  operator: string;
  value: any;
  weight: number;
}

export interface TechniqueScoring {
  fullSignalThreshold: number;
  halfSignalThreshold: number;
  minConditionsForSignal: number;
}

export interface TechniqueDef {
  id: number | string;
  name: string;
  requiredFields: string[];
  minCandlesNeeded: number;
  callConditions: TechniqueCondition[];
  putConditions: TechniqueCondition[];
  scoring: TechniqueScoring;
  maxScore: number;
}

export interface ChartAnalysisWindow {
  focusCandles: any[];
  marketContext: {
    volatilityState: string;
    [key: string]: any;
  };
  current?: any;
  prev?: any;
  prev2?: any;
  prev3?: any; // FIX 3: Add optional prev3 field for trailing context
}

export interface TechniqueBreakdown {
  id: number | string;
  name: string;
  status: "EVALUATED" | "SKIPPED";
  bullScore: number;
  bearScore: number;
  bullResult: "SIGNAL_FULL" | "SIGNAL_HALF" | "NEUTRAL";
  bearResult: "SIGNAL_FULL" | "SIGNAL_HALF" | "NEUTRAL";
}

export interface EngineResult {
  verdict: "LONG" | "NO_TRADE";
  bullTotal: number;
  bearTotal: number;
  margin: number;
  bullConfidence: number;
  bearConfidence: number;
  maxPossible: number;
  processed: number;
  skipped: number;
  insufficientTechniques: boolean;
  noTradeReason: "INSUFFICIENT_TECHNIQUES" | "VOLATILE" | "EXACT_TIE" | null;
  techniqueBreakdown: TechniqueBreakdown[];
}

function getFieldValue(obj: any, path: string): any {
  if (!obj) return null;

  // 1. Standard nested path lookup (e.g. "oscillators.rsi")
  const parts = path.split('.');
  let resolved: any = obj;
  let success = true;
  for (const part of parts) {
    if (resolved === null || resolved === undefined) {
      success = false;
      break;
    }
    resolved = resolved[part];
  }
  if (success && resolved !== null && resolved !== undefined && !Number.isNaN(resolved)) {
    return resolved;
  }

  // 2. Normalize path and perform robust scan of object properties
  const cleanPath = path.toLowerCase().replace(/[\s_.-]/g, '');

  if (cleanPath.includes('rsi')) {
    return obj.oscillators?.rsi ?? obj.rsi;
  }
  if (cleanPath.includes('macdsignal') || cleanPath.includes('macdsig')) {
    return obj.oscillators?.macdSignal ?? obj.macdSignal;
  }
  if (cleanPath.includes('macdhist') || cleanPath.includes('macdhistogram') || cleanPath.includes('macdh')) {
    return obj.oscillators?.macdHist ?? obj.macdHist;
  }
  if (cleanPath.includes('macd')) {
    return obj.oscillators?.macdLine ?? obj.macdLine ?? obj.oscillators?.macd ?? obj.macd;
  }
  if (cleanPath.includes('stochk') || cleanPath.includes('stok') || cleanPath.includes('stochastick')) {
    return obj.oscillators?.stochK ?? obj.stochK;
  }
  if (cleanPath.includes('stochd') || cleanPath.includes('stod') || cleanPath.includes('stochasticd')) {
    return obj.oscillators?.stochD ?? obj.stochD;
  }
  if (cleanPath.includes('stoch') || cleanPath.includes('stochastic')) {
    return obj.oscillators?.stochK ?? obj.stochK;
  }
  if (cleanPath.includes('ema9') || cleanPath === 'ema' || cleanPath === 'ema9aboveprice') {
    return obj.ema?.ema9 ?? obj.ema9 ?? (obj.ema?.ema9AbovePrice !== null ? (obj.ema?.ema9AbovePrice ? 1 : 0) : null);
  }
  if (cleanPath.includes('ema21') || cleanPath === 'ema21aboveprice') {
    return obj.ema?.ema21 ?? obj.ema21 ?? (obj.ema?.ema21AbovePrice !== null ? (obj.ema?.ema21AbovePrice ? 1 : 0) : null);
  }
  if (cleanPath.includes('bollingerupper') || cleanPath.includes('bbupper') || cleanPath.includes('upperband') || cleanPath.includes('upper_band') || cleanPath === 'upper') {
    return obj.volatility?.bollingerUpper ?? obj.bollingerUpper ?? obj.volatility?.upper ?? obj.upper;
  }
  if (cleanPath.includes('bollingerlower') || cleanPath.includes('bblower') || cleanPath.includes('lowerband') || cleanPath.includes('lower_band') || cleanPath === 'lower') {
    return obj.volatility?.bollingerLower ?? obj.bollingerLower ?? obj.volatility?.lower ?? obj.lower;
  }
  if (cleanPath.includes('bollingermiddle') || cleanPath.includes('bbmiddle') || cleanPath.includes('middleband') || cleanPath.includes('middle_band') || cleanPath.includes('bollingermid') || cleanPath === 'middle') {
    return obj.volatility?.bollingerMiddle ?? obj.bollingerMiddle ?? obj.volatility?.middle ?? obj.middle;
  }
  if (cleanPath.includes('bollingerwidth') || cleanPath.includes('bbwidth') || cleanPath.includes('bandwidth')) {
    return obj.volatility?.bollingerWidth ?? obj.bollingerWidth ?? obj.volatility?.width ?? obj.width;
  }
  if (cleanPath.includes('bollingerposition') || cleanPath.includes('bbposition')) {
    return obj.volatility?.bollingerPosition ?? obj.bollingerPosition;
  }
  if (cleanPath.includes('atr')) {
    return obj.volatility?.atr ?? obj.atr ?? obj.volatility?.atrEstimate ?? obj.atrEstimate;
  }
  if (cleanPath === 'close') {
    return obj.ohlc?.close ?? obj.close;
  }
  if (cleanPath === 'open') {
    return obj.ohlc?.open ?? obj.open;
  }
  if (cleanPath === 'high') {
    return obj.ohlc?.high ?? obj.high;
  }
  if (cleanPath === 'low') {
    return obj.ohlc?.low ?? obj.low;
  }
  if (cleanPath === 'direction') {
    // FIX 1: Add handler for 'direction' to look into bodyDirection
    return obj?.geometry?.bodyDirection ?? obj?.bodyDirection ?? null;
  }

  if (cleanPath === 'trend') {
    // FIX 2: Check visibleTrend first to match dataExtractor output, with trendState as fallback
    return obj?.marketContext?.visibleTrend
        ?? obj?.visibleTrend
        ?? obj?.trendState
        ?? null;
  }
  if (cleanPath === 'atsupport') {
    // FIX 4: Use boolean nearSupport field instead of non-existent yPercent
    return obj?.marketContext?.nearSupport
        ?? obj?.nearSupport
        ?? null;
  }
  if (cleanPath === 'atresistance') {
    // FIX 4: Use boolean nearResistance field instead of non-existent yPercent
    return obj?.marketContext?.nearResistance
        ?? obj?.nearResistance
        ?? null;
  }

  // 3. Probe inside categories by base name
  const baseName = parts[parts.length - 1];
  if (obj[baseName] !== null && obj[baseName] !== undefined && !Number.isNaN(obj[baseName])) {
    return obj[baseName];
  }

  const subCategories = ['oscillators', 'volatility', 'geometry', 'ema', 'yContext', 'ohlc'];
  for (const cat of subCategories) {
    if (obj[cat] && typeof obj[cat] === 'object') {
      const subVal = obj[cat][baseName];
      if (subVal !== null && subVal !== undefined && !Number.isNaN(subVal)) {
        return subVal;
      }
    }
  }

  // 4. Recursive search fallback
  const findValueIgnoreCase = (source: any, target: string): any => {
    if (!source || typeof source !== 'object') return null;
    for (const key of Object.keys(source)) {
      const normalizedKey = key.toLowerCase().replace(/[\s_.-]/g, '');
      if (normalizedKey === target) {
        return source[key];
      }
      if (source[key] && typeof source[key] === 'object') {
        const nestedVal = findValueIgnoreCase(source[key], target);
        if (nestedVal !== null && nestedVal !== undefined) {
          return nestedVal;
        }
      }
    }
    return null;
  };

  return findValueIgnoreCase(obj, cleanPath);
}

function evaluateCondition(fieldValue: any, operator: string, threshold: any, currentFieldVal?: any, prevFieldVal?: any): boolean {
  if (fieldValue === null || fieldValue === undefined || Number.isNaN(fieldValue)) {
    return false;
  }
  switch (operator) {
    case "<": return fieldValue < threshold;
    case ">": return fieldValue > threshold;
    case "<=": return fieldValue <= threshold;
    case ">=": return fieldValue >= threshold;
    case "==": return fieldValue === threshold;
    case "!=": return fieldValue !== threshold;
    case "CROSS_UP":
      if (currentFieldVal === undefined || prevFieldVal === undefined) return false;
      return currentFieldVal > threshold && prevFieldVal <= threshold;
    case "CROSS_DOWN":
      if (currentFieldVal === undefined || prevFieldVal === undefined) return false;
      return currentFieldVal < threshold && prevFieldVal >= threshold;
    default:
      return false;
  }
}

export function evaluateTechniques(window: ChartAnalysisWindow, techniques: TechniqueDef[]): EngineResult {
  let bullTotal = 0;
  let bearTotal = 0;
  let processed = 0;
  let skipped = 0;
  let maxPossible = 0;
  
  const breakdown: TechniqueBreakdown[] = [];
  
  const focusCandles = window.focusCandles || [];
  const current = window.current || focusCandles.find((c: any) => c.label === 'CURRENT') || focusCandles[focusCandles.length - 1];
  const prev = window.prev || focusCandles.find((c: any) => c.label === 'PREV_1') || focusCandles[focusCandles.length - 2];
  const prev2 = window.prev2 || focusCandles.find((c: any) => c.label === 'PREV_2') || focusCandles[focusCandles.length - 3];
  
  // FIX 3: Define prev3 alongside the other candle references for 3-step trailing comparisons
  const prev3 = window.prev3
    || focusCandles.find((c: any) => c.label === 'PREV_3')
    || focusCandles[focusCandles.length - 4]
    || null;

  for (const technique of techniques) {
    // SKIP CHECK
    let skip = false;
    const totalCandles = window.meta?.totalCandlesVisible || focusCandles.length;
    if (totalCandles < 1) {
      skip = true;
    } else {
      for (const fieldPath of (technique.requiredFields || [])) {
        // We look for required fields in the current candle and window context by default
        let val = getFieldValue(current, fieldPath) ?? getFieldValue(window, fieldPath);
        if (val === null || val === undefined || Number.isNaN(val)) {
          skip = true;
          break;
        }
      }
    }

    if (skip) {
      skipped++;
      breakdown.push({
        id: technique.id,
        name: technique.name,
        status: "SKIPPED",
        bullScore: 0,
        bearScore: 0,
        bullResult: "NEUTRAL",
        bearResult: "NEUTRAL"
      });
      continue;
    }

    let bullScore = 0;
    let bullConditionsMet = 0;
    for (const cond of (technique.callConditions || [])) {
      let passed = false;
      
      const checkConditionForCandle = (candle: any, cCond: any) => {
        const val = getFieldValue(candle, cCond.field);
        const currVal = getFieldValue(current, cCond.field);
        const prevVal = getFieldValue(prev, cCond.field);
        return evaluateCondition(val, cCond.operator, cCond.value, currVal, prevVal);
      };

      // In real life, conditions might specify their target reference
      // but the prompt says: "Resolve the candle reference: current, prev, prev2, any"
      // Since it's usually inside the condition object (e.g. cond.reference), we'll check that.
      const ref = (cond as any).candle || "current";
      
      if (ref === "any") {
        const contextFields = ['trend', 'atresistance', 'atsupport'];
        const fieldNorm = (cond.field || '').toLowerCase().replace(/[\s_.-]/g, '');
        if (contextFields.includes(fieldNorm)) {
          // Resolve against the window directly, not individual candles
          passed = checkConditionForCandle(window, cond);
        } else {
          passed = focusCandles.some(c => checkConditionForCandle(c, cond));
        }
      } else if (ref === "prev") {
        passed = checkConditionForCandle(prev, cond);
      } else if (ref === "prev2") {
        passed = checkConditionForCandle(prev2, cond);
      } else if (ref === "prev3") {
        // FIX 3: Support evaluation against the 3rd prior candle
        passed = prev3 ? checkConditionForCandle(prev3, cond) : false;
      } else {
        passed = checkConditionForCandle(current, cond);
      }

      if (passed) {
        bullScore += cond.weight || 0;
        bullConditionsMet++;
      }
    }

    let bearScore = 0;
    let bearConditionsMet = 0;
    for (const cond of (technique.putConditions || [])) {
      let passed = false;
      
      const checkConditionForCandle = (candle: any, cCond: any) => {
        const val = getFieldValue(candle, cCond.field);
        const currVal = getFieldValue(current, cCond.field);
        const prevVal = getFieldValue(prev, cCond.field);
        return evaluateCondition(val, cCond.operator, cCond.value, currVal, prevVal);
      };

      const ref = (cond as any).candle || "current";
      
      if (ref === "any") {
        const contextFields = ['trend', 'atresistance', 'atsupport'];
        const fieldNorm = (cond.field || '').toLowerCase().replace(/[\s_.-]/g, '');
        if (contextFields.includes(fieldNorm)) {
          // Resolve against the window directly, not individual candles
          passed = checkConditionForCandle(window, cond);
        } else {
          passed = focusCandles.some(c => checkConditionForCandle(c, cond));
        }
      } else if (ref === "prev") {
        passed = checkConditionForCandle(prev, cond);
      } else if (ref === "prev2") {
        passed = checkConditionForCandle(prev2, cond);
      } else if (ref === "prev3") {
        // FIX 3: Support evaluation against the 3rd prior candle
        passed = prev3 ? checkConditionForCandle(prev3, cond) : false;
      } else {
        passed = checkConditionForCandle(current, cond);
      }

      if (passed) {
        bearScore += cond.weight || 0;
        bearConditionsMet++;
      }
    }

    // CLASSIFY RESULT
    let bullResult: "SIGNAL_FULL" | "SIGNAL_HALF" | "NEUTRAL" = "NEUTRAL";
    if (technique.scoring) {
      if (bullScore >= technique.scoring.fullSignalThreshold && bullConditionsMet >= technique.scoring.minConditionsForSignal) {
        bullResult = "SIGNAL_FULL";
        bullTotal += bullScore;
      } else if (bullScore >= technique.scoring.halfSignalThreshold) {
        bullResult = "SIGNAL_HALF";
        bullTotal += bullScore * 0.5;
      }
    }

    let bearResult: "SIGNAL_FULL" | "SIGNAL_HALF" | "NEUTRAL" = "NEUTRAL";
    if (technique.scoring) {
      if (bearScore >= technique.scoring.fullSignalThreshold && bearConditionsMet >= technique.scoring.minConditionsForSignal) {
        bearResult = "SIGNAL_FULL";
        bearTotal += bearScore;
      } else if (bearScore >= technique.scoring.halfSignalThreshold) {
        bearResult = "SIGNAL_HALF";
        bearTotal += bearScore * 0.5;
      }
    }

    if (bullResult !== "NEUTRAL" || bearResult !== "NEUTRAL") {
      maxPossible += technique.scoring?.maxScore ?? 1;
    }
    processed++;
    
    breakdown.push({
      id: technique.id,
      name: technique.name,
      status: "EVALUATED",
      bullScore,
      bearScore,
      bullResult,
      bearResult
    });
  }

  const volatilityRegime = window.marketContext?.volatilityState || "NORMAL";
  
  if (volatilityRegime === "HIGH") {
    bullTotal *= 0.75;
    bearTotal *= 0.75;
    breakdown.forEach(b => {
      b.bullScore *= 0.75;
      b.bearScore *= 0.75;
    });
  }

  const bullConfidence = maxPossible > 0 ? (bullTotal / maxPossible) * 100 : 0;
  const bearConfidence = maxPossible > 0 ? (bearTotal / maxPossible) * 100 : 0;
  const margin = bullTotal - bearTotal;

  let verdict: "LONG" | "NO_TRADE" = "NO_TRADE";
  let noTradeReason: "INSUFFICIENT_TECHNIQUES" | "VOLATILE" | "EXACT_TIE" | null = null;

  if (processed < 1) {
    verdict = "NO_TRADE";
    noTradeReason = "INSUFFICIENT_TECHNIQUES";
  } else if (volatilityRegime === "EXPLOSIVE") {
    verdict = "NO_TRADE";
    noTradeReason = "VOLATILE";
  } else {
    if (bullTotal > bearTotal) {
      verdict = "LONG";
    } else if (bearTotal > bullTotal) {
      verdict = "NO_TRADE";
    } else {
      verdict = "NO_TRADE";
      noTradeReason = "EXACT_TIE";
    }
  }

  return {
    verdict,
    bullTotal,
    bearTotal,
    margin,
    bullConfidence,
    bearConfidence,
    maxPossible,
    processed,
    skipped,
    insufficientTechniques: processed < 1,
    noTradeReason,
    techniqueBreakdown: breakdown
  };
}
