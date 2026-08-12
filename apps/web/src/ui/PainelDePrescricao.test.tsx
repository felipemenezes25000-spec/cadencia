import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { PainelDePrescricao } from './PainelDePrescricao';

/* ── dublê do MdHub ───────────────────────────────────────────────────── */

interface Comando { modulo: string; comando: string; args: unknown }

function instalarMdHub() {
  const comandos: Comando[] = [];
  const ouvintes = new Map<string, (e: unknown) => void>();
  const hub = {
    command: {
      send: vi.fn(async (modulo: string, comando: string, args: unknown) => {
        comandos.push({ modulo, comando, args });
      }),
    },
    module: { show: vi.fn(async () => {}) },
    event: {
      add: vi.fn((nome: string, cb: (e: unknown) => void) => { ouvintes.set(nome, cb); }),
      remove: vi.fn((nome: string) => { ouvintes.delete(nome); }),
    },
  };
  (globalThis as unknown as { MdHub: unknown }).MdHub = hub;
  return { hub, comandos, ouvintes };
}

const SESSAO = {
  scriptUrl: 'https://memed.test/sinapse.js',
  token: 'tok-abc',
  patientPayload: { nome: 'Yasmin Correia', cpf: '11122233344' },
};

function montar(over: Record<string, unknown> = {}) {
  const aoConfirmar = vi.fn(async () => ({ prescriptionId: 'rx-1' }));
  const props = {
    aberto: true, sessao: SESSAO, aoConfirmar, aoFechar: vi.fn(), ...over,
  };
  render(<PainelDePrescricao {...props} />);
  return props;
}

/**
 * Sinaliza que a Memed está pronta.
 *
 * O `load` do script NÃO basta: `integration.js` carrega e só DEPOIS define o
 * MdHub, avisando pelo evento `MdSinapsePrescricao` no document. Quem age no
 * onload encontra MdHub indefinido e desiste.
 */
function memedPronta() {
  const s = document.querySelector<HTMLScriptElement>('script[data-token]');
  if (s !== null) act(() => { s.dispatchEvent(new Event('load')); });
  act(() => { document.dispatchEvent(new Event('MdSinapsePrescricao')); });
  return s;
}

/** Só o load do script, sem o evento de prontidão da Memed. */
function apenasScriptCarregou() {
  const s = document.querySelector<HTMLScriptElement>('script[data-token]');
  if (s !== null) act(() => { s.dispatchEvent(new Event('load')); });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => {
  document.querySelectorAll('script[data-token]').forEach((s) => { s.remove(); });
  delete (globalThis as unknown as { MdHub?: unknown }).MdHub;
});

