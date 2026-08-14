/**
 * Auditoria consolidada de acessibilidade.
 *
 * Renderiza cada tela principal com dados minimos e executa vitest-axe
 * para detectar violacoes de WCAG AA.
 *
 * Telas que requerem next/navigation sao renderizadas com o mock global
 * configurado acima dos imports.
 */

import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';

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

/* ── Polyfills necessarios para jsdom ──────────────────────────────── */

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;
  }

  if (typeof globalThis.DOMRect === 'undefined') {
    // @ts-ignore - polyfill basico
    globalThis.DOMRect = class DOMRect {
      x = 0; y = 0; width = 0; height = 0;
      top = 0; right = 0; bottom = 0; left = 0;
      toJSON() { return {}; }
      static fromRect() { return new DOMRect(); }
    };
  }

  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
});

/* ── Imports das telas ─────────────────────────────────────────────── */

import { Hoje, type LinhaDaFila, type PrecisaDeVoce } from '../Hoje';
import { Pacientes } from '../Pacientes';
import { Conversas } from '../Conversas';
import { FinanceiroLayout } from '../FinanceiroLayout';
import { ConveniosLayout, type ContadoresConvenios } from '../ConveniosLayout';
import { Recibos } from '../Recibos';
import { ListaDeEspera, type ItemDeEspera } from '../ListaDeEspera';
import { AutomacoesDeConversa, type Automacao } from '../AutomacoesDeConversa';

/* ── Wrapper com TooltipProvider ───────────────────────────────────── */

function TooltipWrapper({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={0}>{children}</RadixTooltip.Provider>
  );
}

/* ── Dados de teste minimos ────────────────────────────────────────── */

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

const CONTADORES_CONVENIOS: ContadoresConvenios = {
  guiasAFaturar: 5, lotesRascunho: 1, lotesEnviados: 2,
  pendencias: 1, glosasPendentes: 3, recursosRascunho: 0,
};

const ITENS_ESPERA: ItemDeEspera[] = [{
  waitlistId: 'w1', patientId: 'p1', displayName: 'Maria Souza Lima',
  prioridade: 'normal' as const, esperandoDesde: '2026-07-20T12:00:00.000Z',
  observacao: null,
}];

const AUTOMACOES: Automacao[] = [{
  automationId: 'a1', nome: 'Confirmacao D-2',
  descricao: 'Envia confirmacao 2 dias antes', templateNome: 'Confirmacao',
  canal: 'whatsapp', timing: '2 dias antes', ativa: true,
}];

const RECIBOS = [{
  receiptId: 'r1', receiptNumber: 42, patientName: 'Maria Souza Lima',
  description: 'Consulta', amountCents: 25000, method: 'pix' as const,
  paidAt: '2026-08-03T13:30:00.000Z',
}];

const PACIENTES = [{
  patientId: 'p1', displayName: 'Maria Souza Lima',
  legalName: 'Maria Souza Lima', hasSocialName: false,
  birthDate: '1990-01-01', cadastroStatus: 'completo' as const,
  phonePrimary: null,
}];

/* ── Regras desabilitadas globalmente ──────────────────────────────── */
/*
 * aria-valid-attr-value: Radix Tabs emite aria-controls apontando para
 *   TabsContent inexistente quando o conteudo vem de rotas filhas.
 */
const AXE_OPTS = {};

/* ── Testes ─────────────────────────────────────────────────────────── */

describe('Auditoria de acessibilidade', () => {
  it('Hoje nao tem violacoes de acessibilidade', async () => {
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
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });

  it('Pacientes nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <Pacientes
        faceta="ativos"
        buscar={async () => PACIENTES}
        aoMudarFaceta={vi.fn()}
        aoAbrir={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Maria Souza Lima')).toBeVisible(),
    );
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });

  it('Conversas nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <Conversas
        filtro="todas"
        conversaAbertaId={null}
        carregarConversas={async () => [{
          conversationId: 'c1', patientId: 'p1',
          patientName: 'Maria Souza Lima', phoneNumber: '+5511999990001',
          lastMessageBody: 'Confirmo', lastMessageAt: '2026-08-03T14:30:00.000Z',
          unreadCount: 1, channel: 'whatsapp', status: 'ativa',
          lastMessageDirection: 'inbound',
        }]}
        carregarMensagens={async () => []}
        carregarContexto={async () => ({ proximoAgendamento: null, pendencias: [], historicoAgendamentos: [] })}
        aoMudarFiltro={vi.fn()}
        aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm1' })}
        carregarTemplates={vi.fn().mockResolvedValue([])}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Maria Souza Lima')).toBeVisible(),
    );
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });

  it('FinanceiroLayout nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroLayout>
        <div>Conteudo da aba</div>
      </FinanceiroLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: /Financeiro/ })).toBeVisible();
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });

  it('ConveniosLayout nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <ConveniosLayout contadores={CONTADORES_CONVENIOS} aoFiltrar={vi.fn()}>
        <div>Conteudo da sub-aba</div>
      </ConveniosLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: /Convênio/ })).toBeVisible();
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });

  it('Desempenho nao tem violacoes de acessibilidade', async () => {
    const { Desempenho } = await import('../Desempenho');
    const { container } = render(
      <NuqsTestingAdapter searchParams={{ periodo: 'mes', aba: 'explorar' }}>
        <Desempenho />
      </NuqsTestingAdapter>,
    );
    expect(screen.getByRole('heading', { name: /Desempenho/ })).toBeVisible();
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });

  it('Recibos nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <Recibos
        carregarRecibos={async () => RECIBOS}
        aoImprimirRecibo={async () => {}}
      />,
      { wrapper: TooltipWrapper },
    );
    await waitFor(() =>
      expect(screen.getByText('Maria Souza Lima')).toBeVisible(),
    );
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });

  it('ListaDeEspera nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <ListaDeEspera itens={ITENS_ESPERA} aoChamar={vi.fn()} />,
    );
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });

  it('AutomacoesDeConversa nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <AutomacoesDeConversa
        carregar={async () => AUTOMACOES}
        aoAlternarAtiva={async () => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Confirmacao D-2')).toBeVisible(),
    );
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });
});
