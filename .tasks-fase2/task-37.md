### Task 37: rotas de mensageria — conversas, mensagens, templates e automacoes

**Arquivos**
- Criar `apps/api/src/routes/messaging.ts`
- Criar `apps/api/src/routes/messaging.int.test.ts`
- Modificar `apps/api/src/app.ts`

**Passos**

- [ ] Criar o arquivo de rotas de mensageria `apps/api/src/routes/messaging.ts`.

```ts
// apps/api/src/routes/messaging.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const ConversationSchema = z.object({
  conversationId: z.string().uuid(),
  patientId: z.string().uuid().nullable(),
  channelKind: z.string(),
  remoteAddress: z.string(),
  displayName: z.string().nullable(),
  status: z.string(),
  lastMessageAt: z.string().nullable(),
  unreadCount: z.number().int(),
});

const MessageSchema = z.object({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  direction: z.enum(['inbound', 'outbound']),
  body: z.string(),
  mediaUrl: z.string().nullable(),
  mediaType: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  sentBy: z.string().uuid().nullable(),
});

const TemplateSchema = z.object({
  templateId: z.string().uuid(),
  slug: z.string(),
  channelKind: z.string(),
  category: z.string(),
  bodyTemplate: z.string(),
  variables: z.array(z.string()),
  providerStatus: z.string(),
  updatedAt: z.string(),
});

const AutomationRuleSchema = z.object({
  ruleId: z.string().uuid(),
  trigger: z.string(),
  templateId: z.string().uuid().nullable(),
  offsetMinutes: z.number().int(),
  enabled: z.boolean(),
  channelKind: z.string(),
  updatedAt: z.string(),
});

export async function messagingRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /v1/conversations ────────────────────────────────────────────────
  r.get('/v1/conversations', {
    schema: {
      querystring: z.object({
        status: z.enum(['open', 'closed', 'archived']).optional(),
        patientId: z.string().uuid().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(ConversationSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('messaging.conversation.read', async (tx, _ctx, req) => {
    const q = req.query as {
      status?: string; patientId?: string; cursor?: string; limit?: number };
    const limite = q.limit ?? 25;
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.status !== undefined) {
      condicoes.push(`c.status = $${idx}`);
      params.push(q.status);
      idx += 1;
    }
    if (q.patientId !== undefined) {
      condicoes.push(`c.patient_id = $${idx}`);
      params.push(q.patientId);
      idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`c.last_message_at < $${idx}`);
      params.push(q.cursor);
      idx += 1;
    }

    const where = condicoes.length > 0 ? `AND ${condicoes.join(' AND ')}` : '';
    params.push(limite + 1);

    const { rows } = await tx.query<{
      conversation_id: string; patient_id: string | null; channel_kind: string;
      remote_address: string; display_name: string | null; status: string;
      last_message_at: string | null; unread_count: string;
    }>(
      `SELECT c.id AS conversation_id, c.patient_id, c.channel_kind,
              c.remote_address, c.display_name, c.status::text,
              to_char(c.last_message_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_message_at,
              coalesce(c.unread_count, 0)::text AS unread_count
         FROM msg.conversation c
        WHERE TRUE ${where}
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT $${idx}`,
      params,
    );

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      conversationId: row.conversation_id,
      patientId: row.patient_id,
      channelKind: row.channel_kind,
      remoteAddress: row.remote_address,
      displayName: row.display_name,
      status: row.status,
      lastMessageAt: row.last_message_at,
      unreadCount: Number(row.unread_count),
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.lastMessageAt
      : null;

    return { itens, nextCursor };
  }));

  // ── GET /v1/conversations/:id/messages ───────────────────────────────────
  r.get('/v1/conversations/:id/messages', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      querystring: z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(MessageSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('messaging.message.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const q = req.query as { cursor?: string; limit?: number };
    const limite = q.limit ?? 50;
    const params: unknown[] = [p.id];
    let cursorClause = '';
    if (q.cursor !== undefined) {
      cursorClause = `AND m.created_at < $2`;
      params.push(q.cursor);
    }
    params.push(limite + 1);

    const { rows } = await tx.query<{
      message_id: string; conversation_id: string; direction: string;
      body: string; media_url: string | null; media_type: string | null;
      status: string; created_at: string; sent_by: string | null;
    }>(
      `SELECT m.id AS message_id, m.conversation_id,
              m.direction::text, m.body,
              m.media_url, m.media_type, m.status::text,
              to_char(m.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              m.sent_by
         FROM msg.message m
        WHERE m.conversation_id = $1 ${cursorClause}
        ORDER BY m.created_at DESC
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      messageId: row.message_id,
      conversationId: row.conversation_id,
      direction: row.direction as 'inbound' | 'outbound',
      body: row.body,
      mediaUrl: row.media_url,
      mediaType: row.media_type,
      status: row.status,
      createdAt: row.created_at,
      sentBy: row.sent_by,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt
      : null;

    return { itens, nextCursor };
  }));

  // ── POST /v1/conversations/:id/messages ──────────────────────────────────
  r.post('/v1/conversations/:id/messages', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        body: z.string().min(1).max(4096),
        templateId: z.string().uuid().optional(),
        variables: z.record(z.string(), z.string()).optional(),
      }),
      response: {
        201: z.object({
          messageId: z.string().uuid(),
          status: z.literal('queued'),
        }),
      },
    },
  }, rota('messaging.message.write', async (tx, ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as { body: string; templateId?: string;
                            variables?: Record<string, string> };

    // Verificar que a conversa existe
    const { rows: convRows } = await tx.query<{ id: string }>(
      `SELECT id FROM msg.conversation WHERE id = $1`, [p.id]);
    if (convRows.length === 0) erroDominio('conversa_nao_encontrada', 404);

    // Inserir a mensagem com status 'queued'
    const { rows } = await tx.query<{ message_id: string }>(
      `INSERT INTO msg.message
         (id, conversation_id, direction, body, status, sent_by,
          template_id, template_variables)
       VALUES (gen_random_uuid(), $1, 'outbound', $2, 'queued', $3, $4, $5)
       RETURNING id::text AS message_id`,
      [p.id, b.body, ctx.actor.userId,
       b.templateId ?? null,
       b.variables !== undefined ? JSON.stringify(b.variables) : null]);

    // Enfileirar no outbox para envio pelo worker
    await tx.query(
      `INSERT INTO msg.outbox_event (id, event_type, aggregate_id, payload)
       VALUES (gen_random_uuid(), 'send_message', $1,
               jsonb_build_object('messageId', $2, 'conversationId', $3))`,
      [rows[0]!.message_id, rows[0]!.message_id, p.id]);

    void reply.code(201);
    return { messageId: rows[0]!.message_id, status: 'queued' as const };
  }));

  // ── GET /v1/messaging/templates ──────────────────────────────────────────
  r.get('/v1/messaging/templates', {
    schema: {
      querystring: z.object({
        category: z.string().optional(),
        channelKind: z.string().optional(),
      }),
      response: {
        200: z.object({ itens: z.array(TemplateSchema) }),
      },
    },
  }, rota('messaging.template.read', async (tx, _ctx, req) => {
    const q = req.query as { category?: string; channelKind?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.category !== undefined) {
      condicoes.push(`t.category = $${idx}`);
      params.push(q.category);
      idx += 1;
    }
    if (q.channelKind !== undefined) {
      condicoes.push(`t.channel_kind = $${idx}`);
      params.push(q.channelKind);
      idx += 1;
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      template_id: string; slug: string; channel_kind: string; category: string;
      body_template: string; variables: string[]; provider_status: string;
      updated_at: string;
    }>(
      `SELECT t.id AS template_id, t.slug, t.channel_kind, t.category,
              t.body_template, t.variables, t.provider_status::text,
              to_char(t.updated_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
         FROM msg.template t
        ${where}
        ORDER BY t.category, t.slug`,
      params,
    );

    return {
      itens: rows.map((row) => ({
        templateId: row.template_id,
        slug: row.slug,
        channelKind: row.channel_kind,
        category: row.category,
        bodyTemplate: row.body_template,
        variables: row.variables,
        providerStatus: row.provider_status,
        updatedAt: row.updated_at,
      })),
    };
  }));

  // ── POST /v1/messaging/templates ─────────────────────────────────────────
  r.post('/v1/messaging/templates', {
    schema: {
      body: z.object({
        templateId: z.string().uuid().optional(),
        slug: z.string().min(1).max(128),
        channelKind: z.enum(['whatsapp', 'sms', 'email']),
        category: z.enum(['confirmacao', 'lembrete', 'pos_consulta', 'aniversario', 'nps', 'geral']),
        bodyTemplate: z.string().min(1).max(1024),
        variables: z.array(z.string()),
      }),
      response: {
        200: z.object({ templateId: z.string().uuid(), providerStatus: z.string() }),
      },
    },
  }, rota('messaging.template.write', async (tx, _ctx, req) => {
    const b = req.body as {
      templateId?: string; slug: string; channelKind: string;
      category: string; bodyTemplate: string; variables: string[] };

    if (b.templateId !== undefined) {
      // Upsert — atualizar template existente
      await tx.query(
        `UPDATE msg.template
            SET slug = $2, channel_kind = $3, category = $4,
                body_template = $5, variables = $6,
                provider_status = 'pending_approval',
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [b.templateId, b.slug, b.channelKind, b.category, b.bodyTemplate, b.variables]);
      return { templateId: b.templateId, providerStatus: 'pending_approval' };
    }

    const { rows } = await tx.query<{ template_id: string }>(
      `INSERT INTO msg.template
         (id, slug, channel_kind, category, body_template, variables, provider_status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'pending_approval')
       RETURNING id::text AS template_id`,
      [b.slug, b.channelKind, b.category, b.bodyTemplate, b.variables]);
    return { templateId: rows[0]!.template_id, providerStatus: 'pending_approval' };
  }));

  // ── GET /v1/messaging/automations ────────────────────────────────────────
  r.get('/v1/messaging/automations', {
    schema: {
      response: {
        200: z.object({ itens: z.array(AutomationRuleSchema) }),
      },
    },
  }, rota('messaging.automation.write', async (tx) => {
    const { rows } = await tx.query<{
      rule_id: string; trigger: string; template_id: string | null;
      offset_minutes: string; enabled: boolean; channel_kind: string;
      updated_at: string;
    }>(
      `SELECT r.id AS rule_id, r.trigger, r.template_id,
              r.offset_minutes::text, r.enabled, r.channel_kind,
              to_char(r.updated_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
         FROM msg.automation_rule r
        ORDER BY r.trigger, r.offset_minutes`);
    return {
      itens: rows.map((row) => ({
        ruleId: row.rule_id,
        trigger: row.trigger,
        templateId: row.template_id,
        offsetMinutes: Number(row.offset_minutes),
        enabled: row.enabled,
        channelKind: row.channel_kind,
        updatedAt: row.updated_at,
      })),
    };
  }));

  // ── PUT /v1/messaging/automations ────────────────────────────────────────
  r.put('/v1/messaging/automations', {
    schema: {
      body: z.object({
        rules: z.array(z.object({
          ruleId: z.string().uuid().optional(),
          trigger: z.enum(['confirmacao_24h', 'lembrete_2h', 'pos_consulta', 'aniversario', 'nps']),
          templateId: z.string().uuid().nullable(),
          offsetMinutes: z.number().int(),
          enabled: z.boolean(),
          channelKind: z.enum(['whatsapp', 'sms', 'email']),
        })),
      }),
      response: {
        200: z.object({ saved: z.number().int() }),
      },
    },
  }, rota('messaging.automation.write', async (tx, _ctx, req) => {
    const b = req.body as {
      rules: Array<{
        ruleId?: string; trigger: string; templateId: string | null;
        offsetMinutes: number; enabled: boolean; channelKind: string;
      }>;
    };

    let saved = 0;
    for (const rule of b.rules) {
      if (rule.ruleId !== undefined) {
        await tx.query(
          `UPDATE msg.automation_rule
              SET trigger = $2, template_id = $3, offset_minutes = $4,
                  enabled = $5, channel_kind = $6, updated_at = clock_timestamp()
            WHERE id = $1`,
          [rule.ruleId, rule.trigger, rule.templateId, rule.offsetMinutes,
           rule.enabled, rule.channelKind]);
      } else {
        await tx.query(
          `INSERT INTO msg.automation_rule
             (id, trigger, template_id, offset_minutes, enabled, channel_kind)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
          [rule.trigger, rule.templateId, rule.offsetMinutes,
           rule.enabled, rule.channelKind]);
      }
      saved += 1;
    }

    return { saved };
  }));
}
```

- [ ] Registrar as rotas de mensageria no `apps/api/src/app.ts`.

```ts
// apps/api/src/app.ts
// Adicionar o import no topo, junto aos outros imports de rotas:
import { messagingRoutes } from './routes/messaging';

