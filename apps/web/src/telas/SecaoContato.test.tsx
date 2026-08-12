import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { SecaoContato, type SecaoContatoProps } from './SecaoContato';

const base: SecaoContatoProps = {
  phonePrimary: '11987654321',
  phoneSecondary: null,
  email: 'paciente@teste.com',
  emergencyContactName: null,
  emergencyContactPhone: null,
  aoSalvar: vi.fn(async () => {}),
  editavel: true,
};

describe('SecaoContato', () => {
  it('exibe telefone e email no modo leitura', () => {
    render(<SecaoContato {...base} />);
    expect(screen.getByText('(11) 98765-4321')).toBeTruthy();
    expect(screen.getByText('paciente@teste.com')).toBeTruthy();
  });

  it('mostra botão Editar quando editavel=true', () => {
    render(<SecaoContato {...base} />);
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
  });

  it('não mostra botão Editar quando editavel=false', () => {
    render(<SecaoContato {...base} editavel={false} />);
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });

  it('alterna para modo edição ao clicar Editar', async () => {
    const user = userEvent.setup();
    render(<SecaoContato {...base} />);
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByLabelText('Telefone principal')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('chama aoSalvar com valores atualizados', async () => {
    const aoSalvar = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<SecaoContato {...base} aoSalvar={aoSalvar} />);
    await user.click(screen.getByRole('button', { name: 'Editar' }));

    const emailInput = screen.getByLabelText('Email');
    await user.clear(emailInput);
    await user.type(emailInput, 'novo@email.com');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(aoSalvar).toHaveBeenCalledWith({
      phonePrimary: '11987654321',
      phoneSecondary: null,
      email: 'novo@email.com',
      emergencyContactName: null,
      emergencyContactPhone: null,
    });
  });

  it('mostra alerta canal_obrigatorio se telefone e email vazios', async () => {
    const user = userEvent.setup();
    render(<SecaoContato {...base} />);
    await user.click(screen.getByRole('button', { name: 'Editar' }));

    const foneInput = screen.getByLabelText('Telefone principal');
    const emailInput = screen.getByLabelText('Email');
    await user.clear(foneInput);
    await user.clear(emailInput);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('exibe contato de emergência quando preenchido', () => {
    render(<SecaoContato {...base}
      emergencyContactName="Maria da Silva"
      emergencyContactPhone="11912345678" />);
    expect(screen.getByText('Contato de emergência')).toBeTruthy();
    expect(screen.getByText('Maria da Silva')).toBeTruthy();
    expect(screen.getByText('(11) 91234-5678')).toBeTruthy();
  });

  it('acessibilidade no modo leitura', async () => {
    const { container } = render(<SecaoContato {...base} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
