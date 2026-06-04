export const NSE_LOT_SIZES: Record<string, number> = {
  NIFTY: 75,         // 2025 lot size – update if SEBI changes
  BANKNIFTY: 30,
  FINNIFTY: 65,
  MIDCPNIFTY: 120,
  SENSEX: 20,
};

/**
 * Returns the lot size for a given symbol. Defaults to 1 for equities.
 * Verify current NSE lot size before each trading session.
 */
export function getLotSize(symbol: string): number {
  const upper = symbol.toUpperCase();
  for (const key of Object.keys(NSE_LOT_SIZES)) {
    if (upper.includes(key)) {
      return NSE_LOT_SIZES[key];
    }
  }
  return 1;
}
