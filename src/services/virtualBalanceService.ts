import { doc, getDoc, setDoc, increment } from 'firebase/firestore';
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
  realizedPnL: number
): Promise<number> {
  if (!uid) return 0;
  const docRef = doc(db, 'tradeBot', uid, 'balance', 'current');
  try {
    // Perform an atomic increment on the database side to protect against race conditions
    await setDoc(docRef, { 
      balance: increment(realizedPnL), 
      upd: Math.floor(Date.now() / 1000) 
    }, { merge: true });

    // Read the updated balance to ensure accurate state returned to the app
    const snap = await getDoc(docRef);
    const next = snap.exists() ? (snap.data().balance ?? 100000) : 100000;
    const rounded = parseFloat(next.toFixed(2));

    try {
      localStorage.setItem('user_virtual_balance', String(rounded));
    } catch (err) {
      // LocalStorage is unavailable or full
    }
    return rounded;
  } catch (e: any) {
    console.error('[VB] updateVirtualBalance failed:', e?.message || e);
    try {
      const cached = localStorage.getItem('user_virtual_balance');
      if (cached) {
        const next = parseFloat((parseFloat(cached) + realizedPnL).toFixed(2));
        localStorage.setItem('user_virtual_balance', String(next));
        return next;
      }
    } catch (err) {
      // LocalStorage is unavailable
    }
    return 0;   // 0 means caller should use local fallback
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
