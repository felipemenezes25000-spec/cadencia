import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { TabelaEquipe, type MembroEquipe } from './TabelaEquipe';

const BASE_ITENS: MembroEquipe[] = [
  {
    userId: 'u1', nome: 'Admin Silva', email: 'admin@test.local',
    role: 'admin_clinico', ehProfissional: false, conselho: null,
    desde: '2026-01-15T10:00:00.000Z', temTotp: true,
  },
  {
    userId: 'u2', nome: 'Dr Pereira', email: 'dr@test.local',
    role: 'profissional', ehProfissional: true, conselho: '06 12345/SP',
    desde: '2026-03-20T08:00:00.000Z', temTotp: false,
  },
  {
    userId: 'u3', nome: 'Recepcao Ana', email: 'ana@test.local',
    role: 'recepcao', ehProfissional: false, conselho: null,
    desde: '2026-06-01T09:00:00.000Z', temTotp: true,
  },
];

function montar(over: Partial<Parameters<typeof TabelaEquipe>[0]> = {}) {
  const props = {
    itens: BASE_ITENS,
    meuUserId: 'u1',
    ehAdmin: true,
    aoRevogar: vi.fn(async () => {}),
    aoDesativarMfa: vi.fn(async () => {}),
    ...over,
  };
  render(<TabelaEquipe {...props} />);
  return props;
}

describe('TabelaEquipe', () => {
  it('renderiza todas as colunas incluindo acoes para admin', () => {
    montar();
    expect(screen.getByText('Pessoa')).toBeDefined();
    expect(screen.getByText('Papel')).toBeDefined();
    expect(screen.getByText('Registro')).toBeDefined();
    expect(screen.getByText('Desde')).toBeDefined();
    expect(screen.getByText('Acoes')).toBeDefined();
    expect(screen.getByText('Admin Silva')).toBeDefined();
    expect(screen.getByText('Dr Pereira')).toBeDefined();
    expect(screen.getByText('Recepcao Ana')).toBeDefined();
  });

  it('esconde coluna acoes para nao-admin', () => {
    montar({ ehAdmin: false });
    expect(screen.queryByText('Acoes')).toBeNull();
    expect(screen.queryByRole('button', { name: /revogar/i })).toBeNull();
  });

  it('botao revogar oculto para a propria linha do admin', () => {
    montar();
    const rows = screen.getAllByRole('row');
    const adminRow = rows[1]!;
    expect(within(adminRow).queryByRole('button', { name: /revogar/i })).toBeNull();
    const drRow = rows[2]!;
    expect(within(drRow).getByRole('button', { name: /revogar/i })).toBeDefined();
  });

  it('botao desativar MFA visivel apenas se temTotp', () => {
    montar();
    const rows = screen.getAllByRole('row');
    const drRow = rows[2]!;
    expect(within(drRow).queryByRole('button', { name: /desativar mfa/i })).toBeNull();
    const anaRow = rows[3]!;
    expect(within(anaRow).getByRole('button', { name: /desativar mfa/i })).toBeDefined();
  });

  it('chama aoRevogar com confirmacao', async () => {
    const props = montar();
    const user = userEvent.setup();
    const rows = screen.getAllByRole('row');
    const drRow = rows[2]!;

    await user.click(within(drRow).getByRole('button', { name: /revogar/i }));
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDefined();

    const motivoInput = screen.getByLabelText(/motivo/i);
    await user.type(motivoInput, 'Saiu da clinica');

    await user.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(props.aoRevogar).toHaveBeenCalledWith('u2', 'profissional', 'Saiu da clinica');
  });

  it('chama aoDesativarMfa com confirmacao', async () => {
    const props = montar();
    const user = userEvent.setup();
    const rows = screen.getAllByRole('row');
    const anaRow = rows[3]!;

    await user.click(within(anaRow).getByRole('button', { name: /desativar mfa/i }));
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDefined();

    await user.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(props.aoDesativarMfa).toHaveBeenCalledWith('u3');
  });

  it('cancelar fecha a confirmacao', async () => {
    montar();
    const user = userEvent.setup();
    const rows = screen.getAllByRole('row');
    const drRow = rows[2]!;

    await user.click(within(drRow).getByRole('button', { name: /revogar/i }));
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDefined();

    await user.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('button', { name: /confirmar/i })).toBeNull();
  });

  it('mostra botao alterar papel para admin com callback', () => {
    montar({ aoAlterarPapel: vi.fn(async () => {}) });
    const rows = screen.getAllByRole('row');
    const drRow = rows[2]!;
    expect(within(drRow).getByRole('button', { name: /alterar papel/i })).toBeDefined();
  });

  it('oculta botao alterar papel para si mesmo', () => {
    montar({ aoAlterarPapel: vi.fn(async () => {}) });
    const rows = screen.getAllByRole('row');
    const adminRow = rows[1]!;
    expect(within(adminRow).queryByRole('button', { name: /alterar papel/i })).toBeNull();
  });

  it('nao mostra botao alterar papel sem callback', () => {
    montar();
    expect(screen.queryByRole('button', { name: /alterar papel/i })).toBeNull();
  });

  it('mostra select ao clicar em alterar papel', async () => {
    montar({ aoAlterarPapel: vi.fn(async () => {}) });
    const user = userEvent.setup();
    const rows = screen.getAllByRole('row');
    const drRow = rows[2]!;
    await user.click(within(drRow).getByRole('button', { name: /alterar papel/i }));
    expect(screen.getByRole('combobox', { name: /novo papel/i })).toBeDefined();
  });

  it('chama aoAlterarPapel com userId e novo papel', async () => {
    const aoAlterarPapel = vi.fn(async () => {});
    montar({ aoAlterarPapel });
    const user = userEvent.setup();
    const rows = screen.getAllByRole('row');
    const anaRow = rows[3]!;
    await user.click(within(anaRow).getByRole('button', { name: /alterar papel/i }));
    const select = screen.getByRole('combobox', { name: /novo papel/i });
    await user.selectOptions(select, 'financeiro');
    await user.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(aoAlterarPapel).toHaveBeenCalledWith('u3', 'financeiro');
  });

  it('passa a11y', async () => {
    const { container } = render(
      <TabelaEquipe
        itens={BASE_ITENS}
        meuUserId="u1"
        ehAdmin={true}
        aoRevogar={vi.fn(async () => {})}
        aoDesativarMfa={vi.fn(async () => {})}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
