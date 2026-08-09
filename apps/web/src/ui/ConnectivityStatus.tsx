'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CloudSlash, WifiHigh } from '@phosphor-icons/react';

export function ConnectivityStatus() {
  const [online, setOnline] = useState(true);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let restoreTimer: number | undefined;
    const sync = () => setOnline(navigator.onLine);
    const onOnline = () => {
      setOnline(true);
      setRestored(true);
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => setRestored(false), 3200);
    };
    const onOffline = () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
      setOnline(false);
      setRestored(false);
    };
    sync();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return (
    <AnimatePresence>
      {!online ? (
        <motion.div
          key="offline" role="status" aria-live="polite"
          initial={{ y: -18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }}
          className="fixed left-1/2 top-3 z-[120] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-full border border-warn/20 bg-[color-mix(in_oklab,var(--surface)_92%,var(--warn-soft))] px-4 py-2 text-xs font-semibold text-text shadow-[var(--elev-float)] backdrop-blur-xl"
        ><CloudSlash size={16} weight="duotone" className="shrink-0 text-warn" /><span className="truncate">Sem conexão · o Cadencia continua disponível para leitura local.</span></motion.div>
      ) : restored ? (
        <motion.div
          key="restored" role="status" aria-live="polite"
          initial={{ y: -18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }}
          className="fixed left-1/2 top-3 z-[120] flex -translate-x-1/2 items-center gap-2 rounded-full border border-ok/20 bg-[color-mix(in_oklab,var(--surface)_94%,var(--ok-soft))] px-4 py-2 text-xs font-semibold text-text shadow-[var(--elev-float)] backdrop-blur-xl"
        ><WifiHigh size={16} weight="duotone" className="text-ok" />Conexão restaurada</motion.div>
      ) : null}
    </AnimatePresence>
  );
}
