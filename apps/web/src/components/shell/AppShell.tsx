'use client';

import { useEffect, useState, type ReactNode } from 'react';
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

/**
 * O dock e a UNICA navegacao estrutural no celular: a Sidebar e `hidden md:flex`.
 * Ele tinha cinco destinos fixos e o quinto, "Mais", era um link direto para
 * /configuracoes — ou seja, Financeiro, Convenios, Desempenho, Catalogos,
 * Bulario e Relatorios nao tinham nenhuma entrada no telefone. O produto tem 59
 * destinos; o celular alcancava 5. Chegar no resto dependia de adivinhar a URL
 * ou de saber que a lupa da TopBar indexa telas.
 *
 * Agora "Mais" abre a mesma arvore que a Sidebar desenha (`NAVEGACAO_SHELL` +
 * `CONFIG_NAV`), reaproveitada e nao duplicada: nav novo na Sidebar aparece no
 * celular sem ninguem lembrar de editar dois arquivos.
 */
export function MobileNavigation() {
  const pathname = usePathname();
  const [maisAberto, setMaisAberto] = useState(false);

  /* Os quatro do dock sao o fluxo do dia (recepcao e consultorio). O resto e
     gestao, que no celular e consulta pontual e cabe atras do "Mais". */
  const items = [
    { label: 'Hoje', href: '/hoje', icon: House },
    { label: 'Agenda', href: '/agenda', icon: CalendarBlank },
    { label: 'Pacientes', href: '/pacientes', icon: Users, activePrefix: '/pacientes' },
    { label: 'Mensagens', href: '/conversas', icon: ChatCircle, activePrefix: '/conversas' },
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

/** Folha inferior com a navegação completa. Fecha sozinha ao navegar — sem isso
 *  ela cobriria a tela recém-aberta, que no celular parece travamento. */
function PainelMais({ aberto, aoFechar, pathname }: {
  readonly aberto: boolean;
  readonly aoFechar: () => void;
  readonly pathname: string;
}) {
  const secoes = [
    ...NAVEGACAO_SHELL.map((grupo) => ({
      rotulo: grupo.rotulo as string,
      itens: grupo.itens.map((i) => ({ id: i.id, rotulo: i.rotulo, href: i.href })),
    })),
    { rotulo: 'Configurações', itens: CONFIG_NAV.filhos.map((f) => ({ id: f.id, rotulo: f.rotulo, href: f.href })) },
  ];

  return (
    <Dialog.Root open={aberto} onOpenChange={(v) => { if (!v) aoFechar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[89] bg-[#07191f]/45 backdrop-blur-[6px] data-[state=open]:animate-[fadeIn_160ms_ease-out] md:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-[90] flex max-h-[82vh] flex-col rounded-t-[22px] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-elev-3 data-[state=open]:animate-[slideUp_200ms_var(--ease-out)] md:hidden"
        >
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <Dialog.Title className="text-base font-bold tracking-[-0.02em] text-text">Navegar</Dialog.Title>
            <Dialog.Close className="grid size-9 shrink-0 place-items-center rounded-lg text-text-muted transition-colors-fast hover:bg-surface-hover hover:text-text" aria-label="Fechar navegação">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
            {secoes.map((secao) => (
              <div key={secao.rotulo} className="mb-5 last:mb-0">
                <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-text-faint">{secao.rotulo}</p>
                <div className="grid gap-1">
                  {secao.itens.map((item) => {
                    const ativo = pathname === item.href;
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        onClick={aoFechar}
                        aria-current={ativo ? 'page' : undefined}
                        className={cn(
                          /* 48px: acima do minimo de 44px da WCAG 2.2 para alvo
                             de toque, com folga para dedo em movimento. */
                          'flex min-h-[48px] items-center rounded-xl px-3 text-sm font-semibold transition-colors-fast',
                          ativo ? 'bg-accent-soft text-accent' : 'text-text-secondary hover:bg-surface-subtle hover:text-text',
                        )}
                      >
                        {item.rotulo}
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
