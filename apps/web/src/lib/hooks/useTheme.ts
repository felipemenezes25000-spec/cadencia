'use client';

/**
 * Theme hook: gerencia dark/light mode com persistência.
 *
 * Uso:
 * ```tsx
 * const { theme, setTheme, toggle } = useTheme();
 * ```
 */

import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'cadencia-theme';

function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY) as Theme | null;
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return getSystemTheme();
  return theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme() ?? 'system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolveTheme(theme));

  /* ── aplicar ao DOM ─────────────────────────────────────────── */

  const applyTheme = useCallback((t: 'light' | 'dark') => {
    const root = document.documentElement;
    root.dataset.theme = t;
    // color-scheme é definido no CSS
    setResolvedTheme(t);
  }, []);

  /* ── watcher para system ─────────────────────────────────────── */

  useEffect(() => {
    const t = resolveTheme(theme);
    applyTheme(t);

    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    function onChange() { applyTheme(getSystemTheme()); }
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, applyTheme]);

  /* ── API pública ─────────────────────────────────────────────── */

  function setTheme(t: Theme) {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  }

  function toggle() {
    const current = resolveTheme(theme);
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  return {
    theme,
    resolvedTheme,
    setTheme,
    toggle,
    isDark: resolvedTheme === 'dark',
  };
}
