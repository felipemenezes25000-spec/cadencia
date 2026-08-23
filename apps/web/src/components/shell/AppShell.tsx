'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { CalendarBlank, ChatCircle, DotsThree, House, Users, X } from '@phosphor-icons/react';
import { ehRotaPublica, useSessao } from '../../sessao';
import { cn } from '../../lib/cn';
import { CONFIG_NAV, NAVEGACAO_SHELL } from '../../ui/nav';
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
    <div className="cadencia-shell-bg flex min-h-screen bg-canvas" style={{ '--nav-width': collapsed ? '76px' : '248px' } as CSSProperties}>
      <Sidebar collapsed={collapsed} onToggle={toggle} sessao={session} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="conteudo-principal" className="cadencia-workspace min-w-0 flex-1">{children}</main>
      </div>
      <MobileNavigation />
    </div>
  );
}

/** O dock mantém as ações do dia à mão; "Mais" abre todos os demais módulos. */
export function MobileNavigation() {
  const pathname = usePathname();
  const [maisAberto, setMaisAberto] = useState(false);

  const items = [
    { label: 'Hoje', href: '/hoje', icon: House, descricao: 'Fila e prioridades' },
    { label: 'Agenda', href: '/agenda', icon: CalendarBlank, descricao: 'Horários e confirmações' },
    { label: 'Pacientes', href: '/pacientes', icon: Users, activePrefix: '/pacientes', descricao: 'Cadastro e prontuário' },
    { label: 'Mensagens', href: '/conversas', icon: ChatCircle, activePrefix: '/conversas', descricao: 'Comunicação com cidadãos' },
  ] as const;

  const emMais = !items.some((item) => pathname === item.href
    || ('activePrefix' in item && pathname.startsWith(item.activePrefix)));

  return (
    <>
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
              aria-label={`${item.label}. ${item.descricao}`}
              title={item.descricao}
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

        <button
          type="button"
          onClick={() => setMaisAberto(true)}
          aria-haspopup="dialog"
          aria-expanded={maisAberto}
          aria-label="Mais módulos. Abre a navegação completa"
          title="Abrir todos os módulos"
          className={cn(
            'flex min-w-[58px] flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-semibold transition-colors-fast',
            emMais ? 'text-accent' : 'text-text-faint',
          )}
        >
          <span className={cn('grid size-8 place-items-center rounded-lg', emMais ? 'bg-accent-soft text-accent' : 'text-text-muted')}>
            <DotsThree size={19} weight={emMais ? 'fill' : 'bold'} aria-hidden />
          </span>
          Mais
        </button>
      </nav>

      <PainelMais aberto={maisAberto} aoFechar={() => setMaisAberto(false)} pathname={pathname} />
    </>
  );
}

function PainelMais({ aberto, aoFechar, pathname }: {
  readonly aberto: boolean;
  readonly aoFechar: () => void;
  readonly pathname: string;
}) {
  const secoes = [
    ...NAVEGACAO_SHELL.map((grupo) => ({
      rotulo: grupo.rotulo as string,
      itens: grupo.itens.map((i) => ({ id: i.id, rotulo: i.rotulo, href: i.href, descricao: i.descricao })),
    })),
    { rotulo: 'Configurações', itens: CONFIG_NAV.filhos.map((f) => ({ id: f.id, rotulo: f.rotulo, href: f.href, descricao: f.descricao })) },
  ];

  return (
    <Dialog.Root open={aberto} onOpenChange={(v) => { if (!v) aoFechar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[89] bg-[#07191f]/45 backdrop-blur-[6px] data-[state=open]:animate-[fadeIn_160ms_ease-out] md:hidden" />
        <Dialog.Content
          className="fixed inset-x-0 bottom-0 z-[90] flex max-h-[84vh] flex-col rounded-t-[22px] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-elev-3 data-[state=open]:animate-[slideUp_200ms_var(--ease-out)] md:hidden"
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-bold tracking-[-0.02em] text-text">Todos os módulos</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-relaxed text-text-muted">
                Escolha pelo que você precisa fazer. Cada módulo explica sua função antes de abrir.
              </Dialog.Description>
            </div>
            <Dialog.Close className="grid size-9 shrink-0 place-items-center rounded-lg text-text-muted transition-colors-fast hover:bg-surface-hover hover:text-text" aria-label="Fechar navegação">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
            {secoes.map((secao) => (
              <div key={secao.rotulo} className="mb-5 last:mb-0">
                <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-text-faint">{secao.rotulo}</p>
                <div className="grid gap-1.5">
                  {secao.itens.map((item) => {
                    const ativo = pathname === item.href;
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        onClick={aoFechar}
                        aria-current={ativo ? 'page' : undefined}
                        className={cn(
                          'flex min-h-[56px] flex-col justify-center rounded-xl px-3 py-2 text-left transition-colors-fast',
                          ativo ? 'bg-accent-soft text-accent' : 'text-text-secondary hover:bg-surface-subtle hover:text-text',
                        )}
                      >
                        <span className="text-sm font-semibold">{item.rotulo}</span>
                        {item.descricao ? <span className={cn('mt-0.5 text-[11px] leading-snug', ativo ? 'text-accent/80' : 'text-text-muted')}>{item.descricao}</span> : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
