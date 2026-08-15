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
        'group relative flex min-h-10 items-center overflow-hidden rounded-xl text-[13px] font-semibold tracking-[-0.012em] outline-none transition-all duration-150',
        collapsed ? 'justify-center px-2' : 'gap-3 px-3',
        active
          ? 'bg-accent-soft text-accent shadow-[inset_0_1px_0_rgb(255_255_255_/_0.055),0_8px_22px_rgb(0_0_0_/_0.12)]'
          : 'text-text-muted hover:bg-surface-subtle hover:text-text',
      )}
    >
      {active ? (
        <>
          <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent shadow-[0_0_18px_var(--brand)]" aria-hidden />
          <span className="absolute inset-y-0 right-0 w-14 bg-[radial-gradient(circle_at_right,var(--brand-soft),transparent_70%)] opacity-80" aria-hidden />
        </>
      ) : null}
      <span className={cn(
        'relative z-[1] grid size-7 shrink-0 place-items-center rounded-lg transition-all duration-150',
        active ? 'bg-accent/15 text-accent' : 'text-text-faint group-hover:bg-surface-sunken group-hover:text-text-muted',
      )}>
        <Icone size={17} weight={active ? 'fill' : 'regular'} aria-hidden />
      </span>
      {!collapsed ? <span className="relative z-[1] min-w-0 flex-1 truncate">{item.rotulo}</span> : null}
      {!collapsed && item.badge ? (
        <span className="relative z-[1] grid min-w-5 place-items-center rounded-full border border-line bg-surface-sunken px-1.5 text-[10px] font-bold text-text-muted">
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
          className="z-[60] rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-text shadow-elev-2"
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
            'group flex min-h-[52px] w-full items-center rounded-[14px] border border-line bg-surface-subtle text-left shadow-[inset_0_1px_0_rgb(255_255_255_/_0.045)] outline-none transition-all duration-150 hover:border-line-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent/70',
            collapsed ? 'justify-center px-2' : 'gap-2.5 px-3',
          )}
        >
          <span className="relative grid size-8 shrink-0 place-items-center rounded-[10px] border border-accent/15 bg-accent-soft text-accent shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)]">
            <Stethoscope size={16} weight="bold" aria-hidden />
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-surface-subtle bg-ok" aria-hidden />
          </span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold tracking-[-0.01em] text-text">{ativa.clinicNome}</span>
                <span className="mt-0.5 block truncate text-[10px] font-medium text-text-faint">{ativa.tenantNome}</span>
              </span>
              <CaretDown size={14} className="text-text-faint transition-transform duration-150 group-data-[state=open]:rotate-180" aria-hidden />
            </>
          ) : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="start"
          sideOffset={10}
          className="z-[60] min-w-[300px] rounded-2xl border border-line bg-surface/98 p-2 shadow-elev-3 backdrop-blur-xl"
        >
          <DropdownMenu.Label className="px-3 pb-2 pt-1.5 text-[10px] font-bold uppercase tracking-[.11em] text-text-faint">
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
                className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 outline-none data-[highlighted]:bg-surface-subtle"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent">
                  <Stethoscope size={17} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-text">{vinculo.clinicNome}</span>
                  <span className="mt-0.5 block truncate text-xs text-text-muted">{vinculo.tenantNome} · {rotulo(vinculo.role)}</span>
                </span>
                {selecionada ? <Check size={17} weight="bold" className="text-ok" aria-label="Unidade atual" /> : null}
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
        'cadencia-sidebar sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-line transition-[width] duration-200 md:flex',
        collapsed ? 'w-[76px]' : 'w-[248px]',
      )}>
        <div className={cn('relative flex h-[72px] shrink-0 items-center border-b border-line', collapsed ? 'justify-center px-2' : 'gap-3 px-4')}>
          <span className="cadencia-brand-mark relative grid size-10 shrink-0 place-items-center rounded-[13px] bg-accent text-[#031f20]">
            <Pulse size={22} weight="bold" aria-hidden />
          </span>
          {!collapsed ? (
            <div className="min-w-0">
              <div className="text-[16px] font-bold tracking-[-0.035em] text-text">Cadência</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.15em] text-text-faint">
                <span>Clinical OS</span>
                <span className="size-1 rounded-full bg-accent" aria-hidden />
                <span>Live</span>
              </div>
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
                <h2 className="mb-1.5 px-3 text-[9px] font-bold uppercase tracking-[.13em] text-text-faint">{grupo.rotulo}</h2>
              ) : <div className="mx-2 mb-2 h-px bg-line" />}
              <div className="space-y-1">
                {grupo.itens.map((item) => <ItemDeNavegacao key={item.id} item={item} collapsed={collapsed} />)}
              </div>
            </section>
          ))}
        </nav>

        <div className="border-t border-line p-2.5">
          <div className={cn('rounded-[14px] border border-transparent bg-surface-subtle/45', collapsed ? 'p-1.5' : 'p-2')}>
            <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
              <span className="relative">
                <Avatar nome={sessao.usuario.nome} />
                <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-surface bg-ok shadow-[0_0_0_2px_var(--surface-subtle)]" aria-hidden />
              </span>
              {!collapsed ? (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold text-text">{sessao.usuario.nome}</div>
                  <div className="mt-0.5 truncate text-[10px] text-text-muted">{rotulo(sessao.vinculoAtivo.role)} · Online<span className="sr-only"> na unidade {sessao.vinculoAtivo.clinicNome}</span></div>
                </div>
              ) : null}
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => sessao.sair()}
                  aria-label="Sair"
                  title="Sair"
                  className="grid size-8 place-items-center rounded-lg text-text-faint transition-colors hover:bg-surface-sunken hover:text-text"
                >
                  <SignOut size={16} aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
            className="mt-1.5 flex h-9 w-full items-center justify-center rounded-xl text-[11px] font-semibold text-text-faint transition-colors-fast hover:bg-surface-subtle hover:text-text-muted"
          >
            <CaretLeft size={15} className={cn('transition-transform-fast', collapsed && 'rotate-180')} aria-hidden />
            {!collapsed ? <span className="ml-2">Recolher menu</span> : null}
          </button>
        </div>
      </aside>
    </RadixTooltip.Provider>
  );
}
