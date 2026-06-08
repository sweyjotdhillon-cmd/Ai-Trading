import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore }              from 'firebase/firestore';
import { getAuth, Auth, setPersistence, browserLocalPersistence } from 'firebase/auth';

const firebaseConfig = {
  projectId:         'gen-lang-client-0935111175',
  appId:             '1:600299763081:web:21e39c07ae9bd68bb51d58',
  apiKey:            'AIzaSyDJchusQzz_gnEEo2WmLhymIwBOThKrWYg',
  authDomain:        'gen-lang-client-0935111175.firebaseapp.com',
  storageBucket:     'gen-lang-client-0935111175.firebasestorage.app',
  messagingSenderId: '600299763081',
};

// Prevent duplicate initialization (React StrictMode / HMR safe)
const app: FirebaseApp =
  getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApps()[0];

export const db:   Firestore = getFirestore(app);
export const auth: Auth      = getAuth(app);

// Explicitly enforce local persistence for robust session state recovery (especially on mobile browsers/devices)
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.warn('[Firebase Auth] Failed to enforce local browser persistence:', err);
});

export default app;
