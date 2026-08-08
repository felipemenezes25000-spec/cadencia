import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Users, FileText } from "@phosphor-icons/react";
import { EstadoVazio } from "./EstadoVazio";

describe("EstadoVazio", () => {
  it("renderiza icone e titulo", () => {
    const { container } = render(
      <EstadoVazio icone={Users} titulo="Nenhum paciente encontrado" />,
    );
    expect(
      screen.getByText("Nenhum paciente encontrado"),
    ).toBeInTheDocument();
    // Icone renderiza como SVG decorativo
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renderiza descricao quando fornecida", () => {
    render(
      <EstadoVazio
        icone={Users}
        titulo="Nenhum paciente"
        descricao="Adicione seu primeiro paciente"
      />,
    );
    expect(
      screen.getByText("Adicione seu primeiro paciente"),
    ).toBeInTheDocument();
  });

  it("renderiza acao quando fornecida", () => {
    render(
      <EstadoVazio
        icone={Users}
        titulo="Nenhum paciente"
        acao={<button type="button">Novo paciente</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Novo paciente" }),
    ).toBeInTheDocument();
  });

  it("renderiza versao compacta com classes menores", () => {
    const { container } = render(
      <EstadoVazio
        icone={FileText}
        titulo="Nenhum registro"
        compacto
      />,
    );
    // Compacto usa py-8 em vez de py-16
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains("py-8")).toBe(true);
    expect(wrapper.classList.contains("py-16")).toBe(false);
  });

  it("nao renderiza descricao quando omitida", () => {
    const { container } = render(
      <EstadoVazio icone={Users} titulo="Nenhum paciente" />,
    );
    // Deve haver apenas o titulo (p com font-medium) e nao um segundo p
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.textContent).toBe("Nenhum paciente");
  });

  it("nao renderiza acao quando omitida", () => {
    const { container } = render(
      <EstadoVazio icone={Users} titulo="Nenhum paciente" />,
    );
    // Nao deve haver div.mt-4 (wrapper da acao)
    expect(container.querySelector(".mt-4")).toBeNull();
  });

  it("aceita className adicional", () => {
    const { container } = render(
      <EstadoVazio
        icone={Users}
        titulo="Teste"
        className="custom-class"
      />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains("custom-class")).toBe(true);
  });

  it("nao tem violacoes de acessibilidade", async () => {
    const { container } = render(
      <EstadoVazio
        icone={Users}
        titulo="Nenhum paciente encontrado"
        descricao="Ajuste os filtros ou adicione um novo paciente"
        acao={<button type="button">Novo paciente</button>}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("nao tem violacoes de acessibilidade (compacto)", async () => {
    const { container } = render(
      <EstadoVazio
        icone={FileText}
        titulo="Nenhum registro"
        compacto
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
