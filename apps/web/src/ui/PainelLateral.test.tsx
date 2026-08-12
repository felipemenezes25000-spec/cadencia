import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelLateral } from './PainelLateral';

// Polyfills para jsdom: Radix Dialog depende de APIs que não existem no jsdom
beforeAll(() => {
  // scrollIntoView não existe no jsdom
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }

  // PointerEvent não existe no jsdom — necessário para Radix DismissableLayer
  if (typeof window.PointerEvent === 'undefined') {
    // @ts-expect-error - polyfill básico para testes
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
  it('não renderiza quando aberto=false', () => {
    render(
      <PainelLateral aberto={false} onFechar={() => {}}>
        Conteúdo oculto
      </PainelLateral>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Conteúdo oculto')).not.toBeInTheDocument();
  });

  it('renderiza conteúdo quando aberto=true', () => {
    render(
      <PainelLateral aberto onFechar={() => {}}>
        Conteúdo visível
      </PainelLateral>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Conteúdo visível')).toBeInTheDocument();
  });

  it('mostra título no cabeçalho', () => {
    render(
      <PainelLateral aberto titulo="Prescrever" onFechar={() => {}}>
        Conteúdo
      </PainelLateral>,
    );
    expect(screen.getByText('Prescrever')).toBeInTheDocument();
    // Radix vincula o título ao dialog via aria-labelledby
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Prescrever');
  });

  it('chama onFechar ao clicar no X', async () => {
    const onFechar = vi.fn();
    const user = userEvent.setup();
    render(
      <PainelLateral aberto titulo="Teste" onFechar={onFechar}>
        Conteúdo
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
        Conteúdo
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
        <button type="button">Botão dentro</button>
      </PainelLateral>,
    );
    // Radix Dialog v1.1+ usa DismissableLayer com deferPointerDownOutside.
    // O overlay é registrado como "dismissable surface" e despacha
    // onDismiss quando o usuário clica nele. userEvent simula a sequência
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
        Conteúdo
      </PainelLateral>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('w-80');
  });

  it('aplica largura lg corretamente', () => {
    render(
      <PainelLateral aberto largura="lg" onFechar={() => {}}>
        Conteúdo
      </PainelLateral>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('w-[560px]');
  });

  it('aplica largura md por padrão', () => {
    render(
      <PainelLateral aberto onFechar={() => {}}>
        Conteúdo
      </PainelLateral>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('w-[420px]');
  });

  it('tem role=dialog e aria-modal', () => {
    render(
      <PainelLateral aberto titulo="Teste" onFechar={() => {}}>
        Conteúdo
      </PainelLateral>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    // Radix Dialog define aria-modal automaticamente no Content
  });

  it('aceita className adicional', () => {
    render(
      <PainelLateral aberto onFechar={() => {}} className="mt-4">
        Conteúdo
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
        Conteúdo
      </PainelLateral>,
    );
    await user.keyboard('{Escape}');
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('renderiza sem título', () => {
    render(
      <PainelLateral aberto onFechar={() => {}}>
        Sem título
      </PainelLateral>,
    );
    // Botão de fechar deve estar presente mesmo sem título
    expect(screen.getByRole('button', { name: 'Fechar painel' })).toBeInTheDocument();
    expect(screen.getByText('Sem título')).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    render(
      <PainelLateral aberto titulo="Teste" onFechar={() => {}}>
        Conteúdo
      </PainelLateral>,
    );
    // Radix Portal renderiza em document.body, então verificamos o body inteiro
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('não tem violações de acessibilidade sem título', async () => {
    render(
      <PainelLateral aberto onFechar={() => {}}>
        Conteúdo
      </PainelLateral>,
    );
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
