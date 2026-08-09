// apps/web/src/telas/ConveniosGlosas.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, MagnifyingGlass } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';

// -- Tipos ------------------------------------------------------------------

export type StatusGlosa = 'pendente' | 'recurso_enviado' | 'recurso_aceito' | 'recurso_negado';

export interface Glosa {
  readonly id: string;
  readonly demonstrativoId: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly codigoGlosa: string;
  readonly descricaoGlosa: string;
  readonly valorApresentadoCentavos: number;
  readonly valorGlosadoCentavos: number;
  readonly dataAtendimento: string;
  readonly status: StatusGlosa;
}

export interface OperadoraResumo {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
}

export interface GlosasDados {
  readonly glosas: readonly Glosa[];
  readonly operadoras: readonly OperadoraResumo[];
  readonly totalGlosadoPendenteCentavos: number;
}

export interface FiltrosGlosas {
  readonly status?: StatusGlosa;
  readonly operadoraId?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface ConveniosGlosasProps {
  readonly carregarDados: (filtros: FiltrosGlosas) => Promise<GlosasDados>;
  readonly aoCriarRecurso: (glosaIds: readonly string[]) => void;
}

// -- Helpers ----------------------------------------------------------------

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const STATUS_CHIP: Record<StatusGlosa, { rotulo: string; classes: string }> = {
  pendente:        { rotulo: 'Pendente',        classes: 'text-warn bg-warn-soft' },
  recurso_enviado: { rotulo: 'Recurso enviado', classes: 'text-accent bg-accent-soft' },
  recurso_aceito:  { rotulo: 'Recurso aceito',  classes: 'text-ok bg-ok-soft' },
  recurso_negado:  { rotulo: 'Recurso negado',  classes: 'text-danger bg-danger-soft' },
};

// -- Componente -------------------------------------------------------------

export function ConveniosGlosas(p: ConveniosGlosasProps) {
  const [dados, setDados] = useState<GlosasDados | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('');
  const [operadoraFiltro, setOperadoraFiltro] = useState('');

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  const glosasFiltradas = useMemo(() => {
    if (!dados) return [];
    return dados.glosas.filter((g) => {
      if (statusFiltro !== '' && g.status !== statusFiltro) return false;
      if (operadoraFiltro !== '' && g.operadoraId !== operadoraFiltro) return false;
      if (busca !== '') {
        const termo = busca.toLowerCase();
        return (
          g.guiaNumero.toLowerCase().includes(termo) ||
          g.pacienteNome.toLowerCase().includes(termo) ||
          g.operadoraNome.toLowerCase().includes(termo) ||
          g.descricaoGlosa.toLowerCase().includes(termo)
        );
      }
      return true;
    });
  }, [dados, busca, statusFiltro, operadoraFiltro]);

  function alternarSelecao(id: string): void {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // -- Skeleton de carregamento --
  if (dados === null) {
    return (
      <div className="space-y-4" role="status" aria-label="Carregando glosas">
        <Skeleton variant="text" width="30%" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabecalho com badge de pendente */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-[length:var(--fs-15)] font-semibold">Glosas</h3>
          {dados.totalGlosadoPendenteCentavos > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full text-danger bg-danger-soft">
              {centavosParaReais(dados.totalGlosadoPendenteCentavos)} pendente
            </span>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <Campo
          prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
          placeholder="Buscar..."
          className="max-w-xs"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar glosas"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-status-gl" className="text-sm font-medium text-text-muted">
            Status
          </label>
          <select
            id="filtro-status-gl"
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            aria-label="Status"
            className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-text shadow-[inset_0_1px_0_color-mix(in_oklch,var(--surface),white_30%)] transition-all-fast hover:border-line-strong focus:border-accent focus:ring-[3px] focus:ring-accent/10 focus:outline-none"
          >
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="recurso_enviado">Recurso enviado</option>
            <option value="recurso_aceito">Recurso aceito</option>
            <option value="recurso_negado">Recurso negado</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-operadora-gl" className="text-sm font-medium text-text-muted">
            Operadora
          </label>
          <select
            id="filtro-operadora-gl"
            value={operadoraFiltro}
            onChange={(e) => setOperadoraFiltro(e.target.value)}
            aria-label="Operadora"
            className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-text shadow-[inset_0_1px_0_color-mix(in_oklch,var(--surface),white_30%)] transition-all-fast hover:border-line-strong focus:border-accent focus:ring-[3px] focus:ring-accent/10 focus:outline-none"
          >
            <option value="">Todas</option>
            {dados.operadoras.map((op) => (
              <option key={op.id} value={op.id}>{op.nome}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Barra de acao batch */}
      {selecionadas.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-accent/15 bg-accent-soft px-4 py-2">
          <span className="text-sm text-text">
            {selecionadas.size} glosa(s) selecionada(s)
          </span>
          <Botao variante="primario" tamanho="md"
            onClick={() => { p.aoCriarRecurso(Array.from(selecionadas)); }}>
            Criar recurso
          </Botao>
        </div>
      )}

      {/* Tabela de glosas */}
      {glosasFiltradas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-muted">
          <Icone icon={CheckCircle} size="xl" className="text-ok mb-3" />
          <p>Nenhuma glosa pendente</p>
        </div>
      ) : (
        <section aria-label="Lista de glosas">
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-elev-1">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-raised">
                    <th className="w-10 px-4 py-3">
                      <span className="sr-only">Selecionar</span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Guia</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Paciente</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Operadora</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Motivo</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted">Valor</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                      <span className="sr-only">Acao</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {glosasFiltradas.map((g) => {
                    const chip = STATUS_CHIP[g.status];
                    const selecionavel = g.status === 'pendente';
                    return (
                      <tr key={g.id} className="hover:bg-surface-raised transition-colors-fast">
                        <td className="px-4 py-3">
                          {selecionavel ? (
                            <input
                              type="checkbox"
                              checked={selecionadas.has(g.id)}
                              onChange={() => alternarSelecao(g.id)}
                              aria-label={`Selecionar glosa ${g.guiaNumero}`}
                              className="h-4 w-4 cursor-pointer rounded border-line accent-accent"
                            />
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{g.guiaNumero}</td>
                        <td className="px-4 py-3 text-text">{g.pacienteNome}</td>
                        <td className="px-4 py-3 text-text-muted">{g.operadoraNome}</td>
                        <td className="px-4 py-3 text-text-muted max-w-[200px] truncate" title={g.descricaoGlosa}>
                          {g.descricaoGlosa}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-danger">
                          {centavosParaReais(g.valorGlosadoCentavos)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'inline-flex items-center text-[11px] uppercase tracking-[.04em] font-medium',
                            'px-2 py-0.5 rounded-full',
                            chip.classes,
                          )}>
                            {chip.rotulo}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {selecionavel && (
                            <Botao variante="secundario" tamanho="sm"
                              onClick={() => { p.aoCriarRecurso([g.id]); }}>
                              Recursar
                            </Botao>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
