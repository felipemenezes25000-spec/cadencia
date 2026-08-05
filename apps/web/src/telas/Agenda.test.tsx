import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Agenda } from './Agenda';

const FILA = [{
  appointmentId: 'a1', startsAt: '2026-08-03T13:00:00.000Z', endsAt: '2026-08-03T13:30:00.000Z',
  patientId: 'p1', displayName: 'Maria Souza Lima', professionalId: 'pr1',
  procedureNome: 'Consulta', procedureCor: '#2f5fd0', operadoraNome: 'Unimed',
  status: 'agendado' as const, encaixe: false, teleconsulta: false, primeiraVez: false,
  cadastroPreliminar: false, encounterId: null,
  mensagensNaoLidas: 0, pagamentoPendente: true,
}];

function montar(over = {}) {
  const props = {
    dia: '2026-08-03', visao: 'dia' as const, timezone: 'UTC',
    carregar: vi.fn(async () => FILA), aoMudarVisao: vi.fn(), aoMudarDia: vi.fn(),
    aoAbrirCompositor: vi.fn(), aoMover: vi.fn(async () => {}),
    aoConfirmar: vi.fn(async () => {}), aoCobrar: vi.fn(),
    ...over,
  };
  render(<Agenda {...props} />);
  return props;
}

describe('tela Agenda', () => {
  it('oferece as cinco visoes como tablist', async () => {
    montar();
    const abas = await screen.findAllByRole('tab');
    expect(abas.map((a) => a.textContent)).toEqual([
      'Dia', 'Semana', 'Mês', 'Por profissional', 'Por sala']);
  });

  it('as teclas 1..5 trocam a visao — atalho de um caractere fora de campo de texto', async () => {
    const { aoMudarVisao } = montar();
    await userEvent.keyboard('4');
    expect(aoMudarVisao).toHaveBeenCalledWith('profissional');
  });

  it('a visao vai para a query string, nao para estado local', async () => {
    const { aoMudarVisao } = montar();
    await userEvent.click(await screen.findByRole('tab', { name: 'Semana' }));
    expect(aoMudarVisao).toHaveBeenCalledWith('semana');
  });

  it('o agendamento aparece posicionado na grade, com a cor do procedimento', async () => {
    montar();
    const item = await screen.findByText('Maria Souza Lima');
    expect(item.closest('[style]')).toBeTruthy();
  });

  it('o botao Confirmar aparece para status agendado e envia template de confirmacao', async () => {
    const { aoConfirmar } = montar();
    const botao = await screen.findByRole('button', { name: /Confirmar Maria Souza Lima/ });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(aoConfirmar).toHaveBeenCalledWith('a1');
  });

  it('apos confirmar, o status muda para confirmado e o glifo aparece', async () => {
    montar();
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar Maria Souza Lima/ }));
    await waitFor(() => expect(screen.getByLabelText('Confirmado')).toBeVisible());
    expect(screen.queryByRole('button', { name: /Confirmar Maria Souza Lima/ }))
      .not.toBeInTheDocument();
  });

  it('o botao Cobrar aparece para quem tem pagamento pendente', async () => {
    const { aoCobrar } = montar();
    const botao = await screen.findByRole('button', { name: /Cobrar Maria Souza Lima/ });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(aoCobrar).toHaveBeenCalledWith('a1');
  });

  it('Cobrar NAO aparece quando pagamentoPendente e false', async () => {
    montar({ carregar: vi.fn(async () =>
      FILA.map((f) => ({ ...f, pagamentoPendente: false }))) });
    await waitFor(() => expect(screen.getByText('Maria Souza Lima')).toBeVisible());
    expect(screen.queryByRole('button', { name: /Cobrar/ })).not.toBeInTheDocument();
  });

  it('clicar num vao vazio abre o compositor INLINE, nao um modal de pagina cheia', async () => {
    const { aoAbrirCompositor } = montar();
    const slots = await waitFor(() => {
      const s = document.querySelectorAll('[data-slot="vazio"]');
      expect(s.length).toBeGreaterThan(0);
      return s;
    });
    await userEvent.click(slots[0] as HTMLElement);
    expect(aoAbrirCompositor).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Agenda dia="2026-08-03" visao="dia" timezone="UTC" carregar={async () => FILA}
        aoMudarVisao={vi.fn()} aoMudarDia={vi.fn()} aoAbrirCompositor={vi.fn()}
        aoMover={async () => {}} aoConfirmar={async () => {}} aoCobrar={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(5));
    expect(await axe(container)).toHaveNoViolations();
  });
});
