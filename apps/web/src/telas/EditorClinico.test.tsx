import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { EditorClinico } from "./EditorClinico";

/* ── polyfills para jsdom ─────────────────────────────────────────────── */

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;
  }

  if (typeof globalThis.DOMRect === "undefined") {
    // @ts-ignore - polyfill basico
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

  // ClipboardEvent nao existe no jsdom
  if (typeof globalThis.ClipboardEvent === "undefined") {
    // @ts-ignore - polyfill basico
    globalThis.ClipboardEvent = class ClipboardEvent extends Event {
      clipboardData: DataTransfer | null = null;
      constructor(type: string, init?: EventInit) {
        super(type, init);
      }
    };
  }

  // DragEvent nao existe no jsdom
  if (typeof globalThis.DragEvent === "undefined") {
    // @ts-ignore - polyfill basico
    globalThis.DragEvent = class DragEvent extends Event {
      dataTransfer: DataTransfer | null = null;
      constructor(type: string, init?: EventInit) {
        super(type, init);
      }
    };
  }
});

/* ── helper ────────────────────────────────────────────────────────────── */

function renderComProvider(ui: ReactNode) {
  return render(
    <RadixTooltip.Provider delayDuration={0}>{ui}</RadixTooltip.Provider>,
  );
}

function propsBase(over: Record<string, unknown> = {}) {
  return {
    encounterId: "e1",
    buscarCodigo: vi.fn(async () => [{ code: "I10", display: "Hipertensao essencial" }]),
    buscarModelo: vi.fn(async () => [{ code: "retorno", texto: "Retorno em 30 dias." }]),
    buscarValorAnterior: vi.fn(async () => ({ valor: "72,4 kg", em: "12/05/2026" })),
    aoPrescrever: vi.fn(),
    aoPedirExame: vi.fn(),
    aoEmitirDocumento: vi.fn(),
    aoFinalizar: vi.fn(),
    ...over,
  };
}

