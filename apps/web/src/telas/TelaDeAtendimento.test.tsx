import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { TelaDeAtendimento, type TelaDeAtendimentoProps } from './TelaDeAtendimento';

/* ── polyfills para jsdom ─────────────────────────────────────────────── */

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

  if (typeof globalThis.ClipboardEvent === 'undefined') {
    globalThis.ClipboardEvent = class ClipboardEvent extends Event {
      clipboardData: DataTransfer | null;
      constructor(type: string, opts?: EventInit & { clipboardData?: DataTransfer }) {
        super(type, opts);
        this.clipboardData = opts?.clipboardData ?? null;
      }
    } as unknown as typeof globalThis.ClipboardEvent;
  }
});

/* ── mock do EditorClinico (evita TipTap no jsdom) ────────────────────── */

const descargaEspia = vi.fn(async () => true);

vi.mock('./EditorClinico', () => ({
  EditorClinico: (props: {
    encounterId: string;
    aoPrescrever: () => void;
    aoFinalizar: () => void;
    registrarDescarga?: (fn: () => Promise<boolean>) => void;
  }) => {
    props.registrarDescarga?.(descargaEspia);
    return (
      <div data-testid="editor-clinico" data-encounter={props.encounterId}>
        <button type="button" onClick={props.aoPrescrever}>Mock prescrever</button>
        <button type="button" onClick={props.aoFinalizar}>Mock finalizar</button>
      </div>
    );
  },
}));

/* ── mock do PainelLateral ────────────────────────────────────────────── */

vi.mock('../ui/PainelLateral', () => ({
  PainelLateral: ({ aberto, titulo, children }: {
    aberto: boolean;
    titulo?: string;
    children: ReactNode;
  }) =>
    aberto ? <div data-testid="painel-lateral" aria-label={titulo}>{children}</div> : null,
}));

/* ── mock do PainelDeCobranca ─────────────────────────────────────────── */

vi.mock('../ui/PainelDeCobranca', () => ({
  PainelDeCobranca: ({ aberto }: { aberto: boolean }) =>
    aberto ? <div data-testid="painel-cobranca">Cobranca</div> : null,
}));

/* ── mock do PainelDeDocumentos ───────────────────────────────────────── */

vi.mock('../ui/PainelDeDocumentos', () => ({
  PainelDeDocumentos: ({ aberto }: { aberto: boolean }) =>
    aberto ? <div data-testid="painel-documentos">Documentos</div> : null,
}));

/* ── mock do PainelDePrescricao ───────────────────────────────────────── */

vi.mock('../ui/PainelDePrescricao', () => ({
  PainelDePrescricao: ({ aberto, sessao }: { aberto: boolean; sessao: unknown }) =>
    aberto
      ? <div data-testid="painel-prescricao" data-sessao={sessao === null ? 'nao' : 'sim'}>
          Prescricao
        </div>
      : null,
}));

/* ── factory de props ─────────────────────────────────────────────────── */

function criarProps(overrides: Partial<TelaDeAtendimentoProps> = {}): TelaDeAtendimentoProps {
  return {
    encounterId: 'enc-123',
    pacienteNome: 'Maria Silva',
    procedimentoNome: 'Consulta de rotina',
    valorSugeridoCentavos: 15000,
    abrirSessaoDoPrescritor: vi.fn().mockResolvedValue({ mode: 'embed' }),
    buscarCodigo: vi.fn().mockResolvedValue([]),
    buscarModelo: vi.fn().mockResolvedValue([]),
    buscarValorAnterior: vi.fn().mockResolvedValue(null),
    aoConfirmarPrescricao: vi.fn().mockResolvedValue({ prescriptionId: 'rx-1' }),
    aoFinalizar: vi.fn().mockResolvedValue({ versionId: 'v-1', versionNo: 1 }),
    inicio: new Date(),
    paciente: {
      nome: 'Maria Silva',
      nascimento: '1985-03-15',
      sexo: 'Feminino',
      convenio: 'Unimed',
      alergias: ['Dipirona', 'Penicilina'],
      medicamentos: ['Losartana 50mg'],
      ultimosAtendimentos: [
        { data: '2026-07-01', procedimento: 'Retorno' },
        { data: '2026-06-15', procedimento: 'Consulta inicial' },
      ],
    },
    ...overrides,
  };
}

