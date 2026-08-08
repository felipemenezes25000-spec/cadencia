// apps/web/src/telas/ConveniosAFaturar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosAFaturar,
  type GuiaPendente,
  type AFaturarDados,
  type FiltrosAFaturar,
} from './ConveniosAFaturar';

const GUIAS: readonly GuiaPendente[] = [
  {
    id: 'g1', numeroGuia: '000001', pacienteNome: 'Maria Souza',
    operadoraNome: 'Unimed', registroAns: '123456',
    codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
    valorCentavos: 15000, dataAtendimento: '2026-08-01',
    status: 'completa',
  },
  {
    id: 'g2', numeroGuia: '000002', pacienteNome: 'Joao Silva',
    operadoraNome: 'Bradesco Saude', registroAns: '654321',
    codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
    valorCentavos: 18000, dataAtendimento: '2026-08-02',
    status: 'incompleta',
  },
  {
    id: 'g3', numeroGuia: '000003', pacienteNome: 'Ana Costa',
    operadoraNome: 'Unimed', registroAns: '123456',
    codigoProcedimento: '20201015', nomeProcedimento: 'Retorno',
    valorCentavos: 0, dataAtendimento: '2026-08-03',
    status: 'completa',
  },
];

const DADOS: AFaturarDados = {
  guias: GUIAS,
  operadoras: [
    { id: 'op1', nome: 'Unimed', registroAns: '123456' },
    { id: 'op2', nome: 'Bradesco Saude', registroAns: '654321' },
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

describe('ConveniosAFaturar', () => {
  it('lista as guias pendentes com paciente, operadora e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(screen.getByText('Joao Silva')).toBeVisible();
    expect(screen.getByText('Ana Costa')).toBeVisible();
    expect(screen.getByText('Unimed')).toBeVisible();
  });

  it('exibe o numero da guia em fonte mono', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('000001')).toBeVisible());
    expect(screen.getByText('000001').className).toContain('num');
  });

  it('guias incompletas tem badge de alerta', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Joao Silva')).toBeVisible());
    const linha = screen.getByText('Joao Silva').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByText(/Incompleta/i)).toBeVisible();
  });

  it('guias completas nao tem badge de incompleta', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const linha = screen.getByText('Maria Souza').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).queryByText(/Incompleta/i)).not.toBeInTheDocument();
  });

  it('cada guia tem um checkbox para selecao', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(3);
  });

  it('ao selecionar guias e clicar "Criar lote" chama aoCriarLote com os ids', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[0]!);
    await userEvent.click(checkboxes[2]!);
    const botao = screen.getByRole('button', { name: /Criar lote/i });
    await userEvent.click(botao);
    expect(props.aoCriarLote).toHaveBeenCalledWith(['g1', 'g3']);
  });

  it('botao "Criar lote" so aparece quando ha selecao', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(screen.queryByRole('button', { name: /Criar lote/i })).not.toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[0]!);
    expect(screen.getByRole('button', { name: /Criar lote/i })).toBeVisible();
  });

  it('ao clicar na linha da guia chama aoAbrirGuia com o id', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    await userEvent.click(screen.getByText('Maria Souza'));
    expect(props.aoAbrirGuia).toHaveBeenCalledWith('g1');
  });

  it('tem filtro por operadora', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Operadora/i)).toBeVisible());
  });

  it('tem filtro por periodo', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
  });

  it('tem filtro por status (completa/incompleta)', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Status/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosAFaturar
        carregarDados={async () => DADOS}
        aoCriarLote={async () => {}}
        aoAbrirGuia={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
