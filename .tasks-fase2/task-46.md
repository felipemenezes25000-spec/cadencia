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