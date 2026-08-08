'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CaretLeft,
  DotsThreeVertical,
  Stethoscope,
  User,
} from '@phosphor-icons/react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import * as RadixPopover from '@radix-ui/react-popover';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/cn';
import { useMediaQuery } from '../lib/hooks';
import { FASE_ATUAL, ITENS_NAV } from './nav';

const CHAVE_COLAPSADO = 'cadencia:nav-colapsado';
const ITENS_MOBILE_VISIVEIS = 5;

/* ── Hook: persistencia do estado colapsado ──────────────────────────── */

function useSidebarColapsado() {
  const [colapsado, setColapsado] = useState(false);

  useEffect(() => {
    const salvo = localStorage.getItem(CHAVE_COLAPSADO);
    if (salvo !== null) {
      setColapsado(salvo === 'true');
    }
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

/* ── Subcomponente: tooltip condicional para modo colapsado ───────────── */

function TooltipItem({
  conteudo,
  ativo,
  children,
}: {
  readonly conteudo: string;
  readonly ativo: boolean;
  readonly children: React.ReactNode;
}) {
  if (ativo) {
    return (
      <RadixTooltip.Root delayDuration={200}>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side="right"
            sideOffset={8}
            className={cn(
              'z-50 rounded-[var(--r-md)] px-2.5 py-1.5',
              'text-[length:var(--fs-12)] leading-[var(--lh-ui)]',
              'bg-text text-bg',
              'shadow-elev-1',
              'animate-[scaleIn_150ms_ease]',
              'select-none',
            )}
          >
            {conteudo}
            <RadixTooltip.Arrow className="fill-text" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    );
  }
  return <>{children}</>;
}

/* ── Subcomponente: menu "Mais" no mobile ────────────────────────────── */

function MenuMais({
  itens,
  caminho,
}: {
  readonly itens: typeof ITENS_NAV;
  readonly caminho: string | null;
}) {
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>
        <button
          type="button"
          aria-label="Mais opcoes de navegacao"
          className={cn(
            'flex flex-col items-center justify-center gap-0.5',
            'px-1 py-1.5 text-text-muted',
            'transition-colors duration-[var(--dur-2)]',
          )}
        >
          <DotsThreeVertical size={24} weight="bold" />
          <span className="text-[length:var(--fs-11)] leading-none">Mais</span>
        </button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side="top"
          sideOffset={8}
          align="end"
          className={cn(
            'z-50 min-w-[160px] rounded-[var(--r-lg)]',
            'bg-surface border border-line',
            'shadow-elev-2 p-1',
            'animate-[scaleIn_150ms_ease]',
          )}
        >
          {itens.map((item) => {
            const ativo = caminho?.startsWith(item.href) === true;
            const Icone = item.icone;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={ativo ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-[var(--s-4)] px-3 py-2 rounded-[var(--r-md)]',
                  'text-[length:var(--fs-14)] leading-[var(--lh-ui)]',
                  'transition-colors duration-[var(--dur-2)]',
                  ativo
                    ? 'bg-accent-soft text-accent'
                    : 'text-text hover:bg-surface-hover',
                )}
              >
                <Icone size={20} weight={ativo ? 'fill' : 'regular'} />
                {item.rotulo}
              </Link>
            );
          })}
          <RadixPopover.Arrow className="fill-surface" />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/* ── Componente principal ────────────────────────────────────────────── */

export function BarraDeNavegacao() {
  const caminho = usePathname();
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { colapsado, alternar } = useSidebarColapsado();

  const itensVisiveis = ITENS_NAV.filter(
    (item) => item.disponivelNaFase <= FASE_ATUAL,
  );

  /* Sincroniza CSS var --nav-width para layout ajustar margem */
  useEffect(() => {
    if (isMobile) {
      document.documentElement.style.removeProperty('--nav-width');
    } else {
      document.documentElement.style.setProperty(
        '--nav-width',
        colapsado ? '64px' : '240px',
      );
    }
  }, [colapsado, isMobile]);

  /* Atalhos de teclado Alt+1..Alt+N */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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

  /* ── Mobile: bottom tab bar ──────────────────────────────────────── */
  if (isMobile) {
    const itensMobile = itensVisiveis.slice(0, ITENS_MOBILE_VISIVEIS);
    const itensOverflow = itensVisiveis.slice(ITENS_MOBILE_VISIVEIS);

    return (
      <nav
        aria-label="Navegacao principal"
        className={cn(
          'fixed bottom-0 left-0 right-0 z-30',
          'bg-surface border-t border-line',
          'flex items-center justify-around',
          'h-14 pb-[env(safe-area-inset-bottom)]',
        )}
      >
        {itensMobile.map((item) => {
          const ativo = caminho?.startsWith(item.href) === true;
          const Icone = item.icone;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={ativo ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5',
                'px-1 py-1.5 min-w-[48px]',
                'transition-colors duration-[var(--dur-2)]',
                ativo ? 'text-accent' : 'text-text-muted',
              )}
            >
              <Icone size={24} weight={ativo ? 'fill' : 'regular'} />
              <span className="text-[length:var(--fs-11)] leading-none">
                {item.rotulo}
              </span>
            </Link>
          );
        })}
        {itensOverflow.length > 0 && (
          <MenuMais itens={itensOverflow} caminho={caminho} />
        )}
      </nav>
    );
  }

  /* ── Desktop: sidebar ────────────────────────────────────────────── */
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <motion.nav
        aria-label="Navegacao principal"
        className={cn(
          'fixed left-0 top-0 h-screen z-30',
          'bg-surface border-r border-line',
          'flex flex-col',
          'overflow-hidden',
        )}
        animate={{ width: colapsado ? 64 : 240 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
        {/* ── Brand ────────────────────────────────────────────────── */}
        <div
          className={cn(
            'flex items-center gap-[var(--s-4)] px-[var(--s-5)] h-14',
            'border-b border-line shrink-0',
          )}
        >
          <div
            className={cn(
              'flex items-center justify-center shrink-0',
              'w-8 h-8 rounded-[var(--r-md)]',
              'bg-accent text-accent-on',
            )}
          >
            <Stethoscope size={20} weight="bold" />
          </div>
          <AnimatePresence>
            {!colapsado && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  'text-[length:var(--fs-15)] font-[var(--fw-semibold)]',
                  'text-text whitespace-nowrap overflow-hidden',
                )}
              >
                Cadencia
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* ── Nav items ────────────────────────────────────────────── */}
        <ul className="flex-1 overflow-y-auto py-[var(--s-4)] space-y-0.5 list-none m-0 px-[var(--s-3)]">
          {itensVisiveis.map((item) => {
            const ativo = caminho?.startsWith(item.href) === true;
            const Icone = item.icone;
            return (
              <li key={item.id}>
                <TooltipItem
                  conteudo={`${item.rotulo} (Alt+${item.atalho})`}
                  ativo={colapsado}
                >
                  <Link
                    href={item.href}
                    aria-current={ativo ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-[var(--s-4)] rounded-[var(--r-md)]',
                      'h-9 text-[length:var(--fs-14)] leading-[var(--lh-ui)]',
                      'transition-colors duration-[var(--dur-2)]',
                      'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] focus-visible:rounded-[var(--r-sm)]',
                      colapsado
                        ? 'justify-center px-0'
                        : 'px-[var(--s-4)]',
                      ativo
                        ? 'bg-accent-soft text-accent border-l-2 border-accent font-[var(--fw-medium)]'
                        : 'text-text-muted hover:bg-surface-hover hover:text-text',
                    )}
                  >
                    <Icone
                      size={20}
                      weight={ativo ? 'fill' : 'regular'}
                      className="shrink-0"
                    />
                    <AnimatePresence>
                      {!colapsado && (
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.12 }}
                          className="flex-1 whitespace-nowrap overflow-hidden"
                        >
                          {item.rotulo}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    <AnimatePresence>
                      {!colapsado && (
                        <motion.kbd
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.12 }}
                          className={cn(
                            'text-[length:var(--fs-11)] text-text-faint',
                            'whitespace-nowrap ml-auto',
                          )}
                        >
                          Alt+{item.atalho}
                        </motion.kbd>
                      )}
                    </AnimatePresence>
                  </Link>
                </TooltipItem>
              </li>
            );
          })}
        </ul>

        {/* ── User avatar area ─────────────────────────────────────── */}
        <div
          className={cn(
            'border-t border-line px-[var(--s-3)] py-[var(--s-4)]',
            'shrink-0',
          )}
        >
          <div
            className={cn(
              'flex items-center gap-[var(--s-4)] rounded-[var(--r-md)]',
              'h-9 px-[var(--s-4)]',
              colapsado && 'justify-center px-0',
            )}
          >
            <div
              className={cn(
                'flex items-center justify-center shrink-0',
                'w-7 h-7 rounded-full',
                'bg-surface-hover text-text-muted',
              )}
            >
              <User size={16} weight="bold" />
            </div>
            <AnimatePresence>
              {!colapsado && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className={cn(
                    'text-[length:var(--fs-13)] text-text-muted',
                    'whitespace-nowrap overflow-hidden text-ellipsis',
                  )}
                >
                  Usuario
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Collapse toggle ──────────────────────────────────────── */}
        <div className="border-t border-line px-[var(--s-3)] py-[var(--s-3)] shrink-0">
          <button
            type="button"
            onClick={alternar}
            aria-label={colapsado ? 'Expandir navegacao' : 'Colapsar navegacao'}
            className={cn(
              'flex items-center justify-center w-full',
              'h-8 rounded-[var(--r-md)]',
              'text-text-muted hover:bg-surface-hover hover:text-text',
              'transition-colors duration-[var(--dur-2)]',
              'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] focus-visible:rounded-[var(--r-sm)]',
            )}
          >
            <motion.div
              animate={{ rotate: colapsado ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <CaretLeft size={20} />
            </motion.div>
            <AnimatePresence>
              {!colapsado && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="ml-[var(--s-3)] text-[length:var(--fs-13)] whitespace-nowrap"
                >
                  Colapsar
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </motion.nav>
    </RadixTooltip.Provider>
  );
}