// Adicionar o register apos clinicalArtifactRoutes:
//   await app.register(clinicalArtifactRoutes);
//   await app.register(messagingRoutes);
```

O arquivo completo fica:

```ts
// apps/api/src/app.ts
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import {
  serializerCompiler, validatorCompiler, type ZodTypeProvider, jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { comTransacao } from './context';
import { patientRoutes } from './routes/patients';
import { scheduleRoutes } from './routes/schedule';
import { encounterRoutes } from './routes/encounters';
import { clinicalArtifactRoutes } from './routes/clinical-artifacts';
import { messagingRoutes } from './routes/messaging';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(swagger, {
    openapi: { info: { title: 'Cadencia API', version: '1.0.0' } },
    transform: jsonSchemaTransform,
  });
  app.get('/openapi.json', async () => app.swagger());

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    return payload;
  });

  app.setErrorHandler((erro, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(erro)) {
      return reply.code(400).send({
        erro: 'validacao',
        campos: erro.validation.map((v) => ({
          path: (v.instancePath ?? '').replace(/^\//, ''),
          mensagem: v.message ?? '',
        })),
      });
    }
    const status = typeof (erro as { statusCode?: number }).statusCode === 'number'
      ? (erro as { statusCode: number }).statusCode : 500;
    const dominio = (erro as { dominio?: string }).dominio;
    if (typeof dominio === 'string') {
      const extra = (erro as { extra?: Record<string, unknown> }).extra ?? {};
      return reply.code(status).send({ erro: dominio, ...extra });
    }
    return reply.code(status).send({
      erro: status === 500 ? 'interno' : 'requisicao_invalida',
      requestId: req.id,
    });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ erro: 'nao_encontrado' }));

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/v1/whoami', async (req, reply) => {
    const r = await comTransacao(req, reply, async (_tx, ctx) => ({
      kind: ctx.actor.kind, tenantId: ctx.actor.tenantId,
      userId: ctx.actor.userId, clinicId: ctx.actor.clinicId,
    }));
    if (r === undefined) return reply;
    return r;
  });

  await app.register(patientRoutes);
  await app.register(scheduleRoutes);
  await app.register(encounterRoutes);
  await app.register(clinicalArtifactRoutes);
  await app.register(messagingRoutes);

  app.withTypeProvider<ZodTypeProvider>().get('/v1/echo', {
    schema: {
      querystring: z.object({ n: z.coerce.number().int() }),
      response: { 200: z.object({ n: z.number() }) },
    },
  }, async (req) => ({ n: req.query.n }));

  return app;
}
```

- [ ] Criar o arquivo de teste de integracao `apps/api/src/routes/messaging.int.test.ts`.

```ts
// apps/api/src/routes/messaging.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessaoMensageria, auth, type SementeSessaoMsg } from '../test-support-messaging';

