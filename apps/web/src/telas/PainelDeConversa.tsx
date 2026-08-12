// apps/web/src/telas/PainelDeConversa.tsx
'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { ArrowLeft, UserCircle } from '@phosphor-icons/react';
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
  failed: { glifo: '✗', titulo: 'Falhou' },
};

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

function chaveDia(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dataParaSeparador(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/* ── Agrupamento de mensagens por data ────────────────────────── */

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

/* ── Sub-componente: bolha de mensagem ────────────────────────── */

function BolhaDeMensagem({ mensagem }: { mensagem: Mensagem }) {
  const outbound = mensagem.direction === 'outbound';
  const st = STATUS_GLIFO[mensagem.deliveryStatus];

  return (
    <div
      data-testid={`msg-${mensagem.messageId}`}
      data-direction={mensagem.direction}
      className={cn('flex', outbound ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[70%] rounded-2xl px-4 py-2',
          outbound
            ? 'rounded-br-md bg-accent text-accent-on'
            : 'rounded-bl-md bg-surface-raised text-text',
        )}
      >
        <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
          {mensagem.body}
        </p>
        <span
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-[11px]',
            outbound ? 'opacity-60' : 'text-text-muted',
          )}
        >
          <span className="num">{hora(mensagem.sentAt)}</span>
          <span
            title={st.titulo}
            className={cn(
              mensagem.deliveryStatus === 'read' && !outbound && 'text-accent',
            )}
          >
            {st.glifo}
          </span>
        </span>
      </div>
    </div>
  );
}

/* ── Componente principal ─────────────────────────────────────── */

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
  /** Callback para voltar à lista no mobile */
  readonly aoVoltar?: () => void;
}

