import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FaixaDeContadores } from './FaixaDeContadores';

/* ── Polyfills para jsdom (Radix Tooltip/Popper) ───────────────────── */

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;
  }

  if (typeof globalThis.DOMRect === 'undefined') {
    // @ts-ignore — polyfill basico para testes no jsdom
    globalThis.DOMRect = class DOMRect {
      x = 0;
      y = 0;
      width = 0;
      height = 0;
      top = 0;
      right = 0;
      bottom = 0;
      left = 0;
      toJSON() {
        return {};
      }
      static fromRect() {
        return new DOMRect();
      }
    };
  }

  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
});

describe('FaixaDeContadores', () => {
  const contadores = [
    { id: 'total', rotulo: 'Total', valor: 42 },
    { id: 'espera', rotulo: 'Em espera', valor: 5, cor: 'aviso' as const },
    { id: 'atendidos', rotulo: 'Atendidos', valor: 30, cor: 'sucesso' as const },
  ];

  it('renderiza todos os contadores', () => {
    render(
      <FaixaDeContadores contadores={contadores} />,
    );
    const botoes = screen.getAllByRole('button');
    expect(botoes).toHaveLength(3);
  });

  it('mostra valores numericos', () => {
    render(
      <FaixaDeContadores contadores={contadores} />,
    );
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('mostra rotulos', () => {
    render(
      <FaixaDeContadores contadores={contadores} />,
    );
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Em espera')).toBeInTheDocument();
    expect(screen.getByText('Atendidos')).toBeInTheDocument();
  });

  it('destaca contador ativo', () => {
    render(
      <FaixaDeContadores contadores={contadores} ativo="espera" />,
    );
    const botaoAtivo = screen.getByRole('button', { name: /Em espera/ });
    expect(botaoAtivo).toHaveAttribute('aria-pressed', 'true');

    // Os demais devem estar inativos
    const botaoInativo = screen.getByRole('button', { name: /Total/ });
    expect(botaoInativo).toHaveAttribute('aria-pressed', 'false');
  });

  it('chama onClicar ao clicar em contador', async () => {
    const onClicar = vi.fn();
    const user = userEvent.setup();
    render(
      <FaixaDeContadores contadores={contadores} onClicar={onClicar} />,
    );
    await user.click(screen.getByRole('button', { name: /Total/ }));
    expect(onClicar).toHaveBeenCalledWith('total');
  });

  it('renderiza indicador de cor quando fornecido', () => {
    const { container } = render(
      <FaixaDeContadores contadores={contadores} />,
    );
    // "Em espera" tem cor="aviso" → bg-warn, "Atendidos" tem cor="sucesso" → bg-ok
    const indicadores = container.querySelectorAll('.bg-warn, .bg-ok');
    expect(indicadores).toHaveLength(2);

    // "Total" nao tem cor, nao deve ter indicador
    const totalBtn = screen.getByRole('button', { name: /Total/ });
    expect(totalBtn.querySelector('.bg-warn, .bg-ok, .bg-danger, .bg-accent')).toBeNull();
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <FaixaDeContadores contadores={contadores} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
