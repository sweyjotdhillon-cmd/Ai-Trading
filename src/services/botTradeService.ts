import {
  doc, collection,
  setDoc, updateDoc, getDoc, getDocs, deleteDoc,
  query, where, orderBy, limit
} from 'firebase/firestore';
import { db, auth }              from './firebase';
import { BotTradeRecord, BotSessionStats } from '../hooks/useBotLoop';
import { computeRoundTripCharges }         from '../quant/brokerCharges';
import { ScalpInstrument }                 from '../types';
import { updateVirtualBalance }            from '../services/virtualBalanceService';

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
    console.warn('[Firestore Network Monitor] Operation failed:', errMsg, `(Op: ${operationType}, Path: ${path})`);
  }
  throw new Error(JSON.stringify(errInfo));
}

function todayIST(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

interface CompressedTrade {
  i: string;   // id
  s: string;   // symbol
  e: number;   // entry Price
  x: number | null; // exit Price
  p: number | null; // realized PnL
  o: number;   // opened At (seconds)
  c: number | null; // closed At (seconds)
  t: string | null; // outcome
  z: number;   // position size
}

function decompressTrade(c: CompressedTrade): BotTradeRecord {
  const entry = c.e;
  const stopLoss = entry * 0.99;
  const takeProfit1 = entry + (entry - stopLoss);
  const takeProfit2 = c.x && c.x > entry ? c.x : entry * 1.01;
  const posSize = c.z ?? 1;

  return {
    id:              c.i,
    symbol:          c.s,
    entryPrice:      entry,
    exitPrice:       c.x,
    outcome:         c.t as any,
    realizedPnL:     c.p,
    realizedPnLPct:  null,
    rMultiple:       null,
    openedAt:        c.o * 1000,
    closedAt:        c.c ? c.c * 1000 : null,
    durationMinutes: c.c && c.o ? Math.round((c.c - c.o) / 60) : null,
    plan: {
      entry,
      stopLoss,
      takeProfit1,
      takeProfit2,
      trailingActivate:   takeProfit1,
      trailingDistance:   Math.abs(entry - stopLoss) * 0.5,
      breakEvenAfter:     takeProfit1,
      positionSize:       posSize,
      riskRupees:         Math.abs(entry - stopLoss) * posSize,
      potentialRewardRupees: Math.abs(takeProfit2 - entry) * posSize,
      rrRatio:            Math.abs(takeProfit2 - entry) / Math.max(0.1, Math.abs(entry - stopLoss)),
      maxHoldingMinutes:  15,
      confluenceScore:    7,
      brokerCharges:      0,
      netExpectedPnL:     0,
      slMode:             'FIXED_SL',
      tpMode:             'FIXED_TP',
      instrument:         'EQUITY_INTRADAY',
      noteReasons:        [],
      investmentRupees:   posSize * entry,
    } as any,
  };
}

async function saveTradeToCompressedArchive(uid: string, trade: BotTradeRecord): Promise<void> {
  try {
    const docRef = doc(db, 'tradeBot', uid, 'st', 'g');
    const snap = await getDoc(docRef);
    let archive: CompressedTrade[] = [];
    if (snap.exists()) {
      const data = snap.data();
      if (data.ha && typeof data.ha === 'string') {
        try {
          archive = JSON.parse(data.ha);
        } catch {
          archive = [];
        }
      }
    }

    archive = archive.filter(t => t.i !== trade.id);

    archive.unshift({
      i: trade.id,
      s: trade.symbol,
      e: trade.entryPrice,
      x: trade.exitPrice,
      p: trade.realizedPnL,
      o: Math.floor(trade.openedAt / 1000),
      c: trade.closedAt ? Math.floor(trade.closedAt / 1000) : null,
      t: trade.outcome,
      z: trade.plan?.positionSize ?? 1,
    });

    if (archive.length > 200) {
      archive = archive.slice(0, 200);
    }

    await setDoc(docRef, { ha: JSON.stringify(archive) }, { merge: true });
  } catch (err) {
    console.warn('[Compressed Archive] Failed to save/update trade in archive:', err);
  }
}

export async function writeTrade_Open(
  uid:    string,
  trade:  BotTradeRecord
): Promise<void> {
  const path = `tradeBot/${uid}/tr/${trade.id}`;
  try {
    const payload = {
      s:   trade.symbol,
      e:   trade.entryPrice,
      sl:  trade.plan.stopLoss,
      tp:  trade.plan.takeProfit2,
      sz:  trade.plan.positionSize,
      iv:  trade.plan.investmentRupees ?? (trade.plan.positionSize * trade.entryPrice),
      ot:  Math.floor(trade.openedAt / 1000),
      st:  'O',
      sd:  todayIST(),
    };

    await setDoc(doc(db, 'tradeBot', uid, 'tr', trade.id), payload);
    await saveTradeToCompressedArchive(uid, trade);
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
  const path = `tradeBot/${uid}/tr/${trade.id}`;
  const instrument  = (trade.plan.instrument ?? 'EQUITY_INTRADAY') as ScalpInstrument;
  const posSize     = trade.plan.positionSize ?? 1;

  const charges = computeRoundTripCharges(
    trade.entryPrice,
    exitPrice,
    posSize,
    instrument
  );

  const grossPnL      = (exitPrice - trade.entryPrice) * posSize;
  const realizedPnL   = grossPnL - charges.total;
  const invested      = trade.plan.investmentRupees ?? (posSize * trade.entryPrice);
  const realizedPnLPct = invested > 0 ? (realizedPnL / invested) * 100 : 0;
  const rMultiple     = trade.plan.riskRupees > 0
    ? realizedPnL / trade.plan.riskRupees
    : 0;
  const durationMinutes = trade.openedAt
    ? Math.round((Date.now() - trade.openedAt) / 60_000)
    : null;

  try {
    const update = {
      s:   trade.symbol,
      e:   trade.entryPrice,
      sl:  trade.plan.stopLoss,
      tp:  trade.plan.takeProfit2,
      sz:  trade.plan.positionSize,
      iv:  trade.plan.investmentRupees ?? (trade.plan.positionSize * trade.entryPrice),
      ot:  Math.floor(trade.openedAt / 1000),
      sd:  todayIST(),
      x:   exitPrice,
      pnl: parseFloat(realizedPnL.toFixed(2)),
      r:   parseFloat(rMultiple.toFixed(3)),
      bc:  parseFloat(charges.total.toFixed(2)),
      o:   trade.outcome,
      st:  'C',
      ct:  Math.floor(Date.now() / 1000),
      dm:  durationMinutes,
    };

    // Use robust setDoc with merge: true to avoid crashes when document does not yet exist
    await setDoc(doc(db, 'tradeBot', uid, 'tr', trade.id), update, { merge: true });

    // Update compressed historical representation
    const updatedTrade: BotTradeRecord = {
      ...trade,
      exitPrice,
      realizedPnL,
      closedAt: Date.now(),
    };
    await saveTradeToCompressedArchive(uid, updatedTrade);

    await updateVirtualBalance(uid, realizedPnL);

    return {
      realizedPnL:    parseFloat(realizedPnL.toFixed(2)),
      realizedPnLPct: parseFloat(realizedPnLPct.toFixed(4)),
      rMultiple:      parseFloat(rMultiple.toFixed(3)),
      brokerCharges:  parseFloat(charges.total.toFixed(2)),
    };
  } catch (error) {
    console.warn('[botTradeService] writeTrade_Close db up failed. Using local fallback values:', error);
    return {
      realizedPnL:    parseFloat(realizedPnL.toFixed(2)),
      realizedPnLPct: parseFloat(realizedPnLPct.toFixed(4)),
      rMultiple:      parseFloat(rMultiple.toFixed(3)),
      brokerCharges:  parseFloat(charges.total.toFixed(2)),
    };
  }
}

export async function writeStats_Update(
  uid:   string,
  stats: BotSessionStats,
  dailyPnL: number
): Promise<void> {
  const path = `tradeBot/${uid}/st/g`;
  try {
    const payload = {
      tt:  stats.totalTrades,
      tw:  stats.totalWins,
      tl:  stats.totalLosses,
      pnl: parseFloat(stats.totalPnL.toFixed(2)),
      dp:  parseFloat(dailyPnL.toFixed(2)),
      avr: parseFloat(stats.avgRMultiple.toFixed(3)),
      bst: parseFloat(stats.bestTrade.toFixed(2)),
      wst: parseFloat(stats.worstTrade.toFixed(2)),
      str: stats.currentStreak,
      upd: Math.floor(Date.now() / 1000),
    };

    await setDoc(doc(db, 'tradeBot', uid, 'st', 'g'), payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function loadStats(
  uid: string
): Promise<BotSessionStats | null> {
  const path = `tradeBot/${uid}/st/g`;
  try {
    const snap = await getDoc(doc(db, 'tradeBot', uid, 'st', 'g'));
    if (!snap.exists()) return null;
    const d = snap.data();
    const tt = d.tt ?? 0;
    const tw = d.tw ?? 0;
    return {
      totalTrades:   tt,
      totalWins:     tw,
      totalLosses:   d.tl ?? 0,
      winRate:       tt > 0 ? tw / tt : 0,
      totalPnL:      d.pnl ?? 0,
      avgRMultiple:  d.avr ?? 0,
      bestTrade:     d.bst ?? 0,
      worstTrade:    d.wst ?? 0,
      currentStreak: d.str ?? 0,
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
  try {
    const statsDocRef = doc(db, 'tradeBot', uid, 'st', 'g');
    const statsSnap = await getDoc(statsDocRef);
    if (statsSnap.exists()) {
      const data = statsSnap.data();
      if (data.ha && typeof data.ha === 'string') {
        const archive: CompressedTrade[] = JSON.parse(data.ha);
        const opens = archive
          .map(decompressTrade)
          .filter(t => t.exitPrice === null);
        if (opens.length > 0) {
          return opens;
        }
      }
    }
  } catch (err) {
    console.warn('[Compressed Archive] loadOpenTrades fallback to direct:', err);
  }

  const path = `tradeBot/${uid}/tr`;
  try {
    const q = query(
      collection(db, 'tradeBot', uid, 'tr'),
      where('st', '==', 'O'),
      orderBy('ot', 'desc'),
      limit(3)
    );
    const snap = await getDocs(q);
    return snap.docs.map(docSnap => {
      const r = docSnap.data();
      const entry = r.e;
      const stopLoss = r.sl ?? (entry * 0.99);
      const takeProfit1 = entry + (entry - stopLoss);
      const takeProfit2 = r.tp;
      const posSize = r.sz ?? 1;
      return {
        id:              docSnap.id,
        symbol:          r.s,
        entryPrice:      entry,
        exitPrice:       r.x ?? null,
        outcome:         r.o ?? null,
        realizedPnL:     r.pnl ?? null,
        realizedPnLPct:  null,
        rMultiple:       r.r ?? null,
        openedAt:        r.ot * 1000,
        closedAt:        r.ct ? r.ct * 1000 : null,
        durationMinutes: r.dm ?? null,
        plan: {
          entry,
          stopLoss,
          takeProfit1,
          takeProfit2,
          trailingActivate:   takeProfit1,
          trailingDistance:   Math.abs(entry - stopLoss) * 0.5,
          breakEvenAfter:     takeProfit1,
          positionSize:       posSize,
          riskRupees:         Math.abs(entry - stopLoss) * posSize,
          potentialRewardRupees: Math.abs(takeProfit2 - entry) * posSize,
          rrRatio:            Math.abs(takeProfit2 - entry) / Math.max(0.1, Math.abs(entry - stopLoss)),
          maxHoldingMinutes:  15,
          confluenceScore:    7,
          brokerCharges:      0,
          netExpectedPnL:     0,
          slMode:             'FIXED_SL',
          tpMode:             'FIXED_TP',
          instrument:         'EQUITY_INTRADAY',
          noteReasons:        [],
          investmentRupees:   r.iv ?? (posSize * entry),
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
  const trades = await loadOpenTrades(uid);
  return trades[0] ?? null;
}

export async function loadTodayTrades(
  uid: string
): Promise<BotTradeRecord[]> {
  try {
    const statsDocRef = doc(db, 'tradeBot', uid, 'st', 'g');
    const statsSnap = await getDoc(statsDocRef);
    if (statsSnap.exists()) {
      const data = statsSnap.data();
      if (data.ha && typeof data.ha === 'string') {
        const archive: CompressedTrade[] = JSON.parse(data.ha);
        const todayStr = todayIST();
        const todayDecoded = archive
          .map(decompressTrade)
          .filter(t => {
            const tDate = new Date(t.openedAt + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
            return tDate === todayStr;
          });
        if (todayDecoded.length > 0) {
          return todayDecoded;
        }
      }
    }
  } catch (err) {
    console.warn('[Compressed Archive] loadTodayTrades fallback to direct:', err);
  }

  const path = `tradeBot/${uid}/tr`;
  try {
    const q = query(
      collection(db, 'tradeBot', uid, 'tr'),
      where('sd', '==', todayIST()),
      orderBy('ot', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(docSnap => {
      const r = docSnap.data();
      const entry = r.e;
      const stopLoss = r.sl ?? (entry * 0.99);
      const takeProfit1 = entry + (entry - stopLoss);
      const takeProfit2 = r.tp;
      const posSize = r.sz ?? 1;
      return {
        id:              docSnap.id,
        symbol:          r.s,
        entryPrice:      entry,
        exitPrice:       r.x ?? null,
        outcome:         r.o ?? null,
        realizedPnL:     r.pnl ?? null,
        realizedPnLPct:  null,
        rMultiple:       r.r ?? null,
        openedAt:        r.ot * 1000,
        closedAt:        r.ct ? r.ct * 1000 : null,
        durationMinutes: r.dm ?? null,
        plan: {
          entry,
          stopLoss,
          takeProfit1,
          takeProfit2,
          trailingActivate:   takeProfit1,
          trailingDistance:   Math.abs(entry - stopLoss) * 0.5,
          breakEvenAfter:     takeProfit1,
          positionSize:       posSize,
          riskRupees:         Math.abs(entry - stopLoss) * posSize,
          potentialRewardRupees: Math.abs(takeProfit2 - entry) * posSize,
          rrRatio:            Math.abs(takeProfit2 - entry) / Math.max(0.1, Math.abs(entry - stopLoss)),
          maxHoldingMinutes:  15,
          confluenceScore:    7,
          brokerCharges:      0,
          netExpectedPnL:     0,
          slMode:             'FIXED_SL',
          tpMode:             'FIXED_TP',
          instrument:         'EQUITY_INTRADAY',
          noteReasons:        [],
          investmentRupees:   r.iv ?? (posSize * entry),
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

export async function purgeAllSavedData(uid: string): Promise<void> {
  const path = `tradeBot/${uid}`;
  try {
    await deleteDoc(doc(db, 'tradeBot', uid, 'st', 'g'));
    
    const q = query(collection(db, 'tradeBot', uid, 'tr'));
    const snap = await getDocs(q);
    const deletePromises = snap.docs.map(docSnap => deleteDoc(docSnap.ref));
    await Promise.all(deletePromises);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
