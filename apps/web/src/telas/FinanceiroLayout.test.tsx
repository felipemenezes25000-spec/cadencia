import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    const nav = screen.getByRole("navigation", { name: /Seções financeiras/i });
    expect(within(nav).getAllByRole("link")).toHaveLength(8);

    for (const aba of ABAS_FINANCEIRO) {
      expect(
        screen.getByRole("link", { name: new RegExp(aba.rotulo, "i") }),
      ).toBeVisible();
    }
  });

  it("destaca aba ativa com base na rota", () => {
    montar({ pathname: "/financeiro/caixa" });
    const abaCaixa = screen.getByRole("link", { name: /Caixa/i });
    expect(abaCaixa).toHaveAttribute("aria-current", "page");

    const abaVisao = screen.getByRole("link", { name: /Visão geral/i });
    expect(abaVisao).not.toHaveAttribute("aria-current");
  });

  it("expõe o destino de cada seção", () => {
    montar({ pathname: "/financeiro" });
    expect(screen.getByRole("link", { name: /Cadastros/i })).toHaveAttribute("href", "/financeiro/cadastros");
  });

  it("mostra badge de pendentes em A receber", () => {
    montar({ pendentesReceber: 5 });
    const aba = screen.getByRole("link", { name: /A receber/i });
    expect(within(aba).getByText("5")).toBeVisible();
  });

  it("mostra badge de pendentes em A pagar", () => {
    montar({ pendentesPagar: 3 });
    const aba = screen.getByRole("link", { name: /A pagar/i });
    expect(within(aba).getByText("3")).toBeVisible();
  });

  it("mostra badge de estoque baixo em Estoque", () => {
    montar({ baixoEstoque: 7 });
    const aba = screen.getByRole("link", { name: /Estoque/i });
    expect(within(aba).getByText("7")).toBeVisible();
  });

  it("renderiza conteúdo filho", () => {
    montar();
    expect(screen.getByTestId("conteudo-filho")).toBeVisible();
    expect(screen.getByText("Conteudo da aba")).toBeVisible();
  });

  it("abas são scrolláveis horizontalmente no mobile", () => {
    montar();
    const nav = screen.getByRole("navigation", { name: /Seções financeiras/i });
    expect(nav.className).toMatch(/overflow-x-auto/);
  });

  it("não tem violações de acessibilidade", async () => {
    const { container } = montar();
    expect(await axe(container)).toHaveNoViolations();
  });
});
