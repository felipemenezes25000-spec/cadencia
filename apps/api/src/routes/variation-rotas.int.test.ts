import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

/**
 * Testa as rotas pelo HTTP, e nao as funcoes de dominio.
 *
 * O irmao `variation.int.test.ts` chama `computeVariation` e `drillDownFactor`
 * dentro de uma transacao e declara, no proprio comentario, que montar o Fastify
 * era "responsabilidade de outro bloco (API shell)". Esse bloco nunca veio: a
 * tela de Desempenho chamava `/v1/variation` e `/v1/variation/drill-down`, que
 * NAO EXISTIAM em rota nenhuma — 404 nas duas, com a suite inteira verde.
 *
 * O vermelho deste teste foi observado em producao antes da correcao: os dois
 * caminhos devolviam 404, e o cruzamento das 131 rotas do OpenAPI com as 92
 * chamadas do frontend acusou exatamente esses dois orfaos.
 *
 * Por isso o foco aqui e o CONTRATO da rota — existir, exigir sessao, devolver a
 * forma que a tela consome. A aritmetica dos fatores ja tem dono no teste irmao.
 */

let s: SementeSessao;

/** Um mes contra o anterior, ancorados longe da borda do mes. */
const PERIODOS = {
  period_a_start: '2026-06-01', period_a_end: '2026-06-30',
  period_b_start: '2026-07-01', period_b_end: '2026-07-31',
} as const;

function query(extra: Record<string, string> = {}): string {
  return new URLSearchParams({ ...PERIODOS, ...extra }).toString();
}

beforeAll(async () => { s = await semearSessao({ role: 'admin_clinico' }); });
afterAll(async () => { await closePools(); });

describe('GET /v1/reports/variation/factors', () => {
  it('devolve os seis fatores aditivos, rotulados, na ordem do waterfall', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/reports/variation/factors?${query()}`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    const d = r.json() as {
      factors: { factor: string; label: string; delta_cents: number }[];
      totalACents: number; totalBCents: number; deltaTotalCents: number;
    };

    expect(d.factors.map((f) => f.factor)).toEqual([
      'volume', 'mix_procedimento', 'mix_convenio', 'ticket', 'faltas', 'glosas',
    ]);
    // A tela cai no proprio dicionario quando `label` vem vazio; mandar rotulo
    // do servidor evita que a chave crua ("mix_procedimento") vaze para a tela.
    for (const f of d.factors) expect(f.label.length).toBeGreaterThan(0);
    for (const f of d.factors) expect(Number.isInteger(f.delta_cents)).toBe(true);

    // Os totais ficam FORA da lista de fatores: dentro dela, o waterfall somaria
    // a receita do periodo como se fosse mais um fator.
    expect(d.factors.some((f) => f.factor.startsWith('total'))).toBe(false);

    await app.close();
  });

  it('exige sessao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/reports/variation/factors?${query()}` });

    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it('recusa periodo com data malformada em vez de consultar o banco', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation/factors?period_a_start=junho&period_a_end=2026-06-30'
        + '&period_b_start=2026-07-01&period_b_end=2026-07-31',
      ...auth(s) });

    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe('GET /v1/reports/variation/drill-down', () => {
  it('abre um fator por profissional quando a dimensao nao e informada', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/reports/variation/drill-down?${query({ factor: 'faltas' })}`,
      ...auth(s) });

    expect(r.statusCode).toBe(200);
    const d = r.json() as { dimension: string; groups: unknown[]; totalCount: number };
    // `profissional` e o padrao porque e o que a tela assume quando a chamada
    // falha — divergir aqui trocaria a dimensao sem a tela perceber.
    expect(d.dimension).toBe('profissional');
    expect(Array.isArray(d.groups)).toBe(true);
    expect(Number.isInteger(d.totalCount)).toBe(true);

    await app.close();
  });

  it('honra a dimensao pedida', async () => {
    const app = await buildApp();
    for (const dim of ['dia_semana', 'faixa_horario'] as const) {
      const r = await app.inject({
        method: 'GET',
        url: `/v1/reports/variation/drill-down?${query({ factor: 'volume', dimension: dim })}`,
        ...auth(s) });

      expect(r.statusCode).toBe(200);
      expect((r.json() as { dimension: string }).dimension).toBe(dim);
    }
    await app.close();
  });

  it('recusa fator que o dominio nao conhece, sem chegar ao banco', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/reports/variation/drill-down?${query({ factor: 'inventado' })}`,
      ...auth(s) });

    // O `z.enum` barra na borda: o dominio lanca `Error` para fator invalido, e
    // erro de dominio vira 500. Validar no schema transforma isso em 400.
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});
