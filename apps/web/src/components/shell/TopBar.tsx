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
import { Botao } from '../../ui/Botao';
import { BotaoIcone } from '../../ui/BotaoIcone';
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
      <header className="sticky top-0 z-20 flex h-[68px] shrink-0 items-center gap-4 border-b border-line bg-surface px-4 md:px-6">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="group hidden h-10 min-w-0 max-w-[640px] flex-1 items-center gap-3 rounded-[10px] border border-line bg-surface-subtle px-3.5 text-left text-sm text-text-faint transition-[border-color,background-color] duration-150 hover:border-line-strong hover:bg-surface md:flex"
        >
          <MagnifyingGlass size={17} className="shrink-0 text-text-muted transition-colors-fast group-hover:text-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Buscar paciente, atendimento, procedimento ou ação…</span>
          <span className="cadencia-command-key">⌘ K</span>
        </button>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Abrir busca global"
          className="grid size-9 place-items-center rounded-lg border border-line bg-surface text-text-muted md:hidden"
        >
          <MagnifyingGlass size={18} aria-hidden />
        </button>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <BotaoIcone icone={CalendarBlank} rotulo="Abrir calendário" className="max-sm:hidden" onClick={() => router.push('/agenda')} />
          <BotaoIcone icone={ChatCircle} rotulo="Abrir mensagens" className="max-sm:hidden" onClick={() => router.push('/conversas')} />
          <BotaoIcone icone={Bell} rotulo="Abrir notificações" onClick={() => router.push('/hoje#painel-unidade')} />
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <Botao variante="primario" iconeEsquerda={Plus} onClick={() => router.push('/agenda?novo=1')} className="max-sm:px-2.5">
            <span className="max-sm:hidden">Novo atendimento</span>
            <span className="sm:hidden">Novo</span>
          </Botao>
        </div>
      </header>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}