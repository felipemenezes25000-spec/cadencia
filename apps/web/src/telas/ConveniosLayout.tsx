// apps/web/src/telas/ConveniosLayout.tsx
'use client';

import type { ReactNode } from 'react';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type SubAbaConvenios = 'a-faturar' | 'lotes' | 'retornos' | 'operadoras';

export interface ContadoresConvenios {
  readonly guiasAFaturar: number;
  readonly lotesRascunho: number;
  readonly lotesEnviados: number;
  readonly pendencias: number;
  readonly glosasPendentes: number;
  readonly recursosRascunho: number;
}

export type FiltroConvenios = keyof ContadoresConvenios;

interface SubAbaConfig {
  readonly slug: SubAbaConvenios;
  readonly rotulo: string;
  readonly href: string;
}

const SUB_ABAS: readonly SubAbaConfig[] = [
  { slug: 'a-faturar',  rotulo: 'A faturar',  href: '/financeiro/convenios' },
  { slug: 'lotes',      rotulo: 'Lotes',       href: '/financeiro/convenios/lotes' },
  { slug: 'retornos',   rotulo: 'Retornos',    href: '/financeiro/convenios/retornos' },
  { slug: 'operadoras', rotulo: 'Operadoras',  href: '/financeiro/convenios/operadoras' },
];

const ROTULOS_CONTADORES: Record<FiltroConvenios, string> = {
  guiasAFaturar:    'Guias a faturar',
  lotesRascunho:    'Lotes rascunho',
  lotesEnviados:    'Lotes enviados',
  pendencias:       'Pendencias',
  glosasPendentes:  'Glosas pendentes',
  recursosRascunho: 'Recursos rascunho',
};

// ── Props ──────────────────────────────────────────────────────────────────

export interface ConveniosLayoutProps {
  readonly abaAtiva: SubAbaConvenios;
  readonly aoNavegar: (aba: SubAbaConvenios) => void;
  readonly contadores: ContadoresConvenios;
  readonly aoFiltrar: (filtro: FiltroConvenios) => void;
  readonly filtroAtivo?: FiltroConvenios;
  readonly children: ReactNode;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosLayout({
  abaAtiva, aoNavegar, contadores, aoFiltrar, filtroAtivo, children,
}: ConveniosLayoutProps) {
  const chaves = Object.keys(ROTULOS_CONTADORES) as FiltroConvenios[];

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h2 style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Convenios
      </h2>

      {/* Faixa de contadores */}
      <div
        role="group" aria-label="Contadores de convenios" aria-live="polite"
        style={{ display: 'flex', border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', overflow: 'hidden' }}
      >
        {chaves.map((k, i) => (
          <button
            key={k} type="button" onClick={() => aoFiltrar(k)}
            aria-pressed={filtroAtivo === k}
            style={{
              flex: 1, border: 0,
              background: filtroAtivo === k ? 'var(--surface-hover)' : 'transparent',
              borderInlineStart: i === 0 ? 'none' : '1px solid var(--line)',
              padding: `var(--s-5) var(--s-4)`, cursor: 'pointer', minHeight: 44,
              display: 'grid', gap: 'var(--s-1)', justifyItems: 'start', color: 'var(--text)',
            }}
          >
            <span className="num" style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1.1 }}>
              {contadores[k]}
            </span>
            <span style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', color: 'var(--text-muted)' }}>
              {ROTULOS_CONTADORES[k]}
            </span>
          </button>
        ))}
      </div>

      {/* Sub-abas */}
      <nav aria-label="Sub-navegacao convenios">
        <ul style={{ display: 'flex', gap: 'var(--s-1)', listStyle: 'none',
                     margin: 0, padding: 0, borderBottom: 'var(--border)' }}>
          {SUB_ABAS.map((aba) => {
            const ativo = aba.slug === abaAtiva;
            return (
              <li key={aba.slug}>
                <a
                  href={aba.href}
                  aria-current={ativo ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); aoNavegar(aba.slug); }}
                  style={{
                    display: 'inline-block',
                    padding: `var(--s-4) var(--s-5)`,
                    color: ativo ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: ativo ? 'var(--fw-medium)' : 'var(--fw-regular)',
                    fontSize: 'var(--fs-14)',
                    textDecoration: 'none',
                    borderBottom: ativo
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                    whiteSpace: 'nowrap',
                    minHeight: 24,
                  }}
                >
                  {aba.rotulo}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>{children}</div>
    </div>
  );
}
