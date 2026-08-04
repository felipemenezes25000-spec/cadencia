import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FichaDoPaciente } from './FichaDoPaciente';

const PACIENTE = { patientId: 'p1', displayName: 'Maria Souza Lima',
                   legalName: 'Maria Souza Lima', hasSocialName: false,
                   birthDate: '1988-03-14', cadastroStatus: 'preliminar' as const,
                   phonePrimary: '11987654321' };

function montar(over = {}) {
  const props = {
    paciente: PACIENTE, papel: 'profissional' as const,
    pendentes: ['cpf'], carregarProntuario: vi.fn(async () => [] as unknown[]),
    prontuarioAcessivel: true, existeMasSemAcesso: false,
    aoSolicitarAcesso: vi.fn(), aoQuebrarVidro: vi.fn(async () => {}), ...over,
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

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FichaDoPaciente paciente={PACIENTE} papel="profissional" pendentes={[]}
        carregarProntuario={async () => []} prontuarioAcessivel existeMasSemAcesso={false}
        aoSolicitarAcesso={vi.fn()} aoQuebrarVidro={async () => {}} />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
