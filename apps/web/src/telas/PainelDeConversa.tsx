// apps/web/src/telas/PainelDeConversa.tsx
'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  ArrowLeft,
  CalendarBlank,
  CaretRight,
  UserCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Icone } from '../ui/Icone';

export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Mensagem {
  readonly messageId: string;
  readonly direction: 'inbound' | 'outbound';
  readonly body: string;
  readonly sentAt: string;
  readonly deliveryStatus: DeliveryStatus;
}

export interface AgendamentoContexto {
  readonly dia: string;
  readonly hora: string;
  readonly procedimento: string;
}

export interface HistoricoAgendamento {
  readonly dia: string;
  readonly procedimento: string;
  readonly status: string;
}

export interface ContextoConversa {
  readonly proximoAgendamento: AgendamentoContexto | null;
  readonly pendencias: readonly string[];
  readonly historicoAgendamentos: readonly HistoricoAgendamento[];
}

const STATUS_GLIFO: Record<DeliveryStatus, { glifo: string; titulo: string }> = {
  queued: { glifo: '○', titulo: 'Na fila' },
  sent: { glifo: '✓', titulo: 'Enviado' },
  delivered: { glifo: '✓✓', titulo: 'Entregue' },
  read: { glifo: '✓✓', titulo: 'Lido' },
  failed: { glifo: '✕', titulo: 'Falhou' },
};

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(iso));
}

function chaveDia(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dataParaSeparador(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(iso));
}

interface GrupoDeMensagens {
  readonly data: string;
  readonly chave: string;
  readonly mensagens: Mensagem[];
}

function agruparPorData(mensagens: Mensagem[]): GrupoDeMensagens[] {
  const grupos: GrupoDeMensagens[] = [];
  let grupoAtual: GrupoDeMensagens | null = null;
  for (const msg of mensagens) {
    const chave = chaveDia(msg.sentAt);
    const data = dataParaSeparador(msg.sentAt);
    if (grupoAtual === null || grupoAtual.chave !== chave) {
      grupoAtual = { data, chave, mensagens: [] };
      grupos.push(grupoAtual);
    }
    grupoAtual.mensagens.push(msg);
  }
  return grupos;
}

function BolhaDeMensagem({ mensagem }: { mensagem: Mensagem }) {
  const outbound = mensagem.direction === 'outbound';
  const st = STATUS_GLIFO[mensagem.deliveryStatus];
  return (
    <div data-testid={`msg-${mensagem.messageId}`} data-direction={mensagem.direction} className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[min(78%,620px)] rounded-2xl border px-3.5 py-2.5 shadow-elev-1',
        outbound
          ? 'rounded-br-md border-accent bg-accent text-white'
          : 'rounded-bl-md border-line bg-surface text-text',
      )}>
        <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{mensagem.body}</p>
        <span className={cn('mt-1.5 flex items-center justify-end gap-1 text-[10px] font-medium', outbound ? 'text-white/65' : 'text-text-faint')}>
          <span className="num">{hora(mensagem.sentAt)}</span>
          <span title={st.titulo} className={mensagem.deliveryStatus === 'failed' ? 'text-danger' : undefined}>{st.glifo}</span>
        </span>
      </div>
    </div>
  );
}

export interface PainelDeConversaProps {
  readonly conversationId: string;
  readonly nomeExibido: string;
  readonly phoneNumber: string;
  readonly patientId: string | null;
  readonly carregarMensagens: (conversationId: string) => Promise<Mensagem[]>;
  readonly carregarContexto: (conversationId: string) => Promise<ContextoConversa>;
  readonly aoEnviar: (body: string) => Promise<{ messageId: string }>;
  readonly aoVincularPaciente: () => void;
  readonly aoSelecionarTemplate: () => void;
  readonly aoVoltar?: () => void;
}

