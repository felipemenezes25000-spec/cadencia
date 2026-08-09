// apps/web/src/telas/CaixaDeConversas.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChatCircleDots, MagnifyingGlass, WhatsappLogo, EnvelopeSimpleOpen } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { PageHeader } from '../ui/PageHeader';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';

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
  const mesmo = d.getUTCFullYear() === agora.getUTCFullYear() && d.getUTCMonth() === agora.getUTCMonth() && d.getUTCDate() === agora.getUTCDate();
  if (mesmo) return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(d);
}

function nomeExibido(c: ConversaResumo): string { return c.patientName !== null ? c.patientName : c.phoneNumber; }

export interface CaixaDeConversasProps {
  readonly filtro: FiltroConversas;
  readonly carregar: (filtro: FiltroConversas) => Promise<ConversaResumo[]>;
  readonly aoMudarFiltro: (filtro: FiltroConversas) => void;
  readonly aoAbrirConversa: (conversationId: string) => void;
  readonly conversaAtivaId?: string | null;
}

export function CaixaDeConversas(p: CaixaDeConversasProps) {
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    let ativo = true;
    void p.carregar(p.filtro).then((itens) => { if (ativo) setConversas(itens); });
    return () => { ativo = false; };
  }, [p.carregar, p.filtro]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    if (!termo) return conversas;
    return conversas.filter((c) => `${nomeExibido(c)} ${c.lastMessageBody} ${c.phoneNumber}`.toLocaleLowerCase('pt-BR').includes(termo));
  }, [busca, conversas]);
  const naoLidas = conversas.reduce((s, c) => s + c.unreadCount, 0);

  return (
    <div className="cadencia-page cadencia-enter mx-auto grid max-w-6xl gap-6">
      <PageHeader titulo="Conversas" subtitulo="Priorize quem precisa de resposta sem perder o contexto clínico." semBreadcrumb />

      <section className="cadencia-panel cadencia-panel-hero p-4 sm:p-5" aria-label="Central de conversas">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <Campo
            prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
            placeholder="Buscar paciente, telefone ou mensagem..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar conversas"
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="cadencia-metric min-w-[126px] p-3"><span className="cadencia-eyebrow">Fila</span><strong className="mt-1 block text-xl tracking-[-.04em] text-text">{conversas.length}</strong><span className="text-[10px] text-text-faint">conversas</span></div>
            <div className="cadencia-metric min-w-[126px] p-3"><span className="cadencia-eyebrow">Atenção</span><strong className="mt-1 block text-xl tracking-[-.04em] text-text">{naoLidas}</strong><span className="text-[10px] text-text-faint">não lidas</span></div>
          </div>
        </div>
        <div role="group" aria-label="Filtros de conversas" className="mt-4 flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button key={f.chave} type="button" aria-pressed={p.filtro === f.chave} onClick={() => p.aoMudarFiltro(f.chave)}
              className={cn('min-h-9 cursor-pointer rounded-[10px] border px-3 py-1.5 text-xs font-semibold transition-all duration-[var(--dur-2)]', p.filtro === f.chave ? 'border-accent/20 bg-accent-soft text-accent shadow-elev-1' : 'border-line/70 bg-surface/75 text-text-muted hover:bg-surface hover:text-text')}
            >{f.rotulo}</button>
          ))}
        </div>
      </section>

      <ul aria-label="Lista de conversas" className="cadencia-data-grid m-0 list-none p-0">
        {filtradas.map((c, index) => {
          const ativa = p.conversaAtivaId === c.conversationId;
          return (
            <motion.li
              key={c.conversationId} data-active={ativa ? 'true' : undefined} onClick={() => p.aoAbrirConversa(c.conversationId)}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .025, .16) }}
              className={cn('group grid cursor-pointer grid-cols-[44px_1fr_auto] items-center gap-3 border-b border-line/65 px-3.5 py-3.5 last:border-0 sm:px-4', 'transition-[background-color,box-shadow,transform] duration-[var(--dur-2)] hover:bg-surface-hover/70 active:scale-[.997]', ativa ? 'bg-accent-soft/70 shadow-[inset_3px_0_0_var(--accent)]' : c.unreadCount > 0 ? 'bg-surface-raised/45' : 'bg-surface/75')}
            >
              <div className="relative shrink-0">
                <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-accent/10 bg-[linear-gradient(145deg,var(--accent-soft),var(--surface))] text-[12px] font-bold text-accent shadow-elev-1">{c.patientName !== null ? iniciais(c.patientName) : '#'}</span>
                {c.online === true && <span data-testid="online-indicator" role="status" aria-label="Online" className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-[2.5px] border-surface bg-ok shadow-[0_0_0_2px_color-mix(in_oklab,var(--ok)_12%,transparent)]" />}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2"><span className={cn('truncate text-sm text-text', c.unreadCount > 0 ? 'font-bold' : 'font-semibold')}>{nomeExibido(c)}</span>{c.channel === 'whatsapp' && <WhatsappLogo size={13} weight="fill" className="shrink-0 text-ok" aria-hidden />}</div>
                <span className={cn('mt-0.5 block truncate text-[12px]', c.unreadCount > 0 ? 'font-medium text-text-muted' : 'text-text-faint')}>{c.lastMessageBody}</span>
              </div>
              <div className="grid justify-items-end gap-1 self-start pt-0.5"><span className="num text-[10px] font-medium text-text-faint">{horaOuData(c.lastMessageAt)}</span>{c.unreadCount > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-on shadow-[0_3px_10px_color-mix(in_oklab,var(--accent)_22%,transparent)]">{c.unreadCount}</span> : <EnvelopeSimpleOpen size={14} className="text-text-faint" aria-hidden />}</div>
            </motion.li>
          );
        })}
        {filtradas.length === 0 && (
          <li className="flex min-h-56 flex-col items-center justify-center px-6 text-center"><span className="cadencia-icon-orb mb-3 h-12 w-12"><ChatCircleDots size={22} weight="duotone" /></span><strong className="text-sm text-text">Nenhuma conversa encontrada</strong><span className="mt-1 text-xs text-text-muted">Tente outro termo ou filtro.</span></li>
        )}
      </ul>
    </div>
  );
}
