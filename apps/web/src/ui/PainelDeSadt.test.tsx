import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { PainelDeSadt, type GuiaSadtEmitida, type NovaGuiaSadt } from './PainelDeSadt';

const TUSS = [
  { codigo: '40304361', termo: 'Hemograma completo', tabela: 22 },
  { codigo: '40302040', termo: 'Glicemia de jejum', tabela: 22 },
];

const EMITIDA: GuiaSadtEmitida = {
  guiaId: '018f2b00-0000-7000-8000-000000000201',
  numeroGuiaPrestador: '1042',
  tipoAtendimento: '04',
  criadoEm: '2026-08-09T12:00:00+00:00',
  valorTotalCentavos: 12000,
  procedimentos: [
    { codigoProcedimento: '40304361', descricao: 'Hemograma completo', quantidade: 2 },
  ],
};

function montar(over: Record<string, unknown> = {}) {
  const props = {
    aberto: true,
    convenio: 'Meridiano Saude',
    guias: [] as readonly GuiaSadtEmitida[],
    buscarProcedimento: vi.fn(async () => TUSS),
    aoEmitir: vi.fn(async (_g: NovaGuiaSadt) => {}),
    aoFechar: vi.fn(),
    ...over,
  };
  render(<PainelDeSadt {...props} />);
  return props;
}

/** Busca e escolhe um procedimento da lista. */
async function adicionar(termo: string, indice = 0): Promise<void> {
  fireEvent.change(screen.getByLabelText(/procedimento/i), { target: { value: termo } });
  await act(async () => { await Promise.resolve(); });
  const opcoes = screen.getAllByRole('button', { name: /adicionar/i });
  await act(async () => { fireEvent.click(opcoes[indice]!); });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PainelDeSadt', () => {
  it('sem procedimento não dá para emitir', () => {
    montar();
    // Guia SP/SADT sem item é uma cobrança de nada: a operadora aceita e não
    // paga, e o buraco só aparece no demonstrativo semanas depois.
    expect(screen.getByRole('button', { name: /emitir/i })).toBeDisabled();
  });

  it('soma o total dos itens na tela, antes de emitir', async () => {
    montar();
    await adicionar('hemo');
    fireEvent.change(screen.getByLabelText(/valor unit/i), { target: { value: '45,00' } });
    fireEvent.change(screen.getByLabelText(/quantidade/i), { target: { value: '2' } });
    // Quem assina a guia precisa ver o total ANTES de assinar. Descobrir o valor
    // no retorno da operadora é tarde para corrigir. Aparece duas vezes de
    // propósito: na linha do item e no rodapé da guia.
    const rodape = screen.getByRole('table').querySelector('tfoot')!;
    expect(rodape).toHaveTextContent(/R\$\s*90,00/);
  });

  it('entrega centavos inteiros, não o texto digitado', async () => {
    const { aoEmitir } = montar();
    await adicionar('hemo');
    fireEvent.change(screen.getByLabelText(/valor unit/i), { target: { value: '45,50' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /emitir/i }));
    });
    const corpo = aoEmitir.mock.calls[0]![0];
    // 45,50 vira 4550. Mandar "45,50" ou 45.5 faria o servidor arredondar por
    // conta própria — e centavo perdido em guia é glosa.
    expect(corpo.procedimentos[0]?.valorCentavos).toBe(4550);
  });

  it('não deixa o mesmo procedimento entrar duas vezes', async () => {
    montar();
    await adicionar('hemo');
    await adicionar('hemo');
    // Duas linhas do mesmo código na mesma guia são glosadas como duplicidade.
    // Quantidade é o campo certo para "fez duas vezes".
    // A lista de busca continua na tela — o médico costuma pedir vários exames
    // de uma vez. Quem não pode duplicar é a GUIA.
    expect(within(screen.getByRole('table')).getAllByText('40304361')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/já está na guia/i);
  });

  it('dá para remover um item antes de emitir', async () => {
    const { aoEmitir } = montar();
    await adicionar('hemo');
    await adicionar('glice', 1);
    fireEvent.click(screen.getAllByRole('button', { name: /remover item/i })[0]!);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /emitir/i }));
    });
    const corpo = aoEmitir.mock.calls[0]![0];
    expect(corpo.procedimentos).toHaveLength(1);
    expect(corpo.procedimentos[0]?.codigoProcedimento).toBe('40302040');
  });

  it('guia já emitida aparece com número e total', () => {
    montar({ guias: [EMITIDA] });
    const item = screen.getByRole('list', { name: /guias deste atendimento/i })
      .querySelector('li')!;
    expect(item).toHaveTextContent('1042');
    expect(item).toHaveTextContent(/R\$\s*120,00/);
    expect(item).toHaveTextContent(/hemograma/i);
  });

  it('particular avisa em vez de deixar emitir', () => {
    montar({ convenio: null });
    // Guia só existe contra operadora. Deixar emitir criaria uma guia que
    // nunca será enviada e ficaria pendente para sempre na lista de faturamento.
    expect(screen.getByRole('button', { name: /emitir/i })).toBeDisabled();
    expect(screen.getByText(/particular/i)).toBeInTheDocument();
  });

  it('falha ao emitir não apaga o que foi montado', async () => {
    montar({ aoEmitir: vi.fn(async (_g: NovaGuiaSadt) => { throw new Error('fora do ar'); }) });
    await adicionar('hemo');
    fireEvent.change(screen.getByLabelText(/valor unit/i), { target: { value: '45,00' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /emitir/i }));
    });
    // Perder a guia montada obrigaria o médico a refazer item por item — e na
    // segunda vez ele digita errado.
    expect(within(screen.getByRole('table')).getByText('40304361')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível emitir/i);
  });
});

describe('PainelDeSadt — emissão ao finalizar', () => {
  it('em rascunho, o botão diz que a guia sai ao finalizar', async () => {
    montar({ emitirAoFinalizar: true });
    await adicionar('hemo');
    // O médico monta o pedido enquanto pensa no caso. A guia só pode existir
    // depois que o registro que a justifica for selado — e a tela precisa
    // dizer isso ANTES do clique, não devolver 422 depois.
    expect(screen.getByRole('button', { name: /incluir na finaliza/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^emitir guia$/i })).not.toBeInTheDocument();
  });

  it('guarda a guia para o finalizar em vez de tentar emitir agora', async () => {
    const { aoEmitir } = montar({ emitirAoFinalizar: true });
    await adicionar('hemo');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /incluir na finaliza/i }));
    });
    // Mesmo callback: quem decide POSTar agora ou guardar é a PÁGINA, que sabe
    // se o atendimento já foi selado. O painel só compõe.
    expect(aoEmitir).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/será emitida ao finalizar/i)).toBeInTheDocument();
  });
});
