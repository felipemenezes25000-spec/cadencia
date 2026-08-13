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
    const notebook = window.matchMedia('(max-width: 1023px)');
    const aplicar = () => {
      setCollapsed(notebook.matches
        ? true
        : window.localStorage.getItem('cadencia:sidebar-collapsed') === 'true');
    };
    aplicar();
    notebook.addEventListener('change', aplicar);
    return () => notebook.removeEventListener('change', aplicar);
  }, []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem('cadencia:sidebar-collapsed', String(next));
      return next;
    });
  }

  return (
    <div className="cadencia-shell-bg flex min-h-screen bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={toggle} sessao={session} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="conteudo-principal" className="cadencia-workspace min-w-0 flex-1">{children}</main>
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
    { label: 'Pacientes', href: '/pacientes', icon: Users, activePrefix: '/pacientes' },
    { label: 'Mensagens', href: '/conversas', icon: ChatCircle },
    { label: 'Mais', href: '/configuracoes', icon: DotsThree },
  ] as const;

  return (
    <nav aria-label="Navegação móvel" className="cadencia-mobile-nav fixed inset-x-0 bottom-0 z-30 flex h-[68px] items-start justify-around border-t border-line bg-surface/90 px-1 pt-1.5 backdrop-blur-xl md:hidden">
      {items.map((item) => {
        const active = pathname === item.href
          || ('activePrefix' in item && pathname.startsWith(item.activePrefix))
          || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-w-[58px] flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-semibold transition-colors-fast',
              active ? 'text-accent' : 'text-text-faint',
            )}
          >
            <span className={cn('grid size-8 place-items-center rounded-lg', active ? 'bg-accent-soft text-accent' : 'text-text-muted')}>
              <Icon size={19} weight={active ? 'fill' : 'regular'} aria-hidden />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
