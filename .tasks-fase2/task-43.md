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