'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarBlank, ChatCircle, DotsThree, House, Users } from '@phosphor-icons/react';
import { ehRotaPublica, useSessao } from '../../sessao';
import { cn } from '../../lib/cn';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  if (ehRotaPublica(pathname)) return <>{children}</>;
  return <AuthenticatedAppShell>{children}</AuthenticatedAppShell>;
}

function AuthenticatedAppShell({ children }: { readonly children: ReactNode }) {
  const session = useSessao();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem('cadencia:sidebar-collapsed') === 'true');
  }, []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem('cadencia:sidebar-collapsed', String(next));
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar
        collapsed={collapsed}
        onToggle={toggle}
        userName={session.usuario.nome}
        clinicName={session.vinculoAtivo.clinicNome}
        onSignOut={() => { void session.sair(); }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="conteudo-principal" className="min-w-0 flex-1">{children}</main>
      </div>
      <MobileNavigation />
    </div>
  );
}

function MobileNavigation() {
  const pathname = usePathname();
  const items = [
    { label: 'Hoje', href: '/hoje', icon: House },
    { label: 'Agenda', href: '/agenda', icon: CalendarBlank },
    { label: 'Pacientes', href: '/pacientes/PAC-001', icon: Users, activePrefix: '/pacientes' },
    { label: 'Mensagens', href: '/conversas', icon: ChatCircle },
    { label: 'Mais', href: '/configuracoes', icon: DotsThree },
  ] as const;
  return (
    <nav aria-label="Navegação móvel" className="fixed inset-x-0 bottom-0 z-30 flex h-[72px] items-start justify-around border-t border-border bg-surface/95 px-1 pt-2 backdrop-blur md:hidden">
      {items.map((item) => {
        const active = pathname === item.href
          || ('activePrefix' in item && pathname.startsWith(item.activePrefix))
          || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link key={item.label} href={item.href} aria-current={active ? 'page' : undefined} className={cn('flex min-w-[56px] flex-col items-center gap-1 rounded-lg px-1 py-1 text-[10px] font-semibold', active ? 'text-brand' : 'text-text-tertiary')}>
            <span className={cn('grid size-8 place-items-center rounded-lg', active && 'bg-brand-soft')}><Icon size={20} weight={active ? 'fill' : 'regular'} aria-hidden /></span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