/* ── wrapper com tooltip provider ─────────────────────────────────────── */

function Wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <RadixTooltip.Provider>
      {children}
    </RadixTooltip.Provider>
  );
}

function renderTela(overrides: Partial<TelaDeAtendimentoProps> = {}) {
  const props = criarProps(overrides);
  return { ...render(<TelaDeAtendimento {...props} />, { wrapper: Wrapper }), props };
}

/* ── testes ────────────────────────────────────────────────────────────── */

describe('TelaDeAtendimento', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renderiza nome do paciente no cabecalho', () => {
    renderTela();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Maria Silva');
  });

  it('renderiza procedimento no cabecalho', () => {
    renderTela({ procedimentoNome: 'Retorno cardiologia' });
    expect(screen.getByText('Retorno cardiologia')).toBeInTheDocument();
  });

  it('renderiza timer de duracao', () => {
    renderTela({ inicio: new Date(Date.now() - 125_000) });
    const timer = screen.getByTestId('duracao-timer');
    expect(timer).toBeInTheDocument();
    // O timer deve mostrar um formato de duracao (m:ss ou h:mm:ss)
    expect(timer.textContent).toMatch(/\d+:\d{2}/);
  });

  it('renderiza editor clinico', () => {
    renderTela();
    expect(screen.getByTestId('editor-clinico')).toBeInTheDocument();
  });

  it('renderiza sidebar com dados do paciente', () => {
    renderTela();
    expect(screen.getByText('Dados do paciente')).toBeInTheDocument();
    expect(screen.getByText('Feminino')).toBeInTheDocument();
    expect(screen.getByText('Unimed')).toBeInTheDocument();
  });

  it('renderiza alergias destacadas', () => {
    renderTela();
    expect(screen.getByText('Dipirona')).toBeInTheDocument();
    expect(screen.getByText('Penicilina')).toBeInTheDocument();
    // Alergias devem ter classe de cor danger
    const dipirona = screen.getByText('Dipirona');
    expect(dipirona.className).toContain('danger');
  });

  it('renderiza badge de alergias com contagem', () => {
    renderTela();
    const badge = screen.getByText('2');
    expect(badge).toBeInTheDocument();
  });

  it('mostra mensagem quando nao ha alergias', () => {
    renderTela({
      paciente: { nome: 'Joao', alergias: [] },
    });
    // Secao de alergias ja inicia aberta
    expect(screen.getByText('Nenhuma alergia registrada')).toBeInTheDocument();
  });

  it('renderiza medicamentos em uso', () => {
    renderTela();
    // Expandir secao de medicamentos
    const medBtn = screen.getByRole('button', { name: /medicamentos/i });
    fireEvent.click(medBtn);
    expect(screen.getByText('Losartana 50mg')).toBeInTheDocument();
  });

  it('renderiza ultimos atendimentos', () => {
    renderTela();
    // Expandir secao de ultimos atendimentos
    const ateBtn = screen.getByRole('button', { name: /ultimos atendimentos/i });
    fireEvent.click(ateBtn);
    expect(screen.getByText('Retorno')).toBeInTheDocument();
    expect(screen.getByText('Consulta inicial')).toBeInTheDocument();
  });

  it('renderiza barra de acoes', () => {
    // Com o gancho de emissao: a barra completa. Sem ele o botao de documento
    // some, e isso e coberto pelo teste 'sem gancho de emissao'.
    renderTela({ aoEmitirDocumento: vi.fn() });
    // Verifica a barra de acoes via aria-label
    const barraAcoes = screen.getByRole('navigation', { name: /acoes do atendimento/i });
    expect(barraAcoes).toBeInTheDocument();
    // Verifica os botoes dentro da barra de acoes (using within)
    const botoes = barraAcoes.querySelectorAll('button');
    expect(botoes.length).toBe(4);
    const textos = Array.from(botoes).map((b) => b.textContent?.trim());
    expect(textos).toContain('Prescrever');
    expect(textos).toContain('Pedir exame');
    expect(textos).toContain('Emitir documento');
    expect(textos).toContain('Finalizar');
  });

  it('botao Finalizar chama callback', async () => {
    const aoFinalizar = vi.fn().mockResolvedValue({ versionId: 'v-1', versionNo: 1 });
    renderTela({ aoFinalizar });

    // Seleciona o botao Finalizar da barra de acoes (nao o mock do editor)
    const botoes = screen.getAllByRole('button', { name: /finalizar/i });
    const botaoFinalizar = botoes.find((b) => b.textContent?.trim() === 'Finalizar')!;
    await act(async () => {
      fireEvent.click(botaoFinalizar);
    });

    expect(aoFinalizar).toHaveBeenCalledTimes(1);
  });

  it('descarrega o editor ANTES de finalizar', async () => {
    const ordem: string[] = [];
    descargaEspia.mockImplementation(async () => { ordem.push('descarregou'); return true; });
    const aoFinalizar = vi.fn(async () => {
      ordem.push('finalizou');
      return { versionId: 'v-1', versionNo: 1 };
    });
    renderTela({ aoFinalizar });

    const botoes = screen.getAllByRole('button', { name: /finalizar/i });
    const botaoFinalizar = botoes.find((b) => b.textContent?.trim() === 'Finalizar')!;
    await act(async () => { fireEvent.click(botaoFinalizar); });

    // O botao do cabecalho nao passa pelo editor. Sem descarga explicita, o que
    // foi digitado nos ultimos 2s do debounce nunca chega ao servidor — e a
    // versao selada e imutavel.
    expect(ordem).toEqual(['descarregou', 'finalizou']);
  });

  it('nao finaliza duas vezes com dois cliques', async () => {
    descargaEspia.mockImplementation(async () => true);
    const aoFinalizar = vi.fn().mockResolvedValue({ versionId: 'v-1', versionNo: 1 });
    renderTela({ aoFinalizar });

    const botoes = screen.getAllByRole('button', { name: /finalizar/i });
    const botaoFinalizar = botoes.find((b) => b.textContent?.trim() === 'Finalizar')!;
    await act(async () => {
      fireEvent.click(botaoFinalizar);
      fireEvent.click(botaoFinalizar);
    });

    // Finalizar duas vezes nao e clique duplo distraido apenas: Ctrl+Enter e
    // ouvido pelo editor E pela tela. A segunda chamada acha o atendimento fora
    // de rascunho e devolve erro ao medico que fez tudo certo.
    expect(aoFinalizar).toHaveBeenCalledTimes(1);
  });

  it('a sessao do prescritor abre ANTES de o medico pedir', async () => {
    const abrirSessaoDoPrescritor = vi.fn().mockResolvedValue({
      mode: 'embedded', scriptUrl: 'https://memed.test/s.js', token: 't',
      patientPayload: { nome: 'Maria Silva' },
    });
    renderTela({ abrirSessaoDoPrescritor });

    // Buscar o token so quando o medico clica em Prescrever custa a ida a Memed
    // com o paciente esperando. A sessao e aberta ao montar a tela.
    await waitFor(() => expect(abrirSessaoDoPrescritor).toHaveBeenCalledTimes(1));

    const botao = screen.getAllByRole('button', { name: /prescrever/i })[0]!;
    await act(async () => { fireEvent.click(botao); });

    const painel = screen.getByTestId('painel-prescricao');
    expect(painel.dataset['sessao']).toBe('sim');
  });

  it('Memed fora do ar nao impede o atendimento', async () => {
    const abrirSessaoDoPrescritor = vi.fn().mockResolvedValue({ mode: 'indisponivel' });
    renderTela({ abrirSessaoDoPrescritor });
    await waitFor(() => expect(abrirSessaoDoPrescritor).toHaveBeenCalled());

    const botao = screen.getAllByRole('button', { name: /prescrever/i })[0]!;
    await act(async () => { fireEvent.click(botao); });

    // O painel abre dizendo que nao da; a consulta continua. Travar a tela
    // inteira porque um parceiro caiu e transformar indisponibilidade deles em
    // indisponibilidade nossa.
    expect(screen.getByTestId('painel-prescricao').dataset['sessao']).toBe('nao');
    expect(screen.getByTestId('editor-clinico')).toBeInTheDocument();
  });

  it('a ficha estruturada aparece quando a clinica configurou campos', () => {
    renderTela({
      secoesDaFicha: [{
        sectionId: 's1', code: 'antecedentes', label: 'Antecedentes',
        campos: [{
          fieldId: 'f1', code: 'alergias', label: 'Alergias', kind: 'texto_curto',
          generation: 1, required: false, unit: null, options: null,
          refSource: null, observationCode: null, componentes: [],
        }],
      }],
      aoMudarFicha: vi.fn(),
    });
    expect(screen.getByRole('region', { name: /ficha do atendimento/i }))
      .toBeInTheDocument();
    expect(screen.getByLabelText(/alergias/i)).toBeInTheDocument();
  });

  it('sem campos configurados a ficha nao ocupa espaco', () => {
    renderTela({ secoesDaFicha: [], aoMudarFicha: vi.fn() });
    // Clinica que usa so evolucao narrativa nao ve caixa vazia pedindo atencao.
    expect(screen.queryByRole('region', { name: /ficha do atendimento/i }))
      .not.toBeInTheDocument();
  });

  it('Emitir documento abre o painel de documentos', async () => {
    renderTela({ aoEmitirDocumento: vi.fn() });
    expect(screen.queryByTestId('painel-documentos')).not.toBeInTheDocument();

    const botao = screen.getAllByRole('button', { name: /emitir documento/i })[0]!;
    await act(async () => { fireEvent.click(botao); });

    // O botao existia e nao fazia nada — placeholder que parece funcionalidade
    // e pior que botao ausente, porque o medico conta com ele na frente do
    // paciente e descobre no pior momento que nao emite nada.
    expect(screen.getByTestId('painel-documentos')).toBeInTheDocument();
  });

  it('sem gancho de emissao o botao de documento nao aparece', () => {
    renderTela();
    expect(screen.queryAllByRole('button', { name: /emitir documento/i }))
      .toHaveLength(0);
  });

  it('mostra status finalizado apos clicar Finalizar', async () => {
    const aoFinalizar = vi.fn().mockResolvedValue({ versionId: 'v-1', versionNo: 1 });
    renderTela({ aoFinalizar });

    // Seleciona o botao Finalizar da barra de acoes (nao o mock do editor)
    const botoes = screen.getAllByRole('button', { name: /finalizar/i });
    const botaoFinalizar = botoes.find((b) => b.textContent?.trim() === 'Finalizar')!;
    await act(async () => {
      fireEvent.click(botaoFinalizar);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Atendimento finalizado');
  });

  it('atalho Ctrl+P abre prescricao', async () => {
    renderTela();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    });

    // Agora a prescricao tem painel proprio (Memed embarcada), e nao mais o
    // PainelLateral generico com um paragrafo de placeholder dentro.
    expect(screen.getByTestId('painel-prescricao')).toBeInTheDocument();
  });

  it('renderiza botao Voltar quando aoVoltar fornecido', () => {
    const aoVoltar = vi.fn();
    renderTela({ aoVoltar });
    expect(screen.getByRole('button', { name: /voltar/i })).toBeInTheDocument();
  });

  it('nao renderiza botao Voltar quando aoVoltar nao fornecido', () => {
    renderTela();
    // Default props nao incluem aoVoltar, entao o botao nao deve aparecer
    expect(screen.queryByRole('button', { name: /^voltar$/i })).not.toBeInTheDocument();
  });

  it('renderiza atalhos de teclado na barra de acoes', () => {
    renderTela();
    expect(screen.getByText('Ctrl+P')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+E')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+D')).toBeInTheDocument();
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = renderTela();
    expect(await axe(container)).toHaveNoViolations();
  });
});
