'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  CalendarBlank,
  ChatCircle,
  MagnifyingGlass,
  Plus,
} from '@phosphor-icons/react';
import { Button, IconButton } from '../ui/Button';
import { CommandPalette } from './CommandPalette';

export function TopBar() {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-20 flex h-[68px] shrink-0 items-center gap-4 border-b border-border bg-surface/95 px-4 backdrop-blur md:px-6">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="hidden h-10 min-w-0 max-w-[620px] flex-1 items-center gap-3 rounded-lg border border-border bg-surface-subtle px-3 text-left text-sm text-text-tertiary transition-colors-fast hover:border-border-strong md:flex"
        >
          <MagnifyingGlass size={18} aria-hidden />
          <span className="min-w-0 flex-1 truncate">Buscar paciente, atendimento, procedimento ou ação...</span>
          <span className="cadencia-command-key">⌘ K</span>
        </button>
        <button type="button" onClick={() => setPaletteOpen(true)} aria-label="Abrir busca global" className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-text-secondary md:hidden">
          <MagnifyingGlass size={18} aria-hidden />
        </button>

        <div className="ml-auto flex items-center gap-2">
          <IconButton icon={CalendarBlank} label="Abrir calendário" className="max-sm:hidden" onClick={() => router.push('/agenda')} />
          <span className="relative max-sm:hidden">
            <IconButton icon={ChatCircle} label="Abrir mensagens" onClick={() => router.push('/conversas')} />
            <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-danger text-[9px] font-bold text-white" aria-label="2 mensagens não lidas">2</span>
          </span>
          <IconButton icon={Bell} label="Abrir notificações" />
          <Button variant="primary" iconLeft={Plus} onClick={() => router.push('/agenda?novo=1')} className="max-sm:px-2.5">
            <span className="max-sm:hidden">Novo atendimento</span>
            <span className="sm:hidden">Novo</span>
          </Button>
        </div>
      </header>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
