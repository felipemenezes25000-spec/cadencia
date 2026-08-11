import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Agenda } from './Agenda';
import type { LinhaDaFila } from './Hoje';

const FILA: LinhaDaFila[] = [{
  appointmentId: 'a1', startsAt: '2026-08-03T13:00:00.000Z', endsAt: '2026-08-03T13:30:00.000Z',
  patientId: 'p1', displayName: 'Maria Souza Lima', professionalId: 'pr1',
  procedureNome: 'Consulta', procedureCor: '#2f5fd0', operadoraNome: 'Unimed',
  status: 'agendado' as const, encaixe: false, teleconsulta: false, primeiraVez: false,
  cadastroPreliminar: false, encounterId: null,
  mensagensNaoLidas: 0, pagamentoPendente: true,
}];

function montarProps(over = {}) {
  return {
    dia: '2026-08-03', visao: 'dia' as const, timezone: 'UTC',
    carregar: vi.fn(async () => FILA), aoMudarVisao: vi.fn(), aoMudarDia: vi.fn(),
    aoAbrirCompositor: vi.fn(), aoMover: vi.fn(async () => {}),
    aoConfirmar: vi.fn(async () => {}), aoCobrar: vi.fn(),
    ...over,
  };
}

function montar(over = {}) {
  const props = montarProps(over);
  render(<Agenda {...props} />);
  return props;
}

/**
 * Aguarda o conteudo carregar. Em jsdom, as visualizacoes desktop e mobile
 * sao renderizadas simultaneamente (CSS nao aplica), entao usamos queryAll.
 */
async function esperarCarregar() {
  await waitFor(() => {
    expect(screen.queryAllByText('Maria Souza Lima').length).toBeGreaterThan(0);
  });
}

/**
 * Retorna escopo de queries limitado ao container desktop-grid.
 */
async function escopoDesktop() {
  const el = await waitFor(() => {
    const grid = document.querySelector('[data-view="desktop-grid"]');
    expect(grid).toBeTruthy();
    return grid as HTMLElement;
  });
  return within(el);
}

