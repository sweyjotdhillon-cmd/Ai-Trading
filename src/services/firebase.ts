import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore }              from 'firebase/firestore';
import { getAuth, Auth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Prevent duplicate initialization (React StrictMode / HMR safe)
const app: FirebaseApp =
  getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApps()[0];

export const db:   Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth: Auth      = getAuth(app);

// Explicitly enforce local persistence for robust session state recovery (especially on mobile browsers/devices)
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.warn('[Firebase Auth] Failed to enforce local browser persistence:', err);
});

export default app;
