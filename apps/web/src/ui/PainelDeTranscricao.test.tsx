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

/** MediaRecorder e getUserMedia não existem no jsdom. */
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
    fireEvent.click(screen.getByRole('button', { name: /começar a gravar/i }));
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
    // Gravar consulta sem avisar é ilegal. O aviso vem antes do botão, não
    // depois do fato.
    expect(screen.getByText(/avise o paciente antes de gravar/i)).toBeInTheDocument();
  });

  it('nada vem pré-marcado — sugestão não pode virar padrão', async () => {
    instalarMicrofone();
    montar();
    await gravarEParar();

    const caixas = screen.getAllByRole('checkbox');
    expect(caixas.length).toBeGreaterThan(0);
    // Pré-marcar faria quem está com pressa aceitar tudo sem ler — o modo de
    // falha exato que a decisão do médico existe para impedir.
    expect(caixas.every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: /marque o que aceita/i })).toBeDisabled();
  });

  it('só entrega o que o médico marcou', async () => {
    instalarMicrofone();
    const { aoAceitar } = montar();
    await gravarEParar();

    fireEvent.click(screen.getByRole('checkbox', { name: /evolução/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /cid/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /usar 2 campos/i }));
    });

    const campos = aoAceitar.mock.calls[0]?.[1] as Set<string>;
    expect([...campos].sort()).toEqual(['cid', 'evolucao']);
    // Peso e pressão foram sugeridos e NÃO marcados: não podem passar.
    expect(campos.has('pesoKg')).toBe(false);
    expect(campos.has('pa')).toBe(false);
  });

  it('campo sem sugestão não aparece como opção vazia', async () => {
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
    // Sem isto o indicador de microfone fica aceso e o próximo paciente entra
    // na sala com a luz vermelha piscando.
    expect(mic.pararChamado()).toBe(true);
  });

  it('falha na transcrição não derruba o atendimento', async () => {
    instalarMicrofone();
    montar({ aoTranscrever: vi.fn(async () => { throw new Error('fora do ar'); }) });
    await gravarEParar();
    expect(await screen.findByText(/atendimento continua normalmente/i))
      .toBeInTheDocument();
  });
});
