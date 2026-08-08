// apps/web/src/telas/DetalheDemonstrativo.tsx
'use client';

import { PainelLateral } from '../ui/PainelLateral';

// -- Tipos ------------------------------------------------------------------

export interface ItemDemonstrativo {
  readonly id: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly apresentadoCentavos: number;
  readonly processadoCentavos: number;
  readonly liberadoCentavos: number;
  readonly glosadoCentavos: number;
  readonly codigoGlosa: string | null;
  readonly descricaoGlosa: string | null;
}

export interface DetalheDemonstrativoProps {
  readonly aberto: boolean;
  readonly titulo: string;
  readonly itens: readonly ItemDemonstrativo[];
  readonly aoFechar: () => void;
}

// -- Helpers ----------------------------------------------------------------

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

// -- Componente -------------------------------------------------------------

export function DetalheDemonstrativo({ aberto, titulo, itens, aoFechar }: DetalheDemonstrativoProps) {
  return (
    <PainelLateral aberto={aberto} titulo={titulo} aoFechar={aoFechar}>
      <div style={{ marginTop: 'var(--s-4)', overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontSize: 'var(--fs-12)',
        }}>
          <thead>
            <tr style={{ borderBottom: 'var(--border)' }}>
              <th style={{ textAlign: 'left', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Guia
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Apresentado
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Processado
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Liberado
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Glosado
              </th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => {
              const temGlosa = item.glosadoCentavos > 0;
              return (
                <tr key={item.id} style={{
                  borderBottom: 'var(--border)',
                  background: temGlosa ? 'var(--danger-soft)' : 'transparent',
                }}>
                  <td style={{ padding: 'var(--s-3)', verticalAlign: 'top' }}>
                    <div>
                      <span className="num" style={{
                        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                        color: 'var(--text-muted)',
                      }}>
                        {item.guiaNumero}
                      </span>
                      {' '}
                      <span style={{ fontWeight: 'var(--fw-medium)' }}>
                        {item.pacienteNome}
                      </span>
                    </div>
                    <div style={{ fontSize: 'var(--fs-11)', color: 'var(--text-muted)' }}>
                      {item.nomeProcedimento}
                    </div>
                    {temGlosa && item.codigoGlosa !== null ? (
                      <div style={{ fontSize: 'var(--fs-11)', color: 'var(--danger)',
                                    marginTop: 'var(--s-1)' }}>
                        <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>
                          {item.codigoGlosa}
                        </span>
                        {' '}
                        {item.descricaoGlosa}
                      </div>
                    ) : null}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                  }}>
                    {centavosParaReais(item.apresentadoCentavos)}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                  }}>
                    {centavosParaReais(item.processadoCentavos)}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                  }}>
                    {centavosParaReais(item.liberadoCentavos)}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                    color: temGlosa ? 'var(--danger)' : 'var(--text)',
                    fontWeight: temGlosa ? 'var(--fw-medium)' : 'var(--fw-regular)',
                  }}>
                    {centavosParaReais(item.glosadoCentavos)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PainelLateral>
  );
}
