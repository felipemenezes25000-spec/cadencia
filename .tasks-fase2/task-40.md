### Task 40: webhook de pagamento — rota publica com validacao de assinatura do PSP

**Arquivos**
- Criar `apps/api/src/routes/payments-webhook.ts`
- Criar `apps/api/src/routes/payments-webhook.int.test.ts`
- Modificar `apps/api/src/app.ts`

**Passos**

- [ ] Criar a rota de webhook de pagamento `apps/api/src/routes/payments-webhook.ts`.

```ts
// apps/api/src/routes/payments-webhook.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenantTx, jobsPool, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { providers } from '../providers';

/**
 * Webhook do PSP (Payment Service Provider).
 *
 * REGRAS CRITICAS:
 * 1. SEM autenticacao de sessao — valida assinatura do PSP
 * 2. tenant_id NUNCA vem do request — e resolvido pelo payment_link/payment no banco
 * 3. Grava evento bruto ANTES de processar
 */
export async function paymentWebhookRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/payments/webhook', {
    schema: {
      response: {
        200: z.object({ accepted: z.literal(true) }),
        401: z.object({ erro: z.literal('assinatura_invalida') }),
      },
    },
  }, async (req, reply) => {
    const rawBody = typeof req.body === 'string'
      ? Buffer.from(req.body)
      : Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body));
    const headers = req.headers as Record<string, string>;

    // Validar assinatura do PSP
    const payment = providers().payment;
    const verificacao = payment.verifyWebhook(rawBody, headers);
    if (!verificacao.valid) {
      return reply.code(401).send({ erro: 'assinatura_invalida' as const });
    }

    // Parsear o evento
    const parsed = JSON.parse(rawBody.toString()) as {
      eventType: string;
      paymentLinkId?: string;
      providerPaymentId?: string;
      status?: string;
      amountCents?: number;
      paidAt?: string;
    };

    // Resolver tenant_id pelo payment_link_id ou provider_payment_id
    let tenantId: string | null = null;
    let paymentLinkId: string | null = null;

    if (parsed.paymentLinkId !== undefined) {
      const { rows } = await jobsPool().query<{ tenant_id: string; id: string }>(
        `SELECT tenant_id, id FROM fin.payment_link WHERE id = $1`,
        [parsed.paymentLinkId]);
      if (rows.length > 0) {
        tenantId = rows[0]!.tenant_id;
        paymentLinkId = rows[0]!.id;
      }
    }

    if (tenantId === null && parsed.providerPaymentId !== undefined) {
      const { rows } = await jobsPool().query<{ tenant_id: string }>(
        `SELECT tenant_id FROM fin.payment WHERE provider_payment_id = $1`,
        [parsed.providerPaymentId]);
      if (rows.length > 0) {
        tenantId = rows[0]!.tenant_id;
      }
    }

    if (tenantId === null) {
      // Evento de pagamento sem referencia no nosso banco — aceitar mas ignorar
      return { accepted: true as const };
    }

    const requestId = uuidv7();
    const actor: Actor = {
      kind: 'system',
      tenantId,
      reason: 'webhook-psp-inbound',
      requestId,
    };

    await withTenantTx(actor, async (tx) => {
      // Gravar evento bruto
      await tx.query(
        `INSERT INTO fin.webhook_event
           (id, event_type, raw_payload, received_at)
         VALUES ($1, $2, $3, clock_timestamp())`,
        [uuidv7(), parsed.eventType ?? 'unknown', rawBody]);

      // Processar evento de pagamento confirmado
      if (parsed.eventType === 'payment.confirmed' && paymentLinkId !== null) {
        const paymentId = uuidv7();

        // Obter dados do link
        const { rows: linkRows } = await tx.query<{
          patient_id: string; encounter_id: string | null;
          clinic_id: string; amount_cents: string; created_by: string;
        }>(
          `SELECT patient_id, encounter_id, clinic_id, amount_cents::text, created_by
             FROM fin.payment_link WHERE id = $1`, [paymentLinkId]);

        if (linkRows.length > 0) {
          const link = linkRows[0]!;

          // Criar pagamento a partir do link
          await tx.query(
            `INSERT INTO fin.payment
               (id, patient_id, encounter_id, clinic_id, amount_cents, method,
                status, provider_payment_id, created_by, paid_at)
             VALUES ($1, $2, $3, $4, $5, 'link', 'confirmed', $6, $7, clock_timestamp())`,
            [paymentId, link.patient_id, link.encounter_id,
             link.clinic_id, link.amount_cents,
             parsed.providerPaymentId ?? null, link.created_by]);

          // Atualizar status do link
          await tx.query(
            `UPDATE fin.payment_link SET status = 'paid', paid_at = clock_timestamp()
              WHERE id = $1`, [paymentLinkId]);

          // Gerar recibo
          await tx.query(
            `INSERT INTO fin.receipt (id, payment_id, clinic_id, generated_at)
             VALUES ($1, $2, $3, clock_timestamp())`,
            [uuidv7(), paymentId, link.clinic_id]);
        }
      }

      // Processar evento de estorno
      if (parsed.eventType === 'payment.refunded' && parsed.providerPaymentId !== undefined) {
        await tx.query(
          `UPDATE fin.payment SET status = 'refunded', refunded_at = clock_timestamp()
            WHERE provider_payment_id = $1 AND status = 'confirmed'`,
          [parsed.providerPaymentId]);
      }
    });

    return { accepted: true as const };
  });
}
```

