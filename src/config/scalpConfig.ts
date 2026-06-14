import { ScalpConfig } from '../types';

export function getDefaultScalpConfig(): ScalpConfig {
  return {
    capitalRupees: 100000,
    riskPerTradePct: 1.0,
    maxPositionPctCapital: 30,
    leverage: 1,
    instrument: 'EQUITY_INTRADAY',
    lotSize: 1,
    investmentPerTrade: 10000,
    rrRatioChoice: 2,
    useConfidenceThreshold: true,
    maxConcurrentTrades: 1,
    slMode: 'AUTO',
    atrMultiplierSL: 1.2,
    slPercent: 0.4,
    tpMode: 'PARTIAL_RR',
    rrRatio: 2.0,
    tp1RMultiple: 1.0,
    trailMultiplier: 1.5,
    minConfluence: 5,
    minRR: 1.5,
    longOnly: true,
    enableMarketHoursGate: false,
    enablePredictabilityGate: true,
    risk: {
      dailyLossCapRupees: 2000,
      maxTradesPerDay: 10,
      maxConsecutiveLosses: 3,
      cooldownMinutes: 15,
      slippageTicks: 1,
    },
    maxHoldingMinutes: 5,
  };
}

export function loadScalpConfig(): ScalpConfig {
  if (typeof window === 'undefined') return getDefaultScalpConfig();
  try {
    const raw = localStorage.getItem('chartlens_scalp_config_v1');
    if (!raw) return getDefaultScalpConfig();
    return JSON.parse(raw);
  } catch {
    return getDefaultScalpConfig();
  }
}
