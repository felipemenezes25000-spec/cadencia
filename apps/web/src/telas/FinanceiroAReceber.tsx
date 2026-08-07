// apps/web/src/telas/FinanceiroAReceber.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface EntradaPendenteReceber {
  readonly id: string;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly daysPastDue: number;
}

export interface AReceberDados {
  readonly total: number;
  readonly entradas: readonly EntradaPendenteReceber[];
}

export interface FinanceiroAReceberProps {
  readonly carregarDados: () => Promise<AReceberDados>;
  readonly aoCobrar: (entryId: string) => Promise<void>;
  readonly aoMarcarPago: (entryId: string) => Promise<void>;
  readonly aoEnviarLink: (entryId: string) => Promise<void>;
  readonly hoje: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

type AgingLevel = 'ok' | 'warn' | 'danger';

function calcularAging(daysPastDue: number): AgingLevel {
  if (daysPastDue > 30) return 'danger';
  if (daysPastDue > 15) return 'warn';
  return 'ok';
}

const AGING_BORDA: Record<AgingLevel, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
};

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroAReceber(p: FinanceiroAReceberProps) {
  const [dados, setDados] = useState<AReceberDados | null>(null);

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          A receber
        </h2>
        <span className="num" style={{ fontSize: 'var(--fs-18)',
                                        fontWeight: 'var(--fw-semibold)',
                                        fontVariantNumeric: 'tabular-nums' }}>
          {centavosParaReais(dados.total)}
        </span>
      </div>

      {/* Lista */}
      <section aria-label="Lancamentos a receber">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.entradas.map((e) => {
            const aging = calcularAging(e.daysPastDue);
            return (
              <li key={e.id} data-aging={aging} style={{
                display: 'grid',
                gridTemplateColumns: '4px 1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                paddingInlineStart: 0,
                borderBottom: 'var(--border)', minHeight: 44,
              }}>
                {/* Barra lateral de aging */}
                <span style={{
                  display: 'block', width: 4, alignSelf: 'stretch',
                  background: AGING_BORDA[aging], borderRadius: 'var(--r-sm)',
                }} aria-hidden="true" />

                <div style={{ paddingInlineStart: 'var(--s-3)' }}>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                    {e.patientName}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                 color: 'var(--text-muted)' }}>
                    {e.description} — vence {e.dueDate}
                    {e.daysPastDue > 0 ? ` (${e.daysPastDue}d atraso)` : ''}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                  <span className="num" style={{ fontSize: 'var(--fs-14)',
                                                  fontVariantNumeric: 'tabular-nums',
                                                  marginInlineEnd: 'var(--s-3)' }}>
                    {centavosParaReais(e.amountCents)}
                  </span>
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoCobrar(e.id); }}>
                    Cobrar
                  </Botao>
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoMarcarPago(e.id); }}>
                    Marcar pago
                  </Botao>
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoEnviarLink(e.id); }}>
                    Enviar link
                  </Botao>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
