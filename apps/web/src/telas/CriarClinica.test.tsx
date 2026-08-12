import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { CriarClinica } from './CriarClinica';

function montar(over: Partial<Parameters<typeof CriarClinica>[0]> = {}) {
  const props = {
    aberto: true,
    aoFechar: vi.fn(),
    aoCriar: vi.fn(async () => {}),
    ...over,
  };
  render(<CriarClinica {...props} />);
  return props;
}

describe('CriarClinica', () => {
  it('renderiza campos quando aberto=true', () => {
    montar();
    expect(screen.getByLabelText(/nome da unidade/i)).toBeDefined();
    expect(screen.getByLabelText(/fuso horário/i)).toBeDefined();
    expect(screen.getByLabelText(/cnpj/i)).toBeDefined();
    expect(screen.getByLabelText(/cnes/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /criar$/i })).toBeDefined();
  });

  it('não renderiza nada quando aberto=false', () => {
    montar({ aberto: false });
    expect(screen.queryByLabelText(/nome da unidade/i)).toBeNull();
  });

  it('botão desabilitado com nome vazio', () => {
    montar();
    const btn = screen.getByRole('button', { name: /criar$/i });
    expect(btn.getAttribute('disabled')).not.toBeNull();
  });

  it('chama aoCriar com dados mínimos (nome + timezone)', async () => {
    const props = montar();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/nome da unidade/i), 'Filial Sul');
    await user.click(screen.getByRole('button', { name: /criar$/i }));

    await waitFor(() => {
      expect(props.aoCriar).toHaveBeenCalledWith({
        nome: 'Filial Sul',
        timezone: 'America/Sao_Paulo',
      });
    });
  });

  it('chama aoCriar com todos os campos preenchidos', async () => {
    const props = montar();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/nome da unidade/i), 'Filial Norte');
    await user.selectOptions(screen.getByLabelText(/fuso horário/i), 'America/Manaus');
    await user.type(screen.getByLabelText(/cnpj/i), '12345678000190');
    await user.type(screen.getByLabelText(/cnes/i), '1234567');
    await user.click(screen.getByRole('button', { name: /criar$/i }));

    await waitFor(() => {
      expect(props.aoCriar).toHaveBeenCalledWith({
        nome: 'Filial Norte',
        timezone: 'America/Manaus',
        cnpj: '12345678000190',
        cnes: '1234567',
      });
    });
  });

  it('exibe erro quando aoCriar rejeita', async () => {
    montar({
      aoCriar: vi.fn(async () => { throw new Error('fuso_invalido'); }),
    });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/nome da unidade/i), 'Filial Oeste');
    await user.click(screen.getByRole('button', { name: /criar$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Fuso horário inválido');
    });
  });

  it('cancelar fecha e reseta', async () => {
    const props = montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/nome da unidade/i), 'Teste');
    await user.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(props.aoFechar).toHaveBeenCalledOnce();
  });

  it('passa a11y', async () => {
    const { container } = render(
      <CriarClinica aberto={true} aoFechar={vi.fn()} aoCriar={vi.fn(async () => {})} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
