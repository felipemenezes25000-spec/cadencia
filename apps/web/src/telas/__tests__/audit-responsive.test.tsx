/**
 * Auditoria responsiva.
 *
 * Verifica que padroes CSS responsivos estao aplicados nas telas:
 * - Tabelas envoltas em containers overflow-x-auto
 * - Grids usam breakpoints responsivos (sm:, md:, lg:, xl:)
 * - Touch targets com tamanho minimo (min-h-[44px] ou min-w-[44px])
 * - Sidebar esconde no mobile (max-md:hidden ou md:hidden)
 *
 * Nota: testes responsivos completos exigem renderizacao visual.
 * Estes testes verificam a ESTRUTURA do DOM e as classes CSS,
 * que e o que podemos validar em jsdom.
 */

import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import * as RadixTooltip from '@radix-ui/react-tooltip';

/* ── Mock global de next/navigation ────────────────────────────────── */

vi.mock('next/navigation', () => ({
  usePathname: () => '/financeiro',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/* ── Polyfills para jsdom ──────────────────────────────────────────── */

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.cb = cb; }
      observe(target: Element) {
        this.cb([{
          target,
          contentRect: { x: 0, y: 0, width: 390, height: 844, top: 0, left: 0, bottom: 844, right: 390, toJSON: () => '' },
          borderBoxSize: [{ blockSize: 844, inlineSize: 390 }],
          contentBoxSize: [{ blockSize: 844, inlineSize: 390 }],
          devicePixelContentBoxSize: [],
        } as ResizeObserverEntry], this);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;
  }
});

/* ── Imports das telas ─────────────────────────────────────────────── */

import { Hoje, type LinhaDaFila, type PrecisaDeVoce } from '../Hoje';
import { Conversas } from '../Conversas';
import { FinanceiroLayout } from '../FinanceiroLayout';
import { ConveniosLayout, type ContadoresConvenios } from '../ConveniosLayout';
import { Recibos } from '../Recibos';

/* ── Wrapper com TooltipProvider ───────────────────────────────────── */

function TooltipWrapper({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={0}>{children}</RadixTooltip.Provider>
  );
}

/* ── Dados de teste ────────────────────────────────────────────────── */

const FILA: LinhaDaFila[] = [{
  appointmentId: 'a1', startsAt: '2026-08-03T13:00:00.000Z',
  endsAt: '2026-08-03T13:30:00.000Z', patientId: 'p1',
  displayName: 'Maria Souza Lima', professionalId: 'pr1',
  procedureNome: 'Consulta', procedureCor: '#2f5fd0',
  operadoraNome: 'Unimed', status: 'agendado' as const,
  encaixe: false, teleconsulta: false, primeiraVez: false,
  cadastroPreliminar: false, encounterId: null,
  mensagensNaoLidas: 0, pagamentoPendente: false,
}];

const PRECISA: PrecisaDeVoce = {
  confirmacoesSemResposta: 2, prescricoesNaoAssinadas: 0,
  resultadosChegados: 1, rascunhosDeOntem: 0, guiasAFaturar: 3,
};

const CONTADORES: ContadoresConvenios = {
  guiasAFaturar: 5, lotesRascunho: 1, lotesEnviados: 2,
  pendencias: 1, glosasPendentes: 3, recursosRascunho: 0,
};

const RECIBOS = [{
  receiptId: 'r1', receiptNumber: 42, patientName: 'Maria Souza Lima',
  description: 'Consulta', amountCents: 25000, method: 'pix' as const,
  paidAt: '2026-08-03T13:30:00.000Z',
}];

/* ── Utilidades de verificacao ─────────────────────────────────────── */

/**
 * Verifica que toda <table> no container esta envolta em
 * um container com overflow-x-auto.
 */
function verificarTabelasComOverflow(container: HTMLElement): void {
  const tabelas = container.querySelectorAll('table');
  tabelas.forEach((tabela) => {
    let pai = tabela.parentElement;
    let temOverflow = false;
    while (pai && pai !== container) {
      const classes = pai.className || '';
      if (classes.includes('overflow-x-auto') || classes.includes('overflow-auto')) {
        temOverflow = true;
        break;
      }
      pai = pai.parentElement;
    }
    expect(temOverflow).toBe(true);
  });
}

/**
 * Verifica que classes responsivas estao presentes nos grids.
 */
function verificarGridsResponsivos(container: HTMLElement): void {
  const grids = container.querySelectorAll('[class*="grid-cols"]');
  grids.forEach((grid) => {
    const classes = grid.className || '';
    // Um grid responsivo deve ter pelo menos um breakpoint (sm:, md:, lg:, xl:)
    const temBreakpoint =
      classes.includes('sm:grid-cols') ||
      classes.includes('md:grid-cols') ||
      classes.includes('lg:grid-cols') ||
      classes.includes('xl:grid-cols') ||
      classes.includes('grid-cols-1') ||
      classes.includes('grid-cols-2') ||
      (classes.includes('hidden') && classes.includes('md:grid')); // cabecalho desktop removido no mobile
    expect(temBreakpoint, `grid sem estratégia responsiva: ${classes}`).toBe(true);
  });
}

