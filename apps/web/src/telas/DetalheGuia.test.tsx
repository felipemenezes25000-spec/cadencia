// apps/web/src/telas/DetalheGuia.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { DetalheGuia, type GuiaDetalhe, type AjusteGuia } from './DetalheGuia';

const AJUSTES: readonly AjusteGuia[] = [
  {
    id: 'aj1', campoAlterado: 'codigo_procedimento',
    valorAnterior: '10101012', valorNovo: '10102019',
    motivo: 'Correcao para casar com tabela da operadora',
    autorNome: 'Ana Financeiro', criadoEm: '2026-08-05 14:30',
  },
];

const GUIA: GuiaDetalhe = {
  id: 'g1', numeroGuia: '000001',
  pacienteNome: 'Maria Souza', numeroCns: '123456789012345',
  operadoraNome: 'Unimed', registroAns: '123456',
  numeroCarteira: '00112233', atendimentoRn: false,
  cnes: '1234567',
  conselhoProfissional: 'CRM', numeroConselho: '12345', ufConselho: 'SP',
  cbos: '225142',
  indicacaoAcidente: '9', regimeAtendimento: '01', tipoConsulta: '1',
  codigoTabela: '22', codigoProcedimento: '10102019',
  nomeProcedimento: 'Consulta em consultorio',
  valorCentavos: 15000, dataAtendimento: '2026-08-01',
  observacao: null,
  ajustes: AJUSTES,
};

function montar(aberto = true) {
  const props = {
    aberto,
    guia: GUIA,
    aoFechar: vi.fn(),
    aoAjustar: vi.fn(async (_input: { guiaId: string; campoAlterado: string;
      valorNovo: string; motivo: string }) => {}),
  };
  render(<DetalheGuia {...props} />);
  return props;
}

describe('DetalheGuia', () => {
  it('renderiza no PainelLateral com título da guia', () => {
    montar();
    expect(screen.getByRole('dialog', { name: /Guia 000001/i })).toBeVisible();
  });

  it('mostra dados corretos: paciente, operadora, procedimento', () => {
    montar();
    expect(screen.getByText('Maria Souza')).toBeVisible();
    expect(screen.getByText('Unimed')).toBeVisible();
    // codigoProcedimento aparece tanto na info da guia quanto no histórico de ajustes
    const codigos = screen.getAllByText('10102019');
    expect(codigos.length).toBeGreaterThanOrEqual(1);
    expect(codigos[0]).toBeVisible();
    expect(screen.getByText('Consulta em consultorio')).toBeVisible();
  });

  it('exibe o valor formatado em reais', () => {
    montar();
    expect(screen.getByText('R$ 150,00')).toBeVisible();
  });

  it('exibe dados TISS: CNES, conselho, CBO', () => {
    montar();
    expect(screen.getByText('1234567')).toBeVisible();
    expect(screen.getByText(/CRM/)).toBeVisible();
    expect(screen.getByText('12345')).toBeVisible();
    expect(screen.getByText('SP')).toBeVisible();
  });

  it('mostra histórico de ajustes com campo, valores e motivo', () => {
    montar();
    const secao = screen.getByRole('region', { name: /Histórico de ajustes/i });
    expect(secao).toBeVisible();
    expect(within(secao).getByText('codigo_procedimento')).toBeVisible();
    expect(within(secao).getByText('10101012')).toBeVisible();
    expect(within(secao).getByText('10102019')).toBeVisible();
    expect(within(secao).getByText(/Correcao para casar/i)).toBeVisible();
    expect(within(secao).getByText('Ana Financeiro')).toBeVisible();
  });

  it('tem botão Ajustar que abre formulário', async () => {
    montar();
    const botao = screen.getByRole('button', { name: /Ajustar/i });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(screen.getByLabelText(/Campo alterado/i)).toBeVisible();
    expect(screen.getByLabelText(/Novo valor/i)).toBeVisible();
    expect(screen.getByLabelText(/Motivo/i)).toBeVisible();
  });

  it('ao preencher e confirmar ajuste chama aoAjustar com os dados', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Ajustar/i }));
    const selectCampo = screen.getByLabelText(/Campo alterado/i);
    await userEvent.selectOptions(selectCampo, 'codigo_procedimento');
    const inputValor = screen.getByLabelText(/Novo valor/i);
    await userEvent.type(inputValor, '10101012');
    const textareaMotivo = screen.getByLabelText(/Motivo/i);
    await userEvent.type(textareaMotivo, 'Retorno ao codigo original');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar ajuste/i }));
    expect(props.aoAjustar).toHaveBeenCalledWith({
      guiaId: 'g1',
      campoAlterado: 'codigo_procedimento',
      valorNovo: '10101012',
      motivo: 'Retorno ao codigo original',
    });
  });

  it('não renderiza quando fechado', () => {
    montar(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem violação de acessibilidade', async () => {
    const { container } = render(
      <DetalheGuia
        aberto
        guia={GUIA}
        aoFechar={() => {}}
        aoAjustar={async () => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