describe('PainelDePrescricao', () => {
  it('injeta o script da Memed com o token do prescritor', () => {
    instalarMdHub();
    montar();
    const s = document.querySelector<HTMLScriptElement>('script[data-token]');
    expect(s?.src).toBe(SESSAO.scriptUrl);
    // O token vai em `data-token` e nunca na URL: query string entra em log de
    // servidor, em referer e no histórico do navegador.
    expect(s?.dataset['token']).toBe('tok-abc');
    expect(s?.src).not.toContain('tok-abc');
  });

  it('não injeta o script duas vezes ao trocar de atendimento', () => {
    instalarMdHub();
    // Desmontar e montar DE NOVO é o caso real: o médico fecha um atendimento e
    // abre o do próximo paciente. Rerender não exercita nada — o efeito nem
    // reexecuta — e o teste passaria mesmo sem a guarda.
    const primeiro = render(
      <PainelDePrescricao aberto sessao={SESSAO}
        aoConfirmar={vi.fn(async () => ({ prescriptionId: 'x' }))} aoFechar={vi.fn()} />);
    primeiro.unmount();
    render(
      <PainelDePrescricao aberto sessao={{ ...SESSAO, token: 'tok-outro' }}
        aoConfirmar={vi.fn(async () => ({ prescriptionId: 'x' }))} aoFechar={vi.fn()} />);
    // Dois scripts = dois MdHub concorrentes disputando a mesma página.
    expect(document.querySelectorAll('script[data-token]')).toHaveLength(1);
  });

  it('identifica o paciente e exige assinatura antes de abrir o módulo', async () => {
    const { comandos, hub } = instalarMdHub();
    montar();
    memedPronta();

    await waitFor(() => expect(hub.module.show).toHaveBeenCalled());

    const setPaciente = comandos.find((c) => c.comando === 'setPaciente');
    expect(setPaciente?.args).toEqual(SESSAO.patientPayload);

    // forceSign LIGADO: receita sem assinatura ICP-Brasil não tem validade legal
    // para o paciente comprar em farmácia — e o médico só descobre quando o
    // paciente volta dizendo que a farmácia recusou.
    const toggle = comandos.find((c) => c.comando === 'setFeatureToggle');
    expect(toggle?.args).toMatchObject({ forceSign: true });

    // A ordem importa: o módulo só pode aparecer depois de saber quem é o
    // paciente, senão o médico vê a tela em branco e digita o nome de novo.
    const iPaciente = comandos.findIndex((c) => c.comando === 'setPaciente');
    const iToggle = comandos.findIndex((c) => c.comando === 'setFeatureToggle');
    expect(iPaciente).toBeGreaterThanOrEqual(0);
    expect(iToggle).toBeGreaterThanOrEqual(0);
  });

  it('confirma no nosso backend quando a receita é impressa', async () => {
    const { ouvintes } = instalarMdHub();
    const { aoConfirmar } = montar();
    memedPronta();

    await waitFor(() => expect(ouvintes.has('prescricaoImpressa')).toBe(true));

    await act(async () => {
      ouvintes.get('prescricaoImpressa')!({
        prescricao: { id: 998877 }, signed: true,
        documents: [{ url: 'https://memed.test/doc.pdf' }],
      });
    });

    // O id vem da Memed como número; nosso backend guarda texto. Mandar número
    // faria o schema recusar com 400 no momento em que a receita já existe do
    // lado deles — e a receita ficaria órfã no nosso prontuário.
    expect(aoConfirmar).toHaveBeenCalledWith({ providerPrescriptionId: '998877' });
  });

  it('avisa quando a receita saiu SEM assinatura', async () => {
    const { ouvintes } = instalarMdHub();
    montar();
    memedPronta();
    await waitFor(() => expect(ouvintes.has('prescricaoImpressa')).toBe(true));

    await act(async () => {
      ouvintes.get('prescricaoImpressa')!({ prescricao: { id: 1 }, signed: false });
    });

    // Silenciar isso é deixar o paciente sair com um papel que a farmácia
    // recusa. O aviso é na tela, com o médico ainda na sala.
    expect(await screen.findByText(/sem assinatura/i)).toBeInTheDocument();
  });

  it('espera o MdSinapsePrescricao — load do script não é prontidão', async () => {
    // MdHub ausente de propósito: é o estado real logo após o load do script.
    const { hub } = instalarMdHub();
    delete (globalThis as unknown as { MdHub?: unknown }).MdHub;
    montar();
    apenasScriptCarregou();

    // Nada de erro e nada de comando: o painel está esperando, não desistindo.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(hub.command.send).not.toHaveBeenCalled();

    (globalThis as unknown as { MdHub: unknown }).MdHub = hub;
    act(() => { document.dispatchEvent(new Event('MdSinapsePrescricao')); });
    await waitFor(() => expect(hub.command.send).toHaveBeenCalled());
  });

  it('percebe o MdHub mesmo se o evento de prontidão passar antes', async () => {
    // Caso REAL contra a Memed: o evento `MdSinapsePrescricao` dispara na janela
    // entre o efeito montar e o listener existir, e o painel ficava eternamente
    // em "Abrindo a prescrição" com MdHub.initialized === true na página.
    // Depender de um evento único de terceiro que não controlamos é apostar numa
    // corrida; a sondagem curta remove a aposta.
    const { hub } = instalarMdHub();
    delete (globalThis as unknown as { MdHub?: unknown }).MdHub;
    montar();
    apenasScriptCarregou();

    // MdHub aparece SEM evento nenhum.
    (globalThis as unknown as { MdHub: unknown }).MdHub = hub;
    await waitFor(() => expect(hub.command.send).toHaveBeenCalled(), { timeout: 3000 });
  });

  it('sem sessão do prescritor, diz que a prescrição está indisponível', () => {
    montar({ sessao: null });
    expect(screen.getByText(/indisponível/i)).toBeInTheDocument();
    expect(document.querySelector('script[data-token]')).toBeNull();
  });
});
