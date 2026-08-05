// apps/web/src/telas/CaixaDeConversas.tsx
'use client';

import { useEffect, useState } from 'react';

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
  const mesmo = d.getUTCFullYear() === agora.getUTCFullYear()
    && d.getUTCMonth() === agora.getUTCMonth()
    && d.getUTCDate() === agora.getUTCDate();
  if (mesmo) {
    return new Intl.DateTimeFormat('pt-BR',
      { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d);
  }
  return new Intl.DateTimeFormat('pt-BR',
    { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(d);
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
}

export function CaixaDeConversas(p: CaixaDeConversasProps) {
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);

  useEffect(() => {
    void p.carregar(p.filtro).then(setConversas);
  }, [p, p.filtro]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Conversas
      </h1>

      <div role="group" aria-label="Filtros de conversas"
           style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        {FILTROS.map((f) => (
          <button key={f.chave} type="button" aria-pressed={p.filtro === f.chave}
            onClick={() => p.aoMudarFiltro(f.chave)}
            style={{
              border: 'var(--border)', borderRadius: 'var(--r-full)', minHeight: 28,
              padding: `0 var(--s-5)`, fontSize: 'var(--fs-13)', cursor: 'pointer',
              background: p.filtro === f.chave ? 'var(--accent-soft)' : 'var(--surface)',
              color: 'var(--text)',
            }}>
            {f.rotulo}
          </button>
        ))}
      </div>

      <ul aria-label="Lista de conversas"
          style={{ listStyle: 'none', margin: 0, padding: 0,
                   border: 'var(--border)', borderRadius: 'var(--r-md)',
                   overflow: 'hidden', background: 'var(--surface)' }}>
        {conversas.map((c) => (
          <li key={c.conversationId}
            onClick={() => p.aoAbrirConversa(c.conversationId)}
            style={{
              display: 'grid',
              gridTemplateColumns: '40px 1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: `var(--s-4) var(--s-5)`,
              borderBottom: 'var(--border)', cursor: 'pointer',
              background: c.unreadCount > 0 ? 'var(--surface-hover)' : 'var(--surface)',
            }}>
            <span aria-hidden="true" style={{
              width: 40, height: 40, borderRadius: 'var(--r-full)',
              background: 'var(--accent-soft)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-semibold)',
            }}>
              {c.patientName !== null ? iniciais(c.patientName) : '#'}
            </span>

            <div style={{ display: 'grid', gap: 'var(--s-1)', overflow: 'hidden' }}>
              <span style={{
                fontWeight: c.unreadCount > 0 ? 'var(--fw-semibold)' : 'var(--fw-medium)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {nomeExibido(c)}
              </span>
              <span style={{
                fontSize: 'var(--fs-13)', color: 'var(--text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {c.lastMessageBody}
              </span>
            </div>

            <div style={{ display: 'grid', gap: 'var(--s-1)', justifyItems: 'end',
                          alignSelf: 'start' }}>
              <span className="num" style={{
                fontSize: 'var(--fs-11)', color: 'var(--text-muted)',
              }}>
                {horaOuData(c.lastMessageAt)}
              </span>
              {c.unreadCount > 0 ? (
                <span style={{
                  minWidth: 20, height: 20, borderRadius: 'var(--r-full)',
                  background: 'var(--accent)', color: 'var(--accent-on)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'var(--fs-11)', fontWeight: 'var(--fw-semibold)',
                  padding: '0 6px',
                }}>
                  {c.unreadCount}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
