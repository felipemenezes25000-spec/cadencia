'use client';

/**
 * Componentes otimizados para mobile.
 *
 * - TouchTarget: wrapper 44x44px mínimo para touch
 * - OfflineIndicator: banner quando offline
 */

import { type ReactNode, useEffect, useState } from 'react';
import { WifiSlash } from '@phosphor-icons/react';

/* ── TouchTarget ──────────────────────────────────────────────── */

/**
 * Garante touch target de 44x44px mínimo (Apple HIG / WCAG).
 */
export function TouchTarget({
  children,
  className,
  minSize = 44,
  as: Tag = 'button',
  ...props
}: {
  children: ReactNode;
  className?: string;
  minSize?: number;
  as?: 'button' | 'a' | 'div';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Tag
      {...(props as React.HTMLAttributes<HTMLElement>)}
      className={className}
      style={{
        minWidth: minSize,
        minHeight: minSize,
      }}
    >
      {children}
    </Tag>
  );
}

/* ── OfflineIndicator ─────────────────────────────────────────── */

/**
 * Banner que aparece quando a conexão é perdida.
 */
export function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);

    function onOnline() { setOnline(true); setDismissed(false); }
    function onOffline() { setOnline(false); }

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online || dismissed) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-0 left-0 right-0 z-[200] bg-danger px-4 py-2.5 text-center text-sm text-white"
    >
      <div className="flex items-center justify-center gap-2">
        <WifiSlash size={18} aria-hidden />
        <span>Você está offline. Algumas funcionalidades podem estar limitadas.</span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dispensar"
          className="ml-2 rounded p-1 hover:bg-white/20"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/* ── Hooks ─────────────────────────────────────────────────────── */

/**
 * Detecta se está em device touch.
 */
export function useIsTouchDevice() {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    setIsTouch(
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0,
    );
  }, []);

  return isTouch;
}

/**
 * Detecta breakpoint mobile (< 768px).
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(window.matchMedia('(max-width: 768px)').matches);
    }
    check();
    const mq = window.matchMedia('(max-width: 768px)');
    mq.addEventListener('change', check);
    return () => mq.removeEventListener('change', check);
  }, []);

  return isMobile;
}
