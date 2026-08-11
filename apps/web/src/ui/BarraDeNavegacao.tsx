'use client';

/*
 * Adaptador legado da navegacao. O AppShell novo usa components/shell/Sidebar,
 * mas esta exportacao continua clara e funcional para consumidores historicos.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CaretLeft,
  DotsThree,
  GearSix,
  Pulse,
  User,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { useMediaQuery } from '../lib/hooks';
import { ehRotaPublica, useSessao } from '../sessao';
import { CONFIG_NAV, FASE_ATUAL, ITENS_NAV } from './nav';

const STORAGE_KEY = 'cadencia:nav-colapsado';

export function BarraDeNavegacao() {
  const pathname = usePathname();
  if (ehRotaPublica(pathname)) return null;
  return <BarraInterna />;
}

function BarraInterna() {
  const pathname = usePathname();
  const session = useSessao();
  const mobile = useMediaQuery('(max-width: 767px)');
  const [collapsed, setCollapsed] = useState(false);
  const items = ITENS_NAV.filter((item) => item.disponivelNaFase <= FASE_ATUAL);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === 'true');
  }, []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  if (mobile) {
    const visible = items.slice(0, 4);
    return (
      <nav aria-label="Navegacao principal" className="fixed inset-x-0 bottom-0 z-30 flex h-[72px] items-start justify-around border-t border-border bg-surface px-2 pt-2">
        {visible.map((item) => {
          const Icon = item.icone;
          const active = pathname.startsWith(item.href);
          return <Link key={item.id} href={item.href} aria-current={active ? 'page' : undefined} className={cn('flex min-w-[54px] flex-col items-center gap-1 rounded-lg p-1 text-[10px] font-semibold', active ? 'text-brand' : 'text-text-tertiary')}><span className={cn('grid size-8 place-items-center rounded-lg', active && 'bg-brand-soft')}><Icon size={19} weight={active ? 'fill' : 'regular'} /></span>{item.rotulo}</Link>;
        })}
        <button type="button" aria-label="Mais opcoes" className="flex min-w-[54px] flex-col items-center gap-1 rounded-lg p-1 text-[10px] font-semibold text-text-tertiary"><span className="grid size-8 place-items-center rounded-lg"><DotsThree size={20} /></span>Mais</button>
      </nav>
    );
  }

  const workspace = items.filter((item) => item.grupo === 'workspace');
  const management = items.filter((item) => item.grupo === 'gestao');
  return (
    <nav aria-label="Navegacao principal" className={cn('fixed inset-y-0 left-0 z-30 flex flex-col border-r border-border bg-surface transition-[width] duration-200', collapsed ? 'w-[72px]' : 'w-[240px]')}>
      <div className={cn('flex h-[68px] items-center border-b border-border', collapsed ? 'justify-center' : 'gap-3 px-4')}><span className="grid size-9 place-items-center rounded-lg bg-brand text-white"><Pulse size={20} weight="bold" /></span>{!collapsed ? <div><p className="font-bold">Cadencia</p><p className="text-[9px] font-bold uppercase tracking-[.12em] text-text-tertiary">Clinical Intelligence</p></div> : null}</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-4">
        <LegacyGroup title="Workspace" items={workspace} pathname={pathname} collapsed={collapsed} />
        <LegacyGroup title="Gestao" items={management} pathname={pathname} collapsed={collapsed} />
      </div>
      <div className="border-t border-border p-2.5">
        <Link href={CONFIG_NAV.href} className={cn('mb-2 flex h-10 items-center rounded-lg text-sm font-semibold text-text-secondary hover:bg-surface-subtle', collapsed ? 'justify-center' : 'gap-3 px-3')}><GearSix size={18} />{!collapsed ? CONFIG_NAV.rotulo : null}</Link>
        <div className={cn('flex items-center rounded-lg bg-surface-subtle p-2', collapsed ? 'justify-center' : 'gap-3')}><span className="grid size-8 place-items-center rounded-full bg-brand-soft text-brand"><User size={16} /></span>{!collapsed ? <div className="min-w-0"><p className="truncate text-xs font-bold">{session.usuario.nome}</p><p className="truncate text-[10px] text-text-tertiary">{session.vinculoAtivo.clinicNome}</p></div> : null}</div>
        <button type="button" onClick={toggle} aria-label={collapsed ? 'Expandir navegacao' : 'Colapsar navegacao'} className="mt-2 flex h-9 w-full items-center justify-center rounded-lg text-xs font-semibold text-text-tertiary hover:bg-surface-subtle"><CaretLeft size={16} className={cn(collapsed && 'rotate-180')} />{!collapsed ? <span className="ml-2">Colapsar</span> : null}</button>
      </div>
    </nav>
  );
}

function LegacyGroup({ title, items, pathname, collapsed }: {
  readonly title: string;
  readonly items: readonly (typeof ITENS_NAV)[number][];
  readonly pathname: string;
  readonly collapsed: boolean;
}) {
  return <section className="mb-5">{!collapsed ? <h2 className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[.1em] text-text-tertiary">{title}</h2> : <div className="mx-2 mb-2 h-px bg-border" />}<div className="space-y-1">{items.map((item) => { const Icon = item.icone; const active = pathname.startsWith(item.href); return <Link key={item.id} href={item.href} title={collapsed ? item.rotulo : undefined} aria-current={active ? 'page' : undefined} className={cn('flex h-10 items-center rounded-lg text-sm font-semibold transition-colors-fast', collapsed ? 'justify-center' : 'gap-3 px-3', active ? 'bg-brand-soft text-brand' : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary')}><Icon size={18} weight={active ? 'fill' : 'regular'} />{!collapsed ? item.rotulo : null}</Link>; })}</div></section>;
}