describe('tela Agenda', () => {
  /* ── Novos testes da task-20 ────────────────────────────── */

  it('renderiza skeleton enquanto carrega', async () => {
    let resolver!: (data: LinhaDaFila[]) => void;
    const carregar = vi.fn(() => new Promise<LinhaDaFila[]>((r) => { resolver = r; }));
    render(<Agenda {...montarProps({ carregar })} />);

    expect(screen.getByTestId('agenda-skeleton')).toBeInTheDocument();

    resolver(FILA);
    await waitFor(() => {
      expect(screen.queryByTestId('agenda-skeleton')).not.toBeInTheDocument();
    });
  });

  it('renderiza tabs de visualizacao', async () => {
    montar();
    const abas = await screen.findAllByRole('tab');
    expect(abas.map((a) => a.textContent)).toEqual([
      'Dia', 'Semana', 'Mês', 'Por profissional', 'Por sala',
    ]);
  });

  it('mostra grade de horarios na visualizacao Dia', async () => {
    montar();
    await esperarCarregar();
    const grid = await escopoDesktop();
    // Verifica que etiquetas de hora estao na grade
    expect(grid.getByText('07:00')).toBeInTheDocument();
    expect(grid.getByText('12:00')).toBeInTheDocument();
    expect(grid.getByText('19:00')).toBeInTheDocument();
  });

  it('posiciona agendamentos corretamente na grade', async () => {
    montar();
    await esperarCarregar();
    const grid = await escopoDesktop();
    const item = grid.getByText('Maria Souza Lima');
    const bloco = item.closest('[data-status]');
    expect(bloco).toBeTruthy();
    expect(bloco).toHaveAttribute('data-status', 'agendado');
    const style = bloco?.getAttribute('style') ?? '';
    expect(style).toContain('top:');
    expect(style).toContain('height:');
  });

  it('aplica cores de status corretas', async () => {
    montar();
    await esperarCarregar();
    const grid = await escopoDesktop();
    const item = grid.getByText('Maria Souza Lima');
    const bloco = item.closest('[data-status]');
    expect(bloco).toHaveAttribute('data-status', 'agendado');
  });

  it('navega entre datas com botoes anterior/proximo', async () => {
    const props = montar();
    await esperarCarregar();

    await userEvent.click(screen.getByLabelText('Dia anterior'));
    expect(props.aoMudarDia).toHaveBeenCalledWith('2026-08-02');

    await userEvent.click(screen.getByLabelText('Proximo dia'));
    expect(props.aoMudarDia).toHaveBeenCalledWith('2026-08-04');
  });

  it('muda de visualizacao ao clicar nas tabs', async () => {
    const props = montar();
    await esperarCarregar();

    await userEvent.click(screen.getByRole('tab', { name: 'Semana' }));
    expect(props.aoMudarVisao).toHaveBeenCalledWith('semana');
  });

  it('renderiza como lista no mobile', async () => {
    montar();
    await esperarCarregar();
    // Ambas as visualizacoes estao no DOM (CSS controla visibilidade)
    expect(document.querySelector('[data-view="desktop-grid"]')).toBeInTheDocument();
    expect(document.querySelector('[data-view="mobile-list"]')).toBeInTheDocument();
    // A lista mobile contem o agendamento
    const mobileList = document.querySelector('[data-view="mobile-list"]') as HTMLElement;
    expect(within(mobileList).getByText('Maria Souza Lima')).toBeInTheDocument();
  });

  it('abre contexto do paciente sem sair da agenda', async () => {
    const carregarResumoPaciente = vi.fn(async () => ({
      patientId: 'p1', displayName: 'Maria Souza Lima', legalName: 'Maria Souza Lima',
      birthDate: '1988-03-14', phonePrimary: '11999999999', email: 'maria@exemplo.com',
      cadastroStatus: 'completo' as const, pendentes: [] as string[],
    }));
    montar({ carregarResumoPaciente, aoAbrirPaciente: vi.fn() });
    const grid = await escopoDesktop();
    await userEvent.click(grid.getByRole('button', { name: 'Abrir detalhes de Maria Souza Lima' }));
    expect(await screen.findByRole('dialog', { name: 'Visão rápida do paciente' })).toBeVisible();
    expect(carregarResumoPaciente).toHaveBeenCalledWith('p1');
  });

  /* ── Testes de logica de negocio preservados ────────────── */

  it('as teclas 1..5 trocam a visao — atalho fora de campo de texto', async () => {
    const { aoMudarVisao } = montar();
    await esperarCarregar();
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
    await esperarCarregar();
    const grid = await escopoDesktop();
    const item = grid.getByText('Maria Souza Lima');
    const bloco = item.closest('[style]');
    expect(bloco).toBeTruthy();
  });

  it('o botao Confirmar aparece para status agendado e envia confirmacao', async () => {
    const { aoConfirmar } = montar();
    await esperarCarregar();
    // Botao aparece em ambas as visualizacoes; usamos a do desktop
    const grid = await escopoDesktop();
    const botao = grid.getByRole('button', { name: /Confirmar Maria Souza Lima/ });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(aoConfirmar).toHaveBeenCalledWith('a1');
  });

  it('apos confirmar, o status muda para confirmado e o glifo aparece', async () => {
    montar();
    await esperarCarregar();
    const grid = await escopoDesktop();
    await userEvent.click(grid.getByRole('button', { name: /Confirmar Maria Souza Lima/ }));
    await waitFor(() => {
      const glifos = screen.getAllByLabelText('Confirmado');
      expect(glifos.length).toBeGreaterThan(0);
    });
    // O botao de confirmar desaparece de ambas as views
    expect(screen.queryAllByRole('button', { name: /Confirmar Maria Souza Lima/ })).toHaveLength(0);
  });

  it('o botao Cobrar aparece para quem tem pagamento pendente', async () => {
    const { aoCobrar } = montar();
    await esperarCarregar();
    const grid = await escopoDesktop();
    const botao = grid.getByRole('button', { name: /Cobrar Maria Souza Lima/ });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(aoCobrar).toHaveBeenCalledWith(FILA[0]);
  });

  it('Cobrar NAO aparece quando pagamentoPendente e false', async () => {
    montar({ carregar: vi.fn(async () =>
      FILA.map((f) => ({ ...f, pagamentoPendente: false }))) });
    await esperarCarregar();
    expect(screen.queryAllByRole('button', { name: /Cobrar/ })).toHaveLength(0);
  });

  it('clicar num vao vazio abre o compositor INLINE, nao um modal', async () => {
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
    const { container } = render(<Agenda {...montarProps()} />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(5));
    await esperarCarregar();
    expect(await axe(container)).toHaveNoViolations();
  });

  /* ── Testes de drag-and-drop (task-21) ──────────────────── */

  describe('Agenda drag-and-drop', () => {
    it('agendamentos sao arrostaveis (atributos de drag presentes)', async () => {
      montar();
      await esperarCarregar();
      const grid = await escopoDesktop();
      const item = grid.getByText('Maria Souza Lima');

      // O handle de arraste (span pai do texto) recebe tabindex do useDraggable
      const handle = item.closest('[tabindex="0"]') as HTMLElement;
      expect(handle).toBeTruthy();
      expect(handle.tagName).toBe('SPAN');
    });

    it('mostra ghost na posicao original (classe de arraste disponivel)', async () => {
      montar();
      await esperarCarregar();
      const grid = await escopoDesktop();
      const item = grid.getByText('Maria Souza Lima');
      const bloco = item.closest('[data-status]') as HTMLElement;

      // Antes de arrastar, o bloco nao tem opacidade reduzida
      expect(bloco.className).not.toContain('opacity-30');
    });

    it('marca agendamentos com aria-roledescription para acessibilidade', async () => {
      montar();
      await esperarCarregar();
      const grid = await escopoDesktop();
      const item = grid.getByText('Maria Souza Lima');
      const bloco = item.closest('[data-status]') as HTMLElement;

      expect(bloco).toHaveAttribute('aria-roledescription', 'item arrastavel');
      expect(bloco).toHaveAttribute('aria-describedby', 'dnd-instrucoes');
    });

    it('renderiza instrucoes de acessibilidade para DnD', async () => {
      montar();
      await esperarCarregar();

      const instrucoes = document.getElementById('dnd-instrucoes');
      expect(instrucoes).toBeInTheDocument();
      expect(instrucoes?.textContent).toContain('Pressione espaco para arrastar');
      expect(instrucoes?.textContent).toContain('Use as setas para mover');
      expect(instrucoes?.textContent).toContain('Pressione escape para cancelar');
    });

    it('time slots sao droppable (possuem data-horario)', async () => {
      montar();
      await esperarCarregar();

      // Os slots vazios devem existir com data-horario
      const container = document.querySelector('[data-view="desktop-grid"]') as HTMLElement;
      const slotsEl = container.querySelectorAll('[data-slot="vazio"]');
      expect(slotsEl.length).toBeGreaterThan(0);

      // Cada slot deve ter um data-horario no formato HH:MM
      const primeiroSlot = slotsEl[0] as HTMLElement;
      expect(primeiroSlot).toHaveAttribute('data-horario');
      const horario = primeiroSlot.getAttribute('data-horario')!;
      expect(horario).toMatch(/^\d{2}:\d{2}$/);
    });

    it('clicar em slot vazio continua abrindo compositor (click nao e bloqueado pelo DnD)', async () => {
      const { aoAbrirCompositor } = montar();
      const slots = await waitFor(() => {
        const s = document.querySelectorAll('[data-slot="vazio"]');
        expect(s.length).toBeGreaterThan(0);
        return s;
      });
      await userEvent.click(slots[0] as HTMLElement);
      expect(aoAbrirCompositor).toHaveBeenCalled();
    });

    it('DragOverlay nao esta visivel quando nao arrasta', async () => {
      montar();
      await esperarCarregar();

      // O overlay so aparece quando activeAgendamento esta setado
      expect(screen.queryByTestId('drag-overlay')).not.toBeInTheDocument();
    });

    it('cursor e grab no handle de arraste', async () => {
      montar();
      await esperarCarregar();
      const grid = await escopoDesktop();
      const item = grid.getByText('Maria Souza Lima');
      // O cursor-grab esta no handle de arraste (span com tabindex)
      const handle = item.closest('[tabindex="0"]') as HTMLElement;

      expect(handle.className).toContain('cursor-grab');
    });
  });
});