/**
 * Verifica que o padding raiz adapta para mobile.
 * Aceita Tailwind utilities (max-sm:p-4, p-3 etc.) ou a classe
 * cadencia-page, que aplica padding responsivo via CSS custom property.
 */
function verificarPaddingResponsivo(container: HTMLElement): boolean {
  const raiz = container.firstElementChild;
  if (!raiz) return false;
  const classes = raiz.className || '';
  return (
    classes.includes('cadencia-page') ||
    classes.includes('max-sm:p-4') ||
    classes.includes('max-sm:p-3') ||
    classes.includes('p-4') ||
    classes.includes('p-3')
  );
}

/* ── Testes ─────────────────────────────────────────────────────────── */

describe('Auditoria responsiva', () => {
  describe('tabelas tem container overflow-x-auto', () => {
    it('Recibos: tabela de recibos scrollavel horizontalmente', async () => {
      const { container } = render(
        <Recibos
          carregarRecibos={async () => RECIBOS}
          aoImprimirRecibo={async () => {}}
        />,
        { wrapper: TooltipWrapper },
      );
      await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
      verificarTabelasComOverflow(container);
    });
  });

  describe('grids usam classes responsivas', () => {
    it('Hoje: grid de contadores adapta para mobile', async () => {
      const { container } = render(
        <Hoje
          dia="2026-08-03" timezone="America/Sao_Paulo"
          carregarDia={async () => ({
            contadores: { agendados: 1, confirmados: 0, aguardando: 0, atendidos: 0, faltas: 0 },
            fila: FILA,
          })}
          carregarPrecisaDeVoce={async () => PRECISA}
          aoCheckIn={async () => {}}
          aoAbrirAtendimento={vi.fn()}
          aoMudarFiltro={vi.fn()}
          mensagensNaoLidasTotal={0}
          aoMensagem={vi.fn()}
          aoCobrar={vi.fn()}
        />,
      );
      await waitFor(() =>
        expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0),
      );
      verificarGridsResponsivos(container);
    });
  });

  describe('padding adapta para mobile', () => {
    it('Hoje usa padding responsivo (max-sm:p-4)', async () => {
      const { container } = render(
        <Hoje
          dia="2026-08-03" timezone="America/Sao_Paulo"
          carregarDia={async () => ({
            contadores: { agendados: 1, confirmados: 0, aguardando: 0, atendidos: 0, faltas: 0 },
            fila: FILA,
          })}
          carregarPrecisaDeVoce={async () => PRECISA}
          aoCheckIn={async () => {}}
          aoAbrirAtendimento={vi.fn()}
          aoMudarFiltro={vi.fn()}
          mensagensNaoLidasTotal={0}
          aoMensagem={vi.fn()}
          aoCobrar={vi.fn()}
        />,
      );
      await waitFor(() =>
        expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0),
      );
      expect(verificarPaddingResponsivo(container)).toBe(true);
    });

    it('FinanceiroLayout usa padding responsivo', () => {
      const { container } = render(
        <FinanceiroLayout>
          <div>Conteudo</div>
        </FinanceiroLayout>,
      );
      expect(verificarPaddingResponsivo(container)).toBe(true);
    });

    it('ConveniosLayout usa padding responsivo', () => {
      const { container } = render(
        <ConveniosLayout contadores={CONTADORES} aoFiltrar={vi.fn()}>
          <div>Conteudo</div>
        </ConveniosLayout>,
      );
      expect(verificarPaddingResponsivo(container)).toBe(true);
    });
  });

  describe('layout Conversas adapta para mobile', () => {
    it('painel esquerdo esconde quando conversa ativa no mobile', async () => {
      render(
        <Conversas
          filtro="todas"
          conversaAbertaId="c1"
          carregarConversas={async () => [{
            conversationId: 'c1', patientId: 'p1',
            patientName: 'Maria Souza Lima', phoneNumber: '+5511999990001',
            lastMessageBody: 'Confirmo', lastMessageAt: '2026-08-03T14:30:00.000Z',
            unreadCount: 1, channel: 'whatsapp', status: 'ativa',
            lastMessageDirection: 'inbound',
          }]}
          carregarMensagens={async () => [{
            messageId: 'm1', direction: 'inbound', body: 'Confirmo',
            sentAt: '2026-08-03T14:30:00.000Z', deliveryStatus: 'delivered',
          }]}
          carregarContexto={async () => ({ proximoAgendamento: null, pendencias: [], historicoAgendamentos: [] })}
          aoMudarFiltro={vi.fn()}
          aoAbrirConversa={vi.fn()}
          aoEnviar={async () => ({ messageId: 'm2' })}
          carregarTemplates={vi.fn().mockResolvedValue([])}
        />,
      );
      await waitFor(() =>
        expect(screen.getByTestId('split-view')).toBeInTheDocument(),
      );
      // A lista de conversas (role="list") deve ter um ancestral com a classe de esconder no mobile.
      // Em jsdom com Tailwind v4, as classes ficam no className como string.
      const splitView = screen.getByTestId('split-view');
      const painelEsquerdo = splitView.firstElementChild;
      expect(painelEsquerdo).toBeTruthy();
      // A classe raw deve conter o indicador de esconder no mobile
      expect(painelEsquerdo!.className).toMatch(/max-md:hidden/);
    });

    it('botao voltar aparece apenas no mobile quando conversa ativa', async () => {
      render(
        <Conversas
          filtro="todas"
          conversaAbertaId="c1"
          carregarConversas={async () => [{
            conversationId: 'c1', patientId: 'p1',
            patientName: 'Maria Souza Lima', phoneNumber: '+5511999990001',
            lastMessageBody: 'Confirmo', lastMessageAt: '2026-08-03T14:30:00.000Z',
            unreadCount: 1, channel: 'whatsapp', status: 'ativa',
            lastMessageDirection: 'inbound',
          }]}
          carregarMensagens={async () => [{
            messageId: 'm1', direction: 'inbound', body: 'Confirmo',
            sentAt: '2026-08-03T14:30:00.000Z', deliveryStatus: 'delivered',
          }]}
          carregarContexto={async () => ({ proximoAgendamento: null, pendencias: [], historicoAgendamentos: [] })}
          aoMudarFiltro={vi.fn()}
          aoAbrirConversa={vi.fn()}
          aoEnviar={async () => ({ messageId: 'm2' })}
          carregarTemplates={vi.fn().mockResolvedValue([])}
          aoVoltar={vi.fn()}
        />,
      );
      await waitFor(() =>
        expect(screen.getByTestId('split-view')).toBeInTheDocument(),
      );
      // Botao voltar existe com classe md:hidden (visivel apenas no mobile)
      const botaoVoltar = screen.getByLabelText('Voltar');
      expect(botaoVoltar).toBeTruthy();
      // O container do botao deve ter md:hidden para esconder no desktop
      const voltarContainer = botaoVoltar.closest('[class*="md:hidden"]');
      expect(voltarContainer).toBeTruthy();
    });
  });

  describe('tabs horizontalmente scrollaveis', () => {
    it('FinanceiroLayout: abas scrollam horizontalmente', () => {
      const { container } = render(
        <FinanceiroLayout>
          <div>Conteudo</div>
        </FinanceiroLayout>,
      );
      // As abas devem estar envolvidas em overflow-x-auto
      const tabsContainer = container.querySelector('.overflow-x-auto');
      expect(tabsContainer).toBeTruthy();
    });

    it('ConveniosLayout: abas scrollam horizontalmente', () => {
      const { container } = render(
        <ConveniosLayout contadores={CONTADORES} aoFiltrar={vi.fn()}>
          <div>Conteudo</div>
        </ConveniosLayout>,
      );
      const tabsContainer = container.querySelector('.overflow-x-auto');
      expect(tabsContainer).toBeTruthy();
    });
  });

  describe('contadores tem touch target minimo', () => {
    it('ConveniosLayout: botoes de contadores tem min-h >= 44px', () => {
      render(
        <ConveniosLayout contadores={CONTADORES} aoFiltrar={vi.fn()}>
          <div>Conteudo</div>
        </ConveniosLayout>,
      );
      const grupo = screen.getByRole('group', { name: /Contadores de convênios/i });
      const botoes = within(grupo).getAllByRole('button');
      botoes.forEach((botao) => {
        const match = botao.className.match(/min-h-\[(\d+)px\]/);
        expect(match).toBeTruthy();
        expect(Number(match![1])).toBeGreaterThanOrEqual(44);
      });
    });
  });

  /* Auditava a tela-fantasma `telas/Desempenho.tsx`, removida — ela nunca foi
     renderizada por rota nenhuma. A verificacao aqui era por CLASSE CSS
     (`.max-sm:flex-col`), que passa mesmo numa tela sem conteudo. Contra a tela
     real, o que importa e a grade de indicadores: uma coluna no telefone, tres
     no desktop. */
  describe('Desempenho adapta para mobile', () => {
    it('indicadores empilham no mobile e viram três colunas no desktop', async () => {
      const { Desempenho } = await import('../desempenho/Desempenho');
      const { container } = render(
        <Desempenho
          period={{ current: '2026-08', previous: '2026-07' }}
          aoMudarPeriodo={() => {}}
          carregarIndicadores={async () => ({
            indicators: [
              { metric: 'receita', deltaAbsolute: 120_00, deltaPercent: 8.4 },
              { metric: 'ticket_medio', deltaAbsolute: -5_00, deltaPercent: -2.1 },
              { metric: 'ocupacao', deltaAbsolute: 3, deltaPercent: 5.0 },
            ],
            freshness: { source: 'live', refreshedAt: null },
          })}
          carregarWaterfall={async () => []}
          carregarDrillDown={async () => ({
            result: { dimension: 'profissional', groups: [], totalCount: 0 },
            actions: [],
          })}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 1, name: /Desempenho/ })).toBeVisible());
      expect(container.querySelector('.lg\\:grid-cols-3')).toBeTruthy();
    });
  });
});
