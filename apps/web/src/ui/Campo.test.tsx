import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Campo } from './Campo';

describe('Campo', () => {
  // ── Testes de renderizacao basica ──────────────────────────────────────

  it('renderiza input por padrao', () => {
    render(<Campo rotulo="Nome" />);
    const input = screen.getByLabelText('Nome');
    expect(input.tagName).toBe('INPUT');
  });

  it('renderiza textarea quando variante=textarea', () => {
    render(<Campo rotulo="Observacoes" variante="textarea" />);
    const textarea = screen.getByLabelText('Observacoes');
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('textarea usa linhas configuradas', () => {
    render(<Campo rotulo="Bio" variante="textarea" linhas={5} />);
    const textarea = screen.getByLabelText('Bio');
    expect(textarea).toHaveAttribute('rows', '5');
  });

  it('textarea usa 3 linhas por padrao', () => {
    render(<Campo rotulo="Bio" variante="textarea" />);
    const textarea = screen.getByLabelText('Bio');
    expect(textarea).toHaveAttribute('rows', '3');
  });

  // ── Testes de rotulo, ajuda e dica ─────────────────────────────────────

  it('mostra rotulo quando fornecido', () => {
    render(<Campo rotulo="Telefone" placeholder="(11) 90000-0000" />);
    expect(screen.getByText('Telefone')).toBeVisible();
    expect(screen.getByLabelText('Telefone')).toHaveAttribute(
      'placeholder',
      '(11) 90000-0000',
    );
  });

  it('renderiza sem rotulo quando nao fornecido', () => {
    const { container } = render(<Campo placeholder="buscar" />);
    expect(container.querySelector('label')).toBeNull();
  });

  it('mostra texto de ajuda via ajuda', () => {
    render(<Campo rotulo="CPF" ajuda="Somente numeros" />);
    expect(screen.getByText('Somente numeros')).toBeVisible();
  });

  it('mostra texto de ajuda via dica (retrocompatibilidade)', () => {
    render(<Campo rotulo="CPF" dica="Somente numeros" />);
    expect(screen.getByText('Somente numeros')).toBeVisible();
  });

  it('ajuda tem prioridade sobre dica', () => {
    render(<Campo rotulo="CPF" ajuda="Texto novo" dica="Texto antigo" />);
    expect(screen.getByText('Texto novo')).toBeVisible();
    expect(screen.queryByText('Texto antigo')).toBeNull();
  });

  // ── Testes de erro ─────────────────────────────────────────────────────

  it('mostra mensagem de erro com estilo vermelho', () => {
    render(<Campo rotulo="CPF" erro="CPF invalido" />);
    const erroEl = screen.getByText('CPF invalido');
    // Motion anima opacity em JSDOM mas o elemento esta no DOM
    expect(erroEl).toBeInTheDocument();
    expect(erroEl).toHaveClass('text-danger');
  });

  it('erro NUNCA e so cor: tem texto, aria-describedby e aria-invalid', () => {
    render(<Campo rotulo="CPF" erro="CPF invalido" />);
    const input = screen.getByLabelText('CPF');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // Motion anima opacity em JSDOM mas o elemento esta no DOM
    expect(screen.getByText('CPF invalido')).toBeInTheDocument();
    expect(input.getAttribute('aria-describedby')).toContain(
      screen.getByText('CPF invalido').id,
    );
  });

  it('a dica tambem entra em aria-describedby, junto com o erro', () => {
    render(<Campo rotulo="CNS" dica="15 digitos" erro="CNS invalido" />);
    const descrito =
      screen.getByLabelText('CNS').getAttribute('aria-describedby') ?? '';
    expect(descrito.split(' ')).toHaveLength(2);
  });

  it('sem erro, nao anuncia invalido', () => {
    render(<Campo rotulo="Nome" />);
    expect(screen.getByLabelText('Nome')).toHaveAttribute(
      'aria-invalid',
      'false',
    );
  });

  it('erro tem role alert', () => {
    render(<Campo rotulo="Email" erro="Email invalido" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Email invalido');
  });

  // ── Testes de prefixo e sufixo ─────────────────────────────────────────

  it('renderiza prefixo e sufixo', () => {
    render(
      <Campo
        rotulo="Valor"
        prefixo={<span>R$</span>}
        sufixo={<span>.00</span>}
      />,
    );
    expect(screen.getByText('R$')).toBeVisible();
    expect(screen.getByText('.00')).toBeVisible();
  });

  it('nao renderiza slots quando nao fornecidos', () => {
    const { container } = render(<Campo rotulo="Simples" />);
    expect(container.querySelector('[data-testid="campo-prefixo"]')).toBeNull();
    expect(container.querySelector('[data-testid="campo-sufixo"]')).toBeNull();
  });

  // ── Testes de contador de caracteres ───────────────────────────────────

  it('mostra contador de caracteres quando maxLength definido', () => {
    render(<Campo rotulo="Bio" maxLength={100} />);
    expect(screen.getByTestId('campo-contador')).toHaveTextContent('0/100');
  });

  it('contador atualiza ao digitar', () => {
    render(<Campo rotulo="Bio" maxLength={100} />);
    const input = screen.getByLabelText('Bio');
    fireEvent.change(input, { target: { value: 'Hello' } });
    expect(screen.getByTestId('campo-contador')).toHaveTextContent('5/100');
  });

  it('contador fica vermelho perto do limite', () => {
    render(<Campo rotulo="Bio" maxLength={10} />);
    const input = screen.getByLabelText('Bio');
    fireEvent.change(input, { target: { value: '123456789' } });
    const contador = screen.getByTestId('campo-contador');
    expect(contador).toHaveClass('text-danger');
  });

  it('nao mostra contador sem maxLength', () => {
    const { container } = render(<Campo rotulo="Livre" />);
    expect(container.querySelector('[data-testid="campo-contador"]')).toBeNull();
  });

  // ── Testes de forwardRef ───────────────────────────────────────────────

  it('aceita ref (forwardRef)', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Campo ref={ref} rotulo="Nome" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('aceita ref para textarea', () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<Campo ref={ref} rotulo="Bio" variante="textarea" />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  // ── Testes de integracao com react-hook-form ───────────────────────────

  it('funciona com react-hook-form register', () => {
    // Simula o retorno de register(): ref + onChange + onBlur + name
    const refFn = vi.fn();
    const onChangeFn = vi.fn();
    const onBlurFn = vi.fn();

    render(
      <Campo
        rotulo="Email"
        ref={refFn}
        name="email"
        onChange={onChangeFn}
        onBlur={onBlurFn}
      />,
    );

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('name', 'email');
    expect(refFn).toHaveBeenCalledWith(input);

    fireEvent.change(input, { target: { value: 'test@test.com' } });
    expect(onChangeFn).toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onBlurFn).toHaveBeenCalled();
  });

  // ── Testes de retrocompatibilidade ─────────────────────────────────────

  it('prop denso reduz altura (retrocompatibilidade)', () => {
    const { container } = render(<Campo rotulo="Filtro" denso />);
    const wrapper = container.querySelector('.h-8');
    expect(wrapper).not.toBeNull();
  });

  // ── Testes de acessibilidade ───────────────────────────────────────────

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <Campo rotulo="Nome" ajuda="como no documento" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('nao tem violacoes de acessibilidade com dica (retrocompatibilidade)', async () => {
    const { container } = render(
      <Campo rotulo="Nome" dica="como no documento" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('nao tem violacoes de acessibilidade com erro', async () => {
    const { container } = render(
      <Campo rotulo="Email" erro="Email invalido" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('nao tem violacoes de acessibilidade como textarea', async () => {
    const { container } = render(
      <Campo rotulo="Observacoes" variante="textarea" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
