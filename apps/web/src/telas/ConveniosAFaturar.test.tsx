// apps/web/src/telas/ConveniosAFaturar.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import {
  ConveniosAFaturar,
  type GuiaPendente,
  type AFaturarDados,
  type FiltrosAFaturar,
} from "./ConveniosAFaturar";

const GUIAS: readonly GuiaPendente[] = [
  {
    id: "g1",
    numeroGuia: "000001",
    pacienteNome: "Maria Souza",
    operadoraId: '00000000-0000-4000-8000-0000000000aa',
    operadoraNome: "Unimed",
    registroAns: "123456",
    codigoProcedimento: "10101012",
    nomeProcedimento: "Consulta",
    valorCentavos: 15000,
    dataAtendimento: "2026-08-01",
    status: "completa",
  },
  {
    id: "g2",
    numeroGuia: "000002",
    pacienteNome: "Joao Silva",
    operadoraId: '00000000-0000-4000-8000-0000000000aa',
    operadoraNome: "Bradesco Saude",
    registroAns: "654321",
    codigoProcedimento: "10101012",
    nomeProcedimento: "Consulta",
    valorCentavos: 18000,
    dataAtendimento: "2026-08-02",
    status: "incompleta",
  },
  {
    id: "g3",
    numeroGuia: "000003",
    pacienteNome: "Ana Costa",
    operadoraId: '00000000-0000-4000-8000-0000000000aa',
    operadoraNome: "Unimed",
    registroAns: "123456",
    codigoProcedimento: "20201015",
    nomeProcedimento: "Retorno",
    valorCentavos: 0,
    dataAtendimento: "2026-08-03",
    status: "completa",
  },
];

const DADOS: AFaturarDados = {
  guias: GUIAS,
  operadoras: [
    { id: "op1", nome: "Unimed", registroAns: "123456" },
    { id: "op2", nome: "Bradesco Saude", registroAns: "654321" },
  ],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async (_f: FiltrosAFaturar) => DADOS),
    aoCriarLote: vi.fn(async (_ids: readonly string[]) => {}),
    aoAbrirGuia: vi.fn((_id: string) => {}),
  };
  render(<ConveniosAFaturar {...props} />);
  return props;
}

describe("ConveniosAFaturar", () => {
  it("renderiza tabela de guias", async () => {
    montar();
    await waitFor(() => expect(screen.getByText("Maria Souza")).toBeVisible());
    expect(screen.getByText("Joao Silva")).toBeVisible();
    expect(screen.getByText("Ana Costa")).toBeVisible();
  });

  it("exibe o numero da guia em fonte mono", async () => {
    montar();
    await waitFor(() => expect(screen.getByText("000001")).toBeVisible());
    const el = screen.getByText("000001");
    expect(el.className).toContain("font-mono");
  });

  it("renderiza ChipDeStatusTiss correto", async () => {
    montar();
    await waitFor(() => expect(screen.getByText("Joao Silva")).toBeVisible());
    // Encontra o chip dentro da tabela (nao no select de filtro)
    const tabela = screen.getByRole("table");
    const dentroTabela = within(tabela);
    // A guia incompleta deve renderizar o chip "Incompleta"
    expect(dentroTabela.getByText(/Incompleta/i)).toBeVisible();
    // As guias completas devem renderizar o chip "Completa"
    expect(dentroTabela.getAllByText(/Completa/i).length).toBeGreaterThanOrEqual(1);
  });

  it("seleciona guia ao clicar checkbox", async () => {
    montar();
    await waitFor(() => expect(screen.getByText("Maria Souza")).toBeVisible());
    const checkboxes = screen.getAllByRole("checkbox");
    // Primeiro checkbox e o "selecionar todas", entao guias comecam no indice 1
    const checkboxGuia1 = checkboxes[1]!;
    await userEvent.click(checkboxGuia1);
    expect(checkboxGuia1).toBeChecked();
  });

  it("seleciona todas ao clicar checkbox do cabecalho", async () => {
    montar();
    await waitFor(() => expect(screen.getByText("Maria Souza")).toBeVisible());
    const selectAll = screen.getByRole("checkbox", {
      name: /Selecionar todas/i,
    });
    await userEvent.click(selectAll);
    // Todas as checkboxes de guia devem estar marcadas
    const guiaCheckboxes = screen.getAllByRole("checkbox").filter(
      (cb) => cb.getAttribute("aria-label") !== "Selecionar todas",
    );
    for (const cb of guiaCheckboxes) {
      expect(cb).toBeChecked();
    }
  });

  it("mostra barra de acoes com contagem de selecionados", async () => {
    montar();
    await waitFor(() => expect(screen.getByText("Maria Souza")).toBeVisible());
    // Barra de acoes nao deve existir sem selecao
    expect(screen.queryByText(/guia selecionada/i)).not.toBeInTheDocument();
    // Selecionar uma guia
    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[1]!);
    expect(screen.getByText(/1 guia selecionada/i)).toBeVisible();
    // Selecionar mais uma
    await userEvent.click(checkboxes[2]!);
    expect(screen.getByText(/2 guias selecionadas/i)).toBeVisible();
  });

  it("mostra botao Criar lote quando ha selecao", async () => {
    montar();
    await waitFor(() => expect(screen.getByText("Maria Souza")).toBeVisible());
    expect(
      screen.queryByRole("button", { name: /Criar lote/i }),
    ).not.toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[1]!);
    expect(screen.getByRole("button", { name: /Criar lote/i })).toBeVisible();
  });

  it("ao clicar Criar lote chama aoCriarLote com os ids e a operadora", async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText("Maria Souza")).toBeVisible());
    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[1]!); // g1
    await userEvent.click(checkboxes[3]!); // g3
    const botao = screen.getByRole("button", { name: /Criar lote/i });
    await userEvent.click(botao);
    // A operadora vai junto: `POST /v1/tiss/lotes` exige `operadoraId` uuid, e a
    // tela mandava `null`. Um lote pertence a uma operadora — e dela o
    // webservice que recebe o XML.
    expect(props.aoCriarLote).toHaveBeenCalledWith(
      ["g1", "g3"], "00000000-0000-4000-8000-0000000000aa");
  });

  it("ao clicar no nome do paciente chama aoAbrirGuia com o id", async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText("Maria Souza")).toBeVisible());
    await userEvent.click(screen.getByText("Maria Souza"));
    expect(props.aoAbrirGuia).toHaveBeenCalledWith("g1");
  });

  it("tem filtro por operadora", async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByLabelText(/Operadora/i)).toBeVisible(),
    );
  });

  it("tem filtro por periodo", async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByLabelText(/Período início/i)).toBeVisible(),
    );
    expect(screen.getByLabelText(/Período fim/i)).toBeVisible();
  });

  it("tem filtro por status (completa/incompleta)", async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByLabelText(/Status/i)).toBeVisible(),
    );
  });

  it("valores exibidos em fonte mono com tabular-nums", async () => {
    montar();
    await waitFor(() => expect(screen.getByText("Maria Souza")).toBeVisible());
    const valor = screen.getByText("R$ 150,00");
    expect(valor.className).toContain("font-mono");
    expect(valor.className).toContain("tabular-nums");
  });

  it("nao tem violacoes de acessibilidade", async () => {
    const { container } = render(
      <ConveniosAFaturar
        carregarDados={async () => DADOS}
        aoCriarLote={async () => {}}
        aoAbrirGuia={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("Maria Souza")).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
