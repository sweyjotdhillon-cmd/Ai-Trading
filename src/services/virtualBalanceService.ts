import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function initVirtualBalance(uid: string): Promise<number> {
  if (!uid) return 100000;
  const docRef = doc(db, 'tradeBot', uid, 'balance', 'current');
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data().balance ?? 100000;
    } else {
      await setDoc(docRef, { balance: 100000 });
      return 100000;
    }
  } catch (e) {
    console.error('[VirtualBalance] initVirtualBalance failed:', e);
    return 100000;
  }
}

export async function updateVirtualBalance(uid: string, realizedPnL: number): Promise<void> {
  if (!uid) return;
  const docRef = doc(db, 'tradeBot', uid, 'balance', 'current');
  try {
    const snap = await getDoc(docRef);
    const currentBal = snap.exists() ? (snap.data().balance ?? 100000) : 100000;
    const nextBal = parseFloat((currentBal + realizedPnL).toFixed(2));
    await setDoc(docRef, { balance: nextBal }, { merge: true });
  } catch (e) {
    console.error('[VirtualBalance] updateVirtualBalance failed:', e);
  }
}
