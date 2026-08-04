'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FASE_ATUAL, ITENS_NAV } from './nav';

export function BarraDeNavegacao() {
  const caminho = usePathname();
  return (
    <header
      style={{
        background: 'var(--surface)', borderBottom: 'var(--border)',
        position: 'sticky', top: 0, zIndex: 'var(--z-sticky)' as unknown as number,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-6)',
                    padding: `var(--s-3) var(--s-6)` }}>
        <strong style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)' }}>
          Cadencia
        </strong>
      </div>
      <nav aria-label="Navegação principal">
        <ul style={{ display: 'flex', gap: 'var(--s-1)', listStyle: 'none',
                     margin: 0, padding: `0 var(--s-6)` }}>
          {ITENS_NAV.map((item) => {
            const ativo = caminho?.startsWith(item.href) === true;
            const indisponivel = item.disponivelNaFase > FASE_ATUAL;
            const id = `nav-motivo-${item.rotulo.toLowerCase()}`;
            return (
              <li key={item.href}>
                {indisponivel ? (
                  <>
                    <button
                      type="button" disabled aria-disabled="true" aria-describedby={id}
                      style={{
                        border: 0, background: 'transparent', color: 'var(--text-faint)',
                        padding: `var(--s-4) var(--s-5)`, fontSize: 'var(--fs-14)',
                        cursor: 'not-allowed', minHeight: 24,
                      }}
                    >
                      {item.rotulo}
                    </button>
                    <span id={id} hidden>{item.motivo}</span>
                  </>
                ) : (
                  <Link
                    href={item.href}
                    aria-current={ativo ? 'page' : undefined}
                    style={{
                      display: 'inline-block', padding: `var(--s-4) var(--s-5)`,
                      color: ativo ? 'var(--text)' : 'var(--text-muted)',
                      fontWeight: ativo ? 'var(--fw-medium)' : 'var(--fw-regular)',
                      fontSize: 'var(--fs-14)', textDecoration: 'none',
                      borderBottom: ativo ? '2px solid var(--accent)' : '2px solid transparent',
                      minHeight: 24,
                    }}
                  >
                    {item.rotulo}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
