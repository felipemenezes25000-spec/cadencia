'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  CalendarBlank,
  ChatCircle,
  MagnifyingGlass,
  Plus,
  Sparkle,
} from '@phosphor-icons/react';
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
      <header className="cadencia-topbar sticky top-0 z-20 h-[72px] shrink-0 border-b border-line pt-[env(safe-area-inset-top)]">
        <div className="cadencia-topbar-inner">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="group hidden h-11 min-w-0 max-w-[720px] flex-1 items-center gap-3 rounded-[14px] border border-line bg-surface/82 px-3.5 text-left text-sm text-text-faint shadow-[inset_0_1px_0_rgb(255_255_255/.92),0_5px_18px_rgb(8_46_48/.035)] outline-none transition-all duration-150 hover:-translate-y-px hover:border-line-strong hover:bg-surface hover:shadow-elev-1 focus-visible:ring-2 focus-visible:ring-accent/60 md:flex"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-white">
              <MagnifyingGlass size={15} weight="bold" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate">Buscar pacientes, agenda, prontuários, telas e comandos</span>
            <span className="hidden items-center gap-1 text-[10px] font-semibold text-text-faint lg:flex">
              <span className="cadencia-command-key">⌘</span>
              <span className="cadencia-command-key">K</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Abrir busca global"
            className="grid size-10 place-items-center rounded-xl border border-line bg-surface/88 text-text-muted shadow-elev-1 md:hidden"
          >
            <MagnifyingGlass size={18} aria-hidden />
          </button>

          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            <span className="mr-2 hidden items-center gap-2 rounded-full border border-ok/15 bg-ok-soft/75 px-3 py-1.5 text-[11px] font-bold text-ok xl:inline-flex">
              <span className="cadencia-live-dot" aria-hidden />
              Operação online
            </span>
            <Link href="/agenda" aria-label="Abrir calendário" title="Abrir calendário" className="cadencia-icon-button hidden size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface/88 text-text-muted shadow-[inset_0_1px_0_rgb(255_255_255/.9)] transition-all duration-150 hover:-translate-y-px hover:border-line-strong hover:bg-surface hover:text-text hover:shadow-elev-1 sm:inline-grid"><CalendarBlank size={18} aria-hidden /></Link>
            <Link href="/conversas" aria-label="Abrir mensagens" title="Abrir mensagens" className="cadencia-icon-button hidden size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface/88 text-text-muted shadow-[inset_0_1px_0_rgb(255_255_255/.9)] transition-all duration-150 hover:-translate-y-px hover:border-line-strong hover:bg-surface hover:text-text hover:shadow-elev-1 sm:inline-grid"><ChatCircle size={18} aria-hidden /></Link>
            <Link href="/notificacoes" aria-label="Abrir notificações" title="Abrir notificações" className="cadencia-icon-button relative inline-grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface/88 text-text-muted shadow-[inset_0_1px_0_rgb(255_255_255/.9)] transition-all duration-150 hover:-translate-y-px hover:border-line-strong hover:bg-surface hover:text-text hover:shadow-elev-1"><Bell size={18} aria-hidden /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-danger ring-2 ring-surface" aria-hidden /></Link>
            <span className="mx-1.5 hidden h-6 w-px bg-line sm:block" aria-hidden />
            <Link href="/agenda?novo=1" className="cadencia-button group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-accent bg-accent px-3.5 text-sm font-semibold text-accent-on shadow-[0_10px_26px_rgb(7_118_111/.20),inset_0_1px_0_rgb(255_255_255/.18)] transition-all duration-150 hover:-translate-y-px hover:bg-accent-hover hover:shadow-[0_14px_32px_rgb(7_118_111/.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 max-sm:px-3">
              <span className="grid size-5 place-items-center rounded-md bg-white/12"><Plus size={14} weight="bold" aria-hidden /></span>
              <span className="max-sm:hidden">Novo atendimento</span><span className="sm:hidden">Novo</span>
              <Sparkle size={13} className="hidden opacity-55 lg:block" aria-hidden />
            </Link>
          </div>
        </div>
      </header>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
