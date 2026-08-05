### Task 44: Painel de conversa — thread de mensagens com bolhas e input

**Arquivos**

- Criar `apps/web/src/telas/PainelDeConversa.tsx`
- Criar `apps/web/src/telas/PainelDeConversa.test.tsx`

**Passos**

- [ ] Criar o teste `PainelDeConversa.test.tsx`:

```tsx
// apps/web/src/telas/PainelDeConversa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelDeConversa, type Mensagem, type ContextoConversa } from './PainelDeConversa';

const MENSAGENS: Mensagem[] = [
  {
    messageId: 'm1', direction: 'inbound',
    body: 'Bom dia, confirmo a consulta de amanha',
    sentAt: '2026-08-03T14:30:00.000Z', deliveryStatus: 'delivered',
  },
  {
    messageId: 'm2', direction: 'outbound',
    body: 'Perfeito, Maria! Confirmado para amanha as 14h.',
    sentAt: '2026-08-03T14:31:00.000Z', deliveryStatus: 'read',
  },
  {
    messageId: 'm3', direction: 'outbound',
    body: 'Lembramos de trazer os exames.',
    sentAt: '2026-08-03T14:32:00.000Z', deliveryStatus: 'sent',
  },
];

const CONTEXTO: ContextoConversa = {
  proximoAgendamento: { dia: '2026-08-04', hora: '14:00', procedimento: 'Consulta' },
  pendencias: ['CPF', 'Endereco'],
  historicoAgendamentos: [
    { dia: '2026-07-01', procedimento: 'Retorno', status: 'atendido' },
  ],
};

function montar(over: Partial<Parameters<typeof PainelDeConversa>[0]> = {}) {
  const props = {
    conversationId: 'c1',
    nomeExibido: 'Maria Souza Lima',
    phoneNumber: '+5511999990001',
    patientId: 'p1' as string | null,
    carregarMensagens: vi.fn(async () => MENSAGENS),
    carregarContexto: vi.fn(async () => CONTEXTO),
    aoEnviar: vi.fn(async () => ({ messageId: 'm4' })),
    aoVincularPaciente: vi.fn(),
    aoSelecionarTemplate: vi.fn(),
    ...over,
  };
  render(<PainelDeConversa {...props} />);
  return props;
}

describe('painel de conversa', () => {
  it('mostra o nome do contato no cabecalho', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 2, name: /Maria Souza Lima/ })).toBeVisible());
  });

  it('mensagens inbound ficam a esquerda e outbound a direita', async () => {
    montar();
    const msgs = await screen.findAllByTestId(/^msg-/);
    expect(msgs[0]).toHaveAttribute('data-direction', 'inbound');
    expect(msgs[1]).toHaveAttribute('data-direction', 'outbound');
  });

  it('mostra status de entrega com icones discretos nas mensagens outbound', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByTitle('Entregue')).toBeVisible();
      expect(screen.getByTitle('Lido')).toBeVisible();
      expect(screen.getByTitle('Enviado')).toBeVisible();
    });
  });

  it('Enter envia a mensagem, Shift+Enter quebra linha', async () => {
    const { aoEnviar } = montar();
    await screen.findAllByTestId(/^msg-/);
    const input = screen.getByRole('textbox', { name: /Mensagem/ });
    await userEvent.type(input, 'Ola!');
    await userEvent.keyboard('{Enter}');
    expect(aoEnviar).toHaveBeenCalledWith('Ola!');
  });

  it('Shift+Enter nao envia, insere quebra de linha', async () => {
    const { aoEnviar } = montar();
    await screen.findAllByTestId(/^msg-/);
    const input = screen.getByRole('textbox', { name: /Mensagem/ });
    await userEvent.type(input, 'Linha 1');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it('painel de contexto mostra proximo agendamento e pendencias, NUNCA conteudo clinico', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Consulta')).toBeVisible();
      expect(screen.getByText(/CPF/)).toBeVisible();
      expect(screen.getByText(/Endereco/)).toBeVisible();
    });
    expect(screen.queryByText(/prontuario/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/diagnostico/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/prescricao/i)).not.toBeInTheDocument();
  });

  it('conversa com numero desconhecido mostra opcao de vincular a paciente', async () => {
    montar({ patientId: null, nomeExibido: '+5511888880002' });
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Vincular a paciente/ })).toBeVisible());
  });

  it('botao de template abre seletor', async () => {
    const { aoSelecionarTemplate } = montar();
    await screen.findAllByTestId(/^msg-/);
    await userEvent.click(screen.getByRole('button', { name: /Template/ }));
    expect(aoSelecionarTemplate).toHaveBeenCalled();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <PainelDeConversa conversationId="c1" nomeExibido="Maria Souza Lima"
        phoneNumber="+5511999990001" patientId="p1"
        carregarMensagens={async () => MENSAGENS} carregarContexto={async () => CONTEXTO}
        aoEnviar={async () => ({ messageId: 'm4' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId(/^msg-/).length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd apps/web && npx vitest run src/telas/PainelDeConversa.test.tsx
# Esperado: FAIL — Cannot find module './PainelDeConversa'
```

