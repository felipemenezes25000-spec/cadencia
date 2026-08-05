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