let s: SementeSessaoMsg;
beforeAll(async () => { s = await semearSessaoMensageria(); });
afterAll(async () => { await closePools(); });

describe('rotas de mensageria', () => {
  it('GET /v1/conversations lista conversas do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/conversations', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[]; nextCursor: string | null };
    expect(Array.isArray(body.itens)).toBe(true);
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it('GET /v1/conversations filtra por patientId', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/conversations?patientId=${s.patientId}`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ patientId: string }> };
    for (const item of body.itens) {
      expect(item.patientId).toBe(s.patientId);
    }
    await app.close();
  });

  it('GET /v1/conversations/:id/messages lista mensagens', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${s.conversationId}/messages`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[]; nextCursor: string | null };
    expect(Array.isArray(body.itens)).toBe(true);
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it('POST /v1/conversations/:id/messages enfileira mensagem no outbox', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${s.conversationId}/messages`,
      ...auth(s),
      payload: { body: 'Ola, sua consulta esta confirmada para amanha.' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { messageId: string; status: string };
    expect(body.status).toBe('queued');
    expect(body.messageId).toBeTruthy();
    await app.close();
  });

  it('GET /v1/messaging/templates lista templates', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/messaging/templates', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[] };
    expect(Array.isArray(body.itens)).toBe(true);
    await app.close();
  });

  it('POST /v1/messaging/templates cria template novo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/messaging/templates', ...auth(s),
      payload: {
        slug: 'confirmacao_padrao',
        channelKind: 'whatsapp',
        category: 'confirmacao',
        bodyTemplate: 'Ola {{nome}}, sua consulta esta marcada para {{data}}. Confirme respondendo SIM.',
        variables: ['nome', 'data'],
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { templateId: string; providerStatus: string };
    expect(body.templateId).toBeTruthy();
    expect(body.providerStatus).toBe('pending_approval');
    await app.close();
  });

  it('GET /v1/messaging/automations lista regras de automacao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/messaging/automations', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[] };
    expect(Array.isArray(body.itens)).toBe(true);
    await app.close();
  });

  it('PUT /v1/messaging/automations salva regras de automacao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/messaging/automations', ...auth(s),
      payload: {
        rules: [{
          trigger: 'confirmacao_24h',
          templateId: null,
          offsetMinutes: -1440,
          enabled: true,
          channelKind: 'whatsapp',
        }],
      },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { saved: number }).saved).toBe(1);
    await app.close();
  });

  it('recepcao nao pode configurar automacoes (403)', async () => {
    const recep = await semearSessaoMensageria({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/messaging/automations', ...auth(recep),
      payload: { rules: [] },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Criar o helper de seed para testes de mensageria `apps/api/src/test-support-messaging.ts`.

```ts
// apps/api/src/test-support-messaging.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';
import { createSession, newCsrfToken, type Role } from '@cadencia/authn';

export interface SementeSessaoMsg {
  tenantId: string;
  clinicId: string;
  userId: string;
  patientId: string;
  conversationId: string;
  token: string;
  csrf: string;
}

export function auth(s: SementeSessaoMsg) {
  return {
    cookies: { '__Host-cadencia_sid': s.token, '__Host-cadencia_csrf': s.csrf },
    headers: { 'x-clinic-id': s.clinicId, 'x-csrf-token': s.csrf },
  };
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

export async function semearSessaoMensageria(
  opts: { role?: Role } = {},
): Promise<SementeSessaoMsg> {
  const role = opts.role ?? 'admin_clinico';
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  const userId = uuidv7();
  const professionalId = uuidv7();
  const patientId = uuidv7();
  const conversationId = uuidv7();
  const messageId = uuidv7();
  const channelIdentityId = uuidv7();
  const csrf = newCsrfToken();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Msg', '44444444000194')`,
      [tenantId, `msg-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Msg', '2077505', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User Msg')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, $4)`,
      [tenantId, userId, clinicId, role]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777666', 'SP', '225125')`,
      [tenantId, professionalId, userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Msg', 'completo', '1990-05-10')`,
      [tenantId, patientId]);

    // Canal de mensageria
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel_kind, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica Teste', '+5511999999999', 'verified')`,
      [tenantId, channelIdentityId]);

    // Conversa
    await c.query(
      `INSERT INTO msg.conversation
         (tenant_id, id, channel_identity_id, patient_id, channel_kind,
          remote_address, display_name, status, last_message_at, unread_count)
       VALUES ($1, $2, $3, $4, 'whatsapp', '+5511988887777',
               'Paciente Msg', 'open', clock_timestamp(), 1)`,
      [tenantId, conversationId, channelIdentityId, patientId]);

    // Mensagem na conversa
    await c.query(
      `INSERT INTO msg.message
         (tenant_id, id, conversation_id, direction, body, status, sent_by)
       VALUES ($1, $2, $3, 'inbound', 'Boa tarde, gostaria de confirmar minha consulta', 'delivered', NULL)`,
      [tenantId, messageId, conversationId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }

  const { token } = await createSession(admin, {
    userId, activeTenantId: tenantId, activeClinicId: clinicId,
  });

  await admin.query(
    `UPDATE id.session SET mfa_at = clock_timestamp()
      WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);

  await admin.end();

  return { tenantId, clinicId, userId, patientId, conversationId, token, csrf };
}
```

- [ ] Rodar os testes e confirmar que passam (dependem das migrations de mensageria do bloco de migrations).

```bash
pnpm vitest run apps/api/src/routes/messaging.int.test.ts
# Esperado: PASS — todos os 8 testes verdes
```

- [ ] Commitar.

```bash
git add apps/api/src/routes/messaging.ts apps/api/src/routes/messaging.int.test.ts \
       apps/api/src/test-support-messaging.ts apps/api/src/app.ts
git commit -m "feat(api): add messaging routes — conversations, messages, templates, automations"
```

---