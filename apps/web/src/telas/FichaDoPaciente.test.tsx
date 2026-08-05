import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FichaDoPaciente } from './FichaDoPaciente';

const PACIENTE = { patientId: 'p1', displayName: 'Maria Souza Lima',
                   legalName: 'Maria Souza Lima', hasSocialName: false,
                   birthDate: '1988-03-14', cadastroStatus: 'preliminar' as const,
                   phonePrimary: '11987654321' };

const CONVERSAS = [
  { messageId: 'm1', direction: 'inbound' as const, bodyPreview: 'Boa tarde, posso remarcar?',
    sentAt: '04/08/2026 14:30', status: 'read' as const },
  { messageId: 'm2', direction: 'outbound' as const, bodyPreview: 'Sim! Qual dia prefere?',
    sentAt: '04/08/2026 14:32', status: 'delivered' as const },
];

const LANCAMENTOS = [
  { entryId: 'e1', description: 'Consulta particular', amountCents: 30000,
    status: 'paid' as const, dueDate: '2026-08-03', paidAt: '2026-08-03' },
  { entryId: 'e2', description: 'Retorno', amountCents: 15000,
    status: 'pending' as const, dueDate: '2026-08-10', paidAt: null },
];

function montar(over = {}) {
  const props = {
    paciente: PACIENTE, papel: 'profissional' as const,
    pendentes: ['cpf'], carregarProntuario: vi.fn(async () => [] as unknown[]),
    prontuarioAcessivel: true, existeMasSemAcesso: false,
    aoSolicitarAcesso: vi.fn(), aoQuebrarVidro: vi.fn(async () => {}),
    carregarConversas: vi.fn(async () => CONVERSAS),
    carregarFinanceiro: vi.fn(async () => LANCAMENTOS),
    podeVerFinanceiro: false,
    ...over,
  };
  render(<FichaDoPaciente {...props} />);
  return props;
}

describe('ficha do paciente', () => {
  it('recepcao NAO ve a aba Prontuario — ela nao existe, nao esta cinza', () => {
    montar({ papel: 'recepcao', prontuarioAcessivel: false });
    expect(screen.queryByRole('tab', { name: 'Prontuário' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Atendimentos' })).toBeVisible();
  });

  it('profissional ve Prontuario e NAO ve o substituto administrativo em destaque', () => {
    montar();
    expect(screen.getByRole('tab', { name: 'Prontuário' })).toBeVisible();
  });

  it('o TERCEIRO ESTADO aparece com as duas saidas nomeadas', async () => {
    montar({ prontuarioAcessivel: false, existeMasSemAcesso: true });
    await userEvent.click(screen.getByRole('tab', { name: 'Prontuário' }));
    expect(screen.getByText(/Paciente existe\. Prontuário não compartilhado com você\./))
      .toBeVisible();
    expect(screen.getByRole('button', { name: 'Solicitar acesso' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Quebra-vidro assistencial' })).toBeVisible();
  });

  it('quebra-vidro EXIGE justificativa de 20 caracteres antes de habilitar', async () => {
    const { aoQuebrarVidro } = montar({ prontuarioAcessivel: false, existeMasSemAcesso: true });
    await userEvent.click(screen.getByRole('tab', { name: 'Prontuário' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quebra-vidro assistencial' }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar quebra-vidro' });
    expect(confirmar).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Justificativa/),
      'paciente inconsciente no pronto atendimento');
    expect(confirmar).toBeEnabled();
    await userEvent.click(confirmar);
    expect(aoQuebrarVidro).toHaveBeenCalledWith(
      'paciente inconsciente no pronto atendimento', 4);
  });

  it('a barra de dados pendentes diz QUANTOS e quais', () => {
    montar({ pendentes: ['cpf', 'sex_at_birth'] });
    expect(screen.getByText('2 dados pendentes')).toBeVisible();
  });

  it('aba Conversas aparece para todos os papeis e carrega mensagens sob demanda', async () => {
    const { carregarConversas } = montar({ papel: 'recepcao' });
    expect(screen.getByRole('tab', { name: 'Conversas' })).toBeVisible();
    expect(carregarConversas).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: 'Conversas' }));
    expect(carregarConversas).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(
      screen.getByText('Boa tarde, posso remarcar?')).toBeVisible());
  });

  it('recepcao ve Conversas mas NAO ve conteudo clinico no contexto', async () => {
    montar({ papel: 'recepcao', prontuarioAcessivel: false });
    await userEvent.click(screen.getByRole('tab', { name: 'Conversas' }));
    await waitFor(() => expect(
      screen.getByRole('region', { name: 'Conversas do paciente' })).toBeVisible());
    expect(screen.queryByRole('tab', { name: 'Prontuário' })).not.toBeInTheDocument();
  });

  it('aba Financeiro aparece para papel financeiro e mostra lancamentos', async () => {
    const { carregarFinanceiro } = montar({ papel: 'financeiro' });
    expect(screen.getByRole('tab', { name: 'Financeiro' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Financeiro' }));
    expect(carregarFinanceiro).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(
      screen.getByText('Consulta particular')).toBeVisible());
    expect(screen.getByText('Pago')).toBeVisible();
    expect(screen.getByText('Pendente')).toBeVisible();
  });

  it('recepcao NAO ve aba Financeiro a menos que podeVerFinanceiro=true', () => {
    montar({ papel: 'recepcao', podeVerFinanceiro: false });
    expect(screen.queryByRole('tab', { name: 'Financeiro' })).not.toBeInTheDocument();
  });

  it('recepcao ve aba Financeiro quando podeVerFinanceiro=true', () => {
    montar({ papel: 'recepcao', podeVerFinanceiro: true });
    expect(screen.getByRole('tab', { name: 'Financeiro' })).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FichaDoPaciente paciente={PACIENTE} papel="profissional" pendentes={[]}
        carregarProntuario={async () => []} prontuarioAcessivel existeMasSemAcesso={false}
        aoSolicitarAcesso={vi.fn()} aoQuebrarVidro={async () => {}}
        carregarConversas={async () => []} carregarFinanceiro={async () => []}
        podeVerFinanceiro={false} />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
