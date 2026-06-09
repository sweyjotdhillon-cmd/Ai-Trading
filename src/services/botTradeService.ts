import {
  doc, collection,
  setDoc, updateDoc, getDoc, getDocs, deleteDoc,
  query, where, orderBy, limit,
  serverTimestamp,
  DocumentReference
} from 'firebase/firestore';
import { db, auth }              from './firebase';
import { BotTradeRecord, BotSessionStats } from '../hooks/useBotLoop';
import { computeRoundTripCharges }         from '../quant/brokerCharges';
import { ScalpInstrument }                 from '../types';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errMsg = error instanceof Error ? error.message : String(error);
  const isSecurityOrPermissionError = 
    errMsg.toLowerCase().includes('permission') || 
    errMsg.toLowerCase().includes('insufficient');

  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };

  if (isSecurityOrPermissionError) {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  } else {
    console.warn('[Firestore Network Monitor] Operation failed (not a permission error):', errMsg, `(Op: ${operationType}, Path: ${path})`);
  }
  throw new Error(JSON.stringify(errInfo));
}

// tradeBot/{uid}/trades/{tradeId}  — one doc per trade
// tradeBot/{uid}/stats/global      — single rolling stats doc
// tradeBot/{uid}/sessions/{date}   — daily session grouping (YYYY-MM-DD IST)

function tradesCol(uid: string) {
  return collection(db, 'tradeBot', uid, 'trades');
}

function tradeDoc(uid: string, tradeId: string): DocumentReference {
  return doc(db, 'tradeBot', uid, 'trades', tradeId);
}

function statsDoc(uid: string): DocumentReference {
  return doc(db, 'tradeBot', uid, 'stats', 'global');
}