- [ ] Criar o componente `PainelDeConversa.tsx`:

```tsx
// apps/web/src/telas/PainelDeConversa.tsx
'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

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
  queued:    { glifo: '○', titulo: 'Na fila' },
  sent:      { glifo: '✓', titulo: 'Enviado' },
  delivered: { glifo: '✓✓', titulo: 'Entregue' },
  read:      { glifo: '✓✓', titulo: 'Lido' },
  failed:    { glifo: '✗', titulo: 'Falhou' },
};

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR',
    { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
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
}

export function PainelDeConversa(p: PainelDeConversaProps) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [contexto, setContexto] = useState<ContextoConversa | null>(null);
  const [texto, setTexto] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void p.carregarMensagens(p.conversationId).then(setMensagens);
    void p.carregarContexto(p.conversationId).then(setContexto);
  }, [p, p.conversationId]);

  useEffect(() => {
    if (threadRef.current !== null) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [mensagens]);

  async function enviar(): Promise<void> {
    const corpo = texto.trim();
    if (corpo === '') return;
    setTexto('');
    const { messageId } = await p.aoEnviar(corpo);
    setMensagens((prev) => [...prev, {
      messageId, direction: 'outbound', body: corpo,
      sentAt: new Date().toISOString(), deliveryStatus: 'queued',
    }]);
  }

  function aoTeclarInput(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 320px',
      gridTemplateRows: 'auto 1fr auto',
      height: '100%', overflow: 'hidden',
    }}>
      {/* Cabecalho */}
      <header style={{
        gridColumn: '1 / -1', display: 'flex', alignItems: 'center',
        gap: 'var(--s-4)', padding: `var(--s-4) var(--s-5)`,
        borderBottom: 'var(--border)', background: 'var(--surface)',
      }}>
        <h2 style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          {p.nomeExibido}
        </h2>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
          {p.phoneNumber}
        </span>
        {p.patientId === null ? (
          <button type="button" onClick={p.aoVincularPaciente}
            style={{
              marginInlineStart: 'auto', border: 'var(--border)',
              borderRadius: 'var(--r-md)', background: 'var(--surface)',
              padding: 'var(--s-2) var(--s-4)', fontSize: 'var(--fs-13)',
              cursor: 'pointer', color: 'var(--accent)',
            }}>
            Vincular a paciente
          </button>
        ) : null}
      </header>

      {/* Thread de mensagens */}
      <div ref={threadRef} aria-label="Mensagens"
        style={{
          gridColumn: 1, overflowY: 'auto',
          padding: 'var(--s-5)', display: 'flex',
          flexDirection: 'column', gap: 'var(--s-3)',
        }}>
        {mensagens.map((m) => {
          const outbound = m.direction === 'outbound';
          const st = STATUS_GLIFO[m.deliveryStatus];
          return (
            <div
              key={m.messageId}
              data-testid={`msg-${m.messageId}`}
              data-direction={m.direction}
              style={{
                alignSelf: outbound ? 'flex-end' : 'flex-start',
                maxWidth: '75%', padding: `var(--s-3) var(--s-4)`,
                borderRadius: 'var(--r-md)',
                background: outbound ? 'var(--accent-soft)' : 'var(--surface-sunken)',
              }}>
              <p style={{ margin: 0, fontSize: 'var(--fs-14)', lineHeight: 'var(--lh-read)',
                          whiteSpace: 'pre-wrap' }}>
                {m.body}
              </p>
              <span style={{
                display: 'flex', justifyContent: 'flex-end',
                gap: 'var(--s-2)', marginTop: 'var(--s-1)',
                fontSize: 'var(--fs-11)', color: 'var(--text-muted)',
              }}>
                <span className="num">{hora(m.sentAt)}</span>
                {outbound ? (
                  <span title={st.titulo} style={{
                    color: m.deliveryStatus === 'read' ? 'var(--accent)' : 'var(--text-muted)',
                  }}>
                    {st.glifo}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      {/* Painel de contexto */}
      <aside aria-label="Contexto do paciente"
        style={{
          gridColumn: 2, gridRow: '2 / 4', borderInlineStart: 'var(--border)',
          padding: 'var(--s-5)', overflowY: 'auto', background: 'var(--surface)',
          fontSize: 'var(--fs-13)',
        }}>
        {contexto !== null ? (
          <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
            {contexto.proximoAgendamento !== null ? (
              <div>
                <h3 style={{ fontSize: 'var(--fs-12)', textTransform: 'uppercase',
                             letterSpacing: '.04em', color: 'var(--text-muted)',
                             fontWeight: 'var(--fw-medium)', margin: `0 0 var(--s-3)` }}>
                  Proximo agendamento
                </h3>
                <p style={{ margin: 0 }}>
                  {`${contexto.proximoAgendamento.dia} as ${contexto.proximoAgendamento.hora}`}
                </p>
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                  {contexto.proximoAgendamento.procedimento}
                </p>
              </div>
            ) : null}

            {contexto.pendencias.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 'var(--fs-12)', textTransform: 'uppercase',
                             letterSpacing: '.04em', color: 'var(--text-muted)',
                             fontWeight: 'var(--fw-medium)', margin: `0 0 var(--s-3)` }}>
                  Pendencias
                </h3>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none',
                             display: 'grid', gap: 'var(--s-2)' }}>
                  {contexto.pendencias.map((pend) => (
                    <li key={pend} style={{ color: 'var(--warn)' }}>{pend}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {contexto.historicoAgendamentos.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 'var(--fs-12)', textTransform: 'uppercase',
                             letterSpacing: '.04em', color: 'var(--text-muted)',
                             fontWeight: 'var(--fw-medium)', margin: `0 0 var(--s-3)` }}>
                  Historico
                </h3>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none',
                             display: 'grid', gap: 'var(--s-2)' }}>
                  {contexto.historicoAgendamentos.map((h) => (
                    <li key={`${h.dia}-${h.procedimento}`}
                      style={{ display: 'flex', gap: 'var(--s-3)' }}>
                      <span className="num" style={{ color: 'var(--text-muted)' }}>{h.dia}</span>
                      <span>{h.procedimento}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>

      {/* Input de mensagem */}
      <div style={{
        gridColumn: 1, display: 'flex', gap: 'var(--s-3)',
        padding: 'var(--s-4)', borderTop: 'var(--border)',
        background: 'var(--surface)', alignItems: 'flex-end',
      }}>
        <button type="button" aria-label="Template" onClick={p.aoSelecionarTemplate}
          style={{
            border: 'var(--border)', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', width: 36, height: 36,
            cursor: 'pointer', color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--fs-15)',
          }}>
          T
        </button>
        <textarea
          aria-label="Mensagem"
          role="textbox"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={aoTeclarInput}
          rows={1}
          style={{
            flex: 1, resize: 'none', border: 'var(--border)',
            borderRadius: 'var(--r-md)', padding: 'var(--s-3) var(--s-4)',
            background: 'var(--surface)', color: 'var(--text)',
            fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
            minHeight: 36, maxHeight: 120,
          }}
        />
        <button type="button" aria-label="Enviar" onClick={() => { void enviar(); }}
          style={{
            border: 'none', borderRadius: 'var(--r-md)',
            background: 'var(--accent)', color: 'var(--accent-on)',
            width: 36, height: 36, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--fs-15)',
          }}>
          &gt;
        </button>
      </div>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/PainelDeConversa.test.tsx
# Esperado: PASS — 8 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/PainelDeConversa.tsx apps/web/src/telas/PainelDeConversa.test.tsx
git commit -m "feat(web): conversation panel with message thread, delivery status and context"
```

---