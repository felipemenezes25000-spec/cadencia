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
  it('mostra as seções na ordem em que aparecem na ficha', () => {
    montar();
    const rotulos = screen.getAllByRole('listitem').map((l) => l.textContent ?? '');
    expect(rotulos[0]).toContain('Evolucao');
    expect(rotulos[2]).toContain('Sinais vitais');
  });

  it('a primeira não sobe e a última não desce', () => {
    montar();
    // Botão que não faz nada é pior que botão ausente: quem clica acha que a
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
    // Os ordinais saem RENUMERADOS de 1 a N, não com o valor antigo: buraco de
    // ordinal faria a próxima reordenação ficar ambígua.
    expect(itens.map((x) => x.sectionId)).toEqual(['s1', 's3', 's2']);
    expect(itens.map((x) => x.ordinal)).toEqual([1, 2, 3]);
  });

  it('esconder uma seção não a remove da lista de configuração', async () => {
    const { aoSalvar } = montar();
    fireEvent.click(within(linhaDe('Antecedentes')).getByRole('checkbox', { name: /mostrar/i }));
    // Sumir da própria tela de configuração deixaria a seção inalcançável: não
    // haveria como trazê-la de volta.
    expect(linhaDe('Antecedentes')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    });
    expect(aoSalvar.mock.calls[0]![0].find((x) => x.sectionId === 's2')?.visible)
      .toBe(false);
  });

  it('esconder TODAS é recusado', () => {
    montar();
    for (const r of ['Evolucao', 'Antecedentes', 'Sinais vitais']) {
      fireEvent.click(within(linhaDe(r)).getByRole('checkbox', { name: /mostrar/i }));
    }
    // Ficha sem nenhuma seção é uma tela de atendimento em branco — o médico
    // abriria a consulta e não teria onde escrever.
    expect(screen.getByRole('button', { name: /salvar/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos uma/i);
  });

  it('sem mexer em nada, salvar fica desabilitado', () => {
    montar();
    // Salvar sem mudança gravaria um layout personalizado idêntico ao padrão —
    // e a partir daí o médico deixaria de receber mudanças da clínica.
    expect(screen.getByRole('button', { name: /salvar/i })).toBeDisabled();
  });

  it('quem está no padrão vê que está no padrão', () => {
    montar();
    expect(screen.getByText(/seguindo a ordem da clínica/i)).toBeInTheDocument();
  });

  it('quem personalizou pode voltar ao padrão', async () => {
    const { aoSalvar } = montar({
      secoes: SECOES.map((s) => ({ ...s, personalizado: true })),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /voltar ao padr/i }));
    });
    // Lista vazia = apaga a personalização e volta a seguir a clínica.
    expect(aoSalvar).toHaveBeenCalledWith([]);
  });
});
