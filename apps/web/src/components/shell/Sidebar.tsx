'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import {
  CaretDown,
  CaretLeft,
  Check,
  Pulse,
  SignOut,
  Stethoscope,
} from '@phosphor-icons/react';
import { cn } from '../../lib/cn';
import type { Sessao } from '../../sessao';
import { rotulo } from '../../sessao';
import { Avatar } from '../../ui/Avatar';
import { NAVEGACAO_SHELL, type ItemDoShell } from '../../ui/nav';

function ItemDeNavegacao({ item, collapsed }: {
  readonly item: ItemDoShell;
  readonly collapsed: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === item.href
    || (item.prefixoAtivo !== undefined && pathname.startsWith(item.prefixoAtivo))
    || (!item.href.includes('#') && item.href !== '/hoje' && pathname.startsWith(`${item.href}/`));
  const Icone = item.icone;

  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-10 items-center rounded-[10px] text-sm font-semibold tracking-[-0.01em] transition-colors-fast',
        collapsed ? 'justify-center' : 'gap-3 px-3',
        active
          ? 'bg-nav-active text-white'
          : 'text-nav-muted hover:bg-white/[.055] hover:text-nav-text',
      )}
    >
      {active ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-nav-accent" aria-hidden /> : null}
      <Icone size={19} weight={active ? 'fill' : 'regular'} className={active ? 'text-nav-accent' : undefined} aria-hidden />
      {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.rotulo}</span> : null}
      {!collapsed && item.badge ? (
        <span className="grid min-w-5 place-items-center rounded-full bg-white/[.10] px-1.5 text-[10px] font-bold text-nav-text">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{link}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side="right"
          sideOffset={10}
          className="z-[60] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-text shadow-elev-2"
        >
          {item.rotulo}
          <RadixTooltip.Arrow className="fill-surface" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

function SeletorDeUnidade({ sessao, collapsed }: {
  readonly sessao: Sessao;
  readonly collapsed: boolean;
}) {
  const ativa = sessao.vinculoAtivo;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Trocar unidade. Atual: ${ativa.clinicNome}`}
          className={cn(
            'flex h-12 w-full items-center rounded-xl border border-white/[.09] bg-white/[.045] text-left transition-colors-fast hover:border-white/[.16] hover:bg-white/[.07]',
            collapsed ? 'justify-center' : 'gap-2.5 px-3',
          )}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[.09] text-nav-accent">
            <Stethoscope size={15} weight="bold" aria-hidden />
          </span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-nav-text">{ativa.clinicNome}</span>
                <span className="block truncate text-[11px] text-nav-muted">{ativa.tenantNome}</span>
              </span>
              <CaretDown size={14} className="text-nav-muted" aria-hidden />
            </>
          ) : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="start"
          sideOffset={9}
          className="z-[60] min-w-[280px] rounded-2xl border border-line bg-surface p-1.5 shadow-elev-2"
        >
          <DropdownMenu.Label className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-text-faint">
            Unidade de trabalho
          </DropdownMenu.Label>
          {sessao.usuario.vinculos.map((vinculo) => {
            const selecionada = vinculo.clinicId === ativa.clinicId;
            return (
              <DropdownMenu.Item
                key={`${vinculo.tenantId}:${vinculo.clinicId}`}
                onSelect={() => {
                  if (!selecionada) void sessao.trocarUnidade(vinculo.clinicId);
                }}
                className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2.5 outline-none data-[highlighted]:bg-surface-subtle"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <Stethoscope size={16} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-text">{vinculo.clinicNome}</span>
                  <span className="block truncate text-xs text-text-muted">{vinculo.tenantNome} · {rotulo(vinculo.role)}</span>
                </span>
                {selecionada ? <Check size={16} className="text-ok" aria-label="Unidade atual" /> : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Sidebar({ collapsed, onToggle, sessao }: {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly sessao: Sessao;
}) {
  return (
    <RadixTooltip.Provider delayDuration={250}>
      <aside className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/[.06] bg-nav transition-[width] duration-200 md:flex',
        collapsed ? 'w-[72px]' : 'w-[240px]',
      )}>
        <div className={cn('flex h-[68px] shrink-0 items-center border-b border-white/[.07]', collapsed ? 'justify-center px-2' : 'gap-3 px-4')}>
          <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-white text-nav shadow-elev-1">
            <Pulse size={21} weight="bold" aria-hidden />
          </span>
          {!collapsed ? (
            <div className="min-w-0">
              <div className="text-[15px] font-bold tracking-[-0.03em] text-white">Cadencia</div>
              <div className="text-[9px] font-bold uppercase tracking-[.16em] text-nav-accent">Clinical OS</div>
            </div>
          ) : null}
        </div>

        <div className="px-2.5 py-3">
          <SeletorDeUnidade sessao={sessao} collapsed={collapsed} />
        </div>

        <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 scrollbar-thin">
          {NAVEGACAO_SHELL.map((grupo) => (
            <section key={grupo.rotulo} className="mb-4">
              {!collapsed ? (
                <h2 className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[.12em] text-nav-muted">{grupo.rotulo}</h2>
              ) : <div className="mx-2 mb-2 h-px bg-white/[.08]" />}
              <div className="space-y-1">
                {grupo.itens.map((item) => <ItemDeNavegacao key={item.id} item={item} collapsed={collapsed} />)}
              </div>
            </section>
          ))}
        </nav>

        <div className="border-t border-white/[.08] p-2.5">
          <div className={cn('flex items-center rounded-xl', collapsed ? 'justify-center py-2' : 'gap-3 px-2 py-2')}>
            <span className="relative">
              <Avatar nome={sessao.usuario.nome} />
              <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-nav bg-ok" aria-label="Online" />
            </span>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-nav-text">{sessao.usuario.nome}</div>
                <div className="truncate text-[11px] text-nav-muted">{rotulo(sessao.vinculoAtivo.role)} · {sessao.vinculoAtivo.clinicNome}</div>
              </div>
            ) : null}
            {!collapsed ? (
              <button
                type="button"
                onClick={() => { void sessao.sair(); }}
                aria-label="Sair"
                title="Sair"
                className="grid size-8 place-items-center rounded-lg text-nav-muted hover:bg-white/[.07] hover:text-white"
              >
                <SignOut size={16} aria-hidden />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
            className="mt-1 flex h-9 w-full items-center justify-center rounded-lg text-xs font-semibold text-nav-muted transition-colors-fast hover:bg-white/[.055] hover:text-nav-text"
          >
            <CaretLeft size={16} className={cn('transition-transform-fast', collapsed && 'rotate-180')} aria-hidden />
            {!collapsed ? <span className="ml-2">Recolher menu</span> : null}
          </button>
        </div>
      </aside>
    </RadixTooltip.Provider>
  );
}
