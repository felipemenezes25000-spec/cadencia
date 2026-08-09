// apps/web/src/telas/ConveniosLotes.tsx
'use client';

import { useEffect, useState, useMemo, type ChangeEvent } from 'react';
import { MagnifyingGlass, Plus, Package } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { ChipDeStatusTiss } from '../ui/ChipDeStatusTiss';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type StatusLote = 'rascunho' | 'enviado' | 'processado' | 'glosado' | 'processando';

export interface GuiaDoLote {
  readonly id: string;
  readonly numeroGuia: string;
  readonly pacienteNome: string;
  readonly codigoProcedimento: string;
  readonly valorCentavos: number;
  readonly sequencial: number;
}

export interface Lote {
  readonly id: string;
  readonly numero: string;
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly status: StatusLote;
  readonly totalGuias: number;
  readonly totalCentavos: number;
  readonly criadoEm: string;
  readonly enviadoEm: string | null;
  readonly guias: readonly GuiaDoLote[];
  readonly progresso?: number;
}

export interface LotesDados {
  readonly lotes: readonly Lote[];
}

export interface ConveniosLotesProps {
  readonly carregarDados: () => Promise<LotesDados>;
  readonly aoEnviar: (loteId: string) => Promise<void>;
  readonly aoCancelar: (loteId: string) => Promise<void>;
  readonly aoBaixarXml: (loteId: string) => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

function formatarData(data: string): string {
  const partes = data.split('-');
  if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
  return data;
}

// ── Skeleton de carregamento ──────────────────────────────────────────────

function LotesSkeleton() {
  return (
    <div
      role="status"
      aria-label="Carregando lotes..."
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-line bg-surface shadow-elev-1 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <Skeleton variant="text" width="80px" />
            <Skeleton variant="text" width="70px" height="20px" />
          </div>
          <Skeleton variant="text" width="120px" />
          <Skeleton variant="text" width="60px" />
          <Skeleton variant="text" width="100px" height="24px" />
          <Skeleton variant="text" width="90px" />
        </div>
      ))}
    </div>
  );
}

// ── Estado vazio ──────────────────────────────────────────────────────────

function EstadoVazioLotes() {
  return (
    <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-8 text-center">
      <Package size={40} className="mx-auto mb-3 text-text-muted" aria-hidden />
      <p className="text-sm font-medium text-text">Nenhum lote encontrado</p>
      <p className="mt-1 text-xs text-text-muted">
        Crie um novo lote para comecar a faturar.
      </p>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosLotes(p: ConveniosLotesProps) {
  const [dados, setDados] = useState<LotesDados | null>(null);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  const lotesFiltrados = useMemo(() => {
    if (!dados) return [];
    if (busca.trim() === '') return [...dados.lotes];
    const termo = busca.toLowerCase();
    return dados.lotes.filter(
      (lote) =>
        lote.numero.toLowerCase().includes(termo) ||
        lote.operadoraNome.toLowerCase().includes(termo),
    );
  }, [dados, busca]);

  // Estado de carregamento
  if (dados === null) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton variant="text" width="240px" height="36px" />
          <Skeleton variant="text" width="100px" height="36px" />
        </div>
        <LotesSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Acoes */}
      <div className="flex items-center justify-between gap-3">
        <Campo
          prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
          placeholder="Buscar lote..."
          className="max-w-xs"
          value={busca}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setBusca(e.target.value)}
          aria-label="Buscar lote"
        />
        <Botao variante="primario" iconeEsquerda={Plus}>
          Novo lote
        </Botao>
      </div>

      {/* Estado vazio ou grid */}
      {lotesFiltrados.length === 0 ? (
        <EstadoVazioLotes />
      ) : (
        <section aria-label="Lista de lotes">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {lotesFiltrados.map((lote) => (
              <div
                key={lote.id}
                className={cn(
                  'rounded-xl border border-line bg-surface shadow-elev-1 p-4 cursor-pointer',
                  'hover:bg-surface-raised transition-colors-fast',
                )}
              >
                {/* Cabecalho */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-mono font-medium text-text tabular-nums">
                    {lote.numero}
                  </span>
                  {lote.status === 'processando' ? (
                    <span
                      className={cn(
                        'inline-flex items-center gap-[var(--s-2)]',
                        'text-[length:var(--fs-11)] uppercase tracking-[.04em]',
                        'font-medium px-[var(--s-4)] py-[var(--s-1)]',
                        'rounded-full text-accent bg-accent-soft',
                      )}
                    >
                      Processando
                    </span>
                  ) : (
                    <ChipDeStatusTiss status={lote.status} />
                  )}
                </div>

                {/* Info */}
                <p className="text-sm text-text mb-1">{lote.operadoraNome}</p>
                <p className="text-xs text-text-muted">{lote.totalGuias} guias</p>

                {/* Valor */}
                <p className="text-lg font-bold text-text mt-3 tabular-nums">
                  {centavosParaReais(lote.totalCentavos)}
                </p>

                {/* Barra de progresso (se processando) */}
                {lote.status === 'processando' && lote.progresso != null && (
                  <div className="mt-3" data-testid="barra-progresso">
                    <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                      <span>Processando...</span>
                      <span>{lote.progresso}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-line overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-300"
                        role="progressbar"
                        aria-valuenow={lote.progresso}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Progresso do lote"
                        style={{ width: `${lote.progresso}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Data */}
                <p className="text-[10px] text-text-muted mt-3">
                  Criado em {formatarData(lote.criadoEm)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
