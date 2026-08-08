import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./Tabs";

describe("Tabs", () => {
  it("renderiza tab ativa por padrao (defaultValue)", () => {
    render(
      <Tabs defaultValue="resumo">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="historico">Historico</TabsTrigger>
        </TabsList>
        <TabsContent value="resumo">Conteudo Resumo</TabsContent>
        <TabsContent value="historico">Conteudo Historico</TabsContent>
      </Tabs>,
    );

    // Conteudo da tab ativa deve estar visivel
    expect(screen.getByText("Conteudo Resumo")).toBeInTheDocument();
    // Conteudo da tab inativa nao deve estar visivel
    expect(screen.queryByText("Conteudo Historico")).not.toBeInTheDocument();
  });

  it("muda conteudo ao clicar em outra tab", async () => {
    const user = userEvent.setup();

    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Conteudo A</TabsContent>
        <TabsContent value="b">Conteudo B</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("Conteudo A")).toBeInTheDocument();
    expect(screen.queryByText("Conteudo B")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Tab B" }));

    expect(screen.queryByText("Conteudo A")).not.toBeInTheDocument();
    expect(screen.getByText("Conteudo B")).toBeInTheDocument();
  });

  it("navega com ArrowRight/ArrowLeft", async () => {
    const user = userEvent.setup();

    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
          <TabsTrigger value="c">Tab C</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Conteudo A</TabsContent>
        <TabsContent value="b">Conteudo B</TabsContent>
        <TabsContent value="c">Conteudo C</TabsContent>
      </Tabs>,
    );

    // Focar na primeira tab
    const tabA = screen.getByRole("tab", { name: "Tab A" });
    await user.click(tabA);
    expect(tabA).toHaveFocus();

    // ArrowRight move para Tab B
    await user.keyboard("{ArrowRight}");
    const tabB = screen.getByRole("tab", { name: "Tab B" });
    expect(tabB).toHaveFocus();

    // ArrowRight move para Tab C
    await user.keyboard("{ArrowRight}");
    const tabC = screen.getByRole("tab", { name: "Tab C" });
    expect(tabC).toHaveFocus();

    // ArrowLeft volta para Tab B
    await user.keyboard("{ArrowLeft}");
    expect(tabB).toHaveFocus();
  });

  it("mostra badge quando fornecido", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" badge={5}>
            Documentos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">Conteudo</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("nao mostra badge quando valor e 0", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" badge={0}>
            Documentos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">Conteudo</TabsContent>
      </Tabs>,
    );

    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("sublinhado ativo aparece na tab correta", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Conteudo A</TabsContent>
        <TabsContent value="b">Conteudo B</TabsContent>
      </Tabs>,
    );

    const tabA = screen.getByRole("tab", { name: "Tab A" });
    const tabB = screen.getByRole("tab", { name: "Tab B" });

    // Tab ativa tem data-state=active (Radix aplica automaticamente)
    expect(tabA).toHaveAttribute("data-state", "active");
    expect(tabB).toHaveAttribute("data-state", "inactive");
  });

  it("nao tem violacoes de acessibilidade", async () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Conteudo A</TabsContent>
        <TabsContent value="b">Conteudo B</TabsContent>
      </Tabs>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