- [ ] Adicionar `payment` ao registry de providers em `apps/api/src/providers.ts`.

```ts
// apps/api/src/providers.ts
import {
  createFakePrescriptionProvider, createFakeSignatureProvider,
  createFakeMessagingProvider, createFakePaymentProvider,
  type PrescriptionProvider, type SignatureProvider,
  type MessagingProvider, type PaymentProvider,
} from '@cadencia/integrations';

export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
  readonly messaging: MessagingProvider;
  readonly payment: PaymentProvider;
}

let cache: Providers | null = null;

export function providers(): Providers {
  if (cache !== null) return cache;
  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  if (!usarFakes) {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais configurados');
  }
  cache = {
    signature: createFakeSignatureProvider(),
    prescription: createFakePrescriptionProvider(),
    messaging: createFakeMessagingProvider(),
    payment: createFakePaymentProvider(),
  };
  return cache;
}
```

- [ ] Registrar a rota de webhook de pagamento no `apps/api/src/app.ts`.

```ts
// No topo de apps/api/src/app.ts, adicionar:
import { paymentWebhookRoutes } from './routes/payments-webhook';

// Apos o register de paymentRoutes:
//   await app.register(paymentRoutes);
//   await app.register(paymentWebhookRoutes);
```

- [ ] Criar o teste de integracao `apps/api/src/routes/payments-webhook.int.test.ts`.

```ts
// apps/api/src/routes/payments-webhook.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { buildApp } from '../app';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let clinicId: string;
let patientId: string;
let paymentLinkId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  clinicId = uuidv7();
  patientId = uuidv7();
  paymentLinkId = uuidv7();
  const userId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Pay Wh', '66666666000196')`,
      [tenantId, `pwh-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade PayWh', '2077507', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User PayWh')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente PayWh', 'completo', '1988-03-15')`,
      [tenantId, patientId]);
    await c.query(
      `INSERT INTO fin.payment_link
         (tenant_id, id, patient_id, clinic_id, amount_cents,
          description, expires_at, status, created_by)
       VALUES ($1, $2, $3, $4, 20000, 'Consulta via link',
               clock_timestamp() + interval '24 hours', 'pending', $5)`,
      [tenantId, paymentLinkId, patientId, clinicId, userId]);
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

describe('webhook de pagamento', () => {
  it('POST /v1/payments/webhook processa pagamento confirmado via link', async () => {
    const app = await buildApp();
    const payload = JSON.stringify({
      eventType: 'payment.confirmed',
      paymentLinkId,
      providerPaymentId: 'psp_pay_abc123',
      status: 'paid',
      amountCents: 20000,
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
    expect(r.json()).toEqual({ accepted: true });

    // Verificar que o webhook_event foi gravado
    const { rows: events } = await jobsPool().query<{ id: string }>(
      `SELECT id FROM fin.webhook_event
        WHERE event_type = 'payment.confirmed'
        ORDER BY received_at DESC LIMIT 1`);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Verificar que o pagamento foi criado
    const { rows: pays } = await jobsPool().query<{
      provider_payment_id: string; status: string;
    }>(
      `SELECT provider_payment_id, status::text
         FROM fin.payment WHERE provider_payment_id = 'psp_pay_abc123'`);
    expect(pays.length).toBe(1);
    expect(pays[0]!.status).toBe('confirmed');

    // Verificar que o link foi marcado como pago
    const { rows: links } = await jobsPool().query<{ status: string }>(
      `SELECT status::text FROM fin.payment_link WHERE id = $1`, [paymentLinkId]);
    expect(links[0]!.status).toBe('paid');

    await app.close();
  });

  it('webhook nao aceita tenant_id como parametro — resolve pelo payment_link', async () => {
    const linkId2 = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    await admin.query(
      `INSERT INTO fin.payment_link
         (tenant_id, id, patient_id, clinic_id, amount_cents,
          description, expires_at, status, created_by)
       VALUES ($1, $2, $3, $4, 10000, 'Segundo link',
               clock_timestamp() + interval '24 hours', 'pending',
               (SELECT id FROM id."user" LIMIT 1))`,
      [tenantId, linkId2, patientId, clinicId]);
    await admin.end();

    const app = await buildApp();
    const payload = JSON.stringify({
      tenant_id: '00000000-0000-0000-0000-000000000000',
      eventType: 'payment.confirmed',
      paymentLinkId: linkId2,
      providerPaymentId: 'psp_pay_inject2',
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: { 'content-type': 'application/json', 'x-psp-signature': 'valid-sig' },
      payload,
    });

    expect(r.statusCode).toBe(200);

    // Pagamento criado com o tenant correto
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM fin.payment WHERE provider_payment_id = 'psp_pay_inject2'`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.tenant_id).toBe(tenantId);
    expect(rows[0]!.tenant_id).not.toBe('00000000-0000-0000-0000-000000000000');

    await app.close();
  });
});
```

- [ ] Rodar os testes e confirmar que passam.

```bash
pnpm vitest run apps/api/src/routes/payments-webhook.int.test.ts
# Esperado: PASS — todos os 2 testes verdes
```

- [ ] Commitar.

```bash
git add apps/api/src/routes/payments-webhook.ts \
       apps/api/src/routes/payments-webhook.int.test.ts \
       apps/api/src/app.ts apps/api/src/providers.ts
git commit -m "feat(api): add payment webhook route with PSP signature validation"
```

---