// Returns YYYY-MM-DD in IST for session grouping
function todayIST(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export async function writeTrade_Open(
  uid:    string,
  trade:  BotTradeRecord
): Promise<void> {
  const path = `tradeBot/${uid}/trades/${trade.id}`;
  try {
    const payload = {
      id:           trade.id,
      uid,
      symbol:       trade.symbol,
      status:       'OPEN',
      entryPrice:   trade.entryPrice,
      exitPrice:    null,
      outcome:      null,
      realizedPnL:  null,
      realizedPnLPct: null,
      rMultiple:    null,
      brokerCharges: null,
      openedAt:     trade.openedAt,
      closedAt:     null,
      durationMinutes: null,
      sessionDate:  todayIST(),
      // Plan details — the three most important fields
      plan_entry:      trade.plan.entry,
      plan_stopLoss:   trade.plan.stopLoss,
      plan_takeProfit1: trade.plan.takeProfit1,
      plan_takeProfit2: trade.plan.takeProfit2,
      plan_rrRatio:    trade.plan.rrRatio,
      plan_riskRupees: trade.plan.riskRupees,
      plan_positionSize: trade.plan.positionSize ?? 1,
      plan_instrument:   trade.plan.instrument,
      plan_slMode:       trade.plan.slMode,
      plan_tpMode:       trade.plan.tpMode,
      plan_maxHoldingMinutes: trade.plan.maxHoldingMinutes,
      createdAt:    serverTimestamp(),
    };

    await setDoc(tradeDoc(uid, trade.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function writeTrade_Close(
  uid:       string,
  trade:     BotTradeRecord,
  exitPrice: number,
  capital:   number
): Promise<{
  realizedPnL:    number;
  realizedPnLPct: number;
  rMultiple:      number;
  brokerCharges:  number;
}> {
  const path = `tradeBot/${uid}/trades/${trade.id}`;
  try {
    const instrument  = (trade.plan.instrument ?? 'EQUITY_INTRADAY') as ScalpInstrument;
    const posSize     = trade.plan.positionSize ?? 1;

    // Compute exact Indian market broker charges
    const charges     = computeRoundTripCharges(
      trade.entryPrice,
      exitPrice,
      posSize,
      instrument
    );

    const grossPnL      = (exitPrice - trade.entryPrice) * posSize;
    const realizedPnL   = grossPnL - charges.total;
    const realizedPnLPct = capital > 0 ? (realizedPnL / capital) * 100 : 0;
    const rMultiple     = trade.plan.riskRupees > 0
      ? realizedPnL / trade.plan.riskRupees
      : 0;
    const durationMinutes = trade.openedAt
      ? Math.round((Date.now() - trade.openedAt) / 60_000)
      : null;

    const update = {
      status:          'CLOSED',
      exitPrice,
      outcome:         trade.outcome,
      realizedPnL:     parseFloat(realizedPnL.toFixed(2)),
      realizedPnLPct:  parseFloat(realizedPnLPct.toFixed(4)),
      rMultiple:       parseFloat(rMultiple.toFixed(3)),
      brokerCharges:   parseFloat(charges.total.toFixed(2)),
      brokerBreakdown: {
        brokerage:   charges.brokerage,
        stt:         charges.stt,
        exchangeTxn: charges.exchangeTxn,
        gst:         charges.gst,
        sebi:        charges.sebi,
        stampDuty:   charges.stampDuty,
      },
      closedAt:        Date.now(),
      durationMinutes,
      updatedAt:       serverTimestamp(),
    };

    await updateDoc(tradeDoc(uid, trade.id), update);

    return { realizedPnL, realizedPnLPct, rMultiple, brokerCharges: charges.total };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function writeStats_Update(
  uid:   string,
  stats: BotSessionStats,
  dailyPnL: number          // today's P&L only, separate from all-time
): Promise<void> {
  const path = `tradeBot/${uid}/stats/global`;
  try {
    const payload = {
      uid,
      totalTrades:   stats.totalTrades,
      totalWins:     stats.totalWins,
      totalLosses:   stats.totalLosses,
      winRate:       parseFloat((stats.winRate * 100).toFixed(2)),  // store as %
      totalPnL:      parseFloat(stats.totalPnL.toFixed(2)),
      dailyPnL:      parseFloat(dailyPnL.toFixed(2)),
      avgRMultiple:  parseFloat(stats.avgRMultiple.toFixed(3)),
      bestTrade:     parseFloat(stats.bestTrade.toFixed(2)),
      worstTrade:    parseFloat(stats.worstTrade.toFixed(2)),
      currentStreak: stats.currentStreak,
      lastUpdated:   serverTimestamp(),
      sessionDate:   todayIST(),
    };

    await setDoc(statsDoc(uid), payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function loadStats(
  uid: string
): Promise<BotSessionStats | null> {
  const path = `tradeBot/${uid}/stats/global`;
  try {
    const snap = await getDoc(statsDoc(uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      totalTrades:   d.totalTrades   ?? 0,
      totalWins:     d.totalWins     ?? 0,
      totalLosses:   d.totalLosses   ?? 0,
      winRate:       (d.winRate      ?? 0) / 100,  // stored as %, convert back to 0–1
      totalPnL:      d.totalPnL      ?? 0,
      avgRMultiple:  d.avgRMultiple  ?? 0,
      bestTrade:     d.bestTrade     ?? 0,
      worstTrade:    d.worstTrade    ?? 0,
      currentStreak: d.currentStreak ?? 0,
    };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.GET, path);
    } catch {
      return null;
    }
  }
}

export async function loadOpenTrades(
  uid: string
): Promise<BotTradeRecord[]> {
  const path = `tradeBot/${uid}/trades`;
  try {
    const q = query(
      tradesCol(uid),
      where('status', '==', 'OPEN'),
      orderBy('openedAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(docSnap => {
      const d = docSnap.data();
      return {
        id:              d.id,
        symbol:          d.symbol,
        entryPrice:      d.entryPrice,
        exitPrice:       null,
        outcome:         null,
        realizedPnL:     null,
        realizedPnLPct:  null,
        rMultiple:       null,
        openedAt:        d.openedAt,
        closedAt:        null,
        durationMinutes: null,
        plan: {
          entry:              d.plan_entry,
          stopLoss:           d.plan_stopLoss,
          takeProfit1:        d.plan_takeProfit1,
          takeProfit2:        d.plan_takeProfit2,
          rrRatio:            d.plan_rrRatio,
          riskRupees:         d.plan_riskRupees,
          positionSize:       d.plan_positionSize,
          instrument:         d.plan_instrument,
          slMode:             d.plan_slMode,
          tpMode:             d.plan_tpMode,
          maxHoldingMinutes:  d.plan_maxHoldingMinutes,
        } as any,
      };
    });
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.LIST, path);
    } catch {
      return [];
    }
  }
}

export async function loadOpenTrade(
  uid: string
): Promise<BotTradeRecord | null> {
  const path = `tradeBot/${uid}/trades`;
  try {
    const q = query(
      tradesCol(uid),
      where('status', '==', 'OPEN'),
      orderBy('openedAt', 'desc'),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;

    const d = snap.docs[0].data();
    return {
      id:              d.id,
      symbol:          d.symbol,
      entryPrice:      d.entryPrice,
      exitPrice:       null,
      outcome:         null,
      realizedPnL:     null,
      realizedPnLPct:  null,
      rMultiple:       null,
      openedAt:        d.openedAt,
      closedAt:        null,
      durationMinutes: null,
      plan: {
        entry:              d.plan_entry,
        stopLoss:           d.plan_stopLoss,
        takeProfit1:        d.plan_takeProfit1,
        takeProfit2:        d.plan_takeProfit2,
        rrRatio:            d.plan_rrRatio,
        riskRupees:         d.plan_riskRupees,
        positionSize:       d.plan_positionSize,
        instrument:         d.plan_instrument,
        slMode:             d.plan_slMode,
        tpMode:             d.plan_tpMode,
        maxHoldingMinutes:  d.plan_maxHoldingMinutes,
      } as any,
    };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.LIST, path);
    } catch {
      return null;
    }
  }
}

export async function loadTodayTrades(
  uid: string
): Promise<BotTradeRecord[]> {
  const path = `tradeBot/${uid}/trades`;
  try {
    const q = query(
      tradesCol(uid),
      where('sessionDate', '==', todayIST()),
      orderBy('openedAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id:              data.id,
        symbol:          data.symbol,
        entryPrice:      data.entryPrice,
        exitPrice:       data.exitPrice ?? null,
        outcome:         data.outcome   ?? null,
        realizedPnL:     data.realizedPnL    ?? null,
        realizedPnLPct:  data.realizedPnLPct ?? null,
        rMultiple:       data.rMultiple      ?? null,
        openedAt:        data.openedAt,
        closedAt:        data.closedAt  ?? null,
        durationMinutes: data.durationMinutes ?? null,
        plan: {
          entry:             data.plan_entry,
          stopLoss:          data.plan_stopLoss,
          takeProfit1:       data.plan_takeProfit1,
          takeProfit2:       data.plan_takeProfit2,
          rrRatio:           data.plan_rrRatio,
          riskRupees:        data.plan_riskRupees,
          positionSize:      data.plan_positionSize,
          instrument:        data.plan_instrument,
          slMode:            data.plan_slMode,
          tpMode:            data.plan_tpMode,
          maxHoldingMinutes: data.plan_maxHoldingMinutes,
        } as any,
      } as BotTradeRecord;
    });
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.LIST, path);
    } catch {
      return [];
    }
  }
}

export async function purgeAllSavedData(uid: string): Promise<void> {
  const path = `tradeBot/${uid}`;
  try {
    // 1. Delete global stats document
    await deleteDoc(statsDoc(uid));
    
    // 2. Fetch all trades and delete each document
    const q = query(tradesCol(uid));
    const snap = await getDocs(q);
    const deletePromises = snap.docs.map(docSnap => deleteDoc(docSnap.ref));
    await Promise.all(deletePromises);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

