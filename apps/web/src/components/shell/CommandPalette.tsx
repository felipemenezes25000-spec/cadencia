'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import {
  CalendarBlank,
  CreditCard,
  MagnifyingGlass,
  Plus,
  Stethoscope,
  User,
  Wallet,
  X,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

interface CommandItem {
  readonly label: string;
  readonly meta: string;
  readonly href: string;
  readonly icon: PhosphorIcon;
}

const groups: readonly { label: string; items: readonly CommandItem[] }[] = [
  {
    label: 'Pacientes',
    items: [
      { label: 'Paciente Demo 01', meta: 'PAC-001 · Convênio Demo A', href: '/pacientes/PAC-001', icon: User },
      { label: 'Paciente Demo 03', meta: 'PAC-003 · Convênio Demo B', href: '/pacientes/PAC-003', icon: User },
    ],
  },
  {
    label: 'Atendimentos',
    items: [
      { label: 'Paciente Demo 03 · Hoje · 09:00', meta: 'Procedimento · Aguardando', href: '/atendimentos/ATD-003', icon: Stethoscope },
    ],
  },
  {
    label: 'Ações',
    items: [
      { label: 'Novo atendimento', meta: 'Criar atendimento clínico', href: '/agenda?novo=1', icon: Plus },
      { label: 'Registrar pagamento', meta: 'Abrir financeiro', href: '/financeiro', icon: CreditCard },
      { label: 'Abrir agenda', meta: 'Semana atual', href: '/agenda', icon: CalendarBlank },
    ],
  },
  {
    label: 'Telas',
    items: [
      { label: 'Financeiro', meta: 'Resumo da unidade', href: '/financeiro', icon: Wallet },
    ],
  },
];

export function CommandPalette({ open, onOpenChange }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const visibleGroups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return groups;
    return groups.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${item.label} ${item.meta}`.toLocaleLowerCase('pt-BR').includes(normalized)),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  function select(href: string) {
    onOpenChange(false);
    setQuery('');
    router.push(href);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[79] bg-text-primary/20 data-[state=open]:animate-[fadeIn_160ms_ease-out]" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-[80] w-[min(620px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-elev-3 data-[state=open]:animate-[scaleIn_160ms_var(--ease-out)]">
          <Dialog.Title className="sr-only">Busca global e comandos</Dialog.Title>
          <Dialog.Description className="sr-only">Busque pacientes, atendimentos, ações ou telas do Cadencia.</Dialog.Description>
          <div className="flex h-14 items-center gap-3 border-b border-border px-4">
            <MagnifyingGlass size={19} className="text-text-tertiary" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar paciente ou executar ação..."
              aria-label="Buscar paciente ou executar ação"
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
            />
            <Dialog.Close asChild>
              <button type="button" aria-label="Fechar busca" className="grid size-8 place-items-center rounded-lg text-text-tertiary hover:bg-surface-subtle hover:text-text-primary">
                <X size={17} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
            {visibleGroups.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="font-semibold text-text-primary">Nenhum resultado encontrado</p>
                <p className="mt-1 text-sm text-text-secondary">Tente buscar pelo nome do paciente ou pela ação desejada.</p>
              </div>
            ) : visibleGroups.map((group) => (
              <section key={group.label} aria-labelledby={`command-${group.label}`} className="mb-2 last:mb-0">
                <h2 id={`command-${group.label}`} className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[.08em] text-text-tertiary">{group.label}</h2>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button key={`${group.label}-${item.label}`} type="button" onClick={() => select(item.href)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors-fast hover:bg-surface-subtle focus-visible:bg-surface-subtle">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"><Icon size={16} aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-text-primary">{item.label}</span>
                        <span className="block truncate text-xs text-text-secondary">{item.meta}</span>
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border bg-surface-subtle px-4 py-2.5 text-[11px] text-text-tertiary">
            <span>Tab navegar · Enter abrir</span><span>Esc fechar</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
