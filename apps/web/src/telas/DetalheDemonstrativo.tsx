// apps/web/src/telas/DetalheDemonstrativo.tsx
'use client';

import { useMemo } from 'react';
import { PainelLateral } from '../ui/PainelLateral';
import { cn } from '../lib/cn';

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
  const totais = useMemo(() => {
    let apresentado = 0;
    let liberado = 0;
    let glosado = 0;
    for (const item of itens) {
      apresentado += item.apresentadoCentavos;
      liberado += item.liberadoCentavos;
      glosado += item.glosadoCentavos;
    }
    return { apresentado, liberado, glosado };
  }, [itens]);

  return (
    <PainelLateral aberto={aberto} titulo={titulo} aoFechar={aoFechar} largura="lg">
      <div className="space-y-4 mt-1">
        {/* Resumo de valores */}
        <div className="grid grid-cols-3 gap-1.5">
          <div className="rounded-lg bg-surface-raised p-3 text-center">
            <p className="text-xs text-text-muted">Apresentado</p>
            <p className="text-base font-bold text-text tabular-nums">
              {centavosParaReais(totais.apresentado)}
            </p>
          </div>
          <div className="rounded-lg bg-ok-soft p-3 text-center">
            <p className="text-xs text-text-muted">Liberado</p>
            <p className="text-base font-bold text-ok tabular-nums">
              {centavosParaReais(totais.liberado)}
            </p>
          </div>
          <div className="rounded-lg bg-danger-soft p-3 text-center">
            <p className="text-xs text-text-muted">Glosado</p>
            <p className="text-base font-bold text-danger tabular-nums">
              {centavosParaReais(totais.glosado)}
            </p>
          </div>
        </div>

        {/* Tabela de itens */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-line/70">
                <th className="text-left py-2 px-1.5 font-medium text-text-muted">
                  Guia
                </th>
                <th className="text-right py-2 px-1.5 font-medium text-text-muted">
                  Apresentado
                </th>
                <th className="text-right py-2 px-1.5 font-medium text-text-muted">
                  Processado
                </th>
                <th className="text-right py-2 px-1.5 font-medium text-text-muted">
                  Liberado
                </th>
                <th className="text-right py-2 px-1.5 font-medium text-text-muted">
                  Glosado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/65">
              {itens.map((item) => {
                const temGlosa = item.glosadoCentavos > 0;
                return (
                  <tr
                    key={item.id}
                    className={cn(
                      'hover:bg-surface-hover transition-colors',
                      temGlosa && 'bg-danger-soft',
                    )}
                  >
                    <td className="py-1.5 px-1.5 align-top">
                      <div>
                        <span className="font-mono tabular-nums text-text-muted">
                          {item.guiaNumero}
                        </span>
                        {' '}
                        <span className="font-medium">
                          {item.pacienteNome}
                        </span>
                      </div>
                      <div className="text-[length:var(--fs-11)] text-text-muted">
                        {item.nomeProcedimento}
                      </div>
                      {temGlosa && item.codigoGlosa !== null ? (
                        <div className="text-[length:var(--fs-11)] text-danger mt-0.5">
                          <span className="font-mono">
                            {item.codigoGlosa}
                          </span>
                          {' '}
                          {item.descricaoGlosa}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-right py-1.5 px-1.5 tabular-nums align-top">
                      {centavosParaReais(item.apresentadoCentavos)}
                    </td>
                    <td className="text-right py-1.5 px-1.5 tabular-nums align-top">
                      {centavosParaReais(item.processadoCentavos)}
                    </td>
                    <td className="text-right py-1.5 px-1.5 tabular-nums align-top">
                      {centavosParaReais(item.liberadoCentavos)}
                    </td>
                    <td
                      className={cn(
                        'text-right py-1.5 px-1.5 tabular-nums align-top',
                        temGlosa ? 'text-danger font-medium' : 'text-text',
                      )}
                    >
                      {centavosParaReais(item.glosadoCentavos)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </PainelLateral>
  );
}
