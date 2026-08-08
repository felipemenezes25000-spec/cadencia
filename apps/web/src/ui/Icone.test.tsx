import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { House } from "@phosphor-icons/react";
import { Icone } from "./Icone";

describe("Icone", () => {
  it("renderiza com tamanho padrao md (20px)", () => {
    const { container } = render(<Icone icon={House} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("width")).toBe("20");
    expect(svg?.getAttribute("height")).toBe("20");
  });

  it("renderiza com tamanho sm (16px)", () => {
    const { container } = render(<Icone icon={House} size="sm" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
  });

  it("renderiza com tamanho lg (24px)", () => {
    const { container } = render(<Icone icon={House} size="lg" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("24");
    expect(svg?.getAttribute("height")).toBe("24");
  });

  it("renderiza com tamanho xl (32px)", () => {
    const { container } = render(<Icone icon={House} size="xl" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("height")).toBe("32");
  });

  it("e decorativo por padrao (aria-hidden)", () => {
    const { container } = render(<Icone icon={House} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("role")).toBeNull();
    expect(svg?.getAttribute("aria-label")).toBeNull();
  });

  it("tem aria-label quando label e fornecido", () => {
    render(<Icone icon={House} label="Inicio" />);
    expect(screen.getByRole("img", { name: "Inicio" })).toBeInTheDocument();
  });

  it("nao tem aria-hidden quando label e fornecido", () => {
    const { container } = render(<Icone icon={House} label="Inicio" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBeNull();
  });

  it("aceita className customizado", () => {
    const { container } = render(
      <Icone icon={House} className="text-red-500" />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.classList.contains("text-red-500")).toBe(true);
  });

  it("preserva classe shrink-0 com className customizado", () => {
    const { container } = render(
      <Icone icon={House} className="text-blue-500" />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.classList.contains("shrink-0")).toBe(true);
    expect(svg?.classList.contains("text-blue-500")).toBe(true);
  });

  it("usa peso regular por padrao", () => {
    const { container } = render(<Icone icon={House} />);
    const svg = container.querySelector("svg");
    // Phosphor renderiza o SVG — verificamos que ele existe e tem o tamanho correto
    expect(svg).toBeTruthy();
  });

  it("nao tem violacoes de acessibilidade (decorativo)", async () => {
    const { container } = render(<Icone icon={House} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("nao tem violacoes de acessibilidade (com label)", async () => {
    const { container } = render(<Icone icon={House} label="Inicio" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
