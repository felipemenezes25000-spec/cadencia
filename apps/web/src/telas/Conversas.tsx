// apps/web/src/telas/Conversas.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useEstadoNaUrl } from '../hooks/useEstadoNaUrl';
import {
  PencilSimple,
  MagnifyingGlass,
  ChatCircleDots,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Icone } from '../ui/Icone';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { Skeleton } from '../ui/Skeleton';
import type { ConversaResumo, FiltroConversas } from './CaixaDeConversas';
import {
  PainelDeConversa,
  type ContextoConversa,
  type Mensagem,
  type TemplateDeMensagem,
} from './PainelDeConversa';

export interface ConversasProps {
  readonly filtro: FiltroConversas;
  readonly conversaAbertaId: string | null;
  readonly carregarConversas: (filtro: FiltroConversas) => Promise<ConversaResumo[]>;
  readonly carregarMensagens: (conversationId: string) => Promise<Mensagem[]>;
  readonly carregarContexto: (conversationId: string) => Promise<ContextoConversa>;
  readonly aoMudarFiltro: (filtro: FiltroConversas) => void;
  readonly aoAbrirConversa: (conversationId: string) => void;
  readonly aoEnviar: (body: string) => Promise<{ messageId: string }>;
  readonly carregarTemplates: () => Promise<readonly TemplateDeMensagem[]>;
  readonly aoAbrirPaciente?: (patientId: string) => void;
  readonly aoVoltar?: () => void;
  readonly aoNova?: () => void;
}

const FILTROS: ReadonlyArray<{ chave: FiltroConversas; rotulo: string }> = [
  { chave: 'todas', rotulo: 'Todas' },
  { chave: 'nao_lidas', rotulo: 'Não lidas' },
  { chave: 'whatsapp', rotulo: 'WhatsApp' },
];

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0]![0]!.toUpperCase();
  return `${partes[0]![0]!.toUpperCase()}${partes[partes.length - 1]![0]!.toUpperCase()}`;
}

function horaOuData(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const agora = new Date();
  const mesmo = d.getUTCFullYear() === agora.getUTCFullYear()
    && d.getUTCMonth() === agora.getUTCMonth()
    && d.getUTCDate() === agora.getUTCDate();
  return new Intl.DateTimeFormat('pt-BR', mesmo
    ? { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
    : { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(d);
}

function nomeExibido(c: ConversaResumo): string {
  return c.patientName ?? c.phoneNumber;
}

function ConversaVazia() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <ChatCircleDots size={29} aria-hidden />
      </span>
      <p className="mt-4 text-base font-semibold text-text">Central de relacionamento</p>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-text-muted">
        Selecione uma conversa para ver mensagens, próximo atendimento e pendências do paciente no mesmo contexto.
      </p>
    </div>
  );
}

function ConversasSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-68px-var(--nav-height,0px))] bg-surface" role="status" aria-label="Carregando conversas" data-testid="conversas-skeleton">
      <div className="w-[360px] shrink-0 border-r border-line max-md:w-full">
        <div className="border-b border-line p-5"><Skeleton variant="text" width="150px" /></div>
        <div className="border-b border-line p-3"><Skeleton variant="text" height="40px" /></div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line p-3.5">
            <Skeleton variant="avatar" width="42px" />
            <div className="flex-1 space-y-1"><Skeleton variant="text" width="60%" /><Skeleton variant="text" width="85%" /></div>
          </div>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center max-md:hidden"><Skeleton variant="text" width="220px" /></div>
    </div>
  );
}

