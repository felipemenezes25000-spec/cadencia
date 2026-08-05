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
