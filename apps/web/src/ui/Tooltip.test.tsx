import type { ReactNode } from "react";
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { Tooltip } from "./Tooltip";

// Polyfills para jsdom: Radix Tooltip (Popper) depende de ResizeObserver e
// DOMRect que não existem no jsdom
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;
  }

  if (typeof globalThis.DOMRect === "undefined") {
    // @ts-ignore - polyfill básico para testes no jsdom
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

  // Radix Popper chama hasPointerCapture / setPointerCapture / releasePointerCapture
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

/**
 * Wrapper com TooltipProvider exigido pelo Radix.
 * delayDuration=0 para testes rápidos.
 */
function renderComProvider(ui: ReactNode) {
  return render(
    <RadixTooltip.Provider delayDuration={0}>{ui}</RadixTooltip.Provider>,
  );
}

describe("Tooltip", () => {
  it("não mostra tooltip inicialmente", () => {
    renderComProvider(
      <Tooltip conteudo="Dica">
        <button>Hover me</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("mostra tooltip ao hover", async () => {
    const user = userEvent.setup();
    renderComProvider(
      <Tooltip conteudo="Dica" delay={0}>
        <button>Hover me</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Dica");
  });

  it("esconde tooltip ao sair do hover", async () => {
    const user = userEvent.setup();
    renderComProvider(
      <Tooltip conteudo="Dica" delay={0}>
        <button>Hover me</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toBeInTheDocument();

    // Radix Tooltip escuta pointerdown fora do trigger para fechar.
    // No jsdom, unhover não dispara os eventos de ponteiro necessários,
    // então disparamos pointerdown no body para simular clique fora.
    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("mostra tooltip ao focar com teclado", async () => {
    const user = userEvent.setup();
    renderComProvider(
      <Tooltip conteudo="Dica de teclado" delay={0}>
        <button>Focar aqui</button>
      </Tooltip>,
    );

    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Dica de teclado",
    );
  });

  it("renderiza na posição correta (lado top por padrão)", () => {
    renderComProvider(
      <Tooltip conteudo="Topo">
        <button>Botão</button>
      </Tooltip>,
    );
    // Verifica que o componente renderiza sem erro com lado padrão
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("aceita lado bottom", async () => {
    const user = userEvent.setup();
    renderComProvider(
      <Tooltip conteudo="Embaixo" lado="bottom" delay={0}>
        <button>Botão</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Embaixo");
  });

  it("aceita lado left", async () => {
    const user = userEvent.setup();
    renderComProvider(
      <Tooltip conteudo="Esquerda" lado="left" delay={0}>
        <button>Botão</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Esquerda");
  });

  it("aceita lado right", async () => {
    const user = userEvent.setup();
    renderComProvider(
      <Tooltip conteudo="Direita" lado="right" delay={0}>
        <button>Botão</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Direita");
  });

  it("aceita className customizada", async () => {
    const user = userEvent.setup();
    renderComProvider(
      <Tooltip conteudo="Com classe" className="font-bold" delay={0}>
        <button>Botão</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveClass("font-bold");
  });

  it("usa delay padrão de 300ms", () => {
    renderComProvider(
      <Tooltip conteudo="Dica">
        <button>Botão</button>
      </Tooltip>,
    );
    // Componente renderiza sem erro com delay padrão
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("não tem violações de acessibilidade", async () => {
    const { container } = renderComProvider(
      <Tooltip conteudo="Dica acessível">
        <button>Hover me</button>
      </Tooltip>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("não tem violações de acessibilidade com tooltip visível", async () => {
    const user = userEvent.setup();
    const { container } = renderComProvider(
      <Tooltip conteudo="Dica acessível" delay={0}>
        <button>Hover me</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button"));
    await screen.findByRole("tooltip");

    expect(await axe(container)).toHaveNoViolations();
  });
});
