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
    await waitFor(() => expect(screen.getAllByText('Lembrete D-1')[0]).toBeVisible());
    await userEvent.click(screen.getAllByText('Lembrete D-1')[0]!);
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
