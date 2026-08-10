import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { LayoutDoProntuario, type SecaoDoLayout } from './LayoutDoProntuario';

const SECOES: SecaoDoLayout[] = [
  { sectionId: 's1', code: 'evolucao', label: 'Evolucao', ordinal: 1,
    visible: true, collapsed: false, personalizado: false },
  { sectionId: 's2', code: 'antecedentes', label: 'Antecedentes', ordinal: 2,
    visible: true, collapsed: false, personalizado: false },
  { sectionId: 's3', code: 'sinais_vitais', label: 'Sinais vitais', ordinal: 3,
    visible: true, collapsed: false, personalizado: false },
];

function montar(over: Record<string, unknown> = {}) {
  const props = {
    secoes: SECOES,
    aoSalvar: vi.fn(async (_itens: readonly {
      sectionId: string; ordinal: number; visible: boolean; collapsed: boolean
    }[]) => {}),
    ...over,
  };
  render(<LayoutDoProntuario {...props} />);
  return props;
}

function linhaDe(rotulo: string): HTMLElement {
  return screen.getByText(rotulo).closest('li')!;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('LayoutDoProntuario', () => {
  it('mostra as secoes na ordem em que aparecem na ficha', () => {
    montar();
    const rotulos = screen.getAllByRole('listitem').map((l) => l.textContent ?? '');
    expect(rotulos[0]).toContain('Evolucao');
    expect(rotulos[2]).toContain('Sinais vitais');
  });

  it('a primeira nao sobe e a ultima nao desce', () => {
    montar();
    // Botao que nao faz nada e pior que botao ausente: quem clica acha que a
    // tela travou.
    expect(within(linhaDe('Evolucao')).getByRole('button', { name: /subir/i }))
      .toBeDisabled();
    expect(within(linhaDe('Sinais vitais')).getByRole('button', { name: /descer/i }))
      .toBeDisabled();
  });

  it('subir troca com a de cima', async () => {
    const { aoSalvar } = montar();
    fireEvent.click(within(linhaDe('Sinais vitais')).getByRole('button', { name: /subir/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    });
    const itens = aoSalvar.mock.calls[0]![0];
    // Os ordinais saem RENUMERADOS de 1 a N, nao com o valor antigo: buraco de
    // ordinal faria a proxima reordenacao ficar ambigua.
    expect(itens.map((x) => x.sectionId)).toEqual(['s1', 's3', 's2']);
    expect(itens.map((x) => x.ordinal)).toEqual([1, 2, 3]);
  });

  it('esconder uma secao nao a remove da lista de configuracao', async () => {
    const { aoSalvar } = montar();
    fireEvent.click(within(linhaDe('Antecedentes')).getByRole('checkbox', { name: /mostrar/i }));
    // Sumir da propria tela de configuracao deixaria a secao inalcancavel: nao
    // haveria como traze-la de volta.
    expect(linhaDe('Antecedentes')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    });
    expect(aoSalvar.mock.calls[0]![0].find((x) => x.sectionId === 's2')?.visible)
      .toBe(false);
  });

  it('esconder TODAS e recusado', () => {
    montar();
    for (const r of ['Evolucao', 'Antecedentes', 'Sinais vitais']) {
      fireEvent.click(within(linhaDe(r)).getByRole('checkbox', { name: /mostrar/i }));
    }
    // Ficha sem nenhuma secao e uma tela de atendimento em branco — o medico
    // abriria a consulta e nao teria onde escrever.
    expect(screen.getByRole('button', { name: /salvar/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos uma/i);
  });

  it('sem mexer em nada, salvar fica desabilitado', () => {
    montar();
    // Salvar sem mudanca gravaria um layout personalizado identico ao padrao —
    // e a partir dai o medico deixaria de receber mudancas da clinica.
    expect(screen.getByRole('button', { name: /salvar/i })).toBeDisabled();
  });

  it('quem esta no padrao ve que esta no padrao', () => {
    montar();
    expect(screen.getByText(/seguindo a ordem da clinica/i)).toBeInTheDocument();
  });

  it('quem personalizou pode voltar ao padrao', async () => {
    const { aoSalvar } = montar({
      secoes: SECOES.map((s) => ({ ...s, personalizado: true })),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /voltar ao padr/i }));
    });
    // Lista vazia = apaga a personalizacao e volta a seguir a clinica.
    expect(aoSalvar).toHaveBeenCalledWith([]);
  });
});
