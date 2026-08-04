import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Campo } from './Campo';

describe('Campo', () => {
  it('o rotulo esta SEMPRE visivel — placeholder nao e rotulo', () => {
    render(<Campo rotulo="Telefone" placeholder="(11) 90000-0000" />);
    expect(screen.getByText('Telefone')).toBeVisible();
    expect(screen.getByLabelText('Telefone')).toHaveAttribute('placeholder', '(11) 90000-0000');
  });

  it('erro NUNCA e so cor: tem texto, aria-describedby e aria-invalid', () => {
    render(<Campo rotulo="CPF" erro="CPF inválido" />);
    const input = screen.getByLabelText('CPF');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('CPF inválido')).toBeVisible();
    expect(input.getAttribute('aria-describedby'))
      .toBe(screen.getByText('CPF inválido').id);
  });

  it('a dica tambem entra em aria-describedby, junto com o erro', () => {
    render(<Campo rotulo="CNS" dica="15 dígitos" erro="CNS inválido" />);
    const descrito = screen.getByLabelText('CNS').getAttribute('aria-describedby') ?? '';
    expect(descrito.split(' ')).toHaveLength(2);
  });

  it('sem erro, nao anuncia invalido', () => {
    render(<Campo rotulo="Nome" />);
    expect(screen.getByLabelText('Nome')).toHaveAttribute('aria-invalid', 'false');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<Campo rotulo="Nome" dica="como no documento" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