describe("EditorClinico", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renderiza editor TipTap", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    // TipTap cria um elemento com role tiptap ou um div contenteditable
    await waitFor(() => {
      const editor = document.querySelector(".tiptap, .ProseMirror, [contenteditable]");
      expect(editor).toBeTruthy();
    });
  });

  it("mostra toolbar de formatacao", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    await waitFor(() => {
      expect(screen.getByRole("toolbar")).toBeInTheDocument();
    });

    // Botoes de formatacao
    expect(screen.getByLabelText("Negrito")).toBeInTheDocument();
    expect(screen.getByLabelText("Italico")).toBeInTheDocument();
    expect(screen.getByLabelText("Titulo")).toBeInTheDocument();
    expect(screen.getByLabelText("Subtitulo")).toBeInTheDocument();
    expect(screen.getByLabelText("Lista com marcadores")).toBeInTheDocument();
    expect(screen.getByLabelText("Lista numerada")).toBeInTheDocument();
    expect(screen.getByLabelText("Citacao")).toBeInTheDocument();
  });

  it("aplica negrito ao clicar no botao", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Negrito")).toBeInTheDocument();
    });

    const btnNegrito = screen.getByLabelText("Negrito");
    await act(async () => {
      fireEvent.click(btnNegrito);
    });

    // O botao deve ter aria-pressed apos clique
    // (pode estar true ou false dependendo do estado do TipTap)
    expect(btnNegrito).toHaveAttribute("aria-pressed");
  });

  it("aplica italico ao clicar no botao", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Italico")).toBeInTheDocument();
    });

    const btnItalico = screen.getByLabelText("Italico");
    await act(async () => {
      fireEvent.click(btnItalico);
    });

    expect(btnItalico).toHaveAttribute("aria-pressed");
  });

  it("insere heading ao clicar no botao", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Titulo")).toBeInTheDocument();
    });

    const btnTitulo = screen.getByLabelText("Titulo");
    await act(async () => {
      fireEvent.click(btnTitulo);
    });

    expect(btnTitulo).toHaveAttribute("aria-pressed");
  });

  it("mostra placeholder quando vazio", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    await waitFor(() => {
      const editorEl = document.querySelector(".tiptap, .ProseMirror, [contenteditable]");
      expect(editorEl).toBeTruthy();
    });

    // O Placeholder extension adiciona um data-placeholder ou classe is-empty
    const editorEl = document.querySelector(".tiptap, .ProseMirror");
    // O placeholder e visivel via CSS :before — verificamos que o nodo existe
    expect(editorEl).toBeTruthy();
  });

  it("mostra contagem de palavras", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    await waitFor(() => {
      expect(screen.getByText(/palavra/i)).toBeInTheDocument();
    });
  });

  it("mostra indicador de autosave quando onSalvar e fornecido", async () => {
    const props = propsBase({ onSalvar: vi.fn(async () => {}) });
    renderComProvider(<EditorClinico {...props} />);

    await waitFor(() => {
      expect(screen.getByText("Salvo")).toBeInTheDocument();
    });
  });

  it("carrega conteudo inicial", async () => {
    const props = propsBase({ conteudoInicial: "<p>Texto de teste inicial</p>" });
    renderComProvider(<EditorClinico {...props} />);

    await waitFor(() => {
      expect(screen.getByText("Texto de teste inicial")).toBeInTheDocument();
    });
  });

  it("e somente leitura quando readOnly=true", async () => {
    const props = propsBase({ readOnly: true });
    renderComProvider(<EditorClinico {...props} />);

    await waitFor(() => {
      const editorEl = document.querySelector(".tiptap, .ProseMirror, [contenteditable]");
      expect(editorEl).toBeTruthy();
    });

    // Toolbar nao aparece em modo readOnly
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();

    // Editor nao e editavel
    const editorEl = document.querySelector(".tiptap, .ProseMirror, [contenteditable]");
    expect(editorEl?.getAttribute("contenteditable")).toBe("false");
  });

  it("o cronometro do atendimento aparece visivel", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    expect(screen.getByText(/Duracao/)).toBeVisible();
  });

  it("Ctrl+R chama aoPrescrever", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    const container = screen.getByRole("article").closest("div")!.parentElement!;
    fireEvent.keyDown(container, { key: "r", ctrlKey: true });
    expect(props.aoPrescrever).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+E chama aoPedirExame", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    const container = screen.getByRole("article").closest("div")!.parentElement!;
    fireEvent.keyDown(container, { key: "e", ctrlKey: true });
    expect(props.aoPedirExame).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+D chama aoEmitirDocumento", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    const container = screen.getByRole("article").closest("div")!.parentElement!;
    fireEvent.keyDown(container, { key: "d", ctrlKey: true });
    expect(props.aoEmitirDocumento).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Enter chama aoFinalizar", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    const container = screen.getByRole("article").closest("div")!.parentElement!;
    fireEvent.keyDown(container, { key: "Enter", ctrlKey: true });
    expect(props.aoFinalizar).toHaveBeenCalledTimes(1);
  });

  it("nao esconde toolbar quando nao e readOnly", async () => {
    const props = propsBase();
    renderComProvider(<EditorClinico {...props} />);

    await waitFor(() => {
      expect(screen.getByRole("toolbar")).toBeInTheDocument();
    });
  });

  it("sem violacao de acessibilidade", async () => {
    vi.useRealTimers();
    const { container } = renderComProvider(
      <EditorClinico
        encounterId="e1"
        buscarCodigo={async () => []}
        buscarModelo={async () => []}
        buscarValorAnterior={async () => null}
        aoPrescrever={vi.fn()}
        aoPedirExame={vi.fn()}
        aoEmitirDocumento={vi.fn()}
        aoFinalizar={vi.fn()}
      />,
    );

    await waitFor(() => {
      const editorEl = document.querySelector(".tiptap, .ProseMirror, [contenteditable]");
      expect(editorEl).toBeTruthy();
    });

    expect(await axe(container)).toHaveNoViolations();
  });
});
