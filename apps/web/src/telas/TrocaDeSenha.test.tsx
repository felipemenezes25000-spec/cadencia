import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { TrocaDeSenha } from './TrocaDeSenha';

function montar(over: Partial<Parameters<typeof TrocaDeSenha>[0]> = {}) {
  const props = {
    aoTrocar: vi.fn(async () => {}),
    ...over,
  };
  render(<TrocaDeSenha {...props} />);
  return props;
}

describe('TrocaDeSenha', () => {
  it('renderiza os três campos e o botão desabilitado', () => {
    montar();
    expect(screen.getByLabelText(/senha atual/i)).toBeDefined();
    expect(screen.getByLabelText(/nova senha/i)).toBeDefined();
    expect(screen.getByLabelText(/confirmar/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /trocar senha/i })).toBeDisabled();
  });

  it('habilita o botão quando os campos são preenchidos corretamente', async () => {
    montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/senha atual/i), 'MinhaAtual@1');
    await user.type(screen.getByLabelText(/nova senha/i), 'NovaSenha@2026');
    await user.type(screen.getByLabelText(/confirmar/i), 'NovaSenha@2026');
    expect(screen.getByRole('button', { name: /trocar senha/i })).toBeEnabled();
  });

  it('mantém desabilitado se nova senha < 8 caracteres', async () => {
    montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/senha atual/i), 'Atual@123');
    await user.type(screen.getByLabelText(/nova senha/i), 'curta');
    await user.type(screen.getByLabelText(/confirmar/i), 'curta');
    expect(screen.getByRole('button', { name: /trocar senha/i })).toBeDisabled();
  });

  it('mantém desabilitado se confirmação não bate', async () => {
    montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/senha atual/i), 'Atual@123');
    await user.type(screen.getByLabelText(/nova senha/i), 'NovaSenha@2026');
    await user.type(screen.getByLabelText(/confirmar/i), 'Diferente@2026');
    expect(screen.getByRole('button', { name: /trocar senha/i })).toBeDisabled();
  });

  it('chama aoTrocar e exibe mensagem de sucesso', async () => {
    const props = montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/senha atual/i), 'Atual@123');
    await user.type(screen.getByLabelText(/nova senha/i), 'NovaSenha@2026');
    await user.type(screen.getByLabelText(/confirmar/i), 'NovaSenha@2026');
    await user.click(screen.getByRole('button', { name: /trocar senha/i }));

    expect(props.aoTrocar).toHaveBeenCalledWith('Atual@123', 'NovaSenha@2026');
    await waitFor(() => {
      expect(screen.getByText(/senha alterada/i)).toBeDefined();
    });
  });

  it('exibe erro retornado pelo callback', async () => {
    montar({ aoTrocar: vi.fn(async () => { throw new Error('senha_incorreta'); }) });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/senha atual/i), 'Errada@123');
    await user.type(screen.getByLabelText(/nova senha/i), 'NovaSenha@2026');
    await user.type(screen.getByLabelText(/confirmar/i), 'NovaSenha@2026');
    await user.click(screen.getByRole('button', { name: /trocar senha/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });

  it('passa a11y', async () => {
    const { container } = render(<TrocaDeSenha aoTrocar={vi.fn(async () => {})} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
