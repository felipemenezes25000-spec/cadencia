import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Breadcrumb } from "./Breadcrumb";

/* ── Mocks ───────────────────────────────────────────────────────────── */

let mockPathname = "/financeiro/caixa";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
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

describe("Breadcrumb", () => {
  it("renderiza itens manuais", () => {
    render(
      <Breadcrumb
        itens={[
          { rotulo: "Financeiro", href: "/financeiro" },
          { rotulo: "Caixa" },
        ]}
      />,
    );
    expect(screen.getByText("Financeiro")).toBeInTheDocument();
    expect(screen.getByText("Caixa")).toBeInTheDocument();
  });

  it("ultimo item nao e link", () => {
    render(
      <Breadcrumb
        itens={[
          { rotulo: "Pacientes", href: "/pacientes" },
          { rotulo: "Maria Silva" },
        ]}
      />,
    );
    const ultimoItem = screen.getByText("Maria Silva");
    // O ultimo item deve ser um <span>, nao um <a>
    expect(ultimoItem.tagName).toBe("SPAN");
    expect(ultimoItem.closest("a")).toBeNull();
  });

  it("ultimo item tem aria-current=page", () => {
    render(
      <Breadcrumb
        itens={[
          { rotulo: "Financeiro", href: "/financeiro" },
          { rotulo: "Caixa" },
        ]}
      />,
    );
    const ultimoItem = screen.getByText("Caixa");
    expect(ultimoItem).toHaveAttribute("aria-current", "page");
  });

  it("renderiza separadores entre itens", () => {
    const { container } = render(
      <Breadcrumb
        itens={[
          { rotulo: "Financeiro", href: "/financeiro" },
          { rotulo: "Caixa", href: "/financeiro/caixa" },
          { rotulo: "Detalhe" },
        ]}
      />,
    );
    // Para 3 itens, devem existir 2 separadores (SVGs do icone CaretRight)
    const separadores = container.querySelectorAll("svg");
    expect(separadores).toHaveLength(2);
  });

  it("itens intermediarios sao links", () => {
    render(
      <Breadcrumb
        itens={[
          { rotulo: "Financeiro", href: "/financeiro" },
          { rotulo: "Caixa", href: "/financeiro/caixa" },
          { rotulo: "Detalhe" },
        ]}
      />,
    );
    const linkFinanceiro = screen.getByText("Financeiro").closest("a");
    expect(linkFinanceiro).not.toBeNull();
    expect(linkFinanceiro).toHaveAttribute("href", "/financeiro");

    const linkCaixa = screen.getByText("Caixa").closest("a");
    expect(linkCaixa).not.toBeNull();
    expect(linkCaixa).toHaveAttribute("href", "/financeiro/caixa");
  });

  it("tem aria-label=Navegacao estrutural", () => {
    render(<Breadcrumb itens={[{ rotulo: "Teste" }]} />);
    expect(
      screen.getByRole("navigation", { name: "Navegacao estrutural" }),
    ).toBeInTheDocument();
  });

  it("usa ol para estrutura semantica", () => {
    const { container } = render(
      <Breadcrumb itens={[{ rotulo: "Teste" }]} />,
    );
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
  });

  it("auto-gera itens a partir da rota quando itens nao e fornecido", () => {
    mockPathname = "/financeiro/caixa";
    render(<Breadcrumb />);
    expect(screen.getByText("Financeiro")).toBeInTheDocument();
    expect(screen.getByText("Caixa")).toBeInTheDocument();

    // Financeiro deve ser link, Caixa nao
    const linkFinanceiro = screen.getByText("Financeiro").closest("a");
    expect(linkFinanceiro).toHaveAttribute("href", "/financeiro");

    const caixa = screen.getByText("Caixa");
    expect(caixa.tagName).toBe("SPAN");
    expect(caixa).toHaveAttribute("aria-current", "page");
  });

  it("itens manuais sobreescrevem auto-geracao", () => {
    mockPathname = "/financeiro/caixa";
    render(
      <Breadcrumb
        itens={[
          { rotulo: "Pacientes", href: "/pacientes" },
          { rotulo: "Maria Silva" },
        ]}
      />,
    );
    // Deve mostrar os itens manuais, nao os auto-gerados
    expect(screen.getByText("Pacientes")).toBeInTheDocument();
    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.queryByText("Financeiro")).not.toBeInTheDocument();
    expect(screen.queryByText("Caixa")).not.toBeInTheDocument();
  });

  it("retorna null quando nao ha itens", () => {
    mockPathname = "/";
    const { container } = render(<Breadcrumb />);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("aceita className customizado", () => {
    render(
      <Breadcrumb itens={[{ rotulo: "Teste" }]} className="mt-4" />,
    );
    const nav = screen.getByRole("navigation");
    expect(nav.classList.contains("mt-4")).toBe(true);
  });

  it("nao tem violacoes de acessibilidade", async () => {
    const { container } = render(
      <Breadcrumb
        itens={[
          { rotulo: "Home", href: "/" },
          { rotulo: "Atual" },
        ]}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
