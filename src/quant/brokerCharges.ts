import { ScalpInstrument } from '../types';

export interface ChargeBreakdown {
  brokerage: number;
  stt: number;
  exchangeTxn: number;
  gst: number;
  sebi: number;
  stampDuty: number;
  total: number;
}

/** Default Indian flat-fee discount-broker model (Zerodha-like). */
export function computeRoundTripCharges(
  entry: number,
  exit: number,
  sizeShares: number,
  inst: ScalpInstrument
): ChargeBreakdown {
  const buyTurnover = entry * sizeShares;
  const sellTurnover = exit * sizeShares;
  const totalTurnover = buyTurnover + sellTurnover;

  const brokerageOneSide = Math.min(20, buyTurnover * 0.0003); // ₹20 OR 0.03%
  const brokerage = brokerageOneSide * 2;

  let stt = 0;
  if (inst === 'EQUITY_INTRADAY') stt = sellTurnover * 0.00025;       // 0.025% on sell
  else if (inst === 'EQUITY_DELIVERY') stt = totalTurnover * 0.001;        // 0.1% both
  else if (inst === 'INDEX_FUT' || inst === 'STOCK_FUT') stt = sellTurnover * 0.0002;
  else if (inst === 'INDEX_OPT') stt = sellTurnover * 0.001;         // on premium sell

  const exchangeTxn = totalTurnover * 0.0000325;  // NSE eq ~0.00325%
  const sebi = totalTurnover * 0.000001;          // ₹10/cr
  const stampDuty = buyTurnover * 0.00003;        // 0.003% on buy only, intraday
  const gst = (brokerage + exchangeTxn + sebi) * 0.18;

  const total = brokerage + stt + exchangeTxn + gst + sebi + stampDuty;
  return { brokerage, stt, exchangeTxn, gst, sebi, stampDuty, total };
}
