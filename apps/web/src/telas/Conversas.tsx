// apps/web/src/telas/Conversas.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  PencilSimple,
  MagnifyingGlass,
  ChatCircleDots,
  ArrowLeft,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Icone } from '../ui/Icone';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { Skeleton } from '../ui/Skeleton';
import type {
  ConversaResumo,
  FiltroConversas,
} from './CaixaDeConversas';
import {
  PainelDeConversa,
  type ContextoConversa,
  type Mensagem,
} from './PainelDeConversa';

/* ── Props públicas ───────────────────────────────────────────────────── */

export interface ConversasProps {
  readonly filtro: FiltroConversas;
  readonly conversaAbertaId: string | null;
  readonly carregarConversas: (filtro: FiltroConversas) => Promise<ConversaResumo[]>;
  readonly carregarMensagens: (conversationId: string) => Promise<Mensagem[]>;
  readonly carregarContexto: (conversationId: string) => Promise<ContextoConversa>;
  readonly aoMudarFiltro: (filtro: FiltroConversas) => void;
  readonly aoAbrirConversa: (conversationId: string) => void;
  readonly aoEnviar: (body: string) => Promise<{ messageId: string }>;
  readonly aoVincularPaciente: () => void;
  readonly aoSelecionarTemplate: () => void;
  /** Callback para voltar à lista no mobile (limpar conversa ativa) */
  readonly aoVoltar?: () => void;
  /** Callback para iniciar nova conversa */
  readonly aoNova?: () => void;
}

/* ── Constantes ────────────────────────────────────────────────────────── */

const FILTROS: ReadonlyArray<{ chave: FiltroConversas; rotulo: string }> = [
  { chave: 'todas', rotulo: 'Todas' },
  { chave: 'nao_lidas', rotulo: 'Não lidas' },
  { chave: 'whatsapp', rotulo: 'WhatsApp' },
];

/* ── Utilidades (replicadas de CaixaDeConversas — funções privadas lá) ── */

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0]![0]!.toUpperCase();
  return `${partes[0]![0]!.toUpperCase()}${partes[partes.length - 1]![0]!.toUpperCase()}`;
}

function horaOuData(iso: string): string {
  const d = new Date(iso);
  const agora = new Date();
  const mesmo =
    d.getUTCFullYear() === agora.getUTCFullYear() &&
    d.getUTCMonth() === agora.getUTCMonth() &&
    d.getUTCDate() === agora.getUTCDate();
  if (mesmo) {
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(d);
  }
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(d);
}

function nomeExibido(c: ConversaResumo): string {
  return c.patientName ?? c.phoneNumber;
}

/* ── Sub-componentes ───────────────────────────────────────────────────── */

/** Estado vazio quando nenhuma conversa está selecionada */
function ConversaVazia() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center p-6">
      <Icone icon={ChatCircleDots} size="xl" className="text-text-muted mb-3" />
      <p className="text-base font-medium text-text">
        Nenhuma conversa selecionada
      </p>
      <p className="mt-1 text-sm text-text-muted">
        Selecione uma conversa à esquerda ou inicie uma nova
      </p>
    </div>
  );
}

/** Skeleton de carregamento para a tela inteira */
function ConversasSkeleton() {
  return (
    <div
      className="flex h-full"
      role="status"
      aria-label="Carregando conversas"
      data-testid="conversas-skeleton"
    >
      {/* Painel esquerdo skeleton */}
      <div className="w-80 shrink-0 border-r border-line max-md:w-full">
        <div className="border-b border-line p-4">
          <Skeleton variant="text" width="120px" ariaLabel="Carregando título" />
        </div>
        <div className="border-b border-line p-3">
          <Skeleton variant="text" height="36px" ariaLabel="Carregando busca" />
        </div>
        <div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3">
              <Skeleton variant="avatar" width="40px" ariaLabel="Carregando avatar" />
              <div className="flex-1 space-y-1">
                <Skeleton variant="text" width="60%" ariaLabel="Carregando nome" />
                <Skeleton variant="text" width="80%" ariaLabel="Carregando mensagem" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Painel direito skeleton */}
      <div className="flex flex-1 items-center justify-center max-md:hidden">
        <Skeleton variant="text" width="200px" ariaLabel="Carregando conversa" />
      </div>
    </div>
  );
}

/* ── Componente principal ──────────────────────────────────────────────── */