export function Conversas(p: ConversasProps) {
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useEstadoNaUrl('busca');

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    void p.carregarConversas(p.filtro)
      .then((resultado) => { if (ativo) setConversas(resultado); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [p.filtro, p.carregarConversas]);

  const conversasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (termo === '') return conversas;
    return conversas.filter((c) =>
      c.patientName?.toLowerCase().includes(termo)
      || c.phoneNumber.includes(termo)
      || c.lastMessageBody.toLowerCase().includes(termo));
  }, [conversas, busca]);

  const conversaAtiva = p.conversaAbertaId;
  const dadosConversa = conversas.find((c) => c.conversationId === conversaAtiva) ?? null;

  if (carregando) return <ConversasSkeleton />;

  return (
    <div className="flex h-[calc(100dvh-68px-var(--nav-height,0px))] overflow-hidden bg-surface" data-testid="split-view">
      <aside className={cn(
        'flex w-[360px] shrink-0 flex-col border-r border-line bg-surface',
        conversaAtiva != null && 'max-md:hidden',
        'max-md:w-full',
      )}>
        <div className="flex min-h-[72px] items-center justify-between border-b border-line px-4 py-3.5">
          <div>
            <p className="cadencia-eyebrow mb-1">Relacionamento</p>
            <h2 className="text-lg font-bold tracking-[-0.025em] text-text">Conversas</h2>
          </div>
          <Botao variante="secundario" tamanho="sm" iconeEsquerda={PencilSimple} onClick={p.aoNova}>Nova</Botao>
        </div>

        <div className="border-b border-line px-3 py-3">
          <Campo
            prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
            placeholder="Paciente, telefone ou mensagem…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar conversas"
          />
        </div>

        <div role="group" aria-label="Filtros de conversas" className="flex gap-1 border-b border-line bg-surface-subtle px-3 py-2">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              type="button"
              aria-pressed={p.filtro === f.chave}
              onClick={() => p.aoMudarFiltro(f.chave)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors-fast',
                p.filtro === f.chave
                  ? 'bg-surface text-accent shadow-elev-1'
                  : 'text-text-muted hover:bg-surface hover:text-text',
              )}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        <ul aria-label="Lista de conversas" className="m-0 flex-1 list-none overflow-y-auto p-0 scrollbar-thin">
          {conversasFiltradas.map((c) => {
            const ativa = c.conversationId === conversaAtiva;
            return (
              <li key={c.conversationId}>
                <button
                  type="button"
                  onClick={() => p.aoAbrirConversa(c.conversationId)}
                  className={cn(
                    'relative grid w-full grid-cols-[42px_1fr_auto] items-center gap-3 border-b border-line px-3.5 py-3.5 text-left transition-colors-fast',
                    ativa ? 'bg-accent-soft/60' : 'hover:bg-surface-hover',
                    c.unreadCount > 0 && !ativa && 'bg-surface-subtle',
                  )}
                >
                  {ativa ? <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-accent" aria-hidden /> : null}
                  <span aria-hidden="true" className={cn(
                    'grid size-[42px] shrink-0 place-items-center rounded-xl text-xs font-bold',
                    ativa ? 'bg-accent text-white' : 'bg-accent-soft text-accent',
                  )}>
                    {c.patientName != null ? iniciais(c.patientName) : '#'}
                  </span>

                  <span className="grid min-w-0 gap-0.5">
                    <span className={cn('truncate text-sm text-text', c.unreadCount > 0 ? 'font-bold' : 'font-semibold')}>
                      {nomeExibido(c)}
                    </span>
                    <span className={cn('truncate text-xs', c.unreadCount > 0 ? 'font-medium text-text-muted' : 'text-text-faint')}>
                      {c.lastMessageDirection === 'outbound' ? 'Você: ' : ''}{c.lastMessageBody}
                    </span>
                  </span>

                  <span className="grid justify-items-end gap-1 self-start pt-0.5">
                    <span className="text-[11px] tabular-nums text-text-faint">{horaOuData(c.lastMessageAt)}</span>
                    {c.unreadCount > 0 ? (
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{c.unreadCount}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}

          {conversasFiltradas.length === 0 ? (
            <li className="p-8 text-center text-sm text-text-muted">Nenhuma conversa corresponde aos filtros.</li>
          ) : null}
        </ul>
      </aside>

      <main className={cn('min-w-0 flex-1 bg-surface-sunken/35', conversaAtiva == null && 'max-md:hidden')}>
        {conversaAtiva != null && dadosConversa != null ? (
          <PainelDeConversa
            conversationId={dadosConversa.conversationId}
            nomeExibido={nomeExibido(dadosConversa)}
            phoneNumber={dadosConversa.phoneNumber}
            patientId={dadosConversa.patientId}
            carregarMensagens={p.carregarMensagens}
            carregarContexto={p.carregarContexto}
            aoEnviar={p.aoEnviar}
            carregarTemplates={p.carregarTemplates}
            {...(p.aoAbrirPaciente ? { aoAbrirPaciente: p.aoAbrirPaciente } : {})}
            {...(p.aoVoltar ? { aoVoltar: p.aoVoltar } : {})}
          />
        ) : <ConversaVazia />}
      </main>
    </div>
  );
}
