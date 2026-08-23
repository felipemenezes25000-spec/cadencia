import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
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
        aoSolicitarAcesso={() => {}}
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
        aoVincularPaciente={() => {}}
        aoSelecionarTemplate={() => {}}
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

  /* A tela `Financeiro` saiu daqui junto com o arquivo: ela nunca esteve numa
     rota. Nasceu em bb42109 e nenhuma versao de app/financeiro/page.tsx a
     importou — a rota /financeiro sempre renderizou FinanceiroVisao, que tem
     outro contrato de dados. O skeleton que vale e o de FinanceiroVisao. */

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

});
