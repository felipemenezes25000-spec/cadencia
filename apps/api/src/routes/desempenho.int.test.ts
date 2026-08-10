import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

/**
 * Dois MESES com receita diferente. A tela compara mes contra mes, entao os
 * lancamentos sao ancorados no dia 10 de cada um — longe das bordas, para o
 * teste nao depender de em que dia do mes ele roda.
 *   - mes anterior: 2 atendimentos de R$ 200
 *   - mes atual:    3 atendimentos de R$ 300
 */
async function semearHistorico(t: SementeSessao): Promise<void> {
  const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    const metodo = uuidv7();
    await a.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1,$2,'pix','Pix')`, [t.tenantId, metodo]);

    const lancar = async (valor: number, mesesAtras: number) => {
      await a.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, patient_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key)
         VALUES ($1,$2,'receita',$3,$4,$5,'Consulta',$6,$7,
                 (date_trunc('month', clock_timestamp())
                  - make_interval(months => $8::int) + interval '9 days'),
                 'pago',$9)`,
        [t.tenantId, uuidv7(), t.patientId, t.professionalId, t.clinicId,
         valor, metodo, mesesAtras, `desemp-${uuidv7()}`]);
    };

    await lancar(20000, 1);
    await lancar(20000, 1);
    await lancar(30000, 0);
    await lancar(30000, 0);
    await lancar(30000, 0);
  } finally {
    await a.end();
  }
}

beforeAll(async () => {
  s = await semearSessao({ role: 'admin_clinico' });
  await semearHistorico(s);
});
afterAll(async () => { await closePools(); });

describe('indicadores de desempenho', () => {
  it('GET /v1/desempenho/indicadores compara os dois periodos', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/desempenho/indicadores', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const d = r.json() as {
      indicators: { metric: string; deltaAbsolute: number; deltaPercent: number }[];
      freshness: { source: string; refreshedAt: string | null };
    };

    const receita = d.indicators.find((x) => x.metric === 'receita');
    // 90.000 agora contra 40.000 antes: +50.000 e +125%.
    expect(receita?.deltaAbsolute).toBe(50000);
    expect(receita?.deltaPercent).toBe(125);

    const ticket = d.indicators.find((x) => x.metric === 'ticket_medio');
    // 30.000 contra 20.000: +10.000 e +50%.
    expect(ticket?.deltaAbsolute).toBe(10000);
    expect(ticket?.deltaPercent).toBe(50);

    expect(d.indicators.find((x) => x.metric === 'ocupacao')).toBeDefined();
    // A tela publica de onde veio o numero: 'live' quando calculado na hora.
    expect(['live', 'matview']).toContain(d.freshness.source);

    await app.close();
  });

  it('periodo sem receita anterior nao devolve percentual infinito', async () => {
    const app = await buildApp();
    const t = await semearSessao({ role: 'admin_clinico' });
    const r = await app.inject({
      method: 'GET', url: '/v1/desempenho/indicadores', ...auth(t) });

    expect(r.statusCode).toBe(200);
    const receita = (r.json() as {
      indicators: { metric: string; deltaPercent: number }[] })
      .indicators.find((x) => x.metric === 'receita');

    // Dividir por zero daria Infinity, que vira `null` no JSON e quebra a tela.
    // Zero anterior com zero atual e variacao ZERO, nao indefinida.
    expect(Number.isFinite(receita?.deltaPercent)).toBe(true);
    expect(receita?.deltaPercent).toBe(0);

    await app.close();
  });

  it('nao enxerga receita de outro tenant', async () => {
    const app = await buildApp();
    const outro = await semearSessao({ role: 'admin_clinico' });
    const r = await app.inject({
      method: 'GET', url: '/v1/desempenho/indicadores', ...auth(outro) });
    const receita = (r.json() as {
      indicators: { metric: string; deltaAbsolute: number }[] })
      .indicators.find((x) => x.metric === 'receita');
    expect(receita?.deltaAbsolute).toBe(0);
    await app.close();
  });
});