export function PainelDeConversa(p: PainelDeConversaProps) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [contexto, setContexto] = useState<ContextoConversa | null>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ativo = true;
    setMensagens([]);
    setContexto(null);
    void p.carregarMensagens(p.conversationId).then((m) => { if (ativo) setMensagens(m); });
    void p.carregarContexto(p.conversationId).then((c) => { if (ativo) setContexto(c); });
    return () => { ativo = false; };
  }, [p.conversationId, p.carregarMensagens, p.carregarContexto]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [mensagens]);

  const grupos = useMemo(() => agruparPorData(mensagens), [mensagens]);

  async function enviar(): Promise<void> {
    const corpo = texto.trim();
    if (corpo === '' || enviando) return;
    setEnviando(true);
    setTexto('');
    try {
      const { messageId } = await p.aoEnviar(corpo);
      setMensagens((prev) => [...prev, {
        messageId,
        direction: 'outbound',
        body: corpo,
        sentAt: new Date().toISOString(),
        deliveryStatus: 'queued',
      }]);
    } catch {
      setTexto(corpo);
    } finally {
      setEnviando(false);
    }
  }

  function aoTeclarInput(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  }

  return (
    <div className="grid h-full grid-cols-1 grid-rows-[auto_1fr_auto] overflow-hidden md:grid-cols-[minmax(0,1fr)_320px]">
      <header className="col-span-full flex min-h-[72px] items-center gap-3 border-b border-line bg-surface px-4 py-3">
        {p.aoVoltar != null ? (
          <button type="button" onClick={p.aoVoltar} className="grid size-9 place-items-center rounded-lg text-text-muted hover:bg-surface-subtle md:hidden" aria-label="Voltar">
            <Icone icon={ArrowLeft} size="md" />
          </button>
        ) : null}

        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-sm font-bold text-accent">
          {p.nomeExibido.trim().charAt(0).toLocaleUpperCase('pt-BR') || '#'}
        </span>
        <div className="min-w-0">
          <h2 title={p.nomeExibido} className="m-0 truncate text-[15px] font-bold tracking-[-0.02em] text-text">{p.nomeExibido}</h2>
          <p className="mt-0.5 truncate text-xs text-text-faint">{p.phoneNumber} · conversa ativa</p>
        </div>

        {p.patientId === null ? (
          <button type="button" onClick={p.aoVincularPaciente} className="ml-auto rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-accent shadow-elev-1 hover:border-line-strong hover:bg-surface-subtle">
            Vincular paciente
          </button>
        ) : (
          <button type="button" className="ml-auto grid size-9 place-items-center rounded-lg border border-line bg-surface text-text-muted shadow-elev-1 hover:text-accent" aria-label="Abrir ficha">
            <Icone icon={UserCircle} size="md" />
          </button>
        )}
      </header>

      <div role="log" aria-label="Mensagens" className="col-start-1 overflow-y-auto bg-surface-sunken/40 px-4 py-5 scrollbar-thin sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {grupos.map((grupo) => (
            <div key={grupo.chave}>
              <div data-testid="date-separator" className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] font-semibold text-text-faint shadow-elev-1">{grupo.data}</span>
                <div className="h-px flex-1 bg-line" />
              </div>
              <div className="flex flex-col gap-2.5">
                {grupo.mensagens.map((msg) => <BolhaDeMensagem key={msg.messageId} mensagem={msg} />)}
              </div>
            </div>
          ))}
          {mensagens.length === 0 ? <p className="py-12 text-center text-sm text-text-faint">Carregando histórico da conversa…</p> : null}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <aside aria-label="Contexto do paciente" className="hidden overflow-y-auto border-l border-line bg-surface p-4 md:col-start-2 md:row-[2/4] md:block scrollbar-thin">
        <div className="mb-4">
          <p className="cadencia-eyebrow">Contexto do paciente</p>
          <p className="mt-1 text-xs leading-relaxed text-text-faint">O essencial para responder sem sair da conversa.</p>
        </div>

        {contexto !== null ? (
          <div className="grid gap-3">
            <section className="rounded-xl border border-line bg-surface-subtle p-3.5">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-text"><CalendarBlank size={15} className="text-accent" aria-hidden />Próximo atendimento</h3>
              {contexto.proximoAgendamento !== null ? (
                <>
                  <p className="m-0 text-sm font-semibold text-text">{contexto.proximoAgendamento.dia} · {contexto.proximoAgendamento.hora}</p>
                  <p className="mt-1 text-xs text-text-muted">{contexto.proximoAgendamento.procedimento}</p>
                </>
              ) : <p className="m-0 text-xs text-text-faint">Nenhum agendamento futuro.</p>}
            </section>

            <section className="rounded-xl border border-line bg-surface p-3.5">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-text"><WarningCircle size={15} className={contexto.pendencias.length > 0 ? 'text-warn' : 'text-ok'} aria-hidden />Pendências</h3>
              {contexto.pendencias.length > 0 ? (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {contexto.pendencias.map((pend) => <li key={pend} className="rounded-lg bg-warn-soft px-2.5 py-2 text-xs font-medium text-warn">{pend}</li>)}
                </ul>
              ) : <p className="m-0 text-xs text-text-faint">Nada pendente neste contexto.</p>}
            </section>

            <section className="rounded-xl border border-line bg-surface p-3.5">
              <h3 className="mb-2 text-xs font-bold text-text">Histórico recente</h3>
              {contexto.historicoAgendamentos.length > 0 ? (
                <ul className="m-0 grid list-none gap-0 p-0">
                  {contexto.historicoAgendamentos.slice(0, 5).map((h) => (
                    <li key={`${h.dia}-${h.procedimento}`} className="flex items-start justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
                      <span className="min-w-0"><span className="block truncate text-xs font-semibold text-text">{h.procedimento}</span><span className="block text-[11px] text-text-faint">{h.status}</span></span>
                      <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{h.dia}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="m-0 text-xs text-text-faint">Sem histórico disponível.</p>}
            </section>
          </div>
        ) : <p className="text-xs text-text-faint">Carregando contexto…</p>}
      </aside>

      <div className="col-start-1 border-t border-line bg-surface p-3 sm:p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <button type="button" aria-label="Template" onClick={p.aoSelecionarTemplate} className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-line bg-surface text-xs font-bold text-text-muted shadow-elev-1 hover:bg-surface-subtle hover:text-accent">
            T
          </button>
          <textarea
            aria-label="Mensagem"
            role="textbox"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={aoTeclarInput}
            rows={1}
            placeholder="Escreva uma mensagem…"
            className="min-h-10 max-h-[132px] flex-1 resize-none rounded-[12px] border border-line bg-surface px-3.5 py-2.5 font-sans text-sm text-text shadow-elev-1 outline-none transition-colors-fast placeholder:text-text-faint focus:border-accent focus:ring-2 focus:ring-accent/10"
          />
          <button type="button" aria-label="Enviar" disabled={enviando || texto.trim() === ''} onClick={() => enviar()} className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-accent bg-accent text-white shadow-elev-1 transition-colors-fast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45">
            <CaretRight size={18} weight="bold" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
