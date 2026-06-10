import { doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';
import { db } from './firebase';

export async function initVirtualBalance(uid: string): Promise<number> {
  if (!uid) return 100000;
  const docRef = doc(db, 'tradeBot', uid, 'balance', 'current');
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const bal = snap.data().balance ?? 100000;
      try {
        localStorage.setItem('user_virtual_balance', String(bal));
      } catch (err) {
        // LocalStorage is unavailable or full
      }
      return bal;
    } else {
      await setDoc(docRef, { balance: 100000, upd: Math.floor(Date.now() / 1000) });
      try {
        localStorage.setItem('user_virtual_balance', '100000');
      } catch (err) {
        // LocalStorage is unavailable or full
      }
      return 100000;
    }
  } catch (e: any) {
    console.warn('[VirtualBalance] initVirtualBalance failed (falling back):', e?.message || e);
    try {
      const cached = localStorage.getItem('user_virtual_balance');
      if (cached) return parseFloat(cached);
    } catch (err) {
      // LocalStorage is unavailable
    }
    return 100000;
  }
}

export async function updateVirtualBalance(
  uid: string,
  delta: number
): Promise<number> {
  if (!uid) return 0;
  const docRef = doc(db, 'tradeBot', uid, 'balance', 'current');
  try {
    const newBalance = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      const current = snap.exists() ? (snap.data().balance ?? 100000) : 100000;
      const next = parseFloat((current + delta).toFixed(2));
      transaction.set(docRef, { balance: next, upd: Math.floor(Date.now() / 1000) }, { merge: true });
      return next;
    });
    try {
      localStorage.setItem('user_virtual_balance', String(newBalance));
    } catch (err) {
      // Ignore localStorage failure in environments where it's disabled or full
    }
    return newBalance;
  } catch (e: any) {
    console.error('[VB] updateVirtualBalance transaction failed:', e?.message || e);
    // Local fallback
    try {
      const cached = localStorage.getItem('user_virtual_balance');
      if (cached) {
        const next = parseFloat((parseFloat(cached) + delta).toFixed(2));
        localStorage.setItem('user_virtual_balance', String(next));
        return next;
      }
    } catch (err) {
      // Ignore localStorage failure in local fallback
    }
    return 0;
  }
}

export async function setVirtualBalanceValue(
  uid: string | null,
  value: number
): Promise<number> {
  const rounded = parseFloat(value.toFixed(2));
  try {
    localStorage.setItem('user_virtual_balance', String(rounded));
    localStorage.setItem('ledger_cached_balance', String(rounded));
  } catch (err) {
    // LocalStorage is unavailable or full
  }
  if (!uid) return rounded;
  const docRef = doc(db, 'tradeBot', uid, 'balance', 'current');
  try {
    await setDoc(docRef, { balance: rounded, upd: Math.floor(Date.now() / 1000) }, { merge: true });
    return rounded;
  } catch (e: any) {
    console.error('[VB] setVirtualBalanceValue failed:', e?.message || e);
    return rounded;
  }
}
