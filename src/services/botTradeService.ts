import {
  doc, collection,
  setDoc, updateDoc, getDoc, getDocs, deleteDoc,
  query, where, orderBy, limit,
  runTransaction
} from 'firebase/firestore';
import { db, auth }              from './firebase';
import { BotTradeRecord, BotSessionStats } from '../hooks/useBotLoop';
import { computeRoundTripCharges }         from '../quant/brokerCharges';
import { ScalpInstrument }                 from '../types';
import { compressText, decompressText }    from '../utils/storageUtils';
import { todayIST }                        from '../utils/istUtils';

export const MAX_ARCHIVE_SIZE = 200;

type OperationType = 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';

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

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): FirestoreErrorInfo {
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
  return errInfo;
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
  sl?: number; // stop loss
  tp?: number; // take profit
  iv?: number; // investment Rupees
  bc?: number; // broker charges
  r?: number;  // rMultiple
  n?: number;  // net PnL (precomputed, gross realized - charges)
  ca?: number; // charges actual
}

export function reconstructTradeFromRaw(
  id: string,
  symbol: string,
  entry: number,
  exit: number | null,
  pnl: number | null,
  openedAtSec: number,
  closedAtSec: number | null,
  outcome: string | null,
  size: number,
  sl: number | undefined,
  tp: number | undefined,
  invested: number | undefined,
  charges: number | undefined,
  rMul: number | undefined,
  isArchive: boolean,
  rawPayload?: any
): BotTradeRecord {
  const stopLoss = sl ?? entry * 0.99;
  const takeProfit2 = tp ?? (exit && exit > entry ? exit : entry * 1.01);
  const takeProfit1 = entry + (entry - stopLoss) * 1.0;
  const finalInvested = invested ?? (size * entry);
  const realizedPnLPct = pnl != null && finalInvested > 0 ? (pnl / finalInvested) * 100 : null;
  const rMultiple = rMul ?? (pnl != null && (entry - stopLoss) > 0 ? pnl / ((entry - stopLoss) * size) : null);

  const instrument = isArchive ? 'EQUITY_INTRADAY' : (rawPayload?.inst ?? 'EQUITY_INTRADAY');
  const slMode = isArchive ? 'FIXED_SL' : (rawPayload?.sm ?? 'FIXED_SL');
  const tpMode = isArchive ? 'FIXED_TP' : (rawPayload?.tm ?? 'FIXED_TP');
  const maxHoldingMinutes = isArchive ? 15 : (rawPayload?.mh ?? 15);
  const confluenceScore = isArchive ? 7 : (rawPayload?.cs ?? 7);

  const netPnL = isArchive ? (rawPayload?.n ?? null) : (rawPayload?.n ?? rawPayload?.netPnL ?? rawPayload?.pnl ?? null);
  const chargesActual = isArchive ? (rawPayload?.ca ?? null) : (rawPayload?.ca ?? rawPayload?.chargesActual ?? rawPayload?.bc ?? null);

  const record: BotTradeRecord = {
    id,
    symbol,
    entryPrice: entry,
    exitPrice: exit,
    outcome: outcome as any,
    realizedPnL: pnl,
    realizedPnLPct,
    rMultiple,
    openedAt: openedAtSec * 1000,
    closedAt: closedAtSec ? closedAtSec * 1000 : null,
    durationMinutes: closedAtSec && openedAtSec ? Math.round((closedAtSec - openedAtSec) / 60) : null,
    plan: {
      entry,
      stopLoss,
      takeProfit1,
      takeProfit2,
      trailingActivate: takeProfit1,
      trailingDistance: Math.abs(entry - stopLoss) * 0.5,
      breakEvenAfter: takeProfit1,
      positionSize: size,
      riskRupees: Math.abs(entry - stopLoss) * size,
      potentialRewardRupees: Math.abs(takeProfit2 - entry) * size,
      rrRatio: Math.abs(takeProfit2 - entry) / Math.max(0.1, Math.abs(entry - stopLoss)),
      maxHoldingMinutes,
      confluenceScore,
      brokerCharges: charges ?? 0,
      netExpectedPnL: pnl != null ? pnl : 0,
      slMode,
      tpMode,
      instrument,
      noteReasons: [],
      investmentRupees: finalInvested,
    } as any,
  };

  if (netPnL !== null && netPnL !== undefined) {
    record.netPnL = netPnL;
  }
  if (chargesActual !== null && chargesActual !== undefined) {
    record.chargesActual = chargesActual;
  }

  return record;
}

