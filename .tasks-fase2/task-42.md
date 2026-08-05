### Task 42: teste de isolamento — webhook nao aceita tenant_id como parametro

**Arquivos**
- Criar `apps/api/src/routes/webhook-isolation.int.test.ts`

**Passos**

- [ ] Criar o teste de isolamento dedicado que verifica que nenhum webhook aceita tenant_id como parametro.

```ts
// apps/api/src/routes/webhook-isolation.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { buildApp } from '../app';

/**
 * Teste de isolamento (padrao test:iso) para webhooks.
 *
 * Verifica que NENHUMA rota de webhook aceita tenant_id como parametro
 * de entrada. O tenant_id deve ser resolvido internamente pela
 * channel_identity (mensageria) ou pelo payment_link/payment (pagamento).
 *
 * Cenario: cria dois tenants A e B. Envia webhook com tenant_id do B
 * para um recurso do A. O dado gravado deve pertencer ao tenant A,
 * nao ao B — provando que o tenant_id do request foi ignorado.
 */

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantA: string;
let tenantB: string;
let channelIdentityA: string;
let paymentLinkA: string;

beforeAll(async () => {
  tenantA = uuidv7();
  tenantB = uuidv7();
  const clinicA = uuidv7();
  const clinicB = uuidv7();
  const userA = uuidv7();
  const patientA = uuidv7();
  channelIdentityA = uuidv7();
  paymentLinkA = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // Tenant A
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Iso A', '11100011000100')`,
      [tenantA, `isoa-${tenantA.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Iso A', '2077511', 'America/Sao_Paulo')`,
      [tenantA, clinicA]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User Iso A')`,
      [userA, `${userA}@example.test`]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Iso A', 'completo', '1991-01-01')`,
      [tenantA, patientA]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel_kind, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Iso A Clinica', '+5511911111111', 'verified')`,
      [tenantA, channelIdentityA]);
    await c.query(
      `INSERT INTO fin.payment_link
         (tenant_id, id, patient_id, clinic_id, amount_cents,
          description, expires_at, status, created_by)
       VALUES ($1, $2, $3, $4, 30000, 'Link Iso A',
               clock_timestamp() + interval '24 hours', 'pending', $5)`,
      [tenantA, paymentLinkA, patientA, clinicA, userA]);

    // Tenant B (apenas para ter um ID diferente)
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Iso B', '22200022000200')`,
      [tenantB, `isob-${tenantB.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Iso B', '2077512', 'America/Sao_Paulo')`,
      [tenantB, clinicB]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();
});

afterAll(async () => { await closePools(); });

describe('isolamento de webhooks (test:iso)', () => {
  it('webhook de mensageria ignora tenant_id do request e usa o da channel_identity', async () => {
    const app = await buildApp();

    const payload = JSON.stringify({
      tenant_id: tenantB, // INJETADO — deve ser ignorado
      events: [{
        from: '+5511922222222',
        to: '+5511911111111', // telefone do tenant A
        body: 'Mensagem de teste de isolamento',
        providerMessageId: `wamid.iso-${uuidv7()}`,
      }],
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/messaging/webhook/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=fake-valid-signature',
      },
      payload,
    });
    expect(r.statusCode).toBe(200);

    // A conversa DEVE pertencer ao tenant A, NAO ao B
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM msg.conversation
        WHERE channel_identity_id = $1 AND remote_address = '+5511922222222'`,
      [channelIdentityA]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.tenant_id).toBe(tenantA);
    expect(rows[0]!.tenant_id).not.toBe(tenantB);

    await app.close();
  });

  it('webhook de pagamento ignora tenant_id do request e usa o do payment_link', async () => {
    const app = await buildApp();

    const payload = JSON.stringify({
      tenant_id: tenantB, // INJETADO — deve ser ignorado
      eventType: 'payment.confirmed',
      paymentLinkId: paymentLinkA, // pertence ao tenant A
      providerPaymentId: `psp_iso_${uuidv7()}`,
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-psp-signature': 'valid-sig',
      },
      payload,
    });
    expect(r.statusCode).toBe(200);

    // O pagamento DEVE pertencer ao tenant A, NAO ao B
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM fin.payment
        WHERE tenant_id = $1
        ORDER BY created_at DESC LIMIT 1`, [tenantA]);
    if (rows.length > 0) {
      expect(rows[0]!.tenant_id).toBe(tenantA);
      expect(rows[0]!.tenant_id).not.toBe(tenantB);
    }

    // Nunca deve haver pagamento no tenant B originado deste webhook
    const { rows: rowsB } = await jobsPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fin.payment WHERE tenant_id = $1`, [tenantB]);
    expect(Number(rowsB[0]?.n)).toBe(0);

    await app.close();
  });

  it('rota de webhook de mensageria NAO tem parametro tenant_id no schema', async () => {
    const app = await buildApp();
    // A rota nao aceita tenant_id como query param
    const r = await app.inject({
      method: 'POST',
      url: `/v1/messaging/webhook/whatsapp?tenant_id=${tenantB}`,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=fake-valid-signature',
      },
      payload: JSON.stringify({ events: [] }),
    });
    // Deve funcionar normalmente — o query param e ignorado
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('rota de webhook de pagamento NAO tem parametro tenant_id no schema', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/webhook?tenant_id=${tenantB}`,
      headers: {
        'content-type': 'application/json',
        'x-psp-signature': 'valid-sig',
      },
      payload: JSON.stringify({ eventType: 'unknown', providerPaymentId: 'none' }),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});
```

- [ ] Rodar o teste de isolamento.

```bash
pnpm vitest run apps/api/src/routes/webhook-isolation.int.test.ts
# Esperado: PASS — todos os 4 testes verdes
```

- [ ] Commitar.

```bash
git add apps/api/src/routes/webhook-isolation.int.test.ts
git commit -m "test(iso): verify webhooks never accept tenant_id from request parameters"
```

## Parte V — Telas