// apps/web/src/telas/CaixaDeConversas.tsx
'use client';

import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';

export type FiltroConversas = 'todas' | 'nao_lidas' | 'whatsapp';

export interface ConversaResumo {
  readonly conversationId: string;
  readonly patientId: string | null;
  readonly patientName: string | null;
  readonly phoneNumber: string;
  readonly lastMessageBody: string;
  readonly lastMessageAt: string;
  readonly unreadCount: number;
  readonly channel: 'whatsapp' | 'sms' | 'email';
  readonly status: 'ativa' | 'arquivada';
  readonly lastMessageDirection: 'inbound' | 'outbound';
  readonly online?: boolean;
}

const FILTROS: ReadonlyArray<{ chave: FiltroConversas; rotulo: string }> = [
  { chave: 'todas', rotulo: 'Todas' },
  { chave: 'nao_lidas', rotulo: 'Nao lidas' },
  { chave: 'whatsapp', rotulo: 'WhatsApp' },
];

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
  if (c.patientName !== null) return c.patientName;
  return c.phoneNumber;
}

export interface CaixaDeConversasProps {
  readonly filtro: FiltroConversas;
  readonly carregar: (filtro: FiltroConversas) => Promise<ConversaResumo[]>;
  readonly aoMudarFiltro: (filtro: FiltroConversas) => void;
  readonly aoAbrirConversa: (conversationId: string) => void;
  /** ID da conversa ativa para destaque visual */
  readonly conversaAtivaId?: string | null;
}

export function CaixaDeConversas(p: CaixaDeConversasProps) {
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);

  useEffect(() => {
    void p.carregar(p.filtro).then(setConversas);
  }, [p, p.filtro]);

  return (
    <div className="grid gap-4 p-6">
      <h1 className="m-0 text-[22px] font-semibold leading-tight">Conversas</h1>

      <div
        role="group"
        aria-label="Filtros de conversas"
        className="flex flex-wrap gap-1"
      >
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            type="button"
            aria-pressed={p.filtro === f.chave}
            onClick={() => p.aoMudarFiltro(f.chave)}
            className={cn(
              'min-h-7 cursor-pointer rounded-full border border-line px-3 py-1 text-[13px]',
              'transition-colors duration-[var(--dur-2)]',
              p.filtro === f.chave
                ? 'bg-accent-soft text-text'
                : 'bg-surface text-text hover:bg-surface-hover',
            )}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      <ul
        aria-label="Lista de conversas"
        className="m-0 list-none overflow-hidden rounded-md border border-line bg-surface p-0"
      >
        {conversas.map((c) => {
          const ativa = p.conversaAtivaId === c.conversationId;
          return (
            <li
              key={c.conversationId}
              data-active={ativa ? 'true' : undefined}
              onClick={() => p.aoAbrirConversa(c.conversationId)}
              className={cn(
                'grid cursor-pointer grid-cols-[40px_1fr_auto] items-center gap-2',
                'border-b border-line px-3 py-3',
                'transition-colors duration-[var(--dur-2)]',
                ativa
                  ? 'border-r-2 border-r-accent bg-accent-soft'
                  : c.unreadCount > 0
                    ? 'bg-surface-hover hover:bg-surface-hover'
                    : 'bg-surface hover:bg-surface-hover',
              )}
            >
              {/* Avatar com indicador online */}
              <div className="relative shrink-0">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent"
                >
                  {c.patientName !== null ? iniciais(c.patientName) : '#'}
                </span>
                {c.online === true && (
                  <span
                    data-testid="online-indicator"
                    role="status"
                    aria-label="Online"
                    className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface bg-ok"
                  />
                )}
              </div>

              {/* Conteudo: nome + preview */}
              <div className="grid gap-0.5 overflow-hidden">
                <span
                  className={cn(
                    'truncate text-sm',
                    c.unreadCount > 0 ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {nomeExibido(c)}
                </span>
                <span
                  className={cn(
                    'truncate text-[13px]',
                    c.unreadCount > 0 ? 'text-text' : 'text-text-muted',
                  )}
                >
                  {c.lastMessageBody}
                </span>
              </div>

              {/* Hora + badge de nao lidas */}
              <div className="grid gap-0.5 justify-items-end self-start">
                <span className="num text-[11px] text-text-muted">
                  {horaOuData(c.lastMessageAt)}
                </span>
                {c.unreadCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-on">
                    {c.unreadCount}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
