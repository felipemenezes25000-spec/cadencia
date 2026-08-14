// apps/web/src/telas/ConveniosRecursos.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useEstadoNaUrl } from '../hooks/useEstadoNaUrl';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';

// -- Tipos ------------------------------------------------------------------

export type StatusRecurso = 'rascunho' | 'enviado' | 'aceito' | 'negado' | 'parcial';

export interface ItemRecurso {
  readonly id: string;
  readonly glosaId: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly codigoGlosa: string;
  readonly valorGlosadoCentavos: number;
  readonly justificativa: string;
}

export interface Recurso {
  readonly id: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly status: StatusRecurso;
  readonly justificativaGeral: string;
  readonly criadoEm: string;
  readonly enviadoEm: string | null;
  readonly totalGlosasCentavos: number;
  readonly itens: readonly ItemRecurso[];
}

export interface RecursosDados {
  readonly recursos: readonly Recurso[];
}

export interface ConveniosRecursosProps {
  readonly carregarDados: () => Promise<RecursosDados>;
  readonly aoEditar: (recursoId: string) => void;
  readonly aoEnviar: (recursoId: string) => Promise<void>;
  readonly aoVerResultado: (recursoId: string) => void;
}

// -- Helpers ----------------------------------------------------------------

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const STATUS_CHIP: Record<StatusRecurso, { rotulo: string; glifo: string; classes: string }> = {
  rascunho: { rotulo: 'Rascunho', glifo: '●', classes: 'text-text-muted bg-surface-sunken' },
  enviado:  { rotulo: 'Enviado',  glifo: '↑', classes: 'text-accent bg-accent-soft' },
  aceito:   { rotulo: 'Aceito',   glifo: '✓', classes: 'text-ok bg-ok-soft' },
  negado:   { rotulo: 'Negado',   glifo: '✕', classes: 'text-danger bg-danger-soft' },
  parcial:  { rotulo: 'Parcial',  glifo: '◐', classes: 'text-warn bg-warn-soft' },
};

// -- Componente -------------------------------------------------------------

