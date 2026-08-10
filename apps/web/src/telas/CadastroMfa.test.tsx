import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { CadastroMfa } from './CadastroMfa';

const RESULTADO = { qrcodeUri: 'otpauth://totp/Cadencia:user@test?secret=JBSWY3DPEHPK3PXP&issuer=Cadencia', segredo: 'JBSWY3DPEHPK3PXP' };

function montar(over: Partial<Parameters<typeof CadastroMfa>[0]> = {}) {
  const props = {
    mfaCadastrado: false,
    aoIniciar: vi.fn(async () => RESULTADO),
    aoConfirmar: vi.fn(async () => {}),
    ...over,
  };
  render(<CadastroMfa {...props} />);
  return props;
}

describe('CadastroMfa', () => {
  it('exibe botao "Configurar MFA" quando nao cadastrado', () => {
    montar({ mfaCadastrado: false });
    expect(screen.getByRole('button', { name: /configurar mfa/i })).toBeDefined();
  });

  it('exibe botao "Reconfigurar" quando ja cadastrado', () => {
    montar({ mfaCadastrado: true });
    expect(screen.getByRole('button', { name: /reconfigurar/i })).toBeDefined();
  });

  it('ao clicar em configurar, exibe segredo e campo de codigo', async () => {
    montar();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /configurar mfa/i }));

    await waitFor(() => {
      expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeDefined();
    });
    expect(screen.getByLabelText(/codigo de 6 digitos/i)).toBeDefined();
  });

  it('confirma com codigo e exibe badge de sucesso', async () => {
    const props = montar();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /configurar mfa/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/codigo de 6 digitos/i)).toBeDefined();
    });

    await user.type(screen.getByLabelText(/codigo de 6 digitos/i), '123456');
    await user.click(screen.getByRole('button', { name: /confirmar/i }));

    expect(props.aoConfirmar).toHaveBeenCalledWith('123456');
    await waitFor(() => {
      expect(screen.getByText(/mfa ativo/i)).toBeDefined();
    });
  });

  it('exibe erro quando confirmacao falha', async () => {
    montar({ aoConfirmar: vi.fn(async () => { throw new Error('codigo_invalido'); }) });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /configurar mfa/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/codigo de 6 digitos/i)).toBeDefined();
    });

    await user.type(screen.getByLabelText(/codigo de 6 digitos/i), '000000');
    await user.click(screen.getByRole('button', { name: /confirmar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });

  it('passa a11y (estado inicial)', async () => {
    const { container } = render(
      <CadastroMfa mfaCadastrado={false}
        aoIniciar={vi.fn(async () => RESULTADO)}
        aoConfirmar={vi.fn(async () => {})} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
