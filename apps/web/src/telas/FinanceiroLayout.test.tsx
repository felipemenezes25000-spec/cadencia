import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import {
  FinanceiroLayout,
  ABAS_FINANCEIRO,
} from "./FinanceiroLayout";

/* ── Mocks de next/navigation ──────────────────────────────────────── */

const mockPush = vi.fn();
let pathnameMock = "/financeiro";

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock,
  useRouter: () => ({ push: mockPush }),
}));

/* ── Helper ────────────────────────────────────────────────────────── */

function montar(opts?: {
  pathname?: string;
  pendentesReceber?: number;
  pendentesPagar?: number;
  baixoEstoque?: number;
}) {
  pathnameMock = opts?.pathname ?? "/financeiro";
  return render(
    <FinanceiroLayout
      pendentesReceber={opts?.pendentesReceber}
      pendentesPagar={opts?.pendentesPagar}
      baixoEstoque={opts?.baixoEstoque}
    >
      <div data-testid="conteudo-filho">Conteudo da aba</div>
    </FinanceiroLayout>,
  );
}

beforeEach(() => {
  mockPush.mockClear();
  pathnameMock = "/financeiro";
});

/* ── Testes ────────────────────────────────────────────────────────── */

describe("FinanceiroLayout", () => {
  it("renderiza todas as 8 abas", () => {
    montar();
    const tablist = screen.getByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(8);

    for (const aba of ABAS_FINANCEIRO) {
      expect(
        screen.getByRole("tab", { name: new RegExp(aba.rotulo, "i") }),
      ).toBeVisible();
    }
  });

  it("destaca aba ativa com base na rota", () => {
    montar({ pathname: "/financeiro/caixa" });
    const abaCaixa = screen.getByRole("tab", { name: /Caixa/i });
    expect(abaCaixa).toHaveAttribute("data-state", "active");

    const abaVisao = screen.getByRole("tab", { name: /Resumo/i });
    expect(abaVisao).toHaveAttribute("data-state", "inactive");
  });

  it("navega para rota ao clicar em aba", async () => {
    montar({ pathname: "/financeiro" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: /Cadastros/i }));
    expect(mockPush).toHaveBeenCalledWith("/financeiro/cadastros");
  });

  it("mostra badge de pendentes em A receber", () => {
    montar({ pendentesReceber: 5 });
    const aba = screen.getByRole("tab", { name: /A receber/i });
    expect(within(aba).getByText("5")).toBeVisible();
  });

  it("mostra badge de pendentes em A pagar", () => {
    montar({ pendentesPagar: 3 });
    const aba = screen.getByRole("tab", { name: /A pagar/i });
    expect(within(aba).getByText("3")).toBeVisible();
  });

  it("mostra badge de estoque baixo em Estoque", () => {
    montar({ baixoEstoque: 7 });
    const aba = screen.getByRole("tab", { name: /Estoque/i });
    expect(within(aba).getByText("7")).toBeVisible();
  });

  it("renderiza conteudo filho", () => {
    montar();
    expect(screen.getByTestId("conteudo-filho")).toBeVisible();
    expect(screen.getByText("Conteudo da aba")).toBeVisible();
  });

  it("abas sao scrollaveis horizontalmente no mobile", () => {
    montar();
    const tablist = screen.getByRole("tablist");
    /* O container pai direto do tablist deve ter overflow-x-auto */
    const scrollContainer = tablist.parentElement;
    expect(scrollContainer).toBeDefined();
    expect(scrollContainer?.className).toMatch(/overflow-x-auto/);
  });

  it("nao tem violacoes de acessibilidade", async () => {
    const { container } = montar();
    /*
     * Desabilitamos aria-valid-attr-value porque o Radix Tabs emite
     * aria-controls apontando para TabsContent que nao existe neste layout
     * (o conteudo vem das rotas filhas, nao de TabsContent).
     */
    expect(
      await axe(container, {
        rules: { "aria-valid-attr-value": { enabled: false } },
      }),
    ).toHaveNoViolations();
  });
});
