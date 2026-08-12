// apps/web/src/telas/Desempenho.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { Desempenho } from "./Desempenho";

// -- Helper para montar com NuqsTestingAdapter --------------------------------

function montar(searchParams: Record<string, string> = {}) {
  const onUrlUpdate = vi.fn();

  const result = render(
    <NuqsTestingAdapter
      searchParams={{ periodo: "mes", aba: "explorar", ...searchParams }}
      onUrlUpdate={onUrlUpdate}
      hasMemory
    >
      <Desempenho />
    </NuqsTestingAdapter>,
  );

  return { onUrlUpdate, ...result };
}

// -- Testes do shell ----------------------------------------------------------

describe("tela Desempenho", () => {
  it("renderiza título", () => {
    montar();
    expect(
      screen.getByRole("heading", { name: /Desempenho/ }),
    ).toBeVisible();
  });

  it("renderiza seletor de período com 4 opções", () => {
    montar();
    const grupo = screen.getByRole("group", {
      name: /Seletor de período/i,
    });
    expect(grupo).toBeVisible();
    expect(screen.getByRole("button", { name: "Semana" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Mês" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Trimestre" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Ano" })).toBeVisible();
  });

  it("renderiza 4 tabs", () => {
    montar();
    expect(screen.getByRole("tab", { name: /Explorar/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Variações/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Atendimentos/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Satisfação/ })).toBeVisible();
  });

  it("muda período ao clicar", async () => {
    const user = userEvent.setup();
    const { onUrlUpdate } = montar();

    await user.click(screen.getByRole("button", { name: "Semana" }));

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          queryString: expect.stringContaining("periodo=semana"),
        }),
      );
    });
  });

  it("muda tab ao clicar", async () => {
    const user = userEvent.setup();
    const { onUrlUpdate } = montar();

    await user.click(screen.getByRole("tab", { name: /Satisfação/ }));

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          queryString: expect.stringContaining("aba=satisfacao"),
        }),
      );
    });
  });

  it("persiste período e aba na URL", () => {
    montar({ periodo: "trimestre", aba: "atendimentos" });

    // Período trimestre deve estar pressionado
    expect(
      screen.getByRole("button", { name: "Trimestre" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Tab atendimentos deve estar ativa
    expect(
      screen.getByRole("tab", { name: /Atendimentos/ }),
    ).toHaveAttribute("data-state", "active");
  });

  it("renderiza conteúdo da tab ativa", () => {
    montar({ aba: "explorar" });
    expect(
      screen.getByRole("region", { name: /Explorar/ }),
    ).toBeVisible();
  });

  it("renderiza conteúdo ao trocar de tab", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("tab", { name: /Satisfação/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: /Satisfação/ }),
      ).toBeVisible();
    });
  });

  it("não tem violações de acessibilidade", async () => {
    const { container } = montar();
    expect(await axe(container)).toHaveNoViolations();
  });
});

// -- Testes de navegação (preservados) ----------------------------------------

import { FASE_ATUAL, ITENS_NAV } from "../ui/nav";

describe("navegação Desempenho", () => {
  it("FASE_ATUAL inclui fase do Desempenho", () => {
    expect(FASE_ATUAL).toBeGreaterThanOrEqual(3);
  });

  it("item Desempenho está disponível na fase 3", () => {
    const item = ITENS_NAV.find((i) => i.rotulo === "Desempenho");
    expect(item).toBeDefined();
    expect(item!.disponivelNaFase).toBeLessThanOrEqual(FASE_ATUAL);
  });

  it("todos os itens de navegação estão disponíveis na fase atual", () => {
    for (const item of ITENS_NAV) {
      expect(item.disponivelNaFase).toBeLessThanOrEqual(FASE_ATUAL);
    }
  });
});