export function PainelDeConversa(p: PainelDeConversaProps) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [contexto, setContexto] = useState<ContextoConversa | null>(null);
  const [texto, setTexto] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /**
   * Troca de conversa LIMPA a anterior e descarta resposta atrasada.
   *
   * Sem isto duas coisas davam errado, e as duas mostram mensagem de um
   * paciente sob o nome de outro:
   *
   * 1. O estado não era zerado, então a thread da conversa anterior continuava
   *    na tela enquanto a nova carregava — já com o cabeçalho do novo contato.
   * 2. As duas buscas correm soltas. Clicar em A e logo em B, com A mais lento,
   *    fazia a resposta de A chegar DEPOIS e sobrescrever a de B.
   *
   * `ativo` é fechado sobre esta execução do efeito: quando o cleanup roda, a
   * resposta em voo deixa de poder escrever no estado.
   */
  useEffect(() => {
    let ativo = true;
    setMensagens([]);
    setContexto(null);
    void p.carregarMensagens(p.conversationId)
      .then((m) => { if (ativo) setMensagens(m); });
    void p.carregarContexto(p.conversationId)
      .then((c) => { if (ativo) setContexto(c); });
    return () => { ativo = false; };
  }, [p, p.conversationId]);

  /* Auto-scroll para última mensagem */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [mensagens]);

  const grupos = useMemo(() => agruparPorData(mensagens), [mensagens]);

  async function enviar(): Promise<void> {
    const corpo = texto.trim();
    if (corpo === '') return;
    setTexto('');
    const { messageId } = await p.aoEnviar(corpo);
    setMensagens((prev) => [
      ...prev,
      {
        messageId,
        direction: 'outbound',
        body: corpo,
        sentAt: new Date().toISOString(),
        deliveryStatus: 'queued',
      },
    ]);
  }

  function aoTeclarInput(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  }

  return (
    <div className="grid h-full grid-cols-1 grid-rows-[auto_1fr_auto] overflow-hidden bg-surface md:grid-cols-[1fr_320px]">
      {/* Cabeçalho */}
      <header className="col-span-full flex min-h-[64px] items-center gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
        {/* Botão voltar (mobile) */}
        {p.aoVoltar != null && (
          <button
            type="button"
            onClick={p.aoVoltar}
            className="rounded-md p-1 text-text-muted transition-colors duration-[var(--dur-2)] hover:bg-surface-raised md:hidden"
            aria-label="Voltar"
          >
            <Icone icon={ArrowLeft} size="md" />
          </button>
        )}

        <h2 className="m-0 text-lg font-semibold">{p.nomeExibido}</h2>
        <span className="text-xs text-text-muted">{p.phoneNumber}</span>

        {p.patientId === null ? (
          <button
            type="button"
            onClick={p.aoVincularPaciente}
            className="ml-auto cursor-pointer rounded-lg border border-line bg-surface px-2 py-1 text-[13px] text-accent transition-colors duration-[var(--dur-2)] hover:bg-surface-hover"
          >
            Vincular a paciente
          </button>
        ) : (
          <button
            type="button"
            className="ml-auto rounded-md p-1.5 text-text-muted transition-colors duration-[var(--dur-2)] hover:bg-surface-raised"
            aria-label="Abrir ficha"
          >
            <Icone icon={UserCircle} size="md" />
          </button>
        )}
      </header>

      {/* Thread de mensagens */}
      <div
        role="log"
        aria-label="Mensagens"
        className="col-start-1 flex flex-col gap-3 overflow-y-auto p-4"
      >
        {grupos.map((grupo) => (
          <div key={grupo.chave}>
            {/* Separador de data */}
            <div
              data-testid="date-separator"
              className="my-3 flex items-center gap-3"
            >
              <div className="h-px flex-1 bg-line" />
              <span className="text-[11px] font-medium text-text-muted">
                {grupo.data}
              </span>
              <div className="h-px flex-1 bg-line" />
            </div>

            {/* Mensagens do grupo */}
            <div className="flex flex-col gap-3">
              {grupo.mensagens.map((msg) => (
                <BolhaDeMensagem key={msg.messageId} mensagem={msg} />
              ))}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Painel de contexto */}
      <aside
        aria-label="Contexto do paciente"
        className="overflow-y-auto border-l border-line bg-surface-sunken/55 p-4 text-[13px] md:col-start-2 md:row-[2/4]"
      >
        {contexto !== null && (
          <div className="grid gap-4">
            {contexto.proximoAgendamento !== null && (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                  Próximo agendamento
                </h3>
                <p className="m-0">
                  {`${contexto.proximoAgendamento.dia} às ${contexto.proximoAgendamento.hora}`}
                </p>
                <p className="m-0 text-text-muted">
                  {contexto.proximoAgendamento.procedimento}
                </p>
              </div>
            )}

            {contexto.pendencias.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                  Pendências
                </h3>
                <ul className="m-0 grid list-none gap-1 p-0">
                  {contexto.pendencias.map((pend) => (
                    <li key={pend} className="text-warn">
                      {pend}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {contexto.historicoAgendamentos.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                  Histórico
                </h3>
                <ul className="m-0 grid list-none gap-1 p-0">
                  {contexto.historicoAgendamentos.map((h) => (
                    <li
                      key={`${h.dia}-${h.procedimento}`}
                      className="flex gap-2"
                    >
                      <span className="num text-text-muted">{h.dia}</span>
                      <span>{h.procedimento}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Input de mensagem */}
      <div className="col-start-1 flex items-end gap-2 border-t border-line bg-surface/95 p-3 backdrop-blur">
        <button
          type="button"
          aria-label="Template"
          onClick={p.aoSelecionarTemplate}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-sm text-text-muted transition-colors duration-[var(--dur-2)] hover:bg-surface-hover"
        >
          T
        </button>
        <textarea
          aria-label="Mensagem"
          role="textbox"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={aoTeclarInput}
          rows={1}
          className="min-h-9 max-h-[120px] flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 font-sans text-sm text-text outline-none transition-colors duration-[var(--dur-2)] focus:border-accent"
        />
        <button
          type="button"
          aria-label="Enviar"
          onClick={() => {
            void enviar();
          }}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-accent text-sm text-accent-on transition-colors duration-[var(--dur-2)] hover:bg-accent-hover"
        >
          &gt;
        </button>
      </div>
    </div>
  );
}
