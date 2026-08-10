import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PainelDeTranscricao, type SugestaoDaIA } from './PainelDeTranscricao';

const SUGESTAO: SugestaoDaIA = {
  evolucao: 'Paciente refere cefaleia ha tres dias.',
  alergias: 'Dipirona',
  pesoKg: '72.4',
  alturaCm: null,
  paSistolica: '128',
  paDiastolica: '84',
  cid: { codigo: 'R51', descricao: 'Cefaleia' },
  confianca: 0.92,
};

/** MediaRecorder e getUserMedia nao existem no jsdom. */
function instalarMicrofone(): { pararChamado: () => boolean } {
  let parou = false;
  const trilha = { stop: () => { parou = true; } };
  (globalThis.navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: async () => ({ getTracks: () => [trilha] }),
  };
  class FakeRecorder {
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start(): void { this.ondataavailable?.({ data: new Blob(['x']) }); }
    stop(): void { this.onstop?.(); }
  }
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  return { pararChamado: () => parou };
}

function montar(over: Record<string, unknown> = {}) {
  const props = {
    aberto: true,
    aoTranscrever: vi.fn(async () => SUGESTAO),
    aoAceitar: vi.fn(),
    aoFechar: vi.fn(),
    ...over,
  };
  render(<PainelDeTranscricao {...props} />);
  return props;
}

async function gravarEParar(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /comecar a gravar/i }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /parar e transcrever/i }));
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PainelDeTranscricao', () => {
  it('avisa que o paciente precisa consentir ANTES de gravar', () => {
    instalarMicrofone();
    montar();
    // Gravar consulta sem avisar e ilegal. O aviso vem antes do botao, nao
    // depois do fato.
    expect(screen.getByText(/avise o paciente antes de gravar/i)).toBeInTheDocument();
  });

  it('nada vem pre-marcado — sugestao nao pode virar padrao', async () => {
    instalarMicrofone();
    montar();
    await gravarEParar();

    const caixas = screen.getAllByRole('checkbox');
    expect(caixas.length).toBeGreaterThan(0);
    // Pre-marcar faria quem esta com pressa aceitar tudo sem ler — o modo de
    // falha exato que a decisao do medico existe para impedir.
    expect(caixas.every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: /marque o que aceita/i })).toBeDisabled();
  });

  it('so entrega o que o medico marcou', async () => {
    instalarMicrofone();
    const { aoAceitar } = montar();
    await gravarEParar();

    fireEvent.click(screen.getByRole('checkbox', { name: /evolucao/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /cid/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /usar 2 campos/i }));
    });

    const campos = aoAceitar.mock.calls[0]?.[1] as Set<string>;
    expect([...campos].sort()).toEqual(['cid', 'evolucao']);
    // Peso e pressao foram sugeridos e NAO marcados: nao podem passar.
    expect(campos.has('pesoKg')).toBe(false);
    expect(campos.has('pa')).toBe(false);
  });

  it('campo sem sugestao nao aparece como opcao vazia', async () => {
    instalarMicrofone();
    montar();
    await gravarEParar();
    // `alturaCm` veio null. Mostrar a linha vazia convidaria a marcar nada.
    expect(screen.queryByRole('checkbox', { name: /altura/i })).not.toBeInTheDocument();
  });

  it('encerra o microfone ao parar', async () => {
    const mic = instalarMicrofone();
    montar();
    await gravarEParar();
    // Sem isto o indicador de microfone fica aceso e o proximo paciente entra
    // na sala com a luz vermelha piscando.
    expect(mic.pararChamado()).toBe(true);
  });

  it('falha na transcricao nao derruba o atendimento', async () => {
    instalarMicrofone();
    montar({ aoTranscrever: vi.fn(async () => { throw new Error('fora do ar'); }) });
    await gravarEParar();
    expect(await screen.findByText(/atendimento continua normalmente/i))
      .toBeInTheDocument();
  });
});
