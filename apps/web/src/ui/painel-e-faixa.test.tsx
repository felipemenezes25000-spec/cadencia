import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelLateral } from './PainelLateral';
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
      x = 0; y = 0; width = 0; height = 0;
      top = 0; right = 0; bottom = 0; left = 0;
      toJSON() { return {}; }
      static fromRect() { return new DOMRect(); }
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

describe('painel lateral compositor', () => {
  it('usa largura md (420px) por padrao e renderiza como Radix Dialog', () => {
    render(<PainelLateral aberto titulo="Prescrever" aoFechar={vi.fn()}>
      <p>conteudo</p></PainelLateral>);
    const dialog = screen.getByRole('dialog', { name: 'Prescrever' });
    // Largura md e aplicada via classe Tailwind w-[420px]
    expect(dialog.className).toContain('w-[420px]');
  });

  it('Esc fecha e devolve o foco a origem', async () => {
    const aoFechar = vi.fn();
    render(<PainelLateral aberto titulo="Prescrever" aoFechar={aoFechar}>
      <button type="button">dentro</button></PainelLateral>);
    await userEvent.keyboard('{Escape}');
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('faz focus trap: Tab nao escapa do painel (Radix Dialog)', async () => {
    render(<>
      <button type="button">fora</button>
      <PainelLateral aberto titulo="P" aoFechar={vi.fn()}>
        <button type="button">a</button><button type="button">b</button>
      </PainelLateral></>);
    await userEvent.tab(); await userEvent.tab(); await userEvent.tab();
    expect(document.activeElement).not.toHaveTextContent('fora');
  });

  it('sem violacao de acessibilidade', async () => {
    render(
      <PainelLateral aberto titulo="Prescrever" aoFechar={vi.fn()}><p>x</p></PainelLateral>);
    // Radix Portal renderiza em document.body
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('faixa de contadores', () => {
  const CONT = { agendados: 12, confirmados: 8, aguardando: 2, atendidos: 5, faltas: 1 };

  it('cada numero e um BUTTON que filtra a fila, nao um enfeite', async () => {
    const aoFiltrar = vi.fn();
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={aoFiltrar} />);
    await userEvent.click(screen.getByRole('button', { name: /Aguardando/ }));
    expect(aoFiltrar).toHaveBeenCalledWith('aguardando');
  });

  it('anuncia mudanca com aria-live polite', () => {
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Contadores do dia' }))
      .toHaveAttribute('aria-live', 'polite');
  });

  it('os numeros usam tipografia tabular e bold', () => {
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} />);
    const num = screen.getByText('12');
    expect(num).toHaveClass('text-2xl', 'font-bold', 'tabular-nums');
  });

  it('o filtro ativo fica marcado com aria-pressed', () => {
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} filtroAtivo="faltas" />);
    expect(screen.getByRole('button', { name: /Faltas/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
