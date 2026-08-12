import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renderiza variante text por padrão", () => {
    render(<Skeleton />);
    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass("rounded-md");
  });

  it("renderiza variante avatar como círculo", () => {
    render(<Skeleton variant="avatar" />);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("rounded-full");
  });

  it("renderiza variante card", () => {
    render(<Skeleton variant="card" />);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("rounded-md");
  });

  it("renderiza variante table-row com 3 pseudo-colunas", () => {
    render(<Skeleton variant="table-row" />);
    const el = screen.getByRole("status");
    // Container flex com 3 filhos
    expect(el.children).toHaveLength(3);
  });

  it("renderiza múltiplas linhas para variante text", () => {
    render(<Skeleton variant="text" lines={3} />);
    const el = screen.getByRole("status");
    // 3 barras de shimmer como filhos
    expect(el.children).toHaveLength(3);
  });

  it("última linha de múltiplas linhas tem largura reduzida", () => {
    render(<Skeleton variant="text" lines={4} />);
    const el = screen.getByRole("status");
    const lastChild = el.children[3] as HTMLElement;
    expect(lastChild).toHaveClass("w-3/4");
  });

  it("aceita className customizado", () => {
    render(<Skeleton className="mt-8" />);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("mt-8");
  });

  it("tem aria-busy=true", () => {
    render(<Skeleton />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-busy", "true");
  });

  it("tem aria-label padrão 'Carregando...'", () => {
    render(<Skeleton />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-label", "Carregando...");
  });

  it("aceita aria-label customizado", () => {
    render(<Skeleton ariaLabel="Carregando dados do paciente..." />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-label", "Carregando dados do paciente...");
  });

  it("aplica width e height customizados via style", () => {
    render(<Skeleton width="200px" height="32px" />);
    const el = screen.getByRole("status");
    expect(el).toHaveStyle({ width: "200px", height: "32px" });
  });

  it("avatar aceita width customizado via style", () => {
    render(<Skeleton variant="avatar" width="64px" />);
    const el = screen.getByRole("status");
    expect(el).toHaveStyle({ width: "64px" });
  });

  it("não tem violações de acessibilidade", async () => {
    const { container } = render(<Skeleton />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("não tem violações de acessibilidade (variante avatar)", async () => {
    const { container } = render(<Skeleton variant="avatar" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("não tem violações de acessibilidade (múltiplas linhas)", async () => {
    const { container } = render(<Skeleton variant="text" lines={3} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("não tem violações de acessibilidade (table-row)", async () => {
    const { container } = render(<Skeleton variant="table-row" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