export function ConveniosRecursos(p: ConveniosRecursosProps) {
  const [dados, setDados] = useState<RecursosDados | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useEstadoNaUrl('busca');
  const [statusFiltro, setStatusFiltro] = useEstadoNaUrl('status');
  const [operadoraFiltro, setOperadoraFiltro] = useEstadoNaUrl('operadora');

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  const operadoras = useMemo(() => {
    if (!dados) return [];
    const mapa = new Map<string, string>();
    for (const r of dados.recursos) {
      mapa.set(r.operadoraId, r.operadoraNome);
    }
    return Array.from(mapa.entries()).map(([id, nome]) => ({ id, nome }));
  }, [dados]);

  const recursosFiltrados = useMemo(() => {
    if (!dados) return [];
    return dados.recursos.filter((r) => {
      if (statusFiltro !== '' && r.status !== statusFiltro) return false;
      if (operadoraFiltro !== '' && r.operadoraId !== operadoraFiltro) return false;
      if (busca !== '') {
        const termo = busca.toLowerCase();
        return (
          r.operadoraNome.toLowerCase().includes(termo) ||
          r.id.toLowerCase().includes(termo) ||
          r.itens.some((item) =>
            item.guiaNumero.toLowerCase().includes(termo) ||
            item.pacienteNome.toLowerCase().includes(termo),
          )
        );
      }
      return true;
    });
  }, [dados, busca, statusFiltro, operadoraFiltro]);

  function alternarExpandir(id: string): void {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // -- Skeleton de carregamento --
  if (dados === null) {
    return (
      <div className="space-y-4" role="status" aria-label="Carregando recursos">
        <Skeleton variant="text" width="30%" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <h3 className="text-[length:var(--fs-15)] font-semibold">Recursos</h3>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <Campo
          prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
          placeholder="Buscar…"
          className="max-w-xs"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar recursos"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-status-rec" className="text-sm font-medium text-text-muted">
            Status
          </label>
          <select
            id="filtro-status-rec"
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            aria-label="Status"
            className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-text transition-all-fast hover:border-line-strong focus:border-accent focus:ring-[3px] focus:ring-accent/10 focus:outline-none"
          >
            <option value="">Todos</option>
            <option value="rascunho">Rascunho</option>
            <option value="enviado">Enviado</option>
            <option value="aceito">Aceito</option>
            <option value="negado">Negado</option>
            <option value="parcial">Parcial</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-operadora-rec" className="text-sm font-medium text-text-muted">
            Operadora
          </label>
          <select
            id="filtro-operadora-rec"
            value={operadoraFiltro}
            onChange={(e) => setOperadoraFiltro(e.target.value)}
            aria-label="Operadora"
            className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-text transition-all-fast hover:border-line-strong focus:border-accent focus:ring-[3px] focus:ring-accent/10 focus:outline-none"
          >
            <option value="">Todas</option>
            {operadoras.map((op) => (
              <option key={op.id} value={op.id}>{op.nome}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabela de recursos */}
      {recursosFiltrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-muted">
          <p>Nenhum recurso encontrado</p>
        </div>
      ) : (
        <section aria-label="Lista de recursos de glosa">
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-elev-1">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-raised">
                    <th className="w-10 px-4 py-3">
                      <span className="sr-only">Expandir</span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Recurso</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Operadora</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Data</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted">Valor</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Situação</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {recursosFiltrados.map((rec) => {
                    const chip = STATUS_CHIP[rec.status];
                    const expandido = expandidos.has(rec.id);

                    return (
                      <RecursoLinhas
                        key={rec.id}
                        rec={rec}
                        chip={chip}
                        expandido={expandido}
                        aoExpandir={() => alternarExpandir(rec.id)}
                        aoEditar={() => p.aoEditar(rec.id)}
                        aoEnviar={() => { void p.aoEnviar(rec.id); }}
                        aoVerResultado={() => p.aoVerResultado(rec.id)}
                      />
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

// -- Sub-componente de linha ------------------------------------------------

interface RecursoLinhasProps {
  readonly rec: Recurso;
  readonly chip: { rotulo: string; glifo: string; classes: string };
  readonly expandido: boolean;
  readonly aoExpandir: () => void;
  readonly aoEditar: () => void;
  readonly aoEnviar: () => void;
  readonly aoVerResultado: () => void;
}

function RecursoLinhas({
  rec, chip, expandido,
  aoExpandir, aoEditar, aoEnviar, aoVerResultado,
}: RecursoLinhasProps) {
  return (
    <>
      <tr className="hover:bg-surface-raised transition-colors-fast">
        {/* Expandir */}
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={aoExpandir}
            aria-expanded={expandido}
            aria-label="Expandir"
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-hover transition-colors-fast max-md:h-11 max-md:w-11"
          >
            {expandido ? '▾' : '▸'}
          </button>
        </td>
        {/* Recurso */}
        <td className="px-4 py-3">
          <div className="text-sm font-medium">{rec.itens.length} glosa(s)</div>
          <div className="text-xs text-text-muted">
            Criado em {rec.criadoEm}
            {rec.enviadoEm !== null ? ` — Env. ${rec.enviadoEm}` : ''}
          </div>
        </td>
        {/* Operadora */}
        <td className="px-4 py-3 text-text">{rec.operadoraNome}</td>
        {/* Data */}
        <td className="px-4 py-3 text-text-muted">{rec.enviadoEm ?? rec.criadoEm}</td>
        {/* Valor */}
        <td className="px-4 py-3 text-right font-mono tabular-nums text-danger">
          {centavosParaReais(rec.totalGlosasCentavos)}
        </td>
        {/* Status */}
        <td className="px-4 py-3">
          <span className={cn(
            'inline-flex items-center gap-1 text-[11px] uppercase tracking-[.04em] font-medium',
            'px-2 py-0.5 rounded-full',
            chip.classes,
          )}>
            <span aria-hidden="true">{chip.glifo}</span>{chip.rotulo}
          </span>
        </td>
        {/* Ações */}
        <td className="px-4 py-3">
          <div className="flex gap-1">
            {rec.status === 'rascunho' && (
              <>
                <Botao variante="secundario" tamanho="sm" onClick={aoEditar}>
                  Editar
                </Botao>
                <Botao variante="primario" tamanho="sm" onClick={aoEnviar}>
                  Enviar
                </Botao>
              </>
            )}
            {(rec.status === 'enviado' || rec.status === 'aceito'
              || rec.status === 'negado' || rec.status === 'parcial') && (
              <Botao variante="secundario" tamanho="sm" onClick={aoVerResultado}>
                Ver resultado
              </Botao>
            )}
          </div>
        </td>
      </tr>

      {/* Itens expandidos */}
      {expandido && rec.itens.length > 0 && (
        <tr>
          <td colSpan={7} className="px-4 pb-4 pt-0">
            {/* Era `overflow-hidden`: no celular a tabela era CORTADA em vez de
                rolar, e o `ml-10` ainda comia 40px. */}
            <div className="ml-10 overflow-x-auto rounded-xl border border-line bg-surface-sunken scrollbar-thin max-md:ml-0">
              <table className="w-full min-w-[360px] text-sm">
                <tbody className="divide-y divide-line">
                  {rec.itens.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 font-mono text-xs text-text-muted tabular-nums">{item.guiaNumero}</td>
                      <td className="px-3 py-2 font-medium text-sm">{item.pacienteNome}</td>
                      <td className="px-3 py-2 font-mono text-xs text-text-muted">{item.codigoGlosa}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-danger text-sm font-medium">
                        {centavosParaReais(item.valorGlosadoCentavos)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rec.itens.some((item) => item.justificativa) && (
                <div className="border-t border-line px-3 py-2">
                  {rec.itens.map((item) => (
                    item.justificativa ? (
                      <p key={item.id} className="text-xs text-text-muted leading-relaxed mb-1 last:mb-0">
                        <span className="font-mono">{item.guiaNumero}</span>: {item.justificativa}
                      </p>
                    ) : null
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
