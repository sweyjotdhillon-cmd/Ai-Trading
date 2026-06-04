export const featureFlags = {
  // Legacy (keep existing values true)
  enableTemporalFiltering: true,
  enableCandlestickRepoPatterns: true,
  enableGapDetection: true,

  // Scalping rollout (Sprint 1+)
  USE_SCALPING_MODE: true,            // master switch; flipped to true
  SHOW_LEGACY_BINARY_UI: false,       // hide legacy binary UI
  ENABLE_RISK_CAPS: true,             // turn on risk caps
  ENABLE_TRAILING_SL: true,           // trailing stop loss enabled
  ENABLE_PARTIAL_TP: true,            // partial take profit enabled
  ENABLE_VWAP_PROXY: true,            // VWAP proxy enabled
  ENABLE_PREDICTABILITY_GATE: true,   // predictability gate enabled
  ENABLE_MARKET_HOURS_GATE: true,     // market hours gate enabled
  ENABLE_BROKER_CHARGES_NET: true,    // net-of-charges P&L enabled
};

export type FeatureFlagKey = keyof typeof featureFlags;

export const isScalping = () => featureFlags.USE_SCALPING_MODE === true;

