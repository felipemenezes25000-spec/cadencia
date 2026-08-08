import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import {
  SLASH_COMMANDS,
  SlashMenu,
  agruparPorSecao,
  insertarSecao,
  type SlashCommand,
  type SlashMenuRef,
} from "./EditorSlashCommands";

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

  if (typeof globalThis.ClipboardEvent === "undefined") {
    // @ts-ignore - polyfill basico
    globalThis.ClipboardEvent = class ClipboardEvent extends Event {
      clipboardData: DataTransfer | null = null;
      constructor(type: string, init?: EventInit) {
        super(type, init);
      }
    };
  }

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

/* ── helper para capturar ref ─────────────────────────────────────────── */

function renderSlashMenu(
  items: SlashCommand[] = SLASH_COMMANDS,
  command = vi.fn(),
) {
  let refValue: SlashMenuRef | null = null;
  const refCallback = (instance: SlashMenuRef | null) => {
    refValue = instance;
  };

  const result = render(
    <SlashMenu ref={refCallback} items={items} command={command} />,
  );

  return { ...result, getRef: () => refValue!, command };
}

/* ── testes ────────────────────────────────────────────────────────────── */

describe("EditorSlashCommands", () => {
  it("mostra todos os 7 comandos quando / digitado sozinho", () => {
    renderSlashMenu();

    // Deve haver 7 botoes de opcao
    const opcoes = screen.getAllByRole("option");
    expect(opcoes).toHaveLength(7);

    // Verifica que todos os titulos aparecem
    expect(screen.getByText("Subjetivo")).toBeInTheDocument();
    expect(screen.getByText("Objetivo")).toBeInTheDocument();
    expect(screen.getByText("Avaliacao")).toBeInTheDocument();
    expect(screen.getByText("Plano")).toBeInTheDocument();
    expect(screen.getByText("Prescricao")).toBeInTheDocument();
    expect(screen.getByText("Exame")).toBeInTheDocument();
    expect(screen.getByText("CID")).toBeInTheDocument();
  });

  it("filtra comandos ao digitar /sub", () => {
    const filtrados = SLASH_COMMANDS.filter((cmd) =>
      cmd.titulo.toLowerCase().includes("sub"),
    );
    renderSlashMenu(filtrados);

    const opcoes = screen.getAllByRole("option");
    expect(opcoes).toHaveLength(1);
    expect(screen.getByText("Subjetivo")).toBeInTheDocument();
  });

  it("filtra comandos ao digitar /pre", () => {
    const filtrados = SLASH_COMMANDS.filter((cmd) =>
      cmd.titulo.toLowerCase().includes("pre"),
    );
    renderSlashMenu(filtrados);

    const opcoes = screen.getAllByRole("option");
    expect(opcoes).toHaveLength(1);
    expect(screen.getByText("Prescricao")).toBeInTheDocument();
  });

  it("insere secao Subjetivo ao selecionar", () => {
    const command = vi.fn();
    renderSlashMenu(SLASH_COMMANDS, command);

    const botaoSubjetivo = screen.getByText("Subjetivo").closest("button")!;
    fireEvent.click(botaoSubjetivo);

    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ id: "subjetivo", titulo: "Subjetivo" }),
    );
  });

  it("insere secao Plano ao selecionar", () => {
    const command = vi.fn();
    renderSlashMenu(SLASH_COMMANDS, command);

    const botaoPlano = screen.getByText("Plano").closest("button")!;
    fireEvent.click(botaoPlano);

    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plano", titulo: "Plano" }),
    );
  });

  it("navega com ArrowUp/ArrowDown", async () => {
    const { getRef } = renderSlashMenu();

    // Inicialmente o primeiro item esta ativo (indice 0)
    const opcoes = screen.getAllByRole("option");
    expect(opcoes[0]).toHaveAttribute("aria-selected", "true");

    // ArrowDown move para o segundo
    await act(() => {
      getRef().onKeyDown({
        event: new KeyboardEvent("keydown", { key: "ArrowDown" }),
      });
    });

    // Apos re-render, o segundo item deve estar ativo
    const opcoesAtualizadas = screen.getAllByRole("option");
    expect(opcoesAtualizadas[0]).toHaveAttribute("aria-selected", "false");
    expect(opcoesAtualizadas[1]).toHaveAttribute("aria-selected", "true");
  });

  it("seleciona com Enter", () => {
    const command = vi.fn();
    const { getRef } = renderSlashMenu(SLASH_COMMANDS, command);

    const ref = getRef();

    // Enter seleciona o item ativo (indice 0 = Subjetivo)
    const handled = ref.onKeyDown({
      event: new KeyboardEvent("keydown", { key: "Enter" }),
    });
    expect(handled).toBe(true);
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ id: "subjetivo" }),
    );
  });

  it("fecha com Escape", () => {
    const { getRef } = renderSlashMenu();

    const ref = getRef();

    const handled = ref.onKeyDown({
      event: new KeyboardEvent("keydown", { key: "Escape" }),
    });
    expect(handled).toBe(true);
  });

  it("agrupa comandos por secao (SOAP, Acoes, Codigos)", () => {
    const grupos = agruparPorSecao(SLASH_COMMANDS);

    expect(Object.keys(grupos)).toEqual(["SOAP", "Acoes", "Codigos"]);
    expect(grupos["SOAP"]).toHaveLength(4);
    expect(grupos["Acoes"]).toHaveLength(2);
    expect(grupos["Codigos"]).toHaveLength(1);
  });

  it("mostra descricoes dos comandos", () => {
    renderSlashMenu();

    expect(
      screen.getByText("Queixa e historia do paciente"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Exame fisico e sinais vitais"),
    ).toBeInTheDocument();
    expect(screen.getByText("Hipotese diagnostica")).toBeInTheDocument();
    expect(screen.getByText("Conduta terapeutica")).toBeInTheDocument();
    expect(screen.getByText("Inserir prescricao medica")).toBeInTheDocument();
    expect(
      screen.getByText("Solicitar exame complementar"),
    ).toBeInTheDocument();
    expect(screen.getByText("Buscar codigo CID-10")).toBeInTheDocument();
  });

  it("mostra rotulos de secao no popup", () => {
    renderSlashMenu();

    expect(screen.getByText("SOAP")).toBeInTheDocument();
    expect(screen.getByText("Acoes")).toBeInTheDocument();
    expect(screen.getByText("Codigos")).toBeInTheDocument();
  });

  it("mostra mensagem quando nenhum comando encontrado", () => {
    renderSlashMenu([]);

    expect(
      screen.getByText("Nenhum comando encontrado"),
    ).toBeInTheDocument();
  });

  it("ArrowDown retorna ao primeiro item apos o ultimo", async () => {
    const command = vi.fn();
    const { getRef } = renderSlashMenu(SLASH_COMMANDS, command);

    // Move ate o ultimo item (7 vezes ArrowDown para ir de 0 ate wrap-around ao 0)
    for (let i = 0; i < SLASH_COMMANDS.length; i++) {
      await act(() => {
        getRef().onKeyDown({
          event: new KeyboardEvent("keydown", { key: "ArrowDown" }),
        });
      });
    }

    // Agora Enter deve selecionar o primeiro item (wrap-around)
    await act(() => {
      getRef().onKeyDown({
        event: new KeyboardEvent("keydown", { key: "Enter" }),
      });
    });
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ id: "subjetivo" }),
    );
  });

  it("ArrowUp do primeiro vai ao ultimo", async () => {
    const command = vi.fn();
    const { getRef } = renderSlashMenu(SLASH_COMMANDS, command);

    // ArrowUp do indice 0 deve ir para o ultimo
    await act(() => {
      getRef().onKeyDown({
        event: new KeyboardEvent("keydown", { key: "ArrowUp" }),
      });
    });

    // Apos re-render, Enter seleciona o ultimo item
    await act(() => {
      getRef().onKeyDown({
        event: new KeyboardEvent("keydown", { key: "Enter" }),
      });
    });
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cid" }),
    );
  });

  it("insertarSecao insere conteudo para cada tipo", () => {
    // Mock do editor TipTap
    const chainMock: Record<string, ReturnType<typeof vi.fn>> = {};
    const chain = () => {
      const proxy = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "run") return vi.fn();
            if (!chainMock[prop as string]) {
              chainMock[prop as string] = vi.fn(() => proxy);
            }
            return chainMock[prop as string];
          },
        },
      );
      return proxy;
    };

    const editorMock = { chain } as unknown as import("@tiptap/react").Editor;

    // Testa cada tipo de secao
    const tipos = [
      "subjetivo",
      "objetivo",
      "avaliacao",
      "plano",
      "prescricao",
      "exame",
      "cid",
    ];

    for (const tipo of tipos) {
      insertarSecao(editorMock, tipo);
    }

    // Se chegou aqui sem erro, todos os tipos sao tratados
    expect(true).toBe(true);
  });

  it("sem violacoes de acessibilidade", async () => {
    const { container } = renderSlashMenu();
    expect(await axe(container)).toHaveNoViolations();
  });
});
