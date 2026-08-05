<!-- RECONCILIACAO (00-CONTRATOS) ──────────────────────────────────────
  Correcoes aplicadas pela reconciliacao dos 10 blocos:
  1. Alteracao de FASE_ATUAL e nav.ts REMOVIDA deste bloco — o Bloco 10
     (Task 55) e o responsavel por habilitar Conversas+Financeiro no nav
     e trocar FASE_ATUAL para 2.
  2. As telas de conversas PERMANECEM neste bloco.
─────────────────────────────────────────────────────────────────── -->

### Task 43: Caixa de entrada de conversas — lista com filtros na query string

**Arquivos**

- Criar `apps/web/src/telas/CaixaDeConversas.tsx`
- Criar `apps/web/src/telas/CaixaDeConversas.test.tsx`

> **REMOVIDO**: a alteracao de `nav.ts` (FASE_ATUAL e disponivelNaFase) foi
> movida para o Bloco 10, Task 55, que e o integration gate.

**Passos**

- [ ] Criar o teste `CaixaDeConversas.test.tsx`:

```tsx
// apps/web/src/telas/CaixaDeConversas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { CaixaDeConversas, type ConversaResumo } from './CaixaDeConversas';

const CONVERSAS: ConversaResumo[] = [
  {
    conversationId: 'c1', patientId: 'p1', patientName: 'Maria Souza Lima',
    phoneNumber: '+5511999990001', lastMessageBody: 'Bom dia, confirmo a consulta',
    lastMessageAt: '2026-08-03T14:30:00.000Z', unreadCount: 2,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
  {
    conversationId: 'c2', patientId: null, patientName: null,
    phoneNumber: '+5511888880002', lastMessageBody: 'Gostaria de agendar',
    lastMessageAt: '2026-08-03T13:00:00.000Z', unreadCount: 0,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
  {
    conversationId: 'c3', patientId: 'p3', patientName: 'Joana Prado',
    phoneNumber: '+5511777770003', lastMessageBody: 'Obrigada!',
    lastMessageAt: '2026-08-03T10:00:00.000Z', unreadCount: 0,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'outbound',
  },
];

function montar(over: Partial<Parameters<typeof CaixaDeConversas>[0]> = {}) {
  const props = {
    filtro: 'todas' as const,
    carregar: vi.fn(async () => CONVERSAS),
    aoMudarFiltro: vi.fn(),
    aoAbrirConversa: vi.fn(),
    ...over,
  };
  render(<CaixaDeConversas {...props} />);
  return props;
}

describe('tela Caixa de Conversas', () => {
  it('o titulo diz Conversas', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Conversas/i })).toBeVisible());
  });

  it('lista as conversas em ordem de lastMessageAt DESC', async () => {
    montar();
    const itens = await screen.findAllByRole('listitem');
    expect(itens[0]).toHaveTextContent('Maria Souza Lima');
    expect(itens[1]).toHaveTextContent('+5511888880002');
    expect(itens[2]).toHaveTextContent('Joana Prado');
  });

  it('conversa com numero desconhecido mostra "Numero desconhecido" e opcao de vincular a paciente', async () => {
    montar();
    const itens = await screen.findAllByRole('listitem');
    expect(itens[1]).toHaveTextContent('+5511888880002');
    expect(itens[1]).not.toHaveTextContent('null');
  });

  it('mostra badge de nao-lidas quando unreadCount > 0', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('2')).toBeVisible());
  });

  it('mostra preview da ultima mensagem em cada linha', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByText('Bom dia, confirmo a consulta')).toBeVisible());
  });

  it('filtros sao botoes com aria-pressed e vao para query string', async () => {
    const { aoMudarFiltro } = montar();
    await waitFor(() => expect(screen.getByRole('button', { name: /Todas/ })).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Nao lidas/ }));
    expect(aoMudarFiltro).toHaveBeenCalledWith('nao_lidas');
  });

  it('clicar na conversa chama aoAbrirConversa com o conversationId', async () => {
    const { aoAbrirConversa } = montar();
    const itens = await screen.findAllByRole('listitem');
    await userEvent.click(itens[0]!);
    expect(aoAbrirConversa).toHaveBeenCalledWith('c1');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <CaixaDeConversas filtro="todas" carregar={async () => CONVERSAS}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha (componente nao existe):

```bash
cd apps/web && npx vitest run src/telas/CaixaDeConversas.test.tsx
# Esperado: FAIL — Cannot find module './CaixaDeConversas'
```

- [ ] Criar o componente `CaixaDeConversas.tsx`:

```tsx
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
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/CaixaDeConversas.test.tsx
# Esperado: PASS — 7 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/CaixaDeConversas.tsx apps/web/src/telas/CaixaDeConversas.test.tsx apps/web/src/ui/nav.ts
git commit -m "feat(web): inbox screen for conversations with filters in query string"
```

---

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

### Task 45: Split view — caixa de entrada + painel de conversa lado a lado

**Arquivos**

- Criar `apps/web/src/telas/Conversas.tsx`
- Criar `apps/web/src/telas/Conversas.test.tsx`

**Passos**

- [ ] Criar o teste `Conversas.test.tsx`:

```tsx
// apps/web/src/telas/Conversas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Conversas } from './Conversas';
import type { ConversaResumo } from './CaixaDeConversas';
import type { Mensagem, ContextoConversa } from './PainelDeConversa';

