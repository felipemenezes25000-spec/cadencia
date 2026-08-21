import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { Panorama, topoComOutros, type DadosDoPanorama } from './Panorama';

/**
 * O `ParentSize` do visx mede o container por ResizeObserver e desenha 0x0 sem
 * medida — em jsdom nao existe layout, entao um polyfill vazio produziria SVG
 * sem eixo e todo teste de rotulo falharia por motivo errado. Este devolve uma
 * medida plausivel de desktop, que e o que `audit-responsive` ja faz.
 */
beforeAll(() => {
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element) {
      this.cb([{
        target,
        contentRect: { x: 0, y: 0, width: 640, height: 240, top: 0, left: 0,
          bottom: 240, right: 640, toJSON: () => '' },
        borderBoxSize: [{ blockSize: 240, inlineSize: 640 }],
        contentBoxSize: [{ blockSize: 240, inlineSize: 640 }],
        devicePixelContentBoxSize: [],
      } as ResizeObserverEntry], this);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

const VAZIO: DadosDoPanorama = {
  atendimentosNoPeriodo: [],
  porProcedimento: [],
  porConvenio: [],
  duracaoMedia: [],
  pacientesNovos: [],
  distribuicaoEtaria: [],
};

const CHEIO: DadosDoPanorama = {
  atendimentosNoPeriodo: [
    { dia: '2026-08-01', total: 12 },
    { dia: '2026-08-02', total: 9 },
  ],
  porProcedimento: [
    { rotulo: 'Consulta', total: 40 },
    { rotulo: 'Retorno', total: 15 },
  ],
  porConvenio: [
    { rotulo: 'Particular', total: 30 },
    { rotulo: 'Unimed', total: 25 },
  ],
  duracaoMedia: [{ rotulo: 'Consulta', minutos: 28 }],
  pacientesNovos: [{ dia: '2026-08-01', total: 3 }],
  distribuicaoEtaria: [
    { faixa: '0-17', total: 5 },
    { faixa: '18-39', total: 22 },
    { faixa: '40-59', total: 18 },
  ],
};

describe('Panorama', () => {
  it('desenha os seis painéis de /v1/painel/graficos', async () => {
    /* A rota devolvia os seis conjuntos e nenhuma tela os consumia. Este teste
       existe para que a ligacao nao volte a se perder em silencio. */
    render(<Panorama dias={30} carregarDados={async () => CHEIO} />);

    for (const titulo of [
      'Atendimentos por dia',
      'Pacientes novos',
      'Procedimentos mais realizados',
      'Mix de convênios',
      'Duração média por procedimento',
      'Distribuição etária',
    ]) {
      expect(await screen.findByRole('region', { name: titulo })).toBeVisible();
    }
  });

  it('mostra skeleton enquanto os dados não chegam', () => {
    render(<Panorama dias={30} carregarDados={() => new Promise(() => {})} />);
    expect(screen.getByRole('status', { name: /Carregando panorama/ })).toBeInTheDocument();
  });

  it('painel sem dado diz que está vazio, em vez de desenhar eixo oco', async () => {
    render(<Panorama dias={30} carregarDados={async () => VAZIO} />);
    const painel = await screen.findByRole('region', { name: 'Atendimentos por dia' });
    expect(within(painel).getByText('Sem dados no período selecionado.')).toBeVisible();
  });

  it('em falha, avisa sem derrubar os indicadores de cima', async () => {
    render(<Panorama dias={30} carregarDados={vi.fn().mockRejectedValue(new Error('x'))} />);
    expect(await screen.findByText('Não foi possível carregar o panorama')).toBeVisible();
    expect(screen.getByText(/indicadores de variação acima continuam válidos/)).toBeVisible();
  });

  it('reflete a janela recebida nos rótulos, sem inventar período', async () => {
    render(<Panorama dias={90} carregarDados={async () => CHEIO} />);
    await waitFor(() =>
      expect(screen.getAllByText(/Últimos 90 dias/).length).toBeGreaterThan(0));
  });

  it('painel sem dado não renderiza gráfico nenhum', async () => {
    /* O eixo desenhado sobre zero dados parece grafico quebrado, nao "vazio". */
    render(<Panorama dias={30} carregarDados={async () => VAZIO} />);
    const painel = await screen.findByRole('region', { name: 'Mix de convênios' });
    expect(painel.querySelector('svg')).toBeNull();
  });
});

/**
 * `topoComOutros` e testado como funcao, e nao pelo DOM, de proposito: o
 * desenho e responsabilidade de `GraficoExplorar` (que tem teste proprio) e o
 * `ParentSize` do visx nao produz eixo em jsdom, onde nao ha layout. Asserir
 * rotulo de eixo aqui testaria o ambiente de teste, nao o recorte.
 */
describe('topoComOutros', () => {
  const dados = Array.from({ length: 20 }, (_, i) => ({
    label: `Procedimento ${i}`, value: 20 - i,
  }));

  it('devolve tudo quando cabe no limite', () => {
    const poucos = dados.slice(0, 3);
    expect(topoComOutros(poucos, 8)).toEqual(poucos);
  });

  it('mantém os N maiores e soma a cauda em "Outros"', () => {
    /* 40 procedimentos viram 40 barras, 30 delas indistinguiveis de zero: o
       grafico fica alto, ilegivel, e esconde justamente o topo que importa. */
    const r = topoComOutros(dados, 8);
    expect(r).toHaveLength(9);
    expect(r.slice(0, 8).map((d) => d.label)).toEqual(
      Array.from({ length: 8 }, (_, i) => `Procedimento ${i}`));
    /* A cauda sao os itens 8..19, com valores 12, 11, … 1 — soma 78. */
    expect(r[8]).toEqual({ label: 'Outros', value: 78 });
  });

  it('não perde volume: a cauda inteira sobrevive somada', () => {
    const total = dados.reduce((s, d) => s + d.value, 0);
    const somaRecortada = topoComOutros(dados, 8).reduce((s, d) => s + d.value, 0);
    expect(somaRecortada).toBe(total);
  });

  it('ordena por volume antes de cortar, mesmo com entrada fora de ordem', () => {
    const bagunca = [
      { label: 'pequeno', value: 1 },
      { label: 'grande', value: 100 },
      { label: 'medio', value: 50 },
    ];
    expect(topoComOutros(bagunca, 2).map((d) => d.label)).toEqual(['grande', 'medio', 'Outros']);
  });

  it('omite "Outros" quando a cauda soma zero, em vez de plotar uma barra nula', () => {
    const comZeros = [
      { label: 'a', value: 5 }, { label: 'b', value: 3 },
      { label: 'c', value: 0 }, { label: 'd', value: 0 },
    ];
    expect(topoComOutros(comZeros, 2).map((d) => d.label)).toEqual(['a', 'b']);
  });
});
