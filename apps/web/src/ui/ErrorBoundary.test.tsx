import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ErrorBoundary } from "./ErrorBoundary";

// Silencia console.error durante os testes de erro
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// Componente que lanca erro sob demanda
let shouldThrow = false;
function ComponenteQueLancaErro() {
  if (shouldThrow) {
    throw new Error("Erro de teste");
  }
  return <p>OK</p>;
}

// Componente que sempre lanca erro
function SempreLancaErro(): never {
  throw new Error("Erro permanente");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    shouldThrow = false;
  });

  it("renderiza children quando nao ha erro", () => {
    render(
      <ErrorBoundary>
        <p>Conteudo normal</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Conteudo normal")).toBeInTheDocument();
  });

  it("renderiza fallback quando filho lanca erro", () => {
    render(
      <ErrorBoundary>
        <SempreLancaErro />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Algo deu errado")).toBeInTheDocument();
  });

  it("mostra botao Tentar novamente", () => {
    render(
      <ErrorBoundary>
        <SempreLancaErro />
      </ErrorBoundary>,
    );
    expect(
      screen.getByRole("button", { name: /tentar novamente/i }),
    ).toBeInTheDocument();
  });

  it("reseta erro ao clicar Tentar novamente", async () => {
    const user = userEvent.setup();
    shouldThrow = true;

    render(
      <ErrorBoundary>
        <ComponenteQueLancaErro />
      </ErrorBoundary>,
    );

    // Verifica que o fallback esta sendo exibido
    expect(screen.getByText("Algo deu errado")).toBeInTheDocument();

    // Reseta o flag antes de clicar
    shouldThrow = false;

    // Clica em "Tentar novamente"
    await user.click(screen.getByRole("button", { name: /tentar novamente/i }));

    // Deve renderizar o conteudo novamente
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("chama onError callback", () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <SempreLancaErro />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });

  it("renderiza fallback customizado quando fornecido", () => {
    const fallbackCustomizado = <div>Fallback personalizado</div>;

    render(
      <ErrorBoundary fallback={fallbackCustomizado}>
        <SempreLancaErro />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Fallback personalizado")).toBeInTheDocument();
    expect(screen.queryByText("Algo deu errado")).not.toBeInTheDocument();
  });

  it("mostra mensagem descritiva no fallback padrao", () => {
    render(
      <ErrorBoundary>
        <SempreLancaErro />
      </ErrorBoundary>,
    );
    expect(
      screen.getByText(/ocorreu um erro inesperado/i),
    ).toBeInTheDocument();
  });

  it("nao tem violacoes de acessibilidade (estado normal)", async () => {
    const { container } = render(
      <ErrorBoundary>
        <p>Conteudo acessivel</p>
      </ErrorBoundary>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("nao tem violacoes de acessibilidade (estado de erro)", async () => {
    const { container } = render(
      <ErrorBoundary>
        <SempreLancaErro />
      </ErrorBoundary>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
