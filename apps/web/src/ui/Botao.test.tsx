import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Plus, ArrowRight } from '@phosphor-icons/react';
import { Botao } from './Botao';

describe('Botao', () => {
  it('renderiza com variante primario por padrão', () => {
    render(<Botao>Salvar</Botao>);
    const botao = screen.getByRole('button', { name: 'Salvar' });
    expect(botao).toBeInTheDocument();
    expect(botao.className).toMatch(/bg-accent/);
    expect(botao.className).toMatch(/text-accent-on/);
  });

  it('renderiza variante secundario', () => {
    render(<Botao variante="secundario">Cancelar</Botao>);
    const botao = screen.getByRole('button', { name: 'Cancelar' });
    expect(botao.className).toMatch(/bg-surface/);
    expect(botao.className).toMatch(/border/);
    expect(botao.className).toMatch(/text-text/);
  });

  it('renderiza variante fantasma', () => {
    render(<Botao variante="fantasma">Limpar</Botao>);
    const botao = screen.getByRole('button', { name: 'Limpar' });
    expect(botao.className).toMatch(/bg-transparent/);
    expect(botao.className).toMatch(/text-text/);
  });

  it('renderiza variante perigo', () => {
    render(<Botao variante="perigo">Excluir</Botao>);
    const botao = screen.getByRole('button', { name: 'Excluir' });
    expect(botao.className).toMatch(/bg-danger/);
    expect(botao.className).toMatch(/text-white/);
  });

  it('renderiza nos 3 tamanhos', () => {
    const { rerender } = render(<Botao tamanho="sm">A</Botao>);
    expect(screen.getByRole('button').className).toMatch(/h-\[34px\]/);

    rerender(<Botao tamanho="md">B</Botao>);
    expect(screen.getByRole('button').className).toMatch(/h-\[38px\]/);

    rerender(<Botao tamanho="lg">C</Botao>);
    expect(screen.getByRole('button').className).toMatch(/h-\[42px\]/);
  });

  it('suporta prop altura legada para compatibilidade', () => {
    const { rerender } = render(<Botao altura={28}>A</Botao>);
    expect(screen.getByRole('button').className).toMatch(/h-\[34px\]/);

    rerender(<Botao altura={32}>B</Botao>);
    expect(screen.getByRole('button').className).toMatch(/h-\[38px\]/);

    rerender(<Botao altura={40}>C</Botao>);
    expect(screen.getByRole('button').className).toMatch(/h-\[42px\]/);
  });

  it('renderiza ícone à esquerda', () => {
    render(<Botao iconeEsquerda={Plus}>Adicionar</Botao>);
    expect(screen.getByTestId('icone-esquerda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar' })).toBeInTheDocument();
  });

  it('renderiza ícone à direita', () => {
    render(<Botao iconeDireita={ArrowRight}>Próximo</Botao>);
    expect(screen.getByTestId('icone-direita')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeInTheDocument();
  });

  it('mostra spinner quando carregando', () => {
    render(<Botao carregando>Salvar</Botao>);
    expect(screen.getByTestId('spinner-carregando')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando');
    // Texto do botão continua visível
    expect(screen.getByRole('button', { name: /Salvar/ })).toBeInTheDocument();
  });

  it('substitui ícone esquerdo por spinner quando carregando', () => {
    render(<Botao carregando iconeEsquerda={Plus}>Salvar</Botao>);
    expect(screen.getByTestId('spinner-carregando')).toBeInTheDocument();
    expect(screen.queryByTestId('icone-esquerda')).not.toBeInTheDocument();
  });

  it('desabilita quando carregando', () => {
    render(<Botao carregando>Salvar</Botao>);
    const botao = screen.getByRole('button');
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute('aria-busy', 'true');
    expect(botao.className).toMatch(/pointer-events-none/);
    expect(botao.className).toMatch(/opacity-70/);
  });

  it('chama onClick quando clicado', async () => {
    const aoClicar = vi.fn();
    render(<Botao onClick={aoClicar}>Confirmar</Botao>);
    await userEvent.click(screen.getByRole('button'));
    expect(aoClicar).toHaveBeenCalledOnce();
  });

  it('não chama onClick quando desabilitado', async () => {
    const aoClicar = vi.fn();
    render(<Botao disabled onClick={aoClicar}>Confirmar</Botao>);
    await userEvent.click(screen.getByRole('button'));
    expect(aoClicar).not.toHaveBeenCalled();
  });

  it('aceita className customizado', () => {
    render(<Botao className="mt-4">Ok</Botao>);
    expect(screen.getByRole('button').className).toMatch(/mt-4/);
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<Botao>Salvar</Botao>);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('não tem violações de acessibilidade na variante perigo', async () => {
    const { container } = render(<Botao variante="perigo">Excluir</Botao>);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('aplica fullWidth quando solicitado', () => {
    render(<Botao fullWidth>Entrar</Botao>);
    expect(screen.getByRole('button').className).toMatch(/w-full/);
  });
});