const CONVERSAS: ConversaResumo[] = [
  {
    conversationId: 'c1', patientId: 'p1', patientName: 'Maria Souza Lima',
    phoneNumber: '+5511999990001', lastMessageBody: 'Confirmo',
    lastMessageAt: '2026-08-03T14:30:00.000Z', unreadCount: 1,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
  {
    conversationId: 'c2', patientId: null, patientName: null,
    phoneNumber: '+5511888880002', lastMessageBody: 'Oi',
    lastMessageAt: '2026-08-03T13:00:00.000Z', unreadCount: 0,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
];

const MENSAGENS: Mensagem[] = [
  { messageId: 'm1', direction: 'inbound', body: 'Confirmo',
    sentAt: '2026-08-03T14:30:00.000Z', deliveryStatus: 'delivered' },
];

const CONTEXTO: ContextoConversa = {
  proximoAgendamento: null, pendencias: [], historicoAgendamentos: [],
};

function montar(over: Partial<Parameters<typeof Conversas>[0]> = {}) {
  const props = {
    filtro: 'todas' as const,
    conversaAbertaId: null as string | null,
    carregarConversas: vi.fn(async () => CONVERSAS),
    carregarMensagens: vi.fn(async () => MENSAGENS),
    carregarContexto: vi.fn(async () => CONTEXTO),
    aoMudarFiltro: vi.fn(),
    aoAbrirConversa: vi.fn(),
    aoEnviar: vi.fn(async () => ({ messageId: 'm9' })),
    aoVincularPaciente: vi.fn(),
    aoSelecionarTemplate: vi.fn(),
    ...over,
  };
  render(<Conversas {...props} />);
  return props;
}

describe('tela Conversas (split view)', () => {
  it('sem conversa selecionada, mostra so a lista', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza Lima')).toBeVisible());
    expect(screen.queryByRole('textbox', { name: /Mensagem/ })).not.toBeInTheDocument();
  });

  it('layout e split 40/60 quando uma conversa esta aberta', async () => {
    montar({ conversaAbertaId: 'c1' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Mensagem/ })).toBeVisible());
    const container = screen.getByTestId('split-view');
    expect(container).toHaveStyle({ gridTemplateColumns: '40% 60%' });
  });

  it('clicar na conversa chama aoAbrirConversa', async () => {
    const { aoAbrirConversa } = montar();
    const itens = await screen.findAllByRole('listitem');
    await userEvent.click(itens[0]!);
    expect(aoAbrirConversa).toHaveBeenCalledWith('c1');
  });

  it('conversa com numero desconhecido mostra o numero e botao de vincular no painel', async () => {
    montar({ conversaAbertaId: 'c2' });
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Vincular a paciente/ })).toBeVisible());
    expect(screen.getByText('+5511888880002')).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Conversas filtro="todas" conversaAbertaId="c1"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd apps/web && npx vitest run src/telas/Conversas.test.tsx
# Esperado: FAIL — Cannot find module './Conversas'
```

- [ ] Criar o componente `Conversas.tsx`:

```tsx
// apps/web/src/telas/Conversas.tsx
'use client';

