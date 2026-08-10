'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ehRotaPublica } from '../sessao';
import {
  CaretLeft,
  DotsThreeVertical,
  Stethoscope,
  User,
  MagnifyingGlass,
  ArrowRight,
  WifiHigh,
} from '@phosphor-icons/react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import * as RadixPopover from '@radix-ui/react-popover';
import * as RadixDialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/cn';
import { useMediaQuery } from '../lib/hooks';
import { FASE_ATUAL, ITENS_NAV } from './nav';

const CHAVE_COLAPSADO = 'cadencia:nav-colapsado';
const ITENS_MOBILE_VISIVEIS = 5;

function useSidebarColapsado() {
  const [colapsado, setColapsado] = useState(false);

  useEffect(() => {
    const salvo = localStorage.getItem(CHAVE_COLAPSADO);
    if (salvo !== null) setColapsado(salvo === 'true');
  }, []);

  const alternar = useCallback(() => {
    setColapsado((prev) => {
      const novo = !prev;
      localStorage.setItem(CHAVE_COLAPSADO, String(novo));
      return novo;
    });
  }, []);

  return { colapsado, alternar };
}

function TooltipItem({ conteudo, ativo, children }: {
  readonly conteudo: string;
  readonly ativo: boolean;
  readonly children: React.ReactNode;
}) {
  if (!ativo) return <>{children}</>;
  return (
    <RadixTooltip.Root delayDuration={180}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side="right" sideOffset={12}
          className="z-50 rounded-xl border border-line bg-surface/95 px-3 py-2 text-xs font-medium text-text shadow-elev-2 backdrop-blur-xl animate-[scaleIn_150ms_var(--ease-out)] select-none"
        >
          {conteudo}
          <RadixTooltip.Arrow className="fill-surface" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

function CommandPalette({ aberto, setAberto }: {
  readonly aberto: boolean;
  readonly setAberto: (aberto: boolean) => void;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState('');
  const itens = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    return ITENS_NAV.filter((item) => item.disponivelNaFase <= FASE_ATUAL)
      .filter((item) => !termo || item.rotulo.toLocaleLowerCase('pt-BR').includes(termo));
  }, [busca]);

  function ir(href: string) {
    setAberto(false);
    setBusca('');
    router.push(href);
  }

  return (
    <RadixDialog.Root open={aberto} onOpenChange={setAberto}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[79] bg-[oklch(10%_0.03_270_/_0.44)] backdrop-blur-[5px] animate-[fadeIn_160ms_ease-out]" />
        <RadixDialog.Content
          className={cn(
            'fixed left-1/2 top-[12vh] z-[80] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden',
            'rounded-[24px] border border-white/50 bg-surface/96 shadow-[var(--elev-float)] backdrop-blur-2xl',
            'animate-[scaleIn_190ms_var(--ease-out)] max-sm:top-4',
          )}
        >
          <RadixDialog.Title className="sr-only">Busca e comandos</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">Navegue rapidamente pelas areas do Cadencia.</RadixDialog.Description>

          <div className="flex items-center gap-3 border-b border-line/80 px-5 py-4">
            <MagnifyingGlass size={20} className="shrink-0 text-text-muted" aria-hidden />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Ir para uma area..."
              aria-label="Buscar comando"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-text-faint"
            />
            <kbd className="cadencia-command-key text-text-faint">esc</kbd>
          </div>

          <div className="max-h-[52vh] overflow-y-auto p-2.5 scrollbar-thin">
            <p className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[.13em] text-text-faint">Navegacao</p>
            <div className="grid gap-1">
              {itens.map((item) => {
                const Icone = item.icone;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => ir(item.href)}
                    className="group flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left text-sm text-text transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover"
                  >
                    <span className="cadencia-icon-orb h-9 w-9 shrink-0"><Icone size={18} weight="duotone" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{item.rotulo}</span>
                      <span className="block text-[11px] text-text-faint">Abrir {item.rotulo.toLocaleLowerCase('pt-BR')}</span>
                    </span>
                    <span className="flex items-center gap-2 text-text-faint">
                      <kbd className="cadencia-command-key">⌥{item.atalho}</kbd>
                      <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </button>
                );
              })}
              {itens.length === 0 && (
                <div className="px-3 py-10 text-center text-sm text-text-muted">Nenhum comando encontrado.</div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-line/80 bg-surface-sunken/55 px-5 py-3 text-[10px] text-text-faint">
            <span className="flex items-center gap-1.5"><WifiHigh size={13} className="text-ok" /> Workspace conectado</span>
            <span>Enter abre · Esc fecha</span>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function MenuMais({ itens, caminho, aoAbrirComandos }: {
  readonly itens: typeof ITENS_NAV;
  readonly caminho: string | null;
  readonly aoAbrirComandos: () => void;
}) {
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>
        <button
          type="button" aria-label="Mais opcoes de navegacao"
          className="relative flex min-w-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-text-muted transition-colors duration-[var(--dur-2)] hover:text-text"
        >
          <DotsThreeVertical size={23} weight="bold" />
          <span className="text-[10px] font-medium leading-none">Mais</span>
        </button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side="top" sideOffset={12} align="end"
          className="z-50 min-w-[210px] rounded-[18px] border border-line cadencia-glass p-1.5 shadow-elev-3 animate-[scaleIn_150ms_var(--ease-out)]"
        >
          <button
            type="button"
            onClick={aoAbrirComandos}
            className="mb-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-text transition-colors hover:bg-surface-hover"
          >
            <MagnifyingGlass size={19} /> Buscar e comandos
          </button>
          <div className="mx-2 mb-1 h-px bg-line" />
          {itens.map((item) => {
            const ativo = caminho?.startsWith(item.href) === true;
            const Icone = item.icone;
            return (
              <Link
                key={item.id} href={item.href} aria-current={ativo ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  ativo ? 'bg-accent-soft text-accent' : 'text-text hover:bg-surface-hover',
                )}
              >
                <Icone size={19} weight={ativo ? 'fill' : 'regular'} />{item.rotulo}
              </Link>
            );
          })}
          <RadixPopover.Arrow className="fill-surface" />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

export function BarraDeNavegacao() {
  const caminho = usePathname();
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { colapsado, alternar } = useSidebarColapsado();
  const [comandosAbertos, setComandosAbertos] = useState(false);

  const itensVisiveis = ITENS_NAV.filter((item) => item.disponivelNaFase <= FASE_ATUAL);

  // A tela de entrada nao tem navegacao: oferecer atalho para Agenda a quem
  // ainda nao provou quem e so produz uma sequencia de 401.
  // Mesma regra do provider de sessao, num lugar so. A barra e a estrutura
  // INTERNA da clinica: "Financeiro", "Pacientes", "Desempenho". Mostra-la a
  // quem esta marcando consulta expoe a organizacao da clinica e oferece links
  // que so vao expulsar a pessoa de volta.
  const naEntrada = ehRotaPublica(caminho);

  useEffect(() => {
    if (isMobile) {
      document.documentElement.style.setProperty('--nav-width', '0px');
      document.documentElement.style.setProperty('--nav-height', '76px');
    } else {
      document.documentElement.style.setProperty('--nav-width', colapsado ? '76px' : '276px');
      document.documentElement.style.setProperty('--nav-height', '0px');
    }
  }, [colapsado, isMobile]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setComandosAbertos((v) => !v);
        return;
      }
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < itensVisiveis.length) {
        e.preventDefault();
        const item = itensVisiveis[idx];
        if (item) router.push(item.href);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [itensVisiveis, router]);

  if (naEntrada) return null;

  if (isMobile) {
    const itensMobile = itensVisiveis.slice(0, ITENS_MOBILE_VISIVEIS);
    const itensOverflow = itensVisiveis.slice(ITENS_MOBILE_VISIVEIS);
    return (
      <>
        <CommandPalette aberto={comandosAbertos} setAberto={setComandosAbertos} />
        <nav
          aria-label="Navegacao principal"
          className={cn(
            'cadencia-mobile-dock fixed bottom-0 left-0 right-0 z-30',
            'border-t border-line/70 bg-surface/86 backdrop-blur-2xl',
            'flex min-h-[76px] items-start justify-around px-2 pt-2',
            'shadow-[0_-16px_45px_oklch(17%_0.04_264_/_0.1)]',
          )}
        >
          {itensMobile.map((item) => {
            const ativo = caminho?.startsWith(item.href) === true;
            const Icone = item.icone;
            return (
              <Link
                key={item.id} href={item.href} aria-current={ativo ? 'page' : undefined}
                className={cn(
                  'relative flex min-w-[52px] flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5 transition-all duration-[var(--dur-2)]',
                  ativo ? 'text-accent' : 'text-text-muted',
                )}
              >
                {ativo && <motion.span layoutId="mobile-nav-active" className="absolute -top-2 h-[3px] w-7 rounded-full bg-[var(--aurora)] shadow-[0_0_16px_color-mix(in_oklab,var(--accent)_40%,transparent)]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className={cn('grid h-9 w-9 place-items-center rounded-[13px] transition-colors', ativo && 'bg-accent-soft shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_10%,transparent)]')}>
                  <Icone size={21} weight={ativo ? 'fill' : 'regular'} />
                </span>
                <span className="text-[10px] font-semibold leading-none">{item.rotulo}</span>
              </Link>
            );
          })}
          {itensOverflow.length > 0 && <MenuMais itens={itensOverflow} caminho={caminho} aoAbrirComandos={() => setComandosAbertos(true)} />}
        </nav>
      </>
    );
  }

  return (
    <RadixTooltip.Provider delayDuration={180}>
      <CommandPalette aberto={comandosAbertos} setAberto={setComandosAbertos} />
      <motion.nav
        aria-label="Navegacao principal"
        className={cn(
          'fixed left-0 top-0 z-30 flex h-screen flex-col overflow-hidden border-r border-white/8 text-white',
          '[background:linear-gradient(165deg,oklch(19%_0.072_270),oklch(15.5%_0.045_270)_54%,oklch(17%_0.062_296))]',
          'shadow-[22px_0_60px_oklch(17%_0.04_264_/_0.11)]',
        )}
        animate={{ width: colapsado ? 76 : 276 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="pointer-events-none absolute -right-24 -top-20 h-64 w-64 rounded-full bg-cyan-300/12 blur-3xl animate-[nav-glow_8s_ease-in-out_infinite]" />
        <div className="pointer-events-none absolute bottom-[15%] -left-24 h-56 w-56 rounded-full bg-violet-400/12 blur-3xl" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-cyan-200/16 to-transparent" />

        <div className="relative flex h-[82px] shrink-0 items-center gap-3 px-[18px]">
          <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-white text-[oklch(44%_0.2_268)] shadow-[0_10px_28px_oklch(0%_0_0_/_0.25)]">
            <Stethoscope size={22} weight="bold" />
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[oklch(19%_0.072_270)] bg-[oklch(80%_0.15_188)] shadow-[0_0_12px_oklch(80%_0.15_188_/_0.7)]" aria-hidden />
          </div>
          <AnimatePresence initial={false}>
            {!colapsado && (
              <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.14 }} className="min-w-0 whitespace-nowrap">
                <div className="text-[16px] font-semibold tracking-[-0.035em] text-white">Cadencia</div>
                <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[.18em] text-white/42">Clinical intelligence</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative mx-3 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />

        <div className="relative px-2.5 pt-4">
          <TooltipItem conteudo="Busca e comandos (Ctrl/⌘ K)" ativo={colapsado}>
            <button
              type="button"
              onClick={() => setComandosAbertos(true)}
              aria-label="Abrir busca e comandos"
              className={cn(
                'group flex h-10 w-full items-center rounded-xl border border-white/8 bg-white/[.055] text-white/54 shadow-[inset_0_1px_0_oklch(100%_0_0_/_0.04)] transition-all hover:border-white/14 hover:bg-white/[.085] hover:text-white',
                colapsado ? 'justify-center px-0' : 'gap-2.5 px-3',
              )}
            >
              <MagnifyingGlass size={17} />
              {!colapsado && <span className="flex-1 text-left text-[12px] font-medium">Buscar ou comandar</span>}
              {!colapsado && <span className="flex items-center gap-1"><span className="cadencia-command-key">⌘</span><span className="cadencia-command-key">K</span></span>}
            </button>
          </TooltipItem>
        </div>

        <div className="relative flex-1 overflow-y-auto px-2.5 py-5 scrollbar-thin">
          <AnimatePresence initial={false}>
            {!colapsado && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[.17em] text-white/32">Workspace</motion.p>}
          </AnimatePresence>
          <ul className="m-0 list-none space-y-1 p-0">
            {itensVisiveis.map((item) => {
              const ativo = caminho?.startsWith(item.href) === true;
              const Icone = item.icone;
              return (
                <li key={item.id}>
                  <TooltipItem conteudo={`${item.rotulo} (Alt+${item.atalho})`} ativo={colapsado}>
                    <Link
                      href={item.href} aria-current={ativo ? 'page' : undefined}
                      className={cn(
                        'group relative flex h-11 items-center rounded-xl transition-all duration-[var(--dur-2)]',
                        colapsado ? 'justify-center px-0' : 'gap-3 px-3',
                        ativo
                          ? 'bg-white/[.105] text-white shadow-[inset_0_0_0_1px_oklch(100%_0_0_/_0.08),0_10px_26px_oklch(0%_0_0_/_0.14)]'
                          : 'text-white/55 hover:bg-white/[.06] hover:text-white',
                      )}
                    >
                      {ativo && <motion.span layoutId="desktop-nav-active" className="absolute left-0 top-2.5 h-6 w-[3px] rounded-r-full bg-[oklch(80%_0.15_188)] shadow-[0_0_16px_oklch(80%_0.15_188_/_0.72)]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[10px] transition-colors', ativo ? 'bg-white/[.10]' : 'group-hover:bg-white/[.05]')}>
                        <Icone size={19} weight={ativo ? 'fill' : 'regular'} />
                      </span>
                      <AnimatePresence initial={false}>
                        {!colapsado && <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.12 }} className="flex-1 overflow-hidden whitespace-nowrap text-[13px] font-semibold">{item.rotulo}</motion.span>}
                      </AnimatePresence>
                      {!colapsado && <span className="rounded-md border border-white/8 bg-white/[.04] px-1.5 py-0.5 font-mono text-[9px] text-white/28">⌥{item.atalho}</span>}
                    </Link>
                  </TooltipItem>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="relative px-2.5 pb-2">
          <div className={cn('flex min-h-[64px] items-center rounded-2xl border border-white/8 bg-white/[.045] shadow-[inset_0_1px_0_oklch(100%_0_0_/_0.04)]', colapsado ? 'justify-center px-1' : 'gap-3 px-3')}>
            <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-white/15 to-white/[.06] text-white/82 ring-1 ring-white/8">
              <User size={17} weight="bold" />
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[oklch(17%_0.05_280)] bg-[oklch(76%_0.15_155)]" aria-hidden />
            </div>
            <AnimatePresence initial={false}>
              {!colapsado && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-white/88">Usuario</div>
                  <div className="mt-0.5 flex items-center gap-1 truncate text-[9px] font-medium text-white/34"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300/80" /> Clinica Cadencia · online</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="relative px-2.5 pb-3">
          <button
            type="button" onClick={alternar} aria-label={colapsado ? 'Expandir navegacao' : 'Colapsar navegacao'}
            className="flex h-9 w-full items-center justify-center rounded-xl text-white/38 transition-colors hover:bg-white/[.06] hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <motion.div animate={{ rotate: colapsado ? 180 : 0 }} transition={{ duration: 0.2 }}><CaretLeft size={18} /></motion.div>
            <AnimatePresence initial={false}>
              {!colapsado && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="ml-2 text-[10px] font-semibold whitespace-nowrap">Colapsar</motion.span>}
            </AnimatePresence>
          </button>
        </div>
      </motion.nav>
    </RadixTooltip.Provider>
  );
}
