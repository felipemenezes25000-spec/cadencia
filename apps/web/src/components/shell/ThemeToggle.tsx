'use client';

import { useTheme } from '../../lib/hooks/useTheme';
import {
  SunDim,
  MoonStars,
  Desktop,
} from '@phosphor-icons/react';

/**
 * Toggle de tema: alterna entre claro/escuro/sistema.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  const options: { value: 'light' | 'dark' | 'system'; label: string; icon: typeof SunDim }[] = [
    { value: 'light', label: 'Claro', icon: SunDim },
    { value: 'dark', label: 'Escuro', icon: MoonStars },
    { value: 'system', label: 'Sistema', icon: Desktop },
  ];

  return (
    <div className={className} role="group" aria-label="Selecionar tema">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          aria-pressed={theme === value}
          title={label}
          className={`
            inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
            transition-colors duration-150
            ${theme === value
              ? 'bg-accent-soft text-accent font-medium'
              : 'text-text-muted hover:bg-surface-hover hover:text-text'
            }
          `}
        >
          <Icon size={16} aria-hidden />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
