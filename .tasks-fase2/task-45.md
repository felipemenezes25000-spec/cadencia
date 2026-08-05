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