function decompressTrade(c: CompressedTrade): BotTradeRecord {
  return reconstructTradeFromRaw(
    c.i,
    c.s,
    c.e,
    c.x,
    c.p,
    c.o,
    c.c,
    c.t,
    c.z ?? 1,
    c.sl,
    c.tp,
    c.iv,
    c.bc,
    c.r,
    true,
    c
  );
}

async function saveTradeToCompressedArchive(uid: string, trade: BotTradeRecord): Promise<void> {
  try {
    const docRef = doc(db, 'tradeBot', uid, 'st', 'g');
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      let archive: CompressedTrade[] = [];
      if (snap.exists()) {
        const data = snap.data();
        if (data.ha && typeof data.ha === 'string') {
          try {
            const decompressed = decompressText(data.ha);
            archive = JSON.parse(decompressed);
          } catch {
            try {
              archive = JSON.parse(data.ha);
            } catch {
              archive = [];
            }
          }
        }
      }

      // Convert archive into a Map for O(1) deduplication
      const map = new Map<string, CompressedTrade>();
      archive.forEach(t => map.set(t.i, t));

      const newComp: CompressedTrade = {
        i: trade.id,
        s: trade.symbol,
        e: trade.entryPrice,
        x: trade.exitPrice,
        p: trade.realizedPnL,
        o: Math.floor(trade.openedAt / 1000),
        c: trade.closedAt ? Math.floor(trade.closedAt / 1000) : null,
        t: trade.outcome,
        z: trade.plan?.positionSize ?? 1,
        sl: trade.plan?.stopLoss,
        tp: trade.plan?.takeProfit2,
        iv: trade.plan?.investmentRupees,
        bc: trade.plan?.brokerCharges,
        r: trade.rMultiple ?? undefined,
        n: trade.netPnL ?? (trade.realizedPnL != null ? trade.realizedPnL : undefined),
        ca: trade.chargesActual ?? (trade.plan?.brokerCharges != null ? trade.plan.brokerCharges : undefined),
      };

      map.set(trade.id, newComp);

      let updatedList = Array.from(map.values());
      updatedList.sort((a, b) => {
        const tA = a.c ?? a.o;
        const tB = b.c ?? b.o;
        return tB - tA;
      });

      if (updatedList.length > MAX_ARCHIVE_SIZE) {
        updatedList = updatedList.slice(0, MAX_ARCHIVE_SIZE);
      }

      const serialized = JSON.stringify(updatedList);
      const compressed = compressText(serialized);
      transaction.set(docRef, { ha: compressed }, { merge: true });
    });
  } catch (err) {
    console.warn('[Compressed Archive] Failed to save/update trade in archive transaction:', err);
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
      inst: trade.plan.instrument,
      sm:  trade.plan.slMode,
      tm:  trade.plan.tpMode,
      mh:  trade.plan.maxHoldingMinutes,
      cs:  trade.plan.confluenceScore,
    };

    await setDoc(doc(db, 'tradeBot', uid, 'tr', trade.id), payload);
    await saveTradeToCompressedArchive(uid, trade);
  } catch (error) {
    const errInfo = handleFirestoreError(error, 'write', path);
    throw new Error(JSON.stringify(errInfo));
  }
}

