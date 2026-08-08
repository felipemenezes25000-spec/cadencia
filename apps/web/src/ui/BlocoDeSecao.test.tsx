// apps/web/src/ui/BlocoDeSecao.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { BlocoDeSecao } from './BlocoDeSecao';

describe('BlocoDeSecao', () => {
  it('renderiza titulo', () => {
    render(<BlocoDeSecao titulo="Queixa"><p>cefaleia</p></BlocoDeSecao>);
    expect(screen.getByRole('heading', { name: 'Queixa' })).toBeVisible();
  });

  it('mostra conteudo quando aberto (padrao)', () => {
    render(<BlocoDeSecao titulo="Queixa"><p>cefaleia</p></BlocoDeSecao>);
    expect(screen.getByText('cefaleia')).toBeVisible();
  });

  it('esconde conteudo quando vazia', () => {
    render(<BlocoDeSecao titulo="Odontograma" vazia><p>dados</p></BlocoDeSecao>);
    expect(screen.queryByText('dados')).not.toBeInTheDocument();
  });

  it('esconde conteudo quando aberto=false', () => {
    render(<BlocoDeSecao titulo="Historico" aberto={false}><p>dados</p></BlocoDeSecao>);
    expect(screen.queryByText('dados')).not.toBeInTheDocument();
  });

  it('toggle ao clicar', async () => {
    render(<BlocoDeSecao titulo="Odontograma" vazia><p>dados</p></BlocoDeSecao>);
    const botao = screen.getByRole('button', { name: /Odontograma/ });
    expect(screen.queryByText('dados')).not.toBeInTheDocument();
    await userEvent.click(botao);
    expect(screen.getByRole('region', { name: 'Odontograma' })).toBeVisible();
    expect(screen.getByText('dados')).toBeVisible();
  });

  it('mostra badge quando fornecido', () => {
    render(<BlocoDeSecao titulo="Exames" badge={3}><p>lista</p></BlocoDeSecao>);
    expect(screen.getByText('3')).toBeVisible();
  });

  it('nao mostra badge quando zero', () => {
    render(<BlocoDeSecao titulo="Exames" badge={0}><p>lista</p></BlocoDeSecao>);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('tem aria-expanded correto', async () => {
    render(<BlocoDeSecao titulo="Secao" vazia><p>conteudo</p></BlocoDeSecao>);
    const botao = screen.getByRole('button', { name: /Secao/ });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(botao);
    expect(botao).toHaveAttribute('aria-expanded', 'true');
  });

  it('botao de secao colapsada tem minHeight 24px', () => {
    render(<BlocoDeSecao titulo="Odontograma" vazia />);
    const botao = screen.getByRole('button', { name: /Odontograma/ });
    expect(botao).toHaveStyle({ minHeight: '24px' });
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <BlocoDeSecao titulo="Queixa"><p>cefaleia</p></BlocoDeSecao>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
