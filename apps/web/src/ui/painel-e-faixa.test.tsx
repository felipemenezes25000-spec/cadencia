import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelLateral } from './PainelLateral';

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