export async function writeTrade_Close(
  uid:       string,
  trade:     BotTradeRecord,
  exitPrice: number,
  capital:   number,
  precomputedNetPnL?: number,
  precomputedCharges?: number
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
  const chargesTotal  = (precomputedCharges != null && Number.isFinite(precomputedCharges)) ? precomputedCharges : charges.total;
  const realizedPnL   = (precomputedNetPnL != null && Number.isFinite(precomputedNetPnL)) ? precomputedNetPnL : grossPnL - chargesTotal;
  const invested      = trade.plan.investmentRupees ?? (posSize * trade.entryPrice);
  const realizedPnLPct = invested > 0 ? (realizedPnL / invested) * 100 : 0;
  const rMultiple     = trade.plan.riskRupees > 0
    ? realizedPnL / trade.plan.riskRupees
    : 0;

  try {
    // Delete the trade document from the active 'tr' subcollection so that active/open trades
    // are automatically removed from the individual cloud collection when closed.
    await deleteDoc(doc(db, 'tradeBot', uid, 'tr', trade.id));

    // Update compressed historical representation
    const updatedTrade: BotTradeRecord = {
      ...trade,
      exitPrice,
      realizedPnL,
      closedAt: Date.now(),
      netPnL: realizedPnL,
      chargesActual: chargesTotal,
    };
    await saveTradeToCompressedArchive(uid, updatedTrade);

    return {
      realizedPnL:    parseFloat(realizedPnL.toFixed(2)),
      realizedPnLPct: parseFloat(realizedPnLPct.toFixed(4)),
      rMultiple:      parseFloat(rMultiple.toFixed(3)),
      brokerCharges:  parseFloat(chargesTotal.toFixed(2)),
    };
  } catch (error) {
    console.warn('[botTradeService] writeTrade_Close db up failed. Using local fallback values:', error);
    return {
      realizedPnL:    parseFloat(realizedPnL.toFixed(2)),
      realizedPnLPct: parseFloat(realizedPnLPct.toFixed(4)),
      rMultiple:      parseFloat(rMultiple.toFixed(3)),
      brokerCharges:  parseFloat(chargesTotal.toFixed(2)),
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
    const docRef = doc(db, 'tradeBot', uid, 'st', 'g');
    const snap = await getDoc(docRef);
    let tt = stats.totalTrades;
    let tw = stats.totalWins;
    let tl = stats.totalLosses;
    let pnl = parseFloat(stats.totalPnL.toFixed(2));

    if (snap.exists()) {
      const d = snap.data();
      const cloudTT = d.tt ?? 0;
      if (cloudTT > stats.totalTrades) {
        tt = cloudTT;
        const cloudTW = d.tw ?? 0;
        const cloudTL = d.tl ?? 0;
        const cloudPnL = d.pnl ?? 0;
        tw = Math.max(stats.totalWins, cloudTW);
        tl = Math.max(stats.totalLosses, cloudTL);
        pnl = parseFloat(Math.max(stats.totalPnL, cloudPnL).toFixed(2));
      }
    }

    const payload = {
      tt,
      tw,
      tl,
      pnl,
      dp:  parseFloat(dailyPnL.toFixed(2)),
      avr: parseFloat(stats.avgRMultiple.toFixed(3)),
      bst: parseFloat(stats.bestTrade.toFixed(2)),
      wst: parseFloat(stats.worstTrade.toFixed(2)),
      str: stats.currentStreak,
      upd: Math.floor(Date.now() / 1000),
    };

    await setDoc(docRef, payload, { merge: true });
  } catch (error) {
    const errInfo = handleFirestoreError(error, 'write', path);
    throw new Error(JSON.stringify(errInfo));
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
    handleFirestoreError(error, 'get', path);
    return null;
  }
}

export async function loadAllTrades(
  uid: string
): Promise<BotTradeRecord[]> {
  const path = `tradeBot/${uid}/tr`;
  
  // ── FASTRACK COMPRESSED PATH ───────────────────────────────────────
  // Directly pull from the single compressed archive document to deliver 
  // near-instant (lightning fast) load times matching high speed requirements.
  let statsSnap: any = null;
  try {
    const statsDocRef = doc(db, 'tradeBot', uid, 'st', 'g');
    statsSnap = await getDoc(statsDocRef);
    if (statsSnap.exists()) {
      const data = statsSnap.data();
      if (data.ha && typeof data.ha === 'string') {
        const decompressed = decompressText(data.ha);
        let archive: CompressedTrade[] = [];
        try {
          archive = JSON.parse(decompressed);
        } catch {
          archive = JSON.parse(data.ha);
        }
        if (archive.length > 0) {
          const finalTrades = archive.map(decompressTrade);
          finalTrades.sort((a, b) => b.openedAt - a.openedAt);
          return finalTrades;
        }
      }
    }
  } catch (err) {
    console.warn('[Compressed Archive] Lightning path skipped/failed in loadAllTrades:', err);
  }

  // ── SLOW FALLBACK LIVE SCAN PATH ───────────────────────────────────
  try {
    const q = query(
      collection(db, 'tradeBot', uid, 'tr')
    );
    const snap = await getDocs(q);
    const trades = snap.docs.map(docSnap => {
      const r = docSnap.data();
      return reconstructTradeFromRaw(
        docSnap.id,
        r.s,
        r.e,
        r.x ?? null,
        r.pnl ?? null,
        r.ot,
        r.ct ? r.ct : null,
        r.o ?? null,
        r.sz ?? 1,
        r.sl,
        r.tp,
        r.iv,
        r.bc,
        r.r,
        false,
        r
      );
    });

    // Merge with archived trades to ensure complete historical representation
    let archiveTrades: BotTradeRecord[] = [];
    try {
      if (!statsSnap) {
        const statsDocRef = doc(db, 'tradeBot', uid, 'st', 'g');
        statsSnap = await getDoc(statsDocRef);
      }
      if (statsSnap && statsSnap.exists()) {
        const data = statsSnap.data();
        if (data.ha && typeof data.ha === 'string') {
          const decompressed = decompressText(data.ha);
          let archive: CompressedTrade[] = [];
          try {
            archive = JSON.parse(decompressed);
          } catch {
            archive = JSON.parse(data.ha);
          }
          archiveTrades = archive.map(decompressTrade);
        }
      }
    } catch (err) {
      console.warn('[Compressed Archive] Load archive failed in loadAllTrades:', err);
    }

    const finalMap = new Map<string, BotTradeRecord>();
    archiveTrades.forEach(t => finalMap.set(t.id, t));
    trades.forEach(t => finalMap.set(t.id, t));

    const finalTrades = Array.from(finalMap.values());
    finalTrades.sort((a, b) => b.openedAt - a.openedAt);
    return finalTrades;
  } catch (error) {
    console.warn('[botTradeService] loadAllTrades failed, falling back to archive:', error);
    try {
      if (!statsSnap) {
        const statsDocRef = doc(db, 'tradeBot', uid, 'st', 'g');
        statsSnap = await getDoc(statsDocRef);
      }
      if (statsSnap && statsSnap.exists()) {
        const data = statsSnap.data();
        if (data.ha && typeof data.ha === 'string') {
          const decompressed = decompressText(data.ha);
          let archive: CompressedTrade[] = [];
          try {
            archive = JSON.parse(decompressed);
          } catch {
            archive = JSON.parse(data.ha);
          }
          const finalTrades = archive.map(decompressTrade);
          finalTrades.sort((a, b) => b.openedAt - a.openedAt);
          return finalTrades;
        }
      }
    } catch (err) {
      console.warn('[Compressed Archive] Fallback failed in loadAllTrades:', err);
    }
    return [];
  }
}

export async function loadTodayTrades(
  uid: string
): Promise<BotTradeRecord[]> {
  try {
    const todayStr = todayIST();
    // 1. Direct query of active subcollection for elements where sd == todayIST()
    const q = query(
      collection(db, 'tradeBot', uid, 'tr'),
      where('sd', '==', todayStr)
    );
    const snap = await getDocs(q);
    const activeToday = snap.docs.map(docSnap => {
      const r = docSnap.data();
      return reconstructTradeFromRaw(
        docSnap.id,
        r.s,
        r.e,
        r.x ?? null,
        r.pnl ?? null,
        r.ot,
        r.ct ? r.ct : null,
        r.o ?? null,
        r.sz ?? 1,
        r.sl,
        r.tp,
        r.iv,
        r.bc,
        r.r,
        false,
        r
      );
    });

    // 2. Also retrieve today's closed trades from local cached trades in localStorage
    let closedToday: BotTradeRecord[] = [];
    try {
      const cachedStr = localStorage.getItem('ledger_cached_trades');
      if (cachedStr) {
        const cachedTrades: BotTradeRecord[] = JSON.parse(cachedStr);
        closedToday = cachedTrades.filter(t => {
          if (t.exitPrice == null) return false;
          const effTime = t.closedAt ?? t.openedAt;
          const tDate = new Date(effTime + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
          return tDate === todayStr;
        });
      }
    } catch (e) {
      console.warn('[loadTodayTrades] failed to read ledger_cached_trades:', e);
    }

    // Merge them and sort by openedAt descending
    const mergedMap = new Map<string, BotTradeRecord>();
    closedToday.forEach(t => mergedMap.set(t.id, t));
    activeToday.forEach(t => mergedMap.set(t.id, t));

    const finalToday = Array.from(mergedMap.values());
    finalToday.sort((a, b) => b.openedAt - a.openedAt);
    return finalToday;
  } catch (error) {
    console.warn('[loadTodayTrades] direct query fast path failed, falling back to full sweep:', error);
    try {
      const all = await loadAllTrades(uid);
      const todayStr = todayIST();
      return all.filter(t => {
        const effTime = t.closedAt ?? t.openedAt;
        const tDate = new Date(effTime + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
        return tDate === todayStr;
      });
    } catch {
      return [];
    }
  }
}

export async function purgeAllSavedData(uid: string): Promise<void> {
  const path = `tradeBot/${uid}`;
  try {
    // 1. Safe stats / archive document deletion
    try {
      await deleteDoc(doc(db, 'tradeBot', uid, 'st', 'g'));
    } catch (e) {
      console.warn('[Purge] Failed to delete stats doc:', e);
    }
    
    // 2. Safe scan and individual trade document cleanup (errors caught per-doc)
    try {
      const q = query(collection(db, 'tradeBot', uid, 'tr'));
      const snap = await getDocs(q);
      const deletePromises = snap.docs.map(docSnap => 
         deleteDoc(docSnap.ref).catch(err => {
          console.warn(`[Purge] Failed to clean document ${docSnap.id}:`, err);
        })
      );
      await Promise.all(deletePromises);
    } catch (e) {
      console.warn('[Purge] Failed to list or clean sub-trade documents:', e);
    }

    // 3. Reset virtual balance to 100000 in Firestore
    try {
      const balanceDocRef = doc(db, 'tradeBot', uid, 'balance', 'current');
      await setDoc(balanceDocRef, { balance: 100000, upd: Math.floor(Date.now() / 1000) });
    } catch (e) {
      console.warn('[Purge] Failed to reset Firestore virtual balance:', e);
    }

    // 4. Force synchronization of local caches if it is current user
    if (auth.currentUser?.uid === uid) {
      localStorage.setItem('user_virtual_balance', '100000');
    }
  } catch (error) {
    const errInfo = handleFirestoreError(error, 'delete', path);
    throw new Error(JSON.stringify(errInfo));
  }
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

export async function registerUserProfile(uid: string, email: string | null, name: string | null): Promise<void> {
  try {
    const userDocRef = doc(db, 'users', uid);
    await setDoc(userDocRef, {
      role: 'user',
      email: email || '',
      name: name || email || 'Terminal Inspector',
      createdAt: Date.now()
    }, { merge: true });
  } catch (err) {
    console.warn('[botTradeService] Failed to register user profile:', err);
  }
}

export async function listAllUsers(): Promise<UserProfile[]> {
  try {
    const q = query(collection(db, 'users'));
    const snap = await getDocs(q);
    return snap.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        name: data.name || 'Anonymous User',
        email: data.email || 'No email',
        createdAt: data.createdAt || Date.now()
      };
    });
  } catch (err) {
    console.error('[botTradeService] listAllUsers failed:', err);
    return [];
  }
}

export async function resetAndPurgeUser(targetUid: string): Promise<void> {
  // Purge stats, history, balance
  await purgeAllSavedData(targetUid);
  // Also delete their profile from users collection
  try {
    const userDocRef = doc(db, 'users', targetUid);
    await deleteDoc(userDocRef);
  } catch (err) {
    console.warn(`[botTradeService] Failed to delete user profile from 'users' collection during purge:`, err);
  }
}

export function getArchiveStats(trades: BotTradeRecord[]): {
  count: number;
  capacity: number;
  percent: number;
  warning: boolean;
  danger: boolean;
} {
  const count = trades.length;
  const capacity = MAX_ARCHIVE_SIZE;
  const percent = parseFloat(((count / capacity) * 100).toFixed(1));
  return {
    count,
    capacity,
    percent,
    warning: percent >= 85,
    danger: percent >= 100,
  };
}

export function filterTradesByRange(trades: BotTradeRecord[], range: string): BotTradeRecord[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  
  const nowIST = now + 5.5 * 3600 * 1000;
  const todayMidnightIST = nowIST - (nowIST % (24 * 3600 * 1000)) - 5.5 * 3600 * 1000;
  const yesterdayMidnightIST = todayMidnightIST - dayMs;

  const getEffectiveTime = (t: BotTradeRecord) => t.closedAt ?? t.openedAt;

  switch (range) {
    case 'TODAY':
      return trades.filter(t => getEffectiveTime(t) >= todayMidnightIST);
    case 'YESTERDAY':
      return trades.filter(t => {
        const tTime = getEffectiveTime(t);
        return tTime >= yesterdayMidnightIST && tTime < todayMidnightIST;
      });
    case '7D':
      return trades.filter(t => getEffectiveTime(t) >= now - 7 * dayMs);
    case '30D':
      return trades.filter(t => getEffectiveTime(t) >= now - 30 * dayMs);
    case 'ALL':
    default:
      return trades;
  }
}
