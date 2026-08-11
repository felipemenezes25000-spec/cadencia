'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  ChartBar,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  ChatCircle,
  GearSix,
  House,
  Pulse,
  ShieldCheck,
  SignOut,
  Stethoscope,
  UserCircleGear,
  Users,
  Wallet,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { cn } from '../../lib/cn';
import { Avatar } from '../ui/Avatar';

interface NavigationItem {
  readonly label: string;
  readonly href: string;
  readonly icon: PhosphorIcon;
  readonly badge?: number;
  readonly activePrefix?: string;
}

const groups: readonly { label: string; items: readonly NavigationItem[] }[] = [
  {
    label: 'Principal',
    items: [
      { label: 'Hoje', href: '/hoje', icon: House },
      { label: 'Agenda', href: '/agenda', icon: CalendarBlank },
      { label: 'Atendimentos', href: '/atendimentos/ATD-001', icon: Stethoscope, activePrefix: '/atendimentos' },
      { label: 'Pacientes', href: '/pacientes/PAC-001', icon: Users, activePrefix: '/pacientes' },
      { label: 'Mensagens', href: '/conversas', icon: ChatCircle, badge: 2 },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { label: 'Financeiro', href: '/financeiro', icon: Wallet },
      { label: 'Indicadores', href: '/desempenho', icon: ChartBar },
    ],
  },
  {
    label: 'Administração',
    items: [
      { label: 'Equipe', href: '/configuracoes/equipe', icon: UserCircleGear },
      { label: 'Convênios', href: '/convenios', icon: ShieldCheck },
      { label: 'Configurações', href: '/configuracoes', icon: GearSix },
    ],
  },
];

function NavigationLink({ item, collapsed }: { readonly item: NavigationItem; readonly collapsed: boolean }) {
  const pathname = usePathname();
  const active = pathname === item.href
    || (item.activePrefix !== undefined && pathname.startsWith(item.activePrefix))
    || (item.href !== '/hoje' && pathname.startsWith(`${item.href}/`));
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-10 items-center rounded-lg text-sm font-semibold transition-colors-fast',
        collapsed ? 'justify-center px-0' : 'gap-3 px-3',
        active ? 'bg-brand-soft text-brand' : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary',
      )}
    >
      {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-brand" aria-hidden /> : null}
      <Icon size={19} weight={active ? 'fill' : 'regular'} aria-hidden />
      {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
      {!collapsed && item.badge ? <span className="grid min-w-5 place-items-center rounded-full bg-info-soft px-1.5 text-[10px] font-bold text-info">{item.badge}</span> : null}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" sideOffset={9} className="z-[60] rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-primary shadow-elev-2">
          {item.label}<Tooltip.Arrow className="fill-surface" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Sidebar({ collapsed, onToggle, userName, clinicName, onSignOut }: {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly userName: string;
  readonly clinicName: string;
  readonly onSignOut: () => void;
}) {
  return (
    <aside className={cn(
      'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex',
      collapsed ? 'w-[72px]' : 'w-[240px]',
    )}>
      <div className={cn('flex h-[68px] shrink-0 items-center border-b border-border', collapsed ? 'justify-center px-2' : 'gap-3 px-4')}>
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand text-white"><Pulse size={21} weight="bold" aria-hidden /></span>
        {!collapsed ? (
          <div className="min-w-0">
            <div className="text-[15px] font-bold tracking-[-0.025em] text-text-primary">Cadencia</div>
            <div className="text-[9px] font-bold uppercase tracking-[.14em] text-text-tertiary">Clinical Intelligence</div>
          </div>
        ) : null}
      </div>

      <div className="px-2.5 py-3">
        <button type="button" className={cn('flex h-11 w-full items-center rounded-lg border border-border bg-surface-subtle text-left transition-colors-fast hover:border-border-strong', collapsed ? 'justify-center px-0' : 'gap-2 px-3')}>
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-brand-soft text-brand"><Stethoscope size={15} aria-hidden /></span>
          {!collapsed ? <><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-text-primary">Clínica Cadencia</span><span className="block truncate text-[10px] text-text-tertiary">Unidade Jardins</span></span><CaretDown size={14} className="text-text-tertiary" aria-hidden /></> : null}
        </button>
      </div>

      <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 scrollbar-thin">
        {groups.map((group) => (
          <section key={group.label} className="mb-4">
            {!collapsed ? <h2 className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[.1em] text-text-tertiary">{group.label}</h2> : <div className="mx-2 mb-2 h-px bg-border" />}
            <div className="space-y-1">
              {group.items.map((item) => <NavigationLink key={item.label} item={item} collapsed={collapsed} />)}
            </div>
          </section>
        ))}
      </nav>

      <div className="border-t border-border p-2.5">
        <div className={cn('flex items-center rounded-lg', collapsed ? 'justify-center py-2' : 'gap-3 px-2 py-2')}>
          <span className="relative"><Avatar initials="HV" name={userName} size="md" /><span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-surface bg-success" aria-label="Online" /></span>
          {!collapsed ? <div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-text-primary">{userName}</div><div className="truncate text-[10px] text-text-tertiary">{clinicName}</div></div> : null}
          {!collapsed ? <button type="button" onClick={onSignOut} aria-label="Sair" title="Sair" className="grid size-8 place-items-center rounded-lg text-text-tertiary hover:bg-surface-subtle hover:text-danger"><SignOut size={16} aria-hidden /></button> : null}
        </div>
        <button type="button" onClick={onToggle} aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'} className="mt-1 flex h-9 w-full items-center justify-center rounded-lg text-xs font-semibold text-text-tertiary transition-colors-fast hover:bg-surface-subtle hover:text-text-primary">
          <CaretLeft size={16} className={cn('transition-transform-fast', collapsed && 'rotate-180')} aria-hidden />
          {!collapsed ? <span className="ml-2">Recolher menu</span> : null}
        </button>
      </div>
    </aside>
  );
}
