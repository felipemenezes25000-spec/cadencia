import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

/**
 * Emite dois recibos direto no banco: a emissao ja e exercida pela rota de
 * pagamento. Vai pela conexao ADMIN e nao pelo papel `jobs` — jobs tem
 * BYPASSRLS, que ignora POLICY mas nao ignora GRANT, e ele nao tem GRANT em
 * fin.payment_method.
 */
async function semearRecibos(t: SementeSessao): Promise<{ numeros: number[] }> {
  const j = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  const metodoId = uuidv7();
  await j.query(
    `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
     VALUES ($1, $2, 'dinheiro', 'Dinheiro')
     ON CONFLICT DO NOTHING`, [t.tenantId, metodoId]);

  const numeros: number[] = [];
  for (const [i, valor] of [15000, 25000].entries()) {
    const entryId = uuidv7();
    await j.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, patient_id, professional_id, clinic_id, description,
          amount_cents, payment_method_id, paid_at, status, idempotency_key)
       VALUES ($1, $2, 'receita', $3, $4, $5, $6, $7, $8,
               clock_timestamp(), 'pago', $9)`,
      [t.tenantId, entryId, t.patientId, t.professionalId, t.clinicId,
       `Consulta ${i + 1}`, valor, metodoId, `sem-${entryId}`]);
    await j.query(
      `INSERT INTO fin.receipt (tenant_id, id, entry_id, receipt_number)
       VALUES ($1, $2, $3, $4)`, [t.tenantId, uuidv7(), entryId, i + 1]);
    numeros.push(i + 1);
  }
  await j.end();
  return { numeros };
}

beforeAll(async () => { s = await semearSessao({ role: 'financeiro' }); });
afterAll(async () => { await closePools(); });

describe('recibos', () => {
  it('GET /v1/receipts lista com numero, valor e paciente, do mais novo ao mais antigo', async () => {
    const app = await buildApp();
    await semearRecibos(s);

    const r = await app.inject({ method: 'GET', url: '/v1/receipts', ...auth(s) });
    expect(r.statusCode).toBe(200);

    const itens = (r.json() as {
      itens: { receiptNumber: number; valorCents: number; patientNome: string | null }[] }).itens;
    expect(itens).toHaveLength(2);
    // Recibo 2 e o mais recente: a recepcao quer o ultimo emitido no topo.
    expect(itens[0]?.receiptNumber).toBe(2);
    expect(itens[0]?.valorCents).toBe(25000);
    expect(itens[0]?.patientNome).toBe(s.patientNome);

    await app.close();
  });

  it('GET /v1/receipts filtra por periodo de emissao', async () => {
    const app = await buildApp();
    const t = await semearSessao({ role: 'financeiro' });
    await semearRecibos(t);

    const vazio = await app.inject({
      method: 'GET', url: '/v1/receipts?de=2020-01-01&ate=2020-12-31', ...auth(t) });
    expect(vazio.statusCode).toBe(200);
    expect((vazio.json() as { itens: unknown[] }).itens).toHaveLength(0);

    await app.close();
  });

  it('GET /v1/receipts nao enxerga recibo de outro tenant', async () => {
    const app = await buildApp();
    const a = await semearSessao({ role: 'financeiro' });
    const b = await semearSessao({ role: 'financeiro' });
    await semearRecibos(b);

    const r = await app.inject({ method: 'GET', url: '/v1/receipts', ...auth(a) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { itens: unknown[] }).itens).toHaveLength(0);

    await app.close();
  });
});
