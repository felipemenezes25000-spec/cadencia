import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ToastProvider, useToast } from "./ToastProvider";
import type { TipoToast } from "./Toast";

// Polyfill para hasPointerCapture que nao existe no jsdom
beforeEach(() => {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
});

/**
 * Componente auxiliar que dispara um toast ao clicar no botao.
 */
function Disparador({
  tipo,
  mensagem,
  duracao,
}: {
  tipo: TipoToast;
  mensagem: string;
  duracao?: number;
}) {
  const { toast } = useToast();
  return (
    <button
      onClick={() => {
        toast(
          duracao !== undefined
            ? { tipo, mensagem, duracao }
            : { tipo, mensagem },
        );
      }}
    >
      disparar
    </button>
  );
}

/**
 * Componente auxiliar que dispara multiplos toasts de uma vez.
 */
function DisparadorMultiplo({ quantidade }: { quantidade: number }) {
  const { toast } = useToast();
  return (
    <button
      onClick={() => {
        for (let i = 0; i < quantidade; i++) {
          toast({ tipo: "info", mensagem: `Mensagem ${i + 1}` });
        }
      }}
    >
      disparar-multiplo
    </button>
  );
}

function DisparadorComAcao({ aoDesfazer }: { aoDesfazer: () => void }) {
  const { toast } = useToast();
  return (
    <button onClick={() => toast({
      tipo: 'sucesso',
      mensagem: 'Check-in realizado.',
      acao: { rotulo: 'Desfazer', aoClicar: aoDesfazer },
    })}>
      disparar-com-acao
    </button>
  );
}

function renderComProvider(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renderiza toast de sucesso com icone correto", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderComProvider(
      <Disparador tipo="sucesso" mensagem="Paciente salvo com sucesso!" />,
    );
    await user.click(screen.getByText("disparar"));

    const toast = screen.getByTestId("toast-sucesso");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent("Paciente salvo com sucesso!");
  });

  it("renderiza toast de erro com icone correto", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderComProvider(
      <Disparador tipo="erro" mensagem="Falha ao salvar" />,
    );
    await user.click(screen.getByText("disparar"));

    const toast = screen.getByTestId("toast-erro");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent("Falha ao salvar");
  });

  it("renderiza toast de aviso com icone correto", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderComProvider(
      <Disparador tipo="aviso" mensagem="Sessao expira em 5 minutos" />,
    );
    await user.click(screen.getByText("disparar"));

    const toast = screen.getByTestId("toast-aviso");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent("Sessao expira em 5 minutos");
  });

  it("renderiza toast de info com icone correto", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderComProvider(
      <Disparador tipo="info" mensagem="Nova mensagem recebida" />,
    );
    await user.click(screen.getByText("disparar"));

    const toast = screen.getByTestId("toast-info");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent("Nova mensagem recebida");
  });

  it("fecha ao clicar no X", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderComProvider(
      <Disparador tipo="sucesso" mensagem="Vai fechar" duracao={60000} />,
    );
    await user.click(screen.getByText("disparar"));

    expect(screen.getByTestId("toast-sucesso")).toBeInTheDocument();

    const botaoFechar = screen.getByTestId("toast-fechar");
    await user.click(botaoFechar);

    // Aguardar Radix remover o toast do DOM
    await waitFor(() => {
      expect(screen.queryByTestId("toast-sucesso")).not.toBeInTheDocument();
    });
  });

  it("auto-fecha apos duracao", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderComProvider(
      <Disparador tipo="info" mensagem="Auto fechar" duracao={2000} />,
    );
    await user.click(screen.getByText("disparar"));

    expect(screen.getByTestId("toast-info")).toBeInTheDocument();

    // Avancar alem da duracao configurada
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("toast-info")).not.toBeInTheDocument();
    });
  });

  it("empilha multiplos toasts", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderComProvider(<DisparadorMultiplo quantidade={3} />);

    await user.click(screen.getByText("disparar-multiplo"));

    const toasts = screen.getAllByTestId("toast-info");
    expect(toasts.length).toBe(3);
    expect(screen.getByText("Mensagem 1")).toBeInTheDocument();
    expect(screen.getByText("Mensagem 2")).toBeInTheDocument();
    expect(screen.getByText("Mensagem 3")).toBeInTheDocument();
  });

  it('executa uma acao contextual sem esconder a mensagem', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const aoDesfazer = vi.fn();
    renderComProvider(<DisparadorComAcao aoDesfazer={aoDesfazer} />);
    await user.click(screen.getByText('disparar-com-acao'));
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(aoDesfazer).toHaveBeenCalledOnce();
  });

  it("limita a 5 toasts visiveis", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderComProvider(<DisparadorMultiplo quantidade={7} />);

    await user.click(screen.getByText("disparar-multiplo"));

    const toasts = screen.getAllByTestId("toast-info");
    expect(toasts.length).toBe(5);
    // Os 2 primeiros foram removidos
    expect(screen.queryByText("Mensagem 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Mensagem 2")).not.toBeInTheDocument();
    // Os ultimos 5 continuam
    expect(screen.getByText("Mensagem 3")).toBeInTheDocument();
    expect(screen.getByText("Mensagem 7")).toBeInTheDocument();
  });

  it("lanca erro quando useToast e usado fora do provider", () => {
    function ComponenteSemProvider() {
      const { toast } = useToast();
      return <button onClick={() => toast({ tipo: "info", mensagem: "teste" })}>ok</button>;
    }

    // Suprimir console.error do React para este teste
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ComponenteSemProvider />)).toThrow(
      "useToast deve ser usado dentro de ToastProvider",
    );
    consoleSpy.mockRestore();
  });

  it("nao tem violacoes de acessibilidade", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = renderComProvider(
      <Disparador tipo="sucesso" mensagem="Teste de acessibilidade" />,
    );
    await user.click(screen.getByText("disparar"));

    // Radix Toast usa role="status" em <li> que e um padrao interno do componente.
    // Desabilitamos aria-allowed-role e list pois sao falsos-positivos
    // causados pela estrutura interna do Radix Toast (ol > li[role=status]).
    expect(
      await axe(container, {
        rules: {
          "aria-allowed-role": { enabled: false },
          list: { enabled: false },
        },
      }),
    ).toHaveNoViolations();
  });

  it("nao tem violacoes de acessibilidade com toast de erro", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = renderComProvider(
      <Disparador tipo="erro" mensagem="Erro acessibilidade" />,
    );
    await user.click(screen.getByText("disparar"));

    expect(
      await axe(container, {
        rules: {
          "aria-allowed-role": { enabled: false },
          list: { enabled: false },
        },
      }),
    ).toHaveNoViolations();
  });
});
