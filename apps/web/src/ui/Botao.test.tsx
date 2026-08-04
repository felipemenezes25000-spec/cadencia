import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Botao } from './Botao';

describe('Botao', () => {
  it('carregando MANTEM o rotulo e adiciona a barra de 2px — trocar o texto faz perder o lugar', () => {
    render(<Botao carregando>Salvar agendamento</Botao>);
    expect(screen.getByRole('button', { name: /Salvar agendamento/ })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Carregando' })).toBeInTheDocument();
    expect(screen.getByTestId('barra-progresso')).toBeInTheDocument();
  });

  it('carregando desabilita e anuncia com aria-busy', () => {
    render(<Botao carregando>Salvar</Botao>);
    const b = screen.getByRole('button');
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });

  it('nao dispara clique enquanto carrega', async () => {
    const aoClicar = vi.fn();
    render(<Botao carregando onClick={aoClicar}>Salvar</Botao>);
    await userEvent.click(screen.getByRole('button'));
    expect(aoClicar).not.toHaveBeenCalled();
  });

  it('as tres variantes existem e nenhuma usa gradiente ou sombra', () => {
    const { container } = render(
      <>
        <Botao variante="primario">A</Botao>
        <Botao variante="secundario">B</Botao>
        <Botao variante="fantasma">C</Botao>
      </>);
    expect(container.innerHTML).not.toMatch(/gradient|box-shadow: 0 \d/);
  });

  it('alvo minimo de 24px e sem violacao de acessibilidade', async () => {
    const { container } = render(<Botao>Ok</Botao>);
    expect(screen.getByRole('button')).toHaveStyle({ minHeight: '32px' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
