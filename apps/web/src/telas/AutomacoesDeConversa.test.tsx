import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { AutomacoesDeConversa, type Automacao } from './AutomacoesDeConversa';

const AUTOMACOES: Automacao[] = [
  {
    automationId: 'a1',
    nome: 'Confirmacao D-2',
    descricao: 'Envia confirmacao 2 dias antes da consulta',
    templateNome: 'Confirmacao de consulta',
    canal: 'whatsapp',
    timing: '2 dias antes',
    ativa: true,
  },
  {
    automationId: 'a2',
    nome: 'Lembrete D-1',
    descricao: 'Envia lembrete 1 dia antes da consulta',
    templateNome: 'Lembrete D-1',
    canal: 'whatsapp',
    timing: '1 dia antes',
    ativa: false,
  },
  {
    automationId: 'a3',
    nome: 'Pos-consulta',
    descricao: 'Envia mensagem de agradecimento apos consulta',
    templateNome: 'Pos-consulta',
    canal: 'whatsapp',
    timing: '2 horas apos',
    ativa: true,
  },
];

function montar(over: Partial<Parameters<typeof AutomacoesDeConversa>[0]> = {}) {
  const props = {
    carregar: vi.fn(async () => AUTOMACOES),
    aoAlternarAtiva: vi.fn(async () => {}),
    aoEditar: vi.fn(),
    aoExcluir: vi.fn(),
    aoSalvar: vi.fn(),
    ...over,
  };
  render(<AutomacoesDeConversa {...props} />);
  return props;
}

describe('tela Automacoes de Conversa', () => {
  it('renderiza lista de automacoes', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByRole('list', { name: /lista de automacoes/i })).toBeVisible();
      expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });
  });

  it('mostra nome e descricao de cada automacao', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Confirmacao D-2')).toBeVisible();
      expect(screen.getByText('Envia confirmacao 2 dias antes da consulta')).toBeVisible();
      expect(screen.getByText('Lembrete D-1')).toBeVisible();
      expect(screen.getByText('Pos-consulta')).toBeVisible();
    });
  });

  it('toggle switch ativa/desativa automacao', async () => {
    const { aoAlternarAtiva } = montar();
    await waitFor(() => expect(screen.getByText('Confirmacao D-2')).toBeVisible());

    const toggles = screen.getAllByRole('switch');
    expect(toggles[0]).toHaveAttribute('aria-checked', 'true');
    expect(toggles[1]).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(toggles[1]!);
    expect(aoAlternarAtiva).toHaveBeenCalledWith('a2', true);
  });

  it('mostra menu com Editar e Excluir', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Confirmacao D-2')).toBeVisible());

    // Abrir menu de acoes do primeiro card
    const menuTriggers = screen.getAllByRole('button', { name: /acoes de/i });
    await userEvent.click(menuTriggers[0]!);

    await waitFor(() => {
      expect(screen.getByText('Editar')).toBeVisible();
      expect(screen.getByText('Excluir')).toBeVisible();
    });
  });

  it('abre formulario ao clicar Nova automacao', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Confirmacao D-2')).toBeVisible());

    // Usar getAllByRole pois pode haver botao no header e no estado vazio
    const botoesNova = screen.getAllByRole('button', { name: /nova automacao/i });
    await userEvent.click(botoesNova[0]!);

    // O PainelLateral deve abrir com titulo "Nova automacao"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /salvar/i })).toBeVisible();
    });
  });

  it('abre formulario preenchido ao clicar Editar', async () => {
    const { aoEditar } = montar();
    await waitFor(() => expect(screen.getByText('Confirmacao D-2')).toBeVisible());

    // Abrir menu do primeiro card
    const menuTriggers = screen.getAllByRole('button', { name: /acoes de/i });
    await userEvent.click(menuTriggers[0]!);

    await waitFor(() => expect(screen.getByText('Editar')).toBeVisible());
    await userEvent.click(screen.getByText('Editar'));

    // O formulario deve abrir com titulo "Editar automacao"
    await waitFor(() => {
      expect(screen.getByText('Editar automacao')).toBeVisible();
    });

    expect(aoEditar).toHaveBeenCalledWith('a1');
  });

  it('mostra estado vazio quando sem automacoes', async () => {
    montar({ carregar: vi.fn(async () => []) });
    await waitFor(() => {
      expect(screen.getByText('Nenhuma automacao configurada')).toBeVisible();
      expect(
        screen.getByText('Crie automacoes para agilizar o atendimento por mensagens'),
      ).toBeVisible();
    });
  });

  it('valida nome obrigatorio no formulario', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Confirmacao D-2')).toBeVisible());

    // Abrir formulario vazio
    await userEvent.click(screen.getByRole('button', { name: /nova automacao/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /salvar/i })).toBeVisible();
    });

    // Submeter sem preencher nome
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(screen.getByText('Nome obrigatorio')).toBeVisible();
    });
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <AutomacoesDeConversa
        carregar={async () => AUTOMACOES}
        aoAlternarAtiva={async () => {}}
        aoEditar={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBe(3));
    expect(await axe(container)).toHaveNoViolations();
  });
});
