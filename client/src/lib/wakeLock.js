import { useEffect, useRef } from 'react';

export function useWakeLock(active) {
  const lockRef = useRef(null);

  useEffect(() => {
    if (!('wakeLock' in navigator)) return undefined;
    let cancelled = false;

    async function acquire() {
      if (!active || document.visibilityState !== 'visible' || lockRef.current) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          lock.release().catch(() => {});
          return;
        }
        lockRef.current = lock;
        lock.addEventListener('release', () => {
          lockRef.current = null;
        });
      } catch {
        // Wake lock is best-effort (battery saver, unsupported).
      }
    }

    function release() {
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') acquire();
      else release();
    }

    if (active) acquire();
    else release();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [active]);
}
