// apps/web/src/telas/convenios-navegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroLayout } from './FinanceiroLayout';
import { ConveniosLayout, type ContadoresConvenios } from './ConveniosLayout';
import { ConveniosAFaturar, type AFaturarDados } from './ConveniosAFaturar';
import { ConveniosLotes, type LotesDados } from './ConveniosLotes';
import { ConveniosOperadoras, type OperadorasDados } from './ConveniosOperadoras';
import { ConveniosRetornos, type RetornosDados } from './ConveniosRetornos';

const CONTADORES: ContadoresConvenios = {
  guiasAFaturar: 7, lotesRascunho: 1, lotesEnviados: 3, pendencias: 2,
  glosasPendentes: 4, recursosRascunho: 1,
};

const DADOS_FATURAR: AFaturarDados = {
  guias: [
    {
      id: 'g1', numeroGuia: '000001', pacienteNome: 'Carlos Melo',
      operadoraNome: 'Unimed', registroAns: '123456',
      codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
      valorCentavos: 15000, dataAtendimento: '2026-08-01', status: 'completa',
    },
  ],
  operadoras: [{ id: 'op1', nome: 'Unimed', registroAns: '123456' }],
};

const DADOS_LOTES: LotesDados = {
  lotes: [
    {
      id: 'l1', numero: 'L-001', operadoraNome: 'Unimed',
      registroAns: '123456', status: 'rascunho',
      totalGuias: 3, totalCentavos: 45000,
      criadoEm: '2026-08-05', enviadoEm: null, guias: [],
    },
  ],
};

const DADOS_OPERADORAS: OperadorasDados = {
  operadoras: [
    {
      id: 'op1', nome: 'Unimed', registroAns: '123456',
      versaoTiss: '4.01.00', cnpj: 'AB1234567890CD',
      email: null, telefone: null, ativa: true, totalPacientes: 10,
    },
  ],
};

const DADOS_RETORNOS: RetornosDados = {
  demonstrativos: [
    {
      id: 'd1', operadoraNome: 'Unimed', operadoraId: 'op1',
      registroAns: '123456', protocolo: 'PROT-001', tipo: 'analise',
      dataImportacao: '2026-08-01', periodoInicio: '2026-07-01',
      periodoFim: '2026-07-31', totalApresentadoCentavos: 500000,
      totalProcessadoCentavos: 480000, totalLiberadoCentavos: 450000,
      totalGlosadoCentavos: 30000, totalItens: 15, itensGlosados: 3,
    },
  ],
  operadoras: [{ id: 'op1', nome: 'Unimed', registroAns: '123456' }],
  totais: {
    apresentadoCentavos: 500000, processadoCentavos: 480000,
    liberadoCentavos: 450000, glosadoCentavos: 30000,
  },
};

describe('Navegacao completa: Financeiro > Convenios', () => {
  it('renderiza FinanceiroLayout com aba Convenios ativa contendo ConveniosLayout', () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <div data-testid="conteudo-afaturar">Fila</div>
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: /Financeiro/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /Convenios/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: /Convenios/ })).toBeVisible();
    expect(screen.getByText('7')).toBeVisible();
    expect(screen.getByTestId('conteudo-afaturar')).toBeVisible();
  });

  it('sub-aba A faturar renderiza lista de guias', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosAFaturar
            carregarDados={async () => DADOS_FATURAR}
            aoCriarLote={async () => {}}
            aoAbrirGuia={() => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('Carlos Melo')).toBeVisible());
    expect(screen.getByText('000001')).toBeVisible();
  });

  it('sub-aba Lotes renderiza lista de lotes', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="lotes" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosLotes
            carregarDados={async () => DADOS_LOTES}
            aoEnviar={async () => {}}
            aoCancelar={async () => {}}
            aoBaixarXml={async () => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('L-001')).toBeVisible());
    expect(screen.getByText('Rascunho')).toBeVisible();
  });

  it('sub-aba Operadoras renderiza lista de operadoras', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="operadoras" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosOperadoras
            carregarDados={async () => DADOS_OPERADORAS}
            aoSalvar={async () => {}}
            aoDesativar={async () => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByRole('button', { name: /Nova operadora/i })).toBeVisible();
  });

  it('sub-aba Retornos renderiza lista de demonstrativos', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="retornos" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosRetornos
            carregarDados={async () => DADOS_RETORNOS}
            aoImportarXml={async () => {}}
            aoAbrirDemonstrativo={() => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('PROT-001')).toBeVisible());
    expect(screen.getByRole('link', { name: /Retornos/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Importar/i })).toBeVisible();
  });

  it('contadores da faixa incluem glosas pendentes e recursos rascunho', () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <div>Conteudo</div>
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    expect(screen.getByText(/Glosas pendentes/i)).toBeVisible();
    expect(screen.getByText(/Recursos rascunho/i)).toBeVisible();
    expect(screen.getByText('4')).toBeVisible();
  });

  it('contadores da faixa sao botoes clicaveis', async () => {
    const aoFiltrar = vi.fn();
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={aoFiltrar}
        >
          <div>Conteudo</div>
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Glosas pendentes/i }));
    expect(aoFiltrar).toHaveBeenCalledWith('glosasPendentes');
  });

  it('sem violacao de acessibilidade na composicao com Retornos', async () => {
    const { container } = render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="retornos" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosRetornos
            carregarDados={async () => DADOS_RETORNOS}
            aoImportarXml={async () => {}}
            aoAbrirDemonstrativo={() => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('PROT-001')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
