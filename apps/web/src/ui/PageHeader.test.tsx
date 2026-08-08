import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { PageHeader } from "./PageHeader";

/* ── Mocks ───────────────────────────────────────────────────────────── */

vi.mock("next/navigation", () => ({
  usePathname: () => "/pacientes",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/* ── Testes ──────────────────────────────────────────────────────────── */

describe("PageHeader", () => {
  it("renderiza titulo", () => {
    render(<PageHeader titulo="Pacientes" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Pacientes" }),
    ).toBeInTheDocument();
  });

  it("renderiza subtitulo quando fornecido", () => {
    render(<PageHeader titulo="T" subtitulo="Sub" />);
    expect(screen.getByText("Sub")).toBeInTheDocument();
  });

  it("nao renderiza subtitulo quando omitido", () => {
    render(<PageHeader titulo="T" />);
    // Deve haver somente o h1 como filho de texto direto, sem paragrafo de subtitulo
    const heading = screen.getByRole("heading", { level: 1 });
    const container = heading.closest("div")!.parentElement!;
    expect(container.querySelector("p")).toBeNull();
  });

  it("renderiza acoes quando fornecidas", () => {
    render(<PageHeader titulo="T" acoes={<button>Acao</button>} />);
    expect(screen.getByRole("button", { name: "Acao" })).toBeInTheDocument();
  });

  it("renderiza breadcrumb por padrao", () => {
    render(<PageHeader titulo="T" />);
    expect(
      screen.getByRole("navigation", { name: "Navegacao estrutural" }),
    ).toBeInTheDocument();
  });

  it("esconde breadcrumb quando semBreadcrumb=true", () => {
    render(<PageHeader titulo="T" semBreadcrumb />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("passa itens de breadcrumb customizados", () => {
    render(
      <PageHeader
        titulo="Detalhe"
        breadcrumbs={[
          { rotulo: "Pacientes", href: "/pacientes" },
          { rotulo: "Maria Silva" },
        ]}
      />,
    );
    expect(screen.getByText("Pacientes")).toBeInTheDocument();
    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
  });

  it("aceita className customizado", () => {
    render(<PageHeader titulo="T" className="mt-8" />);
    const heading = screen.getByRole("heading", { level: 1 });
    const wrapper = heading.closest("div")!.parentElement!.parentElement!;
    expect(wrapper.classList.contains("mt-8")).toBe(true);
  });

  it("titulo e subtitulo empilham e acoes ficam a direita", () => {
    render(
      <PageHeader
        titulo="Pacientes"
        subtitulo="124 pacientes cadastrados"
        acoes={<button>Novo</button>}
      />,
    );
    // Verifica que o h1 e p estao dentro do mesmo div
    const h1 = screen.getByRole("heading", { level: 1 });
    const subtitulo = screen.getByText("124 pacientes cadastrados");
    expect(h1.parentElement).toBe(subtitulo.parentElement);

    // Verifica que o botao de acao esta presente
    expect(screen.getByRole("button", { name: "Novo" })).toBeInTheDocument();
  });

  it("nao tem violacoes de acessibilidade", async () => {
    const { container } = render(
      <PageHeader
        titulo="Teste"
        subtitulo="Subtitulo de teste"
        acoes={<button>Acao</button>}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
