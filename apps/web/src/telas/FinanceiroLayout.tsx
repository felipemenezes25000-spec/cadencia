// apps/web/src/telas/FinanceiroLayout.tsx
'use client';

import type { ReactNode } from 'react';

export type AbaFinanceiro =
  | 'visao' | 'caixa' | 'a-receber' | 'a-pagar'
  | 'recebimentos' | 'repasse' | 'estoque';

export interface AbaConfig {
  readonly slug: AbaFinanceiro;
  readonly rotulo: string;
  readonly href: string;
}

export const ABAS_FINANCEIRO: readonly AbaConfig[] = [
  { slug: 'visao',         rotulo: 'Visao',         href: '/financeiro/visao' },
  { slug: 'caixa',         rotulo: 'Caixa',         href: '/financeiro/caixa' },
  { slug: 'a-receber',     rotulo: 'A receber',     href: '/financeiro/a-receber' },
  { slug: 'a-pagar',       rotulo: 'A pagar',       href: '/financeiro/a-pagar' },
  { slug: 'recebimentos',  rotulo: 'Recebimentos',  href: '/financeiro/recebimentos' },
  { slug: 'repasse',       rotulo: 'Repasse',       href: '/financeiro/repasse' },
  { slug: 'estoque',       rotulo: 'Estoque',       href: '/financeiro/estoque' },
];

export interface FinanceiroLayoutProps {
  readonly abaAtiva: AbaFinanceiro;
  readonly aoNavegar: (aba: AbaFinanceiro) => void;
  readonly children: ReactNode;
}

export function FinanceiroLayout({ abaAtiva, aoNavegar, children }: FinanceiroLayoutProps) {
  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)',
                  maxWidth: 1120, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Financeiro
      </h1>

      <nav aria-label="Sub-navegacao financeiro">
        <ul style={{ display: 'flex', gap: 'var(--s-1)', listStyle: 'none',
                     margin: 0, padding: 0, borderBottom: 'var(--border)',
                     overflowX: 'auto' }}>
          {ABAS_FINANCEIRO.map((aba) => {
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