import {
  CaixaDeConversas,
  type ConversaResumo,
  type FiltroConversas,
} from './CaixaDeConversas';
import {
  PainelDeConversa,
  type ContextoConversa,
  type Mensagem,
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
  readonly aoVincularPaciente: () => void;
  readonly aoSelecionarTemplate: () => void;
}

export function Conversas(p: ConversasProps) {
  const conversa = p.conversaAbertaId;

  if (conversa === null) {
    return (
      <div data-testid="split-view" style={{ gridTemplateColumns: '1fr' }}>
        <CaixaDeConversas
          filtro={p.filtro}
          carregar={p.carregarConversas}
          aoMudarFiltro={p.aoMudarFiltro}
          aoAbrirConversa={p.aoAbrirConversa}
        />
      </div>
    );
  }

  return (
    <div data-testid="split-view"
      style={{
        display: 'grid', gridTemplateColumns: '40% 60%',
        height: '100vh', overflow: 'hidden',
      }}>
      <div style={{ borderInlineEnd: 'var(--border)', overflowY: 'auto' }}>
        <CaixaDeConversas
          filtro={p.filtro}
          carregar={p.carregarConversas}
          aoMudarFiltro={p.aoMudarFiltro}
          aoAbrirConversa={p.aoAbrirConversa}
        />
      </div>
      <ConversaAbertaWrapper
        conversationId={conversa}
        carregarConversas={p.carregarConversas}
        filtro={p.filtro}
        carregarMensagens={p.carregarMensagens}
        carregarContexto={p.carregarContexto}
        aoEnviar={p.aoEnviar}
        aoVincularPaciente={p.aoVincularPaciente}
        aoSelecionarTemplate={p.aoSelecionarTemplate}
      />
    </div>
  );
}

interface WrapperProps {
  readonly conversationId: string;
  readonly filtro: FiltroConversas;
  readonly carregarConversas: (filtro: FiltroConversas) => Promise<ConversaResumo[]>;
  readonly carregarMensagens: (conversationId: string) => Promise<Mensagem[]>;
  readonly carregarContexto: (conversationId: string) => Promise<ContextoConversa>;
  readonly aoEnviar: (body: string) => Promise<{ messageId: string }>;
  readonly aoVincularPaciente: () => void;
  readonly aoSelecionarTemplate: () => void;
}

import { useEffect, useState } from 'react';

