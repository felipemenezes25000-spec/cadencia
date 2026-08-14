// apps/web/src/telas/ConveniosLayout.test.tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import {
  ConveniosLayout,
  type ContadoresConvenios,
} from "./ConveniosLayout";

/* ── Mocks ──────────────────────────────────────────────────────────── */

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/convenios",
  useRouter: () => ({ push: mockPush }),
}));

const CONTADORES: ContadoresConvenios = {
  guiasAFaturar: 14,
  lotesRascunho: 2,
  lotesEnviados: 5,
  pendencias: 3,
  glosasPendentes: 8,
  recursosRascunho: 1,
};

function montar(contadores?: ContadoresConvenios) {
  const aoFiltrar = vi.fn();
  render(
    <ConveniosLayout
      contadores={contadores ?? CONTADORES}
      aoFiltrar={aoFiltrar}
    >
      <div data-testid="conteudo-filho">Conteudo da sub-aba</div>
    </ConveniosLayout>,
  );
  return { aoFiltrar };
}

describe("ConveniosLayout", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("renderiza todas as 6 abas", () => {
    montar();
    expect(screen.getAllByRole("link")).toHaveLength(6);
  });

  it("destaca aba ativa", () => {
    montar();
    const abaAtiva = screen.getByRole("link", { name: /A faturar/i });
    expect(abaAtiva).toHaveAttribute("aria-current", "page");
  });

  it("expõe o destino da seção", () => {
    montar();
    expect(screen.getByRole("link", { name: /Lotes/i })).toHaveAttribute("href", "/convenios/lotes");
  });

  it("mostra badges de contagem nas abas", () => {
    montar();
    // Badges aparecem nos tabs (dentro do tablist)
    const navegacao = screen.getByRole("navigation", { name: /Seções de convênios/i });
    const dentroTablist = within(navegacao);
    // A faturar badge: 14
    expect(dentroTablist.getByText("14")).toBeVisible();
    // Glosas badge: 8
    expect(dentroTablist.getByText("8")).toBeVisible();
    // Retornos badge: 3
    expect(dentroTablist.getByText("3")).toBeVisible();
  });

  it("renderiza a faixa de contadores com os 6 valores", () => {
    montar();
    const grupo = screen.getByRole("group", { name: /Contadores de convênios/i });
    expect(grupo).toBeVisible();
    // Verifica que os valores dos contadores estão no grupo
    const dentro = within(grupo);
    expect(dentro.getByText("14")).toBeVisible();
    expect(dentro.getByText("2")).toBeVisible();
    expect(dentro.getByText("5")).toBeVisible();
    expect(dentro.getByText("3")).toBeVisible();
    expect(dentro.getByText("8")).toBeVisible();
    expect(dentro.getByText("1")).toBeVisible();
  });

  it("rótulos dos contadores incluem glosas pendentes e recursos rascunho", () => {
    montar();
    expect(screen.getByText(/Guias a faturar/i)).toBeVisible();
    expect(screen.getByText(/Lotes em rascunho/i)).toBeVisible();
    expect(screen.getByText(/Lotes enviados/i)).toBeVisible();
    expect(screen.getByText(/Pendências/i)).toBeVisible();
    expect(screen.getByText(/Glosas pendentes/i)).toBeVisible();
    expect(screen.getByText(/Recursos em rascunho/i)).toBeVisible();
  });

  it("ao clicar em um contador chama aoFiltrar com a chave correta", async () => {
    const { aoFiltrar } = montar();
    await userEvent.click(screen.getByRole("button", { name: /Glosas pendentes/i }));
    expect(aoFiltrar).toHaveBeenCalledWith("glosasPendentes");
  });

  it("renderiza o conteúdo filho dentro do container", () => {
    montar();
    expect(screen.getByTestId("conteudo-filho")).toBeVisible();
  });

  it("sem violação de acessibilidade", async () => {
    const { container } = render(
      <ConveniosLayout
        contadores={CONTADORES}
        aoFiltrar={() => {}}
      >
        <div>Conteudo</div>
      </ConveniosLayout>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
