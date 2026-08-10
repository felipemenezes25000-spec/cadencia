import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

/** Uma despesa pendente e um recebimento pendente, para exercer as duas acoes. */
async function semearPendencias(t: SementeSessao): Promise<{ despesa: string; receita: string }> {
  const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  const despesa = uuidv7();
  const receita = uuidv7();
  try {
    // Nome unico por chamada: `fin.payment_method` tem UNIQUE (tenant_id, name)
    // e esta semeadura roda varias vezes para o mesmo tenant.
    //
    // O nome leva o uuid INTEIRO, nunca um prefixo: os primeiros digitos hex de
    // um uuidv7 sao o timestamp em milissegundos, e duas chamadas da mesma
    // rodada cairiam no mesmo prefixo. Mesma armadilha documentada em
    // packages/authn/src/totp.int.test.ts.
    const metodo = uuidv7();
    await a.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1,$2,'pix',$3)`, [t.tenantId, metodo, `Pix ${metodo}`]);
    for (const [id, kind, desc] of [
      [despesa, 'despesa', 'Aluguel a pagar'],
      [receita, 'receita', 'Consulta a receber'],
    ] as const) {
      await a.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, patient_id, professional_id, clinic_id, description,
            amount_cents, payment_method_id, due_date, status, idempotency_key)
         VALUES ($1,$2,$3::fin.entry_kind,$4,$5,$6,$7,50000,$8,
                 (clock_timestamp() + interval '3 days')::date,'pendente',$9)`,
        [t.tenantId, id, kind, kind === 'receita' ? t.patientId : null,
         t.professionalId, t.clinicId, desc, metodo, `acao-${id}`]);
    }
  } finally {
    await a.end();
  }
  return { despesa, receita };
}

beforeAll(async () => { s = await semearSessao({ role: 'admin_clinico' }); });
afterAll(async () => { await closePools(); });

describe('acoes que as telas ja oferecem', () => {
  it('POST /v1/payables/:id/pagar marca a despesa como paga e carimba a data', async () => {
    const app = await buildApp();
    const { despesa } = await semearPendencias(s);

    const r = await app.inject({
      method: 'POST', url: `/v1/payables/${despesa}/pagar`, ...auth(s), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ payableId: despesa, status: 'pago' });

    const lista = await app.inject({ method: 'GET', url: '/v1/payables', ...auth(s) });
    const item = (lista.json() as {
      itens: { payableId: string; status: string; paidAt: string | null }[] })
      .itens.find((x) => x.payableId === despesa);
    expect(item?.status).toBe('confirmed');
    // O carimbo vem do banco, nao do cliente: e ele que decide em que dia a
    // despesa entra no caixa.
    expect(item?.paidAt).not.toBeNull();

    await app.close();
  });

  it('pagar duas vezes nao duplica nem quebra — a segunda e no-op', async () => {
    const app = await buildApp();
    const { despesa } = await semearPendencias(s);

    const primeira = await app.inject({
      method: 'POST', url: `/v1/payables/${despesa}/pagar`, ...auth(s), payload: {} });
    const segunda = await app.inject({
      method: 'POST', url: `/v1/payables/${despesa}/pagar`, ...auth(s), payload: {} });

    expect(primeira.statusCode).toBe(200);
    // Idempotente: a recepcao clica duas vezes quando a rede demora, e isso
    // nao pode virar dois lancamentos nem um 500.
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json()).toMatchObject({ status: 'pago' });

    await app.close();
  });

  it('POST /v1/payments/:id/confirmar quita o recebimento', async () => {
    const app = await buildApp();
    const { receita } = await semearPendencias(s);

    const r = await app.inject({
      method: 'POST', url: `/v1/payments/${receita}/confirmar`, ...auth(s), payload: {} });
    expect(r.statusCode).toBe(200);

    const aReceber = await app.inject({
      method: 'GET', url: '/v1/financeiro/a-receber', ...auth(s) });
    const ainda = (aReceber.json() as { entradas: { id: string }[] })
      .entradas.find((x) => x.id === receita);
    expect(ainda).toBeUndefined();

    await app.close();
  });

  it('confirmar lancamento de outro tenant devolve 404', async () => {
    const app = await buildApp();
    const { receita } = await semearPendencias(s);
    const outro = await semearSessao({ role: 'admin_clinico' });

    const r = await app.inject({
      method: 'POST', url: `/v1/payments/${receita}/confirmar`, ...auth(outro), payload: {} });
    expect(r.statusCode).toBe(404);

    await app.close();
  });
});

describe('quebra-vidro', () => {
  it('POST /v1/pacientes/:id/quebra-vidro concede acesso e exige justificativa longa', async () => {
    const app = await buildApp();
    const prof = await semearSessao({ role: 'profissional' });

    const curta = await app.inject({
      method: 'POST', url: `/v1/pacientes/${prof.patientId}/quebra-vidro`, ...auth(prof),
      payload: { justificativa: 'urgente', horas: 4 } });
    // Justificativa curta e o mesmo que nenhuma: quem revisa o acesso depois
    // precisa entender por que ele aconteceu, e "urgente" nao explica nada.
    expect(curta.statusCode).toBe(422);

    const ok = await app.inject({
      method: 'POST', url: `/v1/pacientes/${prof.patientId}/quebra-vidro`, ...auth(prof),
      payload: {
        justificativa: 'Paciente inconsciente no pronto-socorro, sem acompanhante',
        horas: 4 } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ expiraEmHoras: 4 });

    await app.close();
  });

  it('recepcao nao quebra vidro — e ato assistencial', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({
      method: 'POST', url: `/v1/pacientes/${recepcao.patientId}/quebra-vidro`,
      ...auth(recepcao),
      payload: {
        justificativa: 'Preciso ver o prontuario para conferir um dado do cadastro',
        horas: 4 } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