function ConversaAbertaWrapper(p: WrapperProps) {
  const [dados, setDados] = useState<ConversaResumo | null>(null);

  useEffect(() => {
    void p.carregarConversas(p.filtro).then((lista) => {
      const encontrada = lista.find((c) => c.conversationId === p.conversationId);
      setDados(encontrada ?? null);
    });
  }, [p, p.conversationId, p.filtro]);

  if (dados === null) return null;

  return (
    <PainelDeConversa
      conversationId={dados.conversationId}
      nomeExibido={dados.patientName ?? dados.phoneNumber}
      phoneNumber={dados.phoneNumber}
      patientId={dados.patientId}
      carregarMensagens={p.carregarMensagens}
      carregarContexto={p.carregarContexto}
      aoEnviar={p.aoEnviar}
      aoVincularPaciente={p.aoVincularPaciente}
      aoSelecionarTemplate={p.aoSelecionarTemplate}
    />
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/Conversas.test.tsx
# Esperado: PASS — 5 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/Conversas.tsx apps/web/src/telas/Conversas.test.tsx
git commit -m "feat(web): split-view conversations screen with 40/60 layout"
```

---

### Task 46: Acao rapida "Mensagem" na fila do dia e na agenda

**Arquivos**

- Criar `apps/web/src/telas/CompositorDeMensagem.tsx`
- Criar `apps/web/src/telas/CompositorDeMensagem.test.tsx`

**Passos**

- [ ] Criar o teste `CompositorDeMensagem.test.tsx`:

```tsx
// apps/web/src/telas/CompositorDeMensagem.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { CompositorDeMensagem } from './CompositorDeMensagem';

const TEMPLATES = [
  { templateId: 't1', nome: 'Confirmacao de consulta',
    corpo: 'Ola {{nome}}, sua consulta esta confirmada para {{data}} as {{hora}}.' },
  { templateId: 't2', nome: 'Lembrete',
    corpo: 'Ola {{nome}}, lembramos da sua consulta amanha.' },
];

function montar(over: Partial<Parameters<typeof CompositorDeMensagem>[0]> = {}) {
  const props = {
    pacienteNome: 'Maria Souza Lima',
    telefone: '+5511999990001',
    templates: TEMPLATES,
    templateSelecionadoId: 't1',
    aoMudarTemplate: vi.fn(),
    aoEnviar: vi.fn(async () => {}),
    aoFechar: vi.fn(),
    ...over,
  };
  render(<CompositorDeMensagem {...props} />);
  return props;
}

describe('compositor de mensagem (acao rapida)', () => {
  it('abre com template de confirmacao pre-selecionado e telefone pre-preenchido', () => {
    montar();
    expect(screen.getByText('+5511999990001')).toBeVisible();
    expect(screen.getByDisplayValue('Confirmacao de consulta')).toBeVisible();
  });

  it('mostra preview do corpo do template selecionado', () => {
    montar();
    expect(screen.getByText(/sua consulta esta confirmada/)).toBeVisible();
  });

  it('trocar template chama aoMudarTemplate', async () => {
    const { aoMudarTemplate } = montar();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /Template/ }), 't2');
    expect(aoMudarTemplate).toHaveBeenCalledWith('t2');
  });

  it('botao Enviar chama aoEnviar e mostra carregando', async () => {
    const aoEnviar = vi.fn(() => new Promise<void>(() => { /* nunca resolve */ }));
    montar({ aoEnviar });
    await userEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    expect(aoEnviar).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Enviar/ })).toHaveAttribute('aria-busy', 'true');
  });

  it('um clique para enviar — nao pede confirmacao', async () => {
    const aoEnviar = vi.fn(async () => {});
    montar({ aoEnviar });
    await userEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    expect(aoEnviar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <CompositorDeMensagem pacienteNome="Maria" telefone="+5511999990001"
        templates={TEMPLATES} templateSelecionadoId="t1"
        aoMudarTemplate={vi.fn()} aoEnviar={async () => {}} aoFechar={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd apps/web && npx vitest run src/telas/CompositorDeMensagem.test.tsx
# Esperado: FAIL — Cannot find module './CompositorDeMensagem'
```

- [ ] Criar o componente `CompositorDeMensagem.tsx`:

```tsx
// apps/web/src/telas/CompositorDeMensagem.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../ui/Botao';

export interface TemplateMensagem {
  readonly templateId: string;
  readonly nome: string;
  readonly corpo: string;
}

export interface CompositorDeMensagemProps {
  readonly pacienteNome: string;
  readonly telefone: string;
  readonly templates: readonly TemplateMensagem[];
  readonly templateSelecionadoId: string;
  readonly aoMudarTemplate: (templateId: string) => void;
  readonly aoEnviar: () => Promise<void>;
  readonly aoFechar: () => void;
}

export function CompositorDeMensagem(p: CompositorDeMensagemProps) {
  const [enviando, setEnviando] = useState(false);
  const selecionado = p.templates.find((t) => t.templateId === p.templateSelecionadoId);

  async function enviar(): Promise<void> {
    setEnviando(true);
    try {
      await p.aoEnviar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{
      display: 'grid', gap: 'var(--s-4)', padding: 'var(--s-5)',
      border: '1px solid var(--accent)', borderRadius: 'var(--r-md)',
      background: 'var(--surface)', boxShadow: 'var(--elev-1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Enviar mensagem
        </h3>
        <button type="button" aria-label="Fechar compositor" onClick={p.aoFechar}
          style={{ border: 0, background: 'transparent', cursor: 'pointer',
                   color: 'var(--text-muted)', fontSize: 'var(--fs-15)' }}>
          &times;
        </button>
      </div>

      <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <span style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-medium)' }}>
          {p.pacienteNome}
        </span>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
          {p.telefone}
        </span>
      </div>

      <label htmlFor="template-selector" style={{ fontSize: 'var(--fs-12)',
                                                   color: 'var(--text-muted)' }}>
        Template
      </label>
      <select id="template-selector" role="combobox" aria-label="Template"
        value={p.templateSelecionadoId}
        onChange={(e) => p.aoMudarTemplate(e.target.value)}
        style={{ height: 40, border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', color: 'var(--text)' }}>
        {p.templates.map((t) => (
          <option key={t.templateId} value={t.templateId}>{t.nome}</option>
        ))}
      </select>

      {selecionado !== undefined ? (
        <div style={{
          padding: 'var(--s-4)', background: 'var(--surface-sunken)',
          borderRadius: 'var(--r-md)', fontSize: 'var(--fs-13)',
          lineHeight: 'var(--lh-read)', whiteSpace: 'pre-wrap',
        }}>
          {selecionado.corpo}
        </div>
      ) : null}

      <Botao variante="primario" carregando={enviando}
        onClick={() => { void enviar(); }}>
        Enviar
      </Botao>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/CompositorDeMensagem.test.tsx
# Esperado: PASS — 6 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/CompositorDeMensagem.tsx apps/web/src/telas/CompositorDeMensagem.test.tsx
git commit -m "feat(web): quick-action message composer with pre-selected template"
```

---

### Task 47: Templates e automacoes (admin) — /conversas/templates e /conversas/automacoes

**Arquivos**

- Criar `apps/web/src/telas/TemplatesDeMensagem.tsx`
- Criar `apps/web/src/telas/TemplatesDeMensagem.test.tsx`
- Criar `apps/web/src/telas/AutomacoesDeConversa.tsx`
- Criar `apps/web/src/telas/AutomacoesDeConversa.test.tsx`

**Passos**

- [ ] Criar o teste `TemplatesDeMensagem.test.tsx`:

```tsx
// apps/web/src/telas/TemplatesDeMensagem.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { TemplatesDeMensagem, type TemplateAdmin } from './TemplatesDeMensagem';

const TEMPLATES: TemplateAdmin[] = [
  {
    templateId: 't1', nome: 'Confirmacao de consulta',
    corpo: 'Ola {{nome}}, confirme sua consulta em {{data}} as {{hora}}.',
    canal: 'whatsapp', statusAprovacao: 'aprovado',
  },
  {
    templateId: 't2', nome: 'Lembrete D-1',
    corpo: 'Ola {{nome}}, lembramos da consulta amanha as {{hora}}.',
    canal: 'whatsapp', statusAprovacao: 'pendente',
  },
  {
    templateId: 't3', nome: 'Pos-consulta',
    corpo: 'Ola {{nome}}, obrigado pela visita!',
    canal: 'whatsapp', statusAprovacao: 'rejeitado',
  },
];

function montar(over: Partial<Parameters<typeof TemplatesDeMensagem>[0]> = {}) {
  const props = {
    carregar: vi.fn(async () => TEMPLATES),
    aoCriar: vi.fn(),
    aoEditar: vi.fn(),
    ...over,
  };
  render(<TemplatesDeMensagem {...props} />);
  return props;
}

describe('tela Templates de Mensagem', () => {
  it('lista os templates com nome, canal e status de aprovacao', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Confirmacao de consulta')).toBeVisible();
      expect(screen.getByText('aprovado')).toBeVisible();
      expect(screen.getByText('pendente')).toBeVisible();
      expect(screen.getByText('rejeitado')).toBeVisible();
    });
  });

  it('botao Novo template chama aoCriar', async () => {
    const { aoCriar } = montar();
    await waitFor(() => expect(screen.getByText('Confirmacao de consulta')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Novo template/ }));
    expect(aoCriar).toHaveBeenCalled();
  });

  it('clicar no template chama aoEditar com o templateId', async () => {
    const { aoEditar } = montar();
    await waitFor(() => expect(screen.getByText('Lembrete D-1')).toBeVisible());
    await userEvent.click(screen.getByText('Lembrete D-1'));
    expect(aoEditar).toHaveBeenCalledWith('t2');
  });

  it('status de aprovacao tem cores distintas: aprovado, pendente, rejeitado', async () => {
    montar();
    await waitFor(() => {
      const aprovado = screen.getByText('aprovado');
      const rejeitado = screen.getByText('rejeitado');
      expect(aprovado).toHaveStyle({ color: expect.stringContaining('var(') });
      expect(rejeitado).toHaveStyle({ color: expect.stringContaining('var(') });
    });
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <TemplatesDeMensagem carregar={async () => TEMPLATES}
        aoCriar={vi.fn()} aoEditar={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd apps/web && npx vitest run src/telas/TemplatesDeMensagem.test.tsx
# Esperado: FAIL — Cannot find module './TemplatesDeMensagem'
```

- [ ] Criar o componente `TemplatesDeMensagem.tsx`:

```tsx
// apps/web/src/telas/TemplatesDeMensagem.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

export type StatusAprovacao = 'aprovado' | 'pendente' | 'rejeitado';

export interface TemplateAdmin {
  readonly templateId: string;
  readonly nome: string;
  readonly corpo: string;
  readonly canal: 'whatsapp' | 'sms' | 'email';
  readonly statusAprovacao: StatusAprovacao;
}

const COR_STATUS: Record<StatusAprovacao, string> = {
  aprovado:  'var(--success)',
  pendente:  'var(--warn)',
  rejeitado: 'var(--danger)',
};

export interface TemplatesDeMensagemProps {
  readonly carregar: () => Promise<TemplateAdmin[]>;
  readonly aoCriar: () => void;
  readonly aoEditar: (templateId: string) => void;
}

export function TemplatesDeMensagem(p: TemplatesDeMensagemProps) {
  const [templates, setTemplates] = useState<TemplateAdmin[]>([]);

  useEffect(() => {
    void p.carregar().then(setTemplates);
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Templates
        </h1>
        <Botao variante="primario" altura={32} onClick={p.aoCriar}>
          Novo template
        </Botao>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)',
                      border: 'var(--border)', borderRadius: 'var(--r-md)' }}>
        <thead>
          <tr>
            {['Nome', 'Canal', 'Status'].map((h) => (
              <th key={h} scope="col" style={{
                textAlign: 'left', fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                letterSpacing: '.04em', color: 'var(--text-muted)', fontWeight: 500,
                padding: 'var(--s-4)', borderBottom: 'var(--border)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.templateId}
              onClick={() => p.aoEditar(t.templateId)}
              style={{ cursor: 'pointer', borderBottom: 'var(--border)' }}>
              <td style={{ padding: 'var(--s-4)', fontWeight: 'var(--fw-medium)' }}>
                {t.nome}
              </td>
              <td style={{ padding: 'var(--s-4)', fontSize: 'var(--fs-13)',
                           color: 'var(--text-muted)' }}>
                {t.canal}
              </td>
              <td style={{ padding: 'var(--s-4)', fontSize: 'var(--fs-13)',
                           color: COR_STATUS[t.statusAprovacao] }}>
                {t.statusAprovacao}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/TemplatesDeMensagem.test.tsx
# Esperado: PASS — 5 testes
```

- [ ] Criar o teste `AutomacoesDeConversa.test.tsx`:

```tsx
// apps/web/src/telas/AutomacoesDeConversa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { AutomacoesDeConversa, type Automacao } from './AutomacoesDeConversa';

const AUTOMACOES: Automacao[] = [
  {
    automationId: 'a1', nome: 'Confirmacao D-2',
    descricao: 'Envia confirmacao 2 dias antes da consulta',
    templateNome: 'Confirmacao de consulta',
    canal: 'whatsapp', timing: '2 dias antes',
    ativa: true,
  },
  {
    automationId: 'a2', nome: 'Lembrete D-1',
    descricao: 'Envia lembrete 1 dia antes da consulta',
    templateNome: 'Lembrete D-1',
    canal: 'whatsapp', timing: '1 dia antes',
    ativa: false,
  },
  {
    automationId: 'a3', nome: 'Pos-consulta',
    descricao: 'Envia mensagem de agradecimento apos consulta',
    templateNome: 'Pos-consulta',
    canal: 'whatsapp', timing: '2 horas apos',
    ativa: true,
  },
];

function montar(over: Partial<Parameters<typeof AutomacoesDeConversa>[0]> = {}) {
  const props = {
    carregar: vi.fn(async () => AUTOMACOES),
    aoAlternarAtiva: vi.fn(async () => {}),
    aoEditar: vi.fn(),
    ...over,
  };
  render(<AutomacoesDeConversa {...props} />);
  return props;
}

describe('tela Automacoes de Conversa', () => {
  it('lista as automacoes com nome, timing, template e toggle', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Confirmacao D-2')).toBeVisible();
      expect(screen.getByText('2 dias antes')).toBeVisible();
      expect(screen.getByText('Confirmacao de consulta')).toBeVisible();
    });
  });

  it('toggle ativo/inativo chama aoAlternarAtiva', async () => {
    const { aoAlternarAtiva } = montar();
    await waitFor(() => expect(screen.getByText('Confirmacao D-2')).toBeVisible());
    const toggles = screen.getAllByRole('switch');
    expect(toggles[0]).toHaveAttribute('aria-checked', 'true');
    expect(toggles[1]).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggles[1]!);
    expect(aoAlternarAtiva).toHaveBeenCalledWith('a2', true);
  });

  it('clicar na automacao chama aoEditar', async () => {
    const { aoEditar } = montar();
    await waitFor(() => expect(screen.getByText('Lembrete D-1')).toBeVisible());
    await userEvent.click(screen.getByText('Lembrete D-1'));
    expect(aoEditar).toHaveBeenCalledWith('a2');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <AutomacoesDeConversa carregar={async () => AUTOMACOES}
        aoAlternarAtiva={async () => {}} aoEditar={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBe(3));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd apps/web && npx vitest run src/telas/AutomacoesDeConversa.test.tsx
# Esperado: FAIL — Cannot find module './AutomacoesDeConversa'
```

- [ ] Criar o componente `AutomacoesDeConversa.tsx`:

```tsx
// apps/web/src/telas/AutomacoesDeConversa.tsx
'use client';

import { useEffect, useState } from 'react';

export interface Automacao {
  readonly automationId: string;
  readonly nome: string;
  readonly descricao: string;
  readonly templateNome: string;
  readonly canal: 'whatsapp' | 'sms' | 'email';
  readonly timing: string;
  readonly ativa: boolean;
}

export interface AutomacoesDeConversaProps {
  readonly carregar: () => Promise<Automacao[]>;
  readonly aoAlternarAtiva: (automationId: string, novoEstado: boolean) => Promise<void>;
  readonly aoEditar: (automationId: string) => void;
}

export function AutomacoesDeConversa(p: AutomacoesDeConversaProps) {
  const [automacoes, setAutomacoes] = useState<Automacao[]>([]);

  useEffect(() => {
    void p.carregar().then(setAutomacoes);
  }, [p]);

  async function alternar(automationId: string, atual: boolean): Promise<void> {
    const novo = !atual;
    setAutomacoes((prev) => prev.map((a) =>
      a.automationId === automationId ? { ...a, ativa: novo } : a));
    try {
      await p.aoAlternarAtiva(automationId, novo);
    } catch {
      setAutomacoes((prev) => prev.map((a) =>
        a.automationId === automationId ? { ...a, ativa: atual } : a));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Automacoes
      </h1>

      <ul aria-label="Lista de automacoes"
          style={{ listStyle: 'none', margin: 0, padding: 0,
                   border: 'var(--border)', borderRadius: 'var(--r-md)',
                   overflow: 'hidden', background: 'var(--surface)' }}>
        {automacoes.map((a) => (
          <li key={a.automationId}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: `var(--s-5) var(--s-5)`,
              borderBottom: 'var(--border)',
            }}>
            <div onClick={() => p.aoEditar(a.automationId)}
              style={{ cursor: 'pointer', display: 'grid', gap: 'var(--s-1)' }}>
              <span style={{ fontWeight: 'var(--fw-medium)' }}>{a.nome}</span>
              <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)' }}>
                {a.timing}
                {` · ${a.templateNome}`}
                {` · ${a.canal}`}
              </span>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
                {a.descricao}
              </span>
            </div>
            <button type="button" role="switch" aria-checked={a.ativa}
              aria-label={`${a.nome} ${a.ativa ? 'ativa' : 'inativa'}`}
              onClick={() => { void alternar(a.automationId, a.ativa); }}
              style={{
                width: 44, height: 24, borderRadius: 'var(--r-full)',
                border: 'none', cursor: 'pointer', position: 'relative',
                background: a.ativa ? 'var(--accent)' : 'var(--surface-sunken)',
                transition: 'background var(--dur-1)',
              }}>
              <span aria-hidden="true" style={{
                position: 'absolute', top: 2,
                left: a.ativa ? 22 : 2,
                width: 20, height: 20, borderRadius: 'var(--r-full)',
                background: 'white', transition: 'left var(--dur-1)',
                boxShadow: '0 1px 2px oklch(0% 0 0 / .15)',
              }} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] Rodar os testes e confirmar que passam:

```bash
cd apps/web && npx vitest run src/telas/TemplatesDeMensagem.test.tsx src/telas/AutomacoesDeConversa.test.tsx
# Esperado: PASS — 5 + 4 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/TemplatesDeMensagem.tsx apps/web/src/telas/TemplatesDeMensagem.test.tsx \
        apps/web/src/telas/AutomacoesDeConversa.tsx apps/web/src/telas/AutomacoesDeConversa.test.tsx
git commit -m "feat(web): templates and automations admin screens for messaging"
```

---

### Task 48: Teste obrigatorio — conversa com numero desconhecido e vinculacao

**Arquivos**

- Criar `apps/web/src/telas/fluxo-conversas.test.tsx`

**Passos**

- [ ] Criar o teste de fluxo `fluxo-conversas.test.tsx`:

```tsx
// apps/web/src/telas/fluxo-conversas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Conversas } from './Conversas';
import type { ConversaResumo } from './CaixaDeConversas';
import type { Mensagem, ContextoConversa } from './PainelDeConversa';

const CONVERSAS: ConversaResumo[] = [
  {
    conversationId: 'c-desconhecido', patientId: null, patientName: null,
    phoneNumber: '+5521900001111', lastMessageBody: 'Gostaria de agendar uma consulta',
    lastMessageAt: '2026-08-03T15:00:00.000Z', unreadCount: 1,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
];

const MENSAGENS: Mensagem[] = [
  { messageId: 'm1', direction: 'inbound', body: 'Gostaria de agendar uma consulta',
    sentAt: '2026-08-03T15:00:00.000Z', deliveryStatus: 'delivered' },
];

const CONTEXTO: ContextoConversa = {
  proximoAgendamento: null, pendencias: [], historicoAgendamentos: [],
};

describe('fluxo: conversa com numero desconhecido', () => {
  it('na lista, numero desconhecido exibe o telefone em vez de nome', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId={null}
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('+5521900001111')).toBeVisible();
    });
    expect(screen.queryByText('null')).not.toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('ao abrir a conversa, mostra botao "Vincular a paciente"', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId="c-desconhecido"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Vincular a paciente/ })).toBeVisible());
  });

  it('clicar em "Vincular a paciente" chama o callback', async () => {
    const aoVincularPaciente = vi.fn();
    render(
      <Conversas filtro="todas" conversaAbertaId="c-desconhecido"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={aoVincularPaciente} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Vincular a paciente/ })).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Vincular a paciente/ }));
    expect(aoVincularPaciente).toHaveBeenCalled();
  });

  it('avatar do numero desconhecido mostra "#" em vez de iniciais', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId={null}
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('#')).toBeVisible());
  });

  it('thread de mensagens funciona normalmente mesmo sem paciente vinculado', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId="c-desconhecido"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('Gostaria de agendar uma consulta')).toBeVisible());
    const input = screen.getByRole('textbox', { name: /Mensagem/ });
    expect(input).toBeVisible();
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/fluxo-conversas.test.tsx
# Esperado: PASS — 5 testes
```

- [ ] Rodar todos os testes do bloco de conversas juntos:

```bash
cd apps/web && npx vitest run src/telas/CaixaDeConversas.test.tsx src/telas/PainelDeConversa.test.tsx src/telas/Conversas.test.tsx src/telas/CompositorDeMensagem.test.tsx src/telas/TemplatesDeMensagem.test.tsx src/telas/AutomacoesDeConversa.test.tsx src/telas/fluxo-conversas.test.tsx
# Esperado: PASS — 7 + 8 + 5 + 6 + 5 + 4 + 5 = 40 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/fluxo-conversas.test.tsx
git commit -m "test(web): mandatory flow test for unknown-number conversation with patient linking"
```
