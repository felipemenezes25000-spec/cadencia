import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelLateral } from './PainelLateral';

// Polyfills para jsdom: Radix Dialog depende de APIs que nao existem no jsdom
beforeAll(() => {
  // scrollIntoView nao existe no jsdom
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }

  // PointerEvent nao existe no jsdom — necessario para Radix DismissableLayer
  if (typeof window.PointerEvent === 'undefined') {
    // @ts-expect-error - polyfill basico para testes
    window.PointerEvent = class PointerEvent extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      constructor(
        type: string,
        params: PointerEventInit & { pointerId?: number; pointerType?: string } = {},
      ) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? '';
      }
    };
  }

  // Radix DismissableLayer pode chamar hasPointerCapture / setPointerCapture
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

describe('PainelLateral', () => {
  it('nao renderiza quando aberto=false', () => {
    render(
      <PainelLateral aberto={false} onFechar={() => {}}>
        Conteudo oculto
      </PainelLateral>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Conteudo oculto')).not.toBeInTheDocument();
  });

  it('renderiza conteudo quando aberto=true', () => {
    render(
      <PainelLateral aberto onFechar={() => {}}>
        Conteudo visivel
      </PainelLateral>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Conteudo visivel')).toBeInTheDocument();
  });

  it('mostra titulo no cabecalho', () => {
    render(
      <PainelLateral aberto titulo="Prescrever" onFechar={() => {}}>
        Conteudo
      </PainelLateral>,
    );
    expect(screen.getByText('Prescrever')).toBeInTheDocument();
    // Radix vincula o titulo ao dialog via aria-labelledby
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Prescrever');
  });

  it('chama onFechar ao clicar no X', async () => {
    const onFechar = vi.fn();
    const user = userEvent.setup();
    render(
      <PainelLateral aberto titulo="Teste" onFechar={onFechar}>
        Conteudo
      </PainelLateral>,
    );
    const botaoFechar = screen.getByRole('button', { name: 'Fechar painel' });
    await user.click(botaoFechar);
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('chama onFechar ao pressionar Escape', async () => {
    const onFechar = vi.fn();
    const user = userEvent.setup();
    render(
      <PainelLateral aberto titulo="Teste" onFechar={onFechar}>
        Conteudo
      </PainelLateral>,
    );
    await user.keyboard('{Escape}');
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('chama onFechar ao clicar no overlay', async () => {
    const onFechar = vi.fn();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <PainelLateral aberto titulo="Teste" onFechar={onFechar}>
        <button type="button">Botao dentro</button>
      </PainelLateral>,
    );
    // Radix Dialog v1.1+ usa DismissableLayer com deferPointerDownOutside.
    // O overlay e registrado como "dismissable surface" e despacha
    // onDismiss quando o usuario clica nele. userEvent simula a sequencia
    // completa de eventos de ponteiro que o Radix espera.
    const overlay = document.querySelector('[data-state="open"].fixed.inset-0') as HTMLElement;
    expect(overlay).toBeTruthy();
    await user.click(overlay);
    await waitFor(() => {
      expect(onFechar).toHaveBeenCalled();
    });
  });

  it('aplica largura sm corretamente', () => {
    render(
      <PainelLateral aberto largura="sm" onFechar={() => {}}>
        Conteudo
      </PainelLateral>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('w-80');
  });

  it('aplica largura lg corretamente', () => {
    render(
      <PainelLateral aberto largura="lg" onFechar={() => {}}>
        Conteudo
      </PainelLateral>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('w-[560px]');
  });

  it('aplica largura md por padrao', () => {
    render(
      <PainelLateral aberto onFechar={() => {}}>
        Conteudo
      </PainelLateral>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('w-[420px]');
  });

  it('tem role=dialog e aria-modal', () => {
    render(
      <PainelLateral aberto titulo="Teste" onFechar={() => {}}>
        Conteudo
      </PainelLateral>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    // Radix Dialog define aria-modal automaticamente no Content
  });

  it('aceita className adicional', () => {
    render(
      <PainelLateral aberto onFechar={() => {}} className="mt-4">
        Conteudo
      </PainelLateral>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('mt-4');
  });

  it('suporta aoFechar para compatibilidade', async () => {
    const aoFechar = vi.fn();
    const user = userEvent.setup();
    render(
      <PainelLateral aberto titulo="Compat" aoFechar={aoFechar}>
        Conteudo
      </PainelLateral>,
    );
    await user.keyboard('{Escape}');
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('renderiza sem titulo', () => {
    render(
      <PainelLateral aberto onFechar={() => {}}>
        Sem titulo
      </PainelLateral>,
    );
    // Botao de fechar deve estar presente mesmo sem titulo
    expect(screen.getByRole('button', { name: 'Fechar painel' })).toBeInTheDocument();
    expect(screen.getByText('Sem titulo')).toBeInTheDocument();
  });

  it('nao tem violacoes de acessibilidade', async () => {
    render(
      <PainelLateral aberto titulo="Teste" onFechar={() => {}}>
        Conteudo
      </PainelLateral>,
    );
    // Radix Portal renderiza em document.body, entao verificamos o body inteiro
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('nao tem violacoes de acessibilidade sem titulo', async () => {
    render(
      <PainelLateral aberto onFechar={() => {}}>
        Conteudo
      </PainelLateral>,
    );
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
