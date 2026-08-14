import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { Hoje } from '../Hoje';

/**
 * Teste consolidado de skeletons de carregamento.
 *
 * Verifica que todas as telas com dados assincronos renderizam
 * um skeleton (role="status") enquanto os dados nao chegam.
 *
 * Estrategia: fornecer callbacks que retornam Promises que nunca resolvem,
 * de modo que a tela permaneca no estado de carregamento.
 */

/** Promise que nunca resolve — mantem a tela em estado de carregamento. */
function nuncaResolve<T = unknown>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe('Skeletons de carregamento', { timeout: 30_000 }, () => {
  it('Hoje renderiza skeleton enquanto carrega', () => {
    const { container } = render(
      <Hoje
        dia="2026-01-01" timezone="America/Sao_Paulo"
        mensagensNaoLidasTotal={0}
        carregarDia={() => nuncaResolve()}
        carregarPrecisaDeVoce={() => nuncaResolve()}
        aoCheckIn={async () => {}}
        aoAbrirAtendimento={() => {}}
        aoMudarFiltro={() => {}}
        aoMensagem={() => {}}
        aoCobrar={() => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('Agenda renderiza skeleton enquanto carrega', async () => {
    const { Agenda } = await import('../Agenda');
    const { container } = render(
      <Agenda
        dia="2026-01-01"
        visao="dia"
        timezone="America/Sao_Paulo"
        carregar={() => nuncaResolve()}
        aoMudarVisao={() => {}}
        aoMudarDia={() => {}}
        aoAbrirCompositor={() => {}}
        aoMover={async () => {}}
        aoConfirmar={async () => {}}
        aoCobrar={() => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('Pacientes renderiza skeleton enquanto carrega', async () => {
    const { Pacientes } = await import('../Pacientes');
    const { container } = render(
      <Pacientes
        faceta="ativos"
        buscar={() => nuncaResolve()}
        aoMudarFaceta={() => {}}
        aoAbrir={() => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('FichaDoPaciente renderiza skeleton enquanto carrega', async () => {
    const { FichaDoPaciente } = await import('../FichaDoPaciente');
    const { container } = render(
      <FichaDoPaciente
        paciente={{
          patientId: 'p1',
          displayName: 'Joao Silva',
          legalName: 'Joao Silva',
          hasSocialName: false,
          birthDate: '1990-01-01',
          phonePrimary: '11999999999',
          cadastroStatus: 'completo',
        }}
        papel="profissional"
        pendentes={[]}
        prontuarioAcessivel
        existeMasSemAcesso={false}
        carregarProntuario={() => nuncaResolve()}
        aoQuebrarVidro={async () => {}}
        carregarConversas={() => nuncaResolve()}
        carregarFinanceiro={() => nuncaResolve()}
        carregarDocumentos={() => nuncaResolve()}
        aoAbrirDocumento={async () => {}}
        podeVerFinanceiro
        carregando
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('Conversas renderiza skeleton enquanto carrega', async () => {
    const { Conversas } = await import('../Conversas');
    const { container } = render(
      <Conversas
        filtro="todas"
        conversaAbertaId={null}
        carregarConversas={() => nuncaResolve()}
        carregarMensagens={() => nuncaResolve()}
        carregarContexto={() => nuncaResolve()}
        aoMudarFiltro={() => {}}
        aoAbrirConversa={() => {}}
        aoEnviar={async () => ({ messageId: 'm1' })}
        carregarTemplates={() => Promise.resolve([])}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('FinanceiroVisao renderiza skeleton enquanto carrega', async () => {
    const { FinanceiroVisao } = await import('../FinanceiroVisao');
    const { container } = render(
      <NuqsTestingAdapter searchParams={{ periodo: 'mes' }}>
        <FinanceiroVisao carregarDados={() => nuncaResolve()} />
      </NuqsTestingAdapter>,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('FinanceiroCaixa renderiza skeleton enquanto carrega', async () => {
    const { FinanceiroCaixa } = await import('../FinanceiroCaixa');
    const { container } = render(
      <FinanceiroCaixa carregarDados={() => nuncaResolve()} />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('ConveniosAFaturar renderiza skeleton enquanto carrega', async () => {
    const { ConveniosAFaturar } = await import('../ConveniosAFaturar');
    const { container } = render(
      <ConveniosAFaturar
        carregarDados={() => nuncaResolve()}
        aoCriarLote={async () => {}}
        aoAbrirGuia={() => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('Recibos renderiza skeleton enquanto carrega', async () => {
    const { Recibos } = await import('../Recibos');
    const { container } = render(
      <Recibos
        carregarRecibos={() => nuncaResolve()}
        aoImprimirRecibo={async () => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('AutomacoesDeConversa renderiza skeleton enquanto carrega', async () => {
    const { AutomacoesDeConversa } = await import('../AutomacoesDeConversa');
    const { container } = render(
      <AutomacoesDeConversa
        carregar={() => nuncaResolve()}
        aoAlternarAtiva={async () => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('Financeiro renderiza skeleton enquanto carrega', async () => {
    const { Financeiro } = await import('../Financeiro');
    const { container } = render(
      <Financeiro
        carregarCaixaDoDia={() => nuncaResolve()}
        carregarReceitasDoMes={() => nuncaResolve()}
        carregarAReceber={() => nuncaResolve()}
        aoEnviarLink={async () => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('FinanceiroAPagar renderiza skeleton enquanto carrega', async () => {
    const { FinanceiroAPagar } = await import('../FinanceiroAPagar');
    const { container } = render(
      <FinanceiroAPagar
        carregarDados={() => nuncaResolve()}
        aoMarcarPago={async () => {}}
        aoParcelar={async () => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('FinanceiroAReceber renderiza skeleton enquanto carrega', async () => {
    const { FinanceiroAReceber } = await import('../FinanceiroAReceber');
    const { container } = render(
      <FinanceiroAReceber
        carregarDados={() => nuncaResolve()}
        aoCobrar={async () => {}}
        aoMarcarPago={async () => {}}
        aoEnviarLink={async () => {}}
        hoje="2026-01-01"
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('FinanceiroEstoque renderiza skeleton enquanto carrega', async () => {
    const { FinanceiroEstoque } = await import('../FinanceiroEstoque');
    const { container } = render(
      <FinanceiroEstoque
        carregarDados={() => nuncaResolve()}
        aoRegistrarMovimentacao={async () => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('FinanceiroRepasse renderiza skeleton enquanto carrega', async () => {
    const { FinanceiroRepasse } = await import('../FinanceiroRepasse');
    const { container } = render(
      <FinanceiroRepasse
        carregarDados={() => nuncaResolve()}
        papelAtual="admin_clinico"
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('ConveniosGlosas renderiza skeleton enquanto carrega', async () => {
    const { ConveniosGlosas } = await import('../ConveniosGlosas');
    const { container } = render(
      <ConveniosGlosas
        carregarDados={() => nuncaResolve()}
        aoCriarRecurso={() => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('ConveniosLotes renderiza skeleton enquanto carrega', async () => {
    const { ConveniosLotes } = await import('../ConveniosLotes');
    const { container } = render(
      <ConveniosLotes
        carregarDados={() => nuncaResolve()}
        aoEnviar={async () => {}}
        aoCancelar={async () => {}}
        aoBaixarXml={async () => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('ConveniosOperadoras renderiza skeleton enquanto carrega', async () => {
    const { ConveniosOperadoras } = await import('../ConveniosOperadoras');
    const { container } = render(
      <ConveniosOperadoras
        carregarDados={() => nuncaResolve()}
        aoSalvar={async () => {}}
        aoDesativar={async () => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('ConveniosRecursos renderiza skeleton enquanto carrega', async () => {
    const { ConveniosRecursos } = await import('../ConveniosRecursos');
    const { container } = render(
      <ConveniosRecursos
        carregarDados={() => nuncaResolve()}
        aoEditar={() => {}}
        aoEnviar={async () => {}}
        aoVerResultado={() => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('ConveniosRetornos renderiza skeleton enquanto carrega', async () => {
    const { ConveniosRetornos } = await import('../ConveniosRetornos');
    const { container } = render(
      <ConveniosRetornos
        carregarDados={() => nuncaResolve()}
        aoImportarXml={async () => {}}
        aoAbrirDemonstrativo={() => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });
});
