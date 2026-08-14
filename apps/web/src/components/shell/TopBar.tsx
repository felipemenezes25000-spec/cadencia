'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, CalendarBlank, ChatCircle, MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { CommandPalette } from './CommandPalette';

export function TopBar() {
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
      {/* Com viewport-fit=cover o layout encosta no topo fisico da tela, entao
          o header precisa se afastar do notch por conta propria. */}
      <header className="cadencia-topbar sticky top-0 z-20 flex h-[68px] shrink-0 items-center gap-4 border-b border-line px-4 pt-[env(safe-area-inset-top)] md:px-6">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="group hidden h-10 min-w-0 max-w-[680px] flex-1 items-center gap-3 rounded-xl border border-line bg-surface/75 px-3.5 text-left text-sm text-text-faint shadow-[0_1px_0_rgb(255_255_255/.7)_inset] transition-all-fast hover:-translate-y-px hover:border-line-strong hover:bg-surface hover:shadow-elev-1 md:flex"
        >
          <MagnifyingGlass size={17} className="shrink-0 text-text-muted transition-colors-fast group-hover:text-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Buscar pacientes, catálogos, telas e comandos…</span>
          <span className="cadencia-command-key">⌘ K</span>
        </button>
        <button type="button" onClick={() => setPaletteOpen(true)} aria-label="Abrir busca global" className="grid size-10 place-items-center rounded-xl border border-line bg-surface/80 text-text-muted shadow-elev-1 md:hidden"><MagnifyingGlass size={18} aria-hidden /></button>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <Link href="/agenda" aria-label="Abrir calendário" title="Abrir calendário" className="cadencia-icon-button hidden size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-text-muted transition-colors-fast hover:border-line-strong hover:bg-surface-subtle hover:text-text sm:inline-grid"><CalendarBlank size={18} aria-hidden /></Link>
          <Link href="/conversas" aria-label="Abrir mensagens" title="Abrir mensagens" className="cadencia-icon-button hidden size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-text-muted transition-colors-fast hover:border-line-strong hover:bg-surface-subtle hover:text-text sm:inline-grid"><ChatCircle size={18} aria-hidden /></Link>
          <Link href="/notificacoes" aria-label="Abrir notificações" title="Abrir notificações" className="cadencia-icon-button inline-grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-text-muted transition-colors-fast hover:border-line-strong hover:bg-surface-subtle hover:text-text"><Bell size={18} aria-hidden /></Link>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <Link href="/agenda?novo=1" className="cadencia-button inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[10px] border border-accent bg-accent px-3.5 text-sm font-semibold text-accent-on shadow-[0_8px_20px_rgb(11_107_118/.18)] transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 max-sm:px-2.5">
            <Plus size={16} aria-hidden />
            <span className="max-sm:hidden">Novo atendimento</span><span className="sm:hidden">Novo</span>
          </Link>
        </div>
      </header>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
