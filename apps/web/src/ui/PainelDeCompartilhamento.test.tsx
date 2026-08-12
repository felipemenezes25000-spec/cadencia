import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import {
  PainelDeCompartilhamento, type Compartilhamento,
} from './PainelDeCompartilhamento';

const COM_PRAZO: Compartilhamento = {
  shareId: '018f2b00-0000-7000-8000-000000000101',
  granteeProfessionalId: '018f2b00-0000-7000-8000-0000000000bb',
  granteeNome: 'Dr. Caio Vasques',
  concedidoPor: 'Dra. Helena Prado',
  motivo: 'Segunda opiniao sobre a lesao do joelho direito',
  // Como a API responde de verdade: instante em UTC. `to_char(..., 'OF:00')` usa
  // o fuso da SESSÃO do Postgres, não o da unidade.
  concedidoEm: '2026-08-01T12:00:00+00:00',
  // 02:00Z de 01/09 é 23:00 do dia 31/08 em São Paulo. Recortar os 10 primeiros
  // caracteres mostraria um acesso vencendo um dia DEPOIS do que vence.
  expiraEm: '2026-09-01T02:00:00+00:00',
  quebraVidro: false,
};

const VIDRO: Compartilhamento = {
  ...COM_PRAZO,
  shareId: '018f2b00-0000-7000-8000-000000000102',
  granteeNome: 'Dr. Plantao Noturno',
  motivo: 'Atendimento de urgencia fora do horario',
  expiraEm: null,
  quebraVidro: true,
};

function montar(over: Record<string, unknown> = {}) {
  const props = {
    aberto: true,
    paciente: 'Marina Souza Prado',
    timezone: 'America/Sao_Paulo',
    itens: [] as readonly Compartilhamento[],
    profissionais: [
      { professionalId: '018f2b00-0000-7000-8000-0000000000bb', nome: 'Dr. Caio Vasques' },
      { professionalId: '018f2b00-0000-7000-8000-0000000000cc', nome: 'Dra. Rita Nunes' },
    ],
    aoCompartilhar: vi.fn(async () => {}),
    aoRevogar: vi.fn(async () => {}),
    aoFechar: vi.fn(),
    ...over,
  };
  render(<PainelDeCompartilhamento {...props} />);
  return props;
}

function escolherColega(): void {
  fireEvent.change(screen.getByLabelText(/profissional/i),
    { target: { value: '018f2b00-0000-7000-8000-0000000000bb' } });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PainelDeCompartilhamento', () => {
  it('motivo genérico não libera o acesso', () => {
    montar();
    escolherColega();
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'ok' } });
    // A pergunta que a auditoria faz não é "quem acessou", e "POR QUE este médico
    // viu este paciente". "ok" cumpre a coluna e não responde nada.
    expect(screen.getByRole('button', { name: /liberar acesso/i })).toBeDisabled();
  });

  it('sem escolher o colega não libera', () => {
    montar();
    fireEvent.change(screen.getByLabelText(/motivo/i),
      { target: { value: 'Segunda opiniao ortopedica' } });
    expect(screen.getByRole('button', { name: /liberar acesso/i })).toBeDisabled();
  });

  it('o padrão é ter prazo — acesso permanente é escolha explícita', () => {
    montar();
    // Compartilhamento sem prazo é um buraco permanente na política. Deixar o
    // padrão em 30 dias faz o caso perigoso exigir um ato deliberado.
    const prazo = screen.getByLabelText(/prazo/i) as HTMLSelectElement;
    expect(prazo.value).toBe('30');
  });

  it('entrega motivo e prazo em dias — quem vira instante é a página', async () => {
    const { aoCompartilhar } = montar();
    escolherColega();
    fireEvent.change(screen.getByLabelText(/motivo/i),
      { target: { value: 'Segunda opiniao sobre a lesao do joelho' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /liberar acesso/i }));
    });
    expect(aoCompartilhar).toHaveBeenCalledWith({
      granteeProfessionalId: '018f2b00-0000-7000-8000-0000000000bb',
      reason: 'Segunda opiniao sobre a lesao do joelho',
      diasDeValidade: 30,
    });
  });

  it('sem prazo vira null, não zero', async () => {
    const { aoCompartilhar } = montar();
    escolherColega();
    fireEvent.change(screen.getByLabelText(/motivo/i),
      { target: { value: 'Co-gestao permanente do caso' } });
    fireEvent.change(screen.getByLabelText(/prazo/i), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /liberar acesso/i }));
    });
    // `0` dias seria "expira agora"; `null` é "não expira". Confundir os dois
    // troca acesso permanente por acesso morto — ou o contrário.
    expect(aoCompartilhar).toHaveBeenCalledWith(expect.objectContaining({
      diasDeValidade: null,
    }));
  });

  it('quem tem acesso aparece com o motivo e o prazo', () => {
    montar({ itens: [COM_PRAZO] });
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent(/dr\. caio vasques/i);
    expect(item).toHaveTextContent(/segunda opiniao sobre a lesao/i);
    // O acesso vence às 23:00 do dia 31 no fuso da clínica. Anunciar 01/09
    // daria ao colega um dia de acesso que ele não tem — e a auditoria veria
    // a tela contradizendo a policy.
    expect(item).toHaveTextContent('31/08/2026');
    expect(item).not.toHaveTextContent('01/09/2026');
  });

  it('quebra de vidro fica visível e o acesso sem prazo não passa por vazio', () => {
    montar({ itens: [VIDRO] });
    const item = screen.getByRole('listitem');
    // Acesso de urgência sem consentimento prévio é o caso que a auditoria abre
    // primeiro. Não pode parecer um compartilhamento comum na lista.
    expect(item).toHaveTextContent(/quebra de vidro/i);
    // Campo em branco leria-se como "sem informação"; é o oposto — não expira.
    expect(item).toHaveTextContent(/sem prazo/i);
  });

  it('revogar exige confirmar', async () => {
    const { aoRevogar } = montar({ itens: [COM_PRAZO] });
    const item = screen.getByRole('listitem');
    fireEvent.click(within(item).getByRole('button', { name: /revogar/i }));
    expect(aoRevogar).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(item).getByRole('button', { name: /confirmar/i }));
    });
    expect(aoRevogar).toHaveBeenCalledWith(COM_PRAZO.shareId);
  });
});