export function Conversas(p: ConversasProps) {
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');

  /* Carrega conversas quando o filtro muda */
  useEffect(() => {
    setCarregando(true);
    void p
      .carregarConversas(p.filtro)
      .then(setConversas)
      .finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.filtro]);

  /* Filtra conversas pelo campo de busca */
  const conversasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (termo === '') return conversas;
    return conversas.filter(
      (c) =>
        c.patientName?.toLowerCase().includes(termo) ||
        c.phoneNumber.includes(termo) ||
        c.lastMessageBody.toLowerCase().includes(termo),
    );
  }, [conversas, busca]);

  const conversaAtiva = p.conversaAbertaId;
  const dadosConversa =
    conversas.find((c) => c.conversationId === conversaAtiva) ?? null;

  /* ── Skeleton de carregamento inicial ────────────────────────────────── */
  if (carregando) {
    return <ConversasSkeleton />;
  }

  return (
    <div
      className="m-4 flex h-[calc(100vh-var(--nav-height,0px)-32px)] overflow-hidden rounded-2xl border border-line bg-surface shadow-elev-2 max-md:m-0 max-md:h-[calc(100vh-var(--nav-height,0px))] max-md:rounded-none max-md:border-0"
      data-testid="split-view"
    >
      {/* ── Painel esquerdo: lista de conversas ──────────────────────────── */}
      <div
        className={cn(
          'w-[340px] shrink-0 border-r border-line flex flex-col bg-surface/90',
          conversaAtiva != null && 'max-md:hidden',
        )}
      >
        {/* Cabeçalho */}
        <div className="flex min-h-[64px] items-center justify-between border-b border-line px-4 py-3">
          <h1 className="text-base font-semibold text-text">Conversas</h1>
          <Botao
            variante="fantasma"
            tamanho="sm"
            iconeEsquerda={PencilSimple}
            onClick={p.aoNova}
          >
            Nova
          </Botao>
        </div>

        {/* Busca */}
        <div className="border-b border-line px-3 py-2">
          <Campo
            prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
            placeholder="Buscar conversas..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        {/* Filtros */}
        <div
          role="group"
          aria-label="Filtros de conversas"
          className="flex flex-wrap gap-1 border-b border-line px-3 py-2"
        >
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              type="button"
              aria-pressed={p.filtro === f.chave}
              onClick={() => p.aoMudarFiltro(f.chave)}
              className={cn(
                'cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs font-semibold',
                'transition-colors-fast',
                p.filtro === f.chave
                  ? 'border-accent/25 bg-accent-soft text-accent shadow-elev-1'
                  : 'bg-surface text-text-muted hover:border-line-strong hover:bg-surface-hover hover:text-text',
              )}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        {/* Lista de conversas */}
        <ul
          aria-label="Lista de conversas"
          className="m-0 flex-1 list-none overflow-y-auto p-0"
        >
          {conversasFiltradas.map((c) => (
            <li
              key={c.conversationId}
              onClick={() => p.aoAbrirConversa(c.conversationId)}
              className={cn(
                'grid cursor-pointer grid-cols-[40px_1fr_auto] items-center gap-2 border-b border-line px-3 py-3.5',
                'transition-colors-fast hover:bg-surface-hover',
                c.unreadCount > 0 && 'bg-surface-hover',
                c.conversationId === conversaAtiva &&
                  'bg-accent-soft hover:bg-accent-soft',
              )}
            >
              {/* Avatar / iniciais */}
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
              >
                {c.patientName != null ? iniciais(c.patientName) : '#'}
              </span>

              {/* Nome + última mensagem */}
              <div className="grid gap-0.5 overflow-hidden">
                <span
                  className={cn(
                    'truncate text-sm',
                    c.unreadCount > 0 ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {nomeExibido(c)}
                </span>
                <span className="truncate text-xs text-text-muted">
                  {c.lastMessageBody}
                </span>
              </div>

              {/* Hora + badge de não lidas */}
              <div className="grid gap-0.5 justify-items-end self-start">
                <span className="text-[11px] tabular-nums text-text-muted">
                  {horaOuData(c.lastMessageAt)}
                </span>
                {c.unreadCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-on">
                    {c.unreadCount}
                  </span>
                )}
              </div>
            </li>
          ))}

          {conversasFiltradas.length === 0 && (
            <li className="p-6 text-center text-sm text-text-muted">
              Nenhuma conversa encontrada
            </li>
          )}
        </ul>
      </div>

      {/* ── Painel direito: conversa ativa ou estado vazio ────────────────── */}
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col bg-surface-sunken/35',
          conversaAtiva == null && 'max-md:hidden',
        )}
      >
        {conversaAtiva != null && dadosConversa != null ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Botão voltar — apenas no mobile */}
            <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:hidden">
              <button
                type="button"
                onClick={p.aoVoltar}
                className="rounded-lg p-1.5 text-text-muted transition-colors-fast hover:bg-surface-raised"
                aria-label="Voltar para lista"
              >
                <Icone icon={ArrowLeft} size="md" />
              </button>
              <span className="truncate text-sm font-medium text-text">
                {nomeExibido(dadosConversa)}
              </span>
            </div>

            {/* Painel de conversa */}
            <div className="min-h-0 flex-1">
              <PainelDeConversa
                conversationId={dadosConversa.conversationId}
                nomeExibido={nomeExibido(dadosConversa)}
                phoneNumber={dadosConversa.phoneNumber}
                patientId={dadosConversa.patientId}
                carregarMensagens={p.carregarMensagens}
                carregarContexto={p.carregarContexto}
                aoEnviar={p.aoEnviar}
                aoVincularPaciente={p.aoVincularPaciente}
                aoSelecionarTemplate={p.aoSelecionarTemplate}
              />
            </div>
          </div>
        ) : (
          <ConversaVazia />
        )}
      </div>
    </div>
  );
}
