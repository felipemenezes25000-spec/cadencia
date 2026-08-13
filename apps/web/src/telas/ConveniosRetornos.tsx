// apps/web/src/telas/ConveniosRetornos.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEstadoNaUrl } from '../hooks/useEstadoNaUrl';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';

// -- Tipos ------------------------------------------------------------------

export interface Demonstrativo {
  readonly id: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly registroAns: string;
  readonly protocolo: string;
  readonly tipo: 'analise' | 'pagamento';
  readonly dataImportacao: string;
  readonly periodoInicio: string;
  readonly periodoFim: string;
  readonly totalApresentadoCentavos: number;
  readonly totalProcessadoCentavos: number;
  readonly totalLiberadoCentavos: number;
  readonly totalGlosadoCentavos: number;
  readonly totalItens: number;
  readonly itensGlosados: number;
}

export interface OperadoraResumo {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
}

export interface TotaisRetornos {
  readonly apresentadoCentavos: number;
  readonly processadoCentavos: number;
  readonly liberadoCentavos: number;
  readonly glosadoCentavos: number;
}

export interface RetornosDados {
  readonly demonstrativos: readonly Demonstrativo[];
  readonly operadoras: readonly OperadoraResumo[];
  readonly totais: TotaisRetornos;
}

export interface FiltrosRetornos {
  readonly operadoraId?: string;
  readonly tipo?: 'analise' | 'pagamento';
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface ConveniosRetornosProps {
  readonly carregarDados: (filtros: FiltrosRetornos) => Promise<RetornosDados>;
  readonly aoImportarXml: (arquivo: File) => Promise<void>;
  readonly aoAbrirDemonstrativo: (id: string) => void;
}

// -- Helpers ----------------------------------------------------------------

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const ROTULOS_TOTAIS: { chave: keyof TotaisRetornos; rotulo: string }[] = [
  { chave: 'apresentadoCentavos', rotulo: 'Apresentado' },
  { chave: 'processadoCentavos', rotulo: 'Processado' },
  { chave: 'liberadoCentavos', rotulo: 'Liberado' },
  { chave: 'glosadoCentavos', rotulo: 'Glosado' },
];

const TIPO_CHIP: Record<'analise' | 'pagamento', { rotulo: string; classes: string }> = {
  analise:   { rotulo: 'Analise',   classes: 'text-accent bg-accent-soft' },
  pagamento: { rotulo: 'Pagamento', classes: 'text-ok bg-ok-soft' },
};

// -- Componente -------------------------------------------------------------

export function ConveniosRetornos(p: ConveniosRetornosProps) {
  const [dados, setDados] = useState<RetornosDados | null>(null);
  const [busca, setBusca] = useEstadoNaUrl('busca');
  const [tipoFiltro, setTipoFiltro] = useEstadoNaUrl('tipo');
  const [operadoraFiltro, setOperadoraFiltro] = useEstadoNaUrl('operadora');
  const [importando, setImportando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  const demonstrativosFiltrados = useMemo(() => {
    if (!dados) return [];
    return dados.demonstrativos.filter((d) => {
      if (tipoFiltro !== '' && d.tipo !== tipoFiltro) return false;
      if (operadoraFiltro !== '' && d.operadoraId !== operadoraFiltro) return false;
      if (busca !== '') {
        const termo = busca.toLowerCase();
        return (
          d.protocolo.toLowerCase().includes(termo) ||
          d.operadoraNome.toLowerCase().includes(termo)
        );
      }
      return true;
    });
  }, [dados, busca, tipoFiltro, operadoraFiltro]);

  function abrirDialogImportar(): void {
    fileRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const arquivo = e.target.files?.[0];
    if (arquivo === undefined) return;
    setImportando(true);
    void p.aoImportarXml(arquivo).finally(() => {
      setImportando(false);
      if (fileRef.current) fileRef.current.value = '';
      void p.carregarDados({}).then(setDados);
    });
  }

  // -- Skeleton de carregamento --
  if (dados === null) {
    return (
      <div className="space-y-4" role="status" aria-label="Carregando retornos">
        <Skeleton variant="text" width="30%" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabecalho */}
      <div className="flex items-center justify-between">
        <h2 className="text-[length:var(--fs-15)] font-semibold">Retornos</h2>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".xml"
            onChange={handleFileChange}
            className="hidden"
            aria-label="Selecionar arquivo XML"
          />
          <Botao variante="primario" tamanho="md"
            onClick={abrirDialogImportar} carregando={importando}>
            Importar
          </Botao>
        </div>
      </div>

      {/* Totalizadores */}
      <div
        role="group" aria-label="Totalizadores de retornos" aria-live="polite"
        className="flex rounded-md border border-line bg-surface overflow-hidden"
      >
        {ROTULOS_TOTAIS.map((t, i) => (
          <div
            key={t.chave}
            className={cn(
              'flex-1 px-3 py-4 grid gap-1 justify-items-start',
              i > 0 && 'border-l border-line',
            )}
          >
            <span
              className={cn(
                'text-[28px] font-semibold leading-tight tabular-nums',
                t.chave === 'glosadoCentavos' && dados.totais[t.chave] > 0
                  ? 'text-danger'
                  : 'text-text',
              )}
            >
              {centavosParaReais(dados.totais[t.chave])}
            </span>
            <span className="text-[11px] uppercase tracking-[.04em] text-text-muted">
              {t.rotulo}
            </span>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <Campo
          prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
          placeholder="Buscar..."
          className="max-w-xs"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar retornos"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-tipo-ret" className="text-sm font-medium text-text-muted">
            Tipo
          </label>
          <select
            id="filtro-tipo-ret"
            value={tipoFiltro}
            onChange={(e) => setTipoFiltro(e.target.value)}
            aria-label="Tipo"
            className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-text transition-colors-fast focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          >
            <option value="">Todos</option>
            <option value="analise">Analise</option>
            <option value="pagamento">Pagamento</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-operadora-ret" className="text-sm font-medium text-text-muted">
            Operadora
          </label>
          <select
            id="filtro-operadora-ret"
            value={operadoraFiltro}
            onChange={(e) => setOperadoraFiltro(e.target.value)}
            aria-label="Operadora"
            className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-text transition-colors-fast focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          >
            <option value="">Todas</option>
            {dados.operadoras.map((op) => (
              <option key={op.id} value={op.id}>{op.nome}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabela de demonstrativos */}
      {demonstrativosFiltrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-muted">
          <p>Nenhum demonstrativo encontrado</p>
        </div>
      ) : (
        <section aria-label="Demonstrativos importados">
          <div className="rounded-lg border border-line overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-raised">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Lote</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Operadora</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Data retorno</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted">Guias</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted">Valor aprovado</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted">Valor glosado</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {demonstrativosFiltrados.map((d) => {
                    const chip = TIPO_CHIP[d.tipo];
                    return (
                      <tr
                        key={d.id}
                        className="hover:bg-surface-raised transition-colors-fast cursor-pointer"
                        onClick={() => p.aoAbrirDemonstrativo(d.id)}
                        role="link"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            p.aoAbrirDemonstrativo(d.id);
                          }
                        }}
                      >
                        <td className="px-4 py-3 font-mono text-xs">{d.protocolo}</td>
                        <td className="px-4 py-3 text-text">{d.operadoraNome}</td>
                        <td className="px-4 py-3 text-text-muted">{d.dataImportacao}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{d.totalItens}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{centavosParaReais(d.totalLiberadoCentavos)}</td>
                        <td className={cn(
                          'px-4 py-3 text-right font-mono tabular-nums',
                          d.totalGlosadoCentavos > 0 && 'text-danger',
                        )}>
                          {d.totalGlosadoCentavos > 0
                            ? centavosParaReais(d.totalGlosadoCentavos)
                            : '—'}
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
