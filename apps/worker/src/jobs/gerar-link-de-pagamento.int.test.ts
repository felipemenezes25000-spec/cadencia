import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createFakePaymentProvider } from '@cadencia/integrations';
import { gerarLinkDePagamento } from './gerar-link-de-pagamento';

afterAll(async () => { await closePools(); });

async function semearLancamento(): Promise<{ tenantId: string; entryId: string; userId: string }> {
  const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    const tenantId = uuidv7();
    const clinicId = uuidv7();
    const entryId = uuidv7();
    const pmId = uuidv7();
    const userId = uuidv7();
    const profId = uuidv7();
    // Slug vai como parâmetro próprio: reaproveitar $1 como uuid e como texto
    // faz o Postgres deduzir tipos conflitantes para o mesmo parâmetro.
    await a.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Link', '11222333000181')`,
      [tenantId, `link-${tenantId.slice(0, 13)}`]);
    await a.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, timezone)
       VALUES ($1, $2, 'Unidade', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await a.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'link'::fin.payment_method_kind, 'Link')`,
      [tenantId, pmId]);
    await a.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dra. Link')`,
      [userId, `link-${userId.slice(0, 13)}@teste.local`]);
    await a.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho)
       VALUES ($1,$2,$3,'06','123456','SP')`,
      [tenantId, profId, userId]);
    await a.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, clinic_id, professional_id, amount_cents,
          payment_method_id, status, description, idempotency_key)
       VALUES ($1,$2,'receita',$3,$6,15000,$4,'pendente','Consulta',$5)`,
      [tenantId, entryId, clinicId, pmId, `link:${entryId}`, profId]);
    return { tenantId, entryId, userId };
  } finally {
    await a.end();
  }
}

describe('gerar link de pagamento', () => {
  it('cria o link no provedor e grava a URL', async () => {
    const { tenantId, entryId, userId } = await semearLancamento();
    const r = await gerarLinkDePagamento(
      { tenantId, entryId, amountCents: 15000, description: 'Consulta', solicitadoPor: userId },
      createFakePaymentProvider());

    // Narrowing explícito: o retorno é união discriminada, e só o ramo 'criado'
    // tem url. Ler .url sem estreitar é o que o typecheck pega e o vitest não.
    if (r.status !== 'criado') throw new Error(`esperava criado, veio ${r.status}`);
    expect(r.url).toMatch(/^https?:\/\//);

    const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    try {
      const { rows } = await a.query<{ url: string; entry_id: string }>(
        `SELECT url, entry_id FROM fin.payment_link WHERE entry_id = $1`, [entryId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.url).toBe(r.url);
    } finally { await a.end(); }
  });

  it('rodar de novo nao cria segundo link — o outbox entrega ao menos uma vez', async () => {
    const { tenantId, entryId, userId } = await semearLancamento();
    const entrada = { tenantId, entryId, amountCents: 15000, description: 'Consulta', solicitadoPor: userId };
    const primeiro = await gerarLinkDePagamento(entrada, createFakePaymentProvider());
    const segundo = await gerarLinkDePagamento(entrada, createFakePaymentProvider());
    if (primeiro.status !== 'criado' || segundo.status !== 'criado') {
      throw new Error('esperava os dois criados');
    }

    // Entrega "ao menos uma vez" é a garantia do outbox, não "exatamente uma".
    // Sem idempotência aqui, uma reentrega geraria uma SEGUNDA cobrança para o
    // mesmo atendimento — e o paciente pagaria duas vezes.
    expect(segundo.url).toBe(primeiro.url);
    const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    try {
      const { rows } = await a.query(
        `SELECT id FROM fin.payment_link WHERE entry_id = $1`, [entryId]);
      expect(rows).toHaveLength(1);
    } finally { await a.end(); }
  });

  it('lancamento inexistente nao explode a fila', async () => {
    const r = await gerarLinkDePagamento(
      { tenantId: uuidv7(), entryId: uuidv7(), amountCents: 100, description: 'x', solicitadoPor: uuidv7() },
      createFakePaymentProvider());
    // Job que lança exceção volta para a fila e tenta de novo para sempre.
    // Lançamento que não existe nunca vai existir: é falha terminal.
    expect(r.status).toBe('lancamento_nao_encontrado');
  });
});
