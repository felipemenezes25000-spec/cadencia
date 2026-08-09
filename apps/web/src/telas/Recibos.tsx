'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  EnvelopeSimple,
  MagnifyingGlass,
  Printer,
  Receipt,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';
import { PageHeader } from '../ui/PageHeader';
import { Tooltip } from '../ui/Tooltip';

/* ── tipos exportados (backward compat) ───────────────────────────── */

export type MetodoRecibo = 'dinheiro' | 'cartao' | 'pix' | 'link';

export interface LinhaDeRecibo {
  readonly receiptId: string;
  readonly receiptNumber: number;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly method: MetodoRecibo;
  readonly paidAt: string;
}

export interface RecibosProps {
  readonly carregarRecibos: (filtros: {
    dataInicio?: string;
    dataFim?: string;
    paciente?: string;
  }) => Promise<LinhaDeRecibo[]>;
  readonly aoImprimirRecibo: (receiptId: string) => Promise<void>;
  readonly aoEnviarEmail?: (receiptId: string) => Promise<void>;
}

/* ── helpers (preservados) ────────────────────────────────────────── */

const ROTULO_METODO: Record<MetodoRecibo, string> = {
  dinheiro: 'Dinheiro',
  cartao: 'Cartão',
  pix: 'Pix',
  link: 'Link',
};

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(d);
}

/* ── skeleton de carregamento ─────────────────────────────────────── */

function TabelaSkeleton() {
  return (
    <div className="space-y-2" data-testid="skeleton-recibos" role="status" aria-label="Carregando recibos">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-md bg-surface-sunken px-4 py-3 animate-pulse"
        >
          <div className="h-4 w-16 rounded bg-line" />
          <div className="h-4 flex-1 rounded bg-line" />
          <div className="h-4 w-24 rounded bg-line" />
          <div className="h-4 w-20 rounded bg-line" />
          <div className="h-4 w-20 rounded bg-line" />
        </div>
      ))}
    </div>
  );
}

/* ── classes reutilizaveis ────────────────────────────────────────── */

const thClasses =
  'px-4 py-2.5 text-left text-xs font-medium text-text-muted';

const acaoBotaoClasses = cn(
  'rounded-md p-1.5 text-text-muted',
  'transition-colors duration-[var(--dur-2)]',
  'hover:bg-surface-hover hover:text-text',
  'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
);

/* ── componente principal ─────────────────────────────────────────── */

export function Recibos(p: RecibosProps) {
  const [recibos, setRecibos] = useState<LinhaDeRecibo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [paciente, setPaciente] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    setIsLoading(true);
    void p.carregarRecibos({}).then((dados) => {
      setRecibos(dados);
      setIsLoading(false);
    });
  }, [p]);

  function filtrar(): void {
    setIsLoading(true);
    const filtros: { dataInicio?: string; dataFim?: string; paciente?: string } = {};
    if (dataInicio !== '') filtros.dataInicio = dataInicio;
    if (dataFim !== '') filtros.dataFim = dataFim;
    if (paciente !== '') filtros.paciente = paciente;
    void p.carregarRecibos(filtros).then((dados) => {
      setRecibos(dados);
      setIsLoading(false);
    });
  }

  const recibosFiltrados = useMemo(() => {
    if (busca === '') return recibos;
    const termo = busca.toLowerCase();
    return recibos.filter(
      (r) =>
        r.patientName.toLowerCase().includes(termo) ||
        String(r.receiptNumber).includes(termo),
    );
  }, [recibos, busca]);

  return (
    <div className="cadencia-page cadencia-enter mx-auto max-w-6xl space-y-6">
      <PageHeader titulo="Recibos" semBreadcrumb />

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <Campo
          prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
          placeholder="Buscar por paciente ou numero..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-xs"
          aria-label="Buscar recibos"
        />
        <Campo
          type="date"
          rotulo="Data início"
          denso
          value={dataInicio}
          onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Data início"
          className="w-36"
        />
        <Campo
          type="date"
          rotulo="Data fim"
          denso
          value={dataFim}
          onChange={(e) => setDataFim(e.target.value)}
          aria-label="Data fim"
          className="w-36"
        />
        <Campo
          rotulo="Paciente"
          denso
          value={paciente}
          onChange={(e) => setPaciente(e.target.value)}
          aria-label="Paciente"
          placeholder="Nome do paciente"
        />
        <Botao variante="secundario" tamanho="sm" onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Skeleton de carregamento */}
      {isLoading && <TabelaSkeleton />}

      {/* Tabela de recibos */}
      {!isLoading && recibosFiltrados.length > 0 && (
        <section aria-label="Lista de recibos">
          <div className="overflow-hidden rounded-[18px] border border-line/75 bg-surface/94 shadow-elev-1">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line/70/70 bg-surface-sunken/45">
                    <th scope="col" className={thClasses}>
                      Numero
                    </th>
                    <th scope="col" className={thClasses}>
                      Paciente
                    </th>
                    <th scope="col" className={thClasses}>
                      Data
                    </th>
                    <th
                      scope="col"
                      className={cn(thClasses, 'text-right')}
                    >
                      Valor
                    </th>
                    <th scope="col" className={thClasses}>
                      Forma pgto
                    </th>
                    <th scope="col" className="px-4 py-2.5 w-20">
                      <span className="sr-only">Acoes</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/65">
                  {recibosFiltrados.map((r) => (
                    <tr
                      key={r.receiptId}
                      className="transition-colors duration-[var(--dur-2)] hover:bg-surface-raised"
                    >
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-text-muted">
                        #{r.receiptNumber}
                      </td>
                      <td className="px-4 py-3 font-medium text-text">
                        {r.patientName}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {formatarDataHora(r.paidAt)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-ok">
                        {centavosParaReais(r.amountCents)}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {ROTULO_METODO[r.method]}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Tooltip conteudo="Imprimir">
                            <button
                              className={acaoBotaoClasses}
                              aria-label={`Imprimir recibo ${r.receiptNumber}`}
                              onClick={() => {
                                void p.aoImprimirRecibo(r.receiptId);
                              }}
                            >
                              <Icone icon={Printer} size="sm" />
                            </button>
                          </Tooltip>
                          <Tooltip conteudo="Enviar por email">
                            <button
                              className={acaoBotaoClasses}
                              aria-label={`Enviar recibo ${r.receiptNumber} por email`}
                              onClick={() => {
                                void p.aoEnviarEmail?.(r.receiptId);
                              }}
                            >
                              <Icone icon={EnvelopeSimple} size="sm" />
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Estado vazio */}
      {!isLoading && recibosFiltrados.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Icone icon={Receipt} size="xl" className="text-text-faint mb-3" />
          <p className="text-base font-medium text-text">
            Nenhum recibo encontrado
          </p>
          <p className="text-sm text-text-muted mt-1">
            Tente ajustar os filtros de busca.
          </p>
        </div>
      )}
    </div>
  );
}
