import { useRef, useEffect, useCallback } from 'react';

export function useWakeLock() {
  const wakeLockRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isRequestedRef = useRef(false);

  useEffect(() => {
    // Create a silent audio element to play in the background to prevent the browser from throttling/killing the page.
    const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    audio.loop = true;
    audioRef.current = audio;
  }, []);

  const requestLock = useCallback(async () => {
    isRequestedRef.current = true;
    audioRef.current?.play().catch((err: any) => console.log('Audio playback failed:', err.message));
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      try {
        if (wakeLockRef.current) return;
        const lock = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current = lock;
        console.log('Screen Wake Lock active');

        lock.addEventListener('release', () => {
          console.log('Screen Wake Lock was released');
          wakeLockRef.current = null;
        });
      } catch (err: any) {
        console.log(`Wake Lock request failed: ${err.message}`);
      }
    }
  }, []);

  const releaseLock = useCallback(async () => {
    isRequestedRef.current = false;
    audioRef.current?.pause();
    if (wakeLockRef.current !== null) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Screen Wake Lock intentionally released');
      } catch (err: any) {
        console.log(`Wake Lock release failed: ${err.message}`);
      }
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isRequestedRef.current) {
        requestLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [requestLock]);

  return { requestLock, releaseLock };
}
