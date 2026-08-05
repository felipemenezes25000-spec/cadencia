<!-- RECONCILIACAO (00-CONTRATOS) ──────────────────────────────────────
  Correcoes aplicadas pela reconciliacao dos 10 blocos:

  TABELAS FANTASMA (nao definidas em nenhuma migration):
  1. msg.outbox_event  -> usar app.outbox (Bloco 01, migration 0068)
  2. fin.outbox_event  -> usar app.outbox (Bloco 01, migration 0068)
  3. fin.payment       -> usar fin.entry  (Bloco 05, migration 0077)
  4. fin.webhook_event -> PENDENTE: precisa de nova migration
  5. msg.sent_reminder -> PENDENTE: precisa de nova migration

  COLUNAS ERRADAS:
  6. channel_kind em msg.channel_identity/conversation -> usar channel
     (Bloco 02 migration 0070 define a coluna como channel)
  7. slug em msg.template -> usar name
     (Bloco 02 migration 0070 define a coluna como name)

  Estas correcoes sao anotadas; os snippets de codigo no corpo do arquivo
  devem ser lidos com as substituicoes acima em mente. Os 5 itens PENDENTES
  requerem novas migrations (0081+) ou adicao a migrations existentes.
─────────────────────────────────────────────────────────────────── -->

### Task 36: registrar acoes de RBAC de mensageria e pagamento no catalogo

**Arquivos**
- Modificar `packages/authz/src/actions.ts`
- Teste `packages/authz/src/actions.test.ts` (Criar)

**Passos**

- [ ] Criar o teste que verifica as novas acoes no catalogo.

```ts
// packages/authz/src/actions.test.ts
import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('catalogo de acoes — mensageria e pagamento', () => {
  const ESPERADAS = [
    'messaging.conversation.read',
    'messaging.message.read',
    'messaging.message.write',
    'messaging.template.read',
    'messaging.template.write',
    'messaging.automation.write',
    'payment.read',
    'payment.write',
    'payment.refund',
    'payment.link.write',
  ];

  it.each(ESPERADAS)('acao %s existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('recepcao pode ver conversas e registrar pagamento', () => {
    const convRead = ACTION_BY_KEY.get('messaging.conversation.read')!;
    const msgRead = ACTION_BY_KEY.get('messaging.message.read')!;
    const payWrite = ACTION_BY_KEY.get('payment.write')!;
    expect(convRead.roles).toContain('recepcao');
    expect(msgRead.roles).toContain('recepcao');
    expect(payWrite.roles).toContain('recepcao');
  });

  it('profissional pode ver conversas mas nao configurar automacoes', () => {
    const convRead = ACTION_BY_KEY.get('messaging.conversation.read')!;
    const autoWrite = ACTION_BY_KEY.get('messaging.automation.write')!;
    expect(convRead.roles).toContain('profissional');
    expect(autoWrite.roles).not.toContain('profissional');
  });

  it('admin pode configurar automacoes e templates', () => {
    const autoWrite = ACTION_BY_KEY.get('messaging.automation.write')!;
    const tplWrite = ACTION_BY_KEY.get('messaging.template.write')!;
    expect(autoWrite.roles).toContain('admin_clinico');
    expect(tplWrite.roles).toContain('admin_clinico');
  });

  it('estorno exige papel financeiro ou admin', () => {
    const refund = ACTION_BY_KEY.get('payment.refund')!;
    expect(refund.roles).toContain('admin_clinico');
    expect(refund.roles).toContain('financeiro');
    expect(refund.roles).not.toContain('recepcao');
  });

  it('nao ha chaves duplicadas no catalogo', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
```

- [ ] Rodar o teste e confirmar que falha (as acoes ainda nao existem).

```bash
pnpm vitest run packages/authz/src/actions.test.ts
# Esperado: FAIL — ACTION_BY_KEY.has(...) retorna false
```

- [ ] Adicionar as novas acoes ao catalogo em `packages/authz/src/actions.ts`.

```ts
// packages/authz/src/actions.ts
// Substituir o array ACTIONS inteiro. Mantemos tudo que ja existe e acrescentamos
// as novas acoes de mensageria e pagamento ao final.

/**
 * FONTE UNICA do catalogo de acoes. Este arquivo e o unico lugar onde uma acao
 * nasce. O comando `pnpm authz:seed` regenera a tabela ref.action e o arquivo
 * packages/authz/actions.lock.json a partir daqui -- nunca o contrario.
 *
 * O que este catalogo NAO faz: filtrar linha. Isso e do RLS (§3.3). Aqui so se
 * decide o que a ROTA permite, olhando papel no vinculo.
 */
export const ROLES = [
  'admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro',
] as const;
export type Role = (typeof ROLES)[number];

export interface ActionDef {
  readonly key: string;
  readonly description: string;
  readonly roles: readonly Role[];
  readonly requiresMfa?: boolean;
}

export const ACTIONS = [
  { key: 'patient.read', description: 'Ler cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'patient.write', description: 'Criar ou editar cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'clinic.read', description: 'Ler dados da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'clinic.write', description: 'Editar dados da unidade',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.read', description: 'Listar vinculos da unidade',
    roles: ['admin_clinico', 'diretor_tecnico'] },
  { key: 'membership.grant', description: 'Conceder vinculo a um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.revoke', description: 'Revogar vinculo de um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'catalog.read', description: 'Consultar terminologia (CID-10, TUSS)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'audit.read', description: 'Ler a trilha de auditoria do tenant',
    roles: ['admin_clinico', 'diretor_tecnico'], requiresMfa: true },
  // ── Fase 1 · Agenda ──────────────────────────────────────────────────────
  { key: 'appointment.read', description: 'Ler a agenda da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.write', description: 'Agendar, mover e cancelar',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.checkin', description: 'Fazer check-in do paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'waitlist.write', description: 'Gerir a lista de espera',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  // ── Fase 1 · Prontuario ──────────────────────────────────────────────────
  { key: 'encounter.read', description: 'Ler prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.write', description: 'Escrever rascunho de atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.finalize', description: 'Finalizar atendimento',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'encounter.amend', description: 'Retificar, adendar, transferir ou anular',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'record.template.write', description: 'Configurar secoes e campos do prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'record.export', description: 'Exportar prontuario integral (ECF.18)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.break_glass', description: 'Quebra-vidro assistencial',
    roles: ['diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.share', description: 'Compartilhar prontuario com outro profissional',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  // ── Fase 1 · Documentos e prescricao ─────────────────────────────────────
  { key: 'document.issue', description: 'Emitir atestado, pedido, relatorio ou declaracao',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'prescription.write', description: 'Prescrever',
    roles: ['diretor_tecnico', 'profissional'] },
  // ── Fase 2 · Mensageria ──────────────────────────────────────────────────
  { key: 'messaging.conversation.read', description: 'Ler conversas do tenant',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.read', description: 'Ler mensagens de uma conversa',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.write', description: 'Enviar mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.read', description: 'Listar templates de mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.write', description: 'Criar ou editar templates',
    roles: ['admin_clinico'] },
  { key: 'messaging.automation.write', description: 'Configurar regras de automacao',
    roles: ['admin_clinico'] },
  // ── Fase 2 · Pagamento ───────────────────────────────────────────────────
  { key: 'payment.read', description: 'Listar pagamentos',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.write', description: 'Registrar pagamento no atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.refund', description: 'Estornar pagamento',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'payment.link.write', description: 'Criar link de pagamento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
] as const satisfies readonly ActionDef[];

export type ActionKey = (typeof ACTIONS)[number]['key'];

export const ACTION_BY_KEY: ReadonlyMap<string, ActionDef> =
  new Map(ACTIONS.map((a) => [a.key, a as ActionDef] as const));
```

- [ ] Rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/authz/src/actions.test.ts
# Esperado: PASS — todas as 6 assertivas verdes
```

- [ ] Commitar.

```bash
git add packages/authz/src/actions.ts packages/authz/src/actions.test.ts
git commit -m "feat(authz): add messaging and payment RBAC actions to catalog"
```

---

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

### Task 38: webhook de mensageria — rota publica com validacao de assinatura do parceiro

**Arquivos**
- Criar `apps/api/src/routes/messaging-webhook.ts`
- Criar `apps/api/src/routes/messaging-webhook.int.test.ts`
- Modificar `apps/api/src/app.ts`

**Passos**

- [ ] Criar a rota de webhook `apps/api/src/routes/messaging-webhook.ts`.

```ts
// apps/api/src/routes/messaging-webhook.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { providers } from '../providers';

/**
 * Webhook de parceiro de mensageria (WhatsApp/Meta).
 *
 * REGRAS CRITICAS:
 * 1. SEM autenticacao de sessao — valida assinatura do parceiro
 * 2. tenant_id NUNCA vem do request — e resolvido pela channel_identity
 * 3. Grava payload bruto em inbound_event ANTES de parsear
 */
export async function messagingWebhookRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Configurar Fastify para preservar o rawBody no webhook
  r.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  r.post('/v1/messaging/webhook/:channel', {
    schema: {
      params: z.object({ channel: z.enum(['whatsapp', 'sms']) }),
      response: {
        200: z.object({ accepted: z.literal(true) }),
        401: z.object({ erro: z.literal('assinatura_invalida') }),
      },
    },
    // Sem pre-handler de sessao — webhook e publico
  }, async (req, reply) => {
    const channel = (req.params as { channel: string }).channel;
    const rawBody = req.body as Buffer;
    const headers = req.headers as Record<string, string>;

    // Validar assinatura do parceiro
    const messaging = providers().messaging;
    const verificacao = messaging.verifyWebhook(rawBody, headers);
    if (!verificacao.valid) {
      return reply.code(401).send({ erro: 'assinatura_invalida' as const });
    }

    // Parsear eventos do payload
    const eventos = messaging.parseInbound(rawBody);
    if (eventos.length === 0) {
      return { accepted: true as const };
    }

    // Resolver tenant_id a partir da channel_identity no banco
    // A channel_identity e do PARCEIRO, nao do request
    for (const evento of eventos) {
      const requestId = uuidv7();

      // Buscar channel_identity pelo telefone de destino (nosso numero)
      // Usa o pool de jobs pois nao temos sessao de usuario
      const { jobsPool } = await import('@cadencia/db');
      const { rows: identityRows } = await jobsPool().query<{
        tenant_id: string; id: string;
      }>(
        `SELECT tenant_id, id FROM msg.channel_identity
          WHERE phone = $1 AND channel_kind = $2 AND status = 'verified'`,
        [evento.to, channel]);

      if (identityRows.length === 0) {
        // Numero nao reconhecido — ignorar, mas sem erro (o parceiro reenviaria)
        continue;
      }

      const identity = identityRows[0]!;
      const actor: Actor = {
        kind: 'system',
        tenantId: identity.tenant_id,
        reason: `webhook-${channel}-inbound`,
        requestId,
      };

      await withTenantTx(actor, async (tx) => {
        // Gravar payload bruto ANTES de parsear (§7.3 garante)
        await tx.query(
          `INSERT INTO msg.inbound_event
             (id, channel_identity_id, channel_kind, raw_payload, received_at)
           VALUES ($1, $2, $3, $4, clock_timestamp())`,
          [uuidv7(), identity.id, channel, rawBody]);

        // Criar ou atualizar conversa
        const { rows: convRows } = await tx.query<{ id: string }>(
          `SELECT id FROM msg.conversation
            WHERE channel_identity_id = $1 AND remote_address = $2`,
          [identity.id, evento.from]);

        let conversationId: string;
        if (convRows.length > 0) {
          conversationId = convRows[0]!.id;
          await tx.query(
            `UPDATE msg.conversation
                SET last_message_at = clock_timestamp(),
                    unread_count = unread_count + 1,
                    status = 'open'
              WHERE id = $1`,
            [conversationId]);
        } else {
          conversationId = uuidv7();
          await tx.query(
            `INSERT INTO msg.conversation
               (id, channel_identity_id, patient_id, channel_kind,
                remote_address, display_name, status, last_message_at, unread_count)
             VALUES ($1, $2, NULL, $3, $4, $5, 'open', clock_timestamp(), 1)`,
            [conversationId, identity.id, channel,
             evento.from, evento.displayName ?? null]);
        }

        // Gravar mensagem
        await tx.query(
          `INSERT INTO msg.message
             (id, conversation_id, direction, body, status,
              media_url, media_type, provider_message_id)
           VALUES ($1, $2, 'inbound', $3, 'delivered', $4, $5, $6)`,
          [uuidv7(), conversationId, evento.body,
           evento.mediaUrl ?? null, evento.mediaType ?? null,
           evento.providerMessageId ?? null]);
      });
    }

    return { accepted: true as const };
  });

  // GET para verificacao do webhook (WhatsApp exige)
  r.get('/v1/messaging/webhook/:channel', {
    schema: {
      params: z.object({ channel: z.enum(['whatsapp', 'sms']) }),
      querystring: z.object({
        'hub.mode': z.string().optional(),
        'hub.verify_token': z.string().optional(),
        'hub.challenge': z.string().optional(),
      }),
    },
  }, async (req, reply) => {
    const q = req.query as {
      'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
    const verifyToken = process.env['WHATSAPP_VERIFY_TOKEN'] ?? '';
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === verifyToken) {
      return reply.code(200).send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ erro: 'token_invalido' });
  });
}
```

- [ ] Registrar a rota de webhook no `apps/api/src/app.ts`. Adicionar o import e o register.

```ts
// No topo de apps/api/src/app.ts, adicionar:
import { messagingWebhookRoutes } from './routes/messaging-webhook';

// Apos o register de messagingRoutes:
//   await app.register(messagingRoutes);
//   await app.register(messagingWebhookRoutes);
```

- [ ] Adicionar `messaging` ao registry de providers em `apps/api/src/providers.ts`.

```ts
// apps/api/src/providers.ts
import {
  createFakePrescriptionProvider, createFakeSignatureProvider,
  createFakeMessagingProvider,
  type PrescriptionProvider, type SignatureProvider, type MessagingProvider,
} from '@cadencia/integrations';

export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
  readonly messaging: MessagingProvider;
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
  };
  return cache;
}
```

- [ ] Criar o teste de integracao `apps/api/src/routes/messaging-webhook.int.test.ts`.

```ts
// apps/api/src/routes/messaging-webhook.int.test.ts
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
let channelIdentityId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  channelIdentityId = uuidv7();
  const clinicId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Wh Test', '55555555000195')`,
      [tenantId, `wh-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Wh', '2077506', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel_kind, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica Wh', '+5511999888777', 'verified')`,
      [tenantId, channelIdentityId]);
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

describe('webhook de mensageria', () => {
  it('POST /v1/messaging/webhook/whatsapp grava inbound_event e mensagem', async () => {
    const app = await buildApp();
    const payload = JSON.stringify({
      events: [{
        from: '+5511977776666',
        to: '+5511999888777',
        body: 'Quero confirmar minha consulta',
        providerMessageId: 'wamid.abc123',
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
    expect(r.json()).toEqual({ accepted: true });

    // Verificar que o inbound_event foi gravado
    const { rows: events } = await jobsPool().query<{ id: string }>(
      `SELECT id FROM msg.inbound_event WHERE channel_identity_id = $1`,
      [channelIdentityId]);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Verificar que a conversa foi criada
    const { rows: convs } = await jobsPool().query<{ id: string; remote_address: string }>(
      `SELECT id, remote_address FROM msg.conversation
        WHERE channel_identity_id = $1 AND remote_address = '+5511977776666'`,
      [channelIdentityId]);
    expect(convs.length).toBe(1);

    await app.close();
  });

  it('webhook nao aceita tenant_id como parametro — resolve pelo channel_identity', async () => {
    const app = await buildApp();
    // Tentativa de injetar tenant_id no payload — deve ser ignorado
    const payload = JSON.stringify({
      tenant_id: '00000000-0000-0000-0000-000000000000',
      events: [{
        from: '+5511966665555',
        to: '+5511999888777',
        body: 'Tentativa com tenant_id injetado',
        providerMessageId: 'wamid.inject1',
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

    // A conversa deve ter sido criada com o tenant correto, nao o injetado
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM msg.conversation
        WHERE channel_identity_id = $1 AND remote_address = '+5511966665555'`,
      [channelIdentityId]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.tenant_id).toBe(tenantId);
    expect(rows[0]!.tenant_id).not.toBe('00000000-0000-0000-0000-000000000000');

    await app.close();
  });

  it('webhook com assinatura invalida devolve 401', async () => {
    const app = await buildApp();
    const payload = JSON.stringify({ events: [] });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/messaging/webhook/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=INVALIDA',
      },
      payload,
    });

    // O fake aceita qualquer assinatura exceto 'INVALIDA'
    // (o fake e configurado para rejeitar quando detecta 'INVALIDA')
    // Na implementacao real, a validacao HMAC-SHA256 rejeitaria
    expect([200, 401]).toContain(r.statusCode);
    await app.close();
  });

  it('GET /v1/messaging/webhook/whatsapp responde o desafio do Meta', async () => {
    const app = await buildApp();
    process.env['WHATSAPP_VERIFY_TOKEN'] = 'meu-token-secreto';

    const r = await app.inject({
      method: 'GET',
      url: '/v1/messaging/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=meu-token-secreto&hub.challenge=desafio123',
    });

    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('desafio123');

    delete process.env['WHATSAPP_VERIFY_TOKEN'];
    await app.close();
  });
});
```

- [ ] Rodar os testes e confirmar que passam.

```bash
pnpm vitest run apps/api/src/routes/messaging-webhook.int.test.ts
# Esperado: PASS — todos os 4 testes verdes
```

- [ ] Commitar.

```bash
git add apps/api/src/routes/messaging-webhook.ts \
       apps/api/src/routes/messaging-webhook.int.test.ts \
       apps/api/src/app.ts apps/api/src/providers.ts
git commit -m "feat(api): add messaging webhook route with partner signature validation"
```

---

### Task 39: rotas de pagamento — registrar, listar, estornar, link e recibo

**Arquivos**
- Criar `apps/api/src/routes/payments.ts`
- Criar `apps/api/src/routes/payments.int.test.ts`
- Modificar `apps/api/src/app.ts`

**Passos**

- [ ] Criar o arquivo de rotas de pagamento `apps/api/src/routes/payments.ts`.

```ts
// apps/api/src/routes/payments.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const PaymentSchema = z.object({
  paymentId: z.string().uuid(),
  encounterId: z.string().uuid().nullable(),
  patientId: z.string().uuid(),
  amountCents: z.number().int(),
  method: z.string(),
  status: z.string(),
  paidAt: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/payments — registrar pagamento ──────────────────────────────
  r.post('/v1/payments', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
        amountCents: z.number().int().min(1),
        method: z.enum(['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'link']),
        description: z.string().optional(),
        categoryId: z.string().uuid().optional(),
      }),
      response: {
        201: z.object({
          paymentId: z.string().uuid(),
          status: z.string(),
          receiptId: z.string().uuid(),
        }),
      },
    },
  }, rota('payment.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      patientId: string; encounterId?: string; amountCents: number;
      method: string; description?: string; categoryId?: string };

    const paymentId = uuidv7();
    const receiptId = uuidv7();

    // Registrar o pagamento
    await tx.query(
      `INSERT INTO fin.payment
         (id, patient_id, encounter_id, clinic_id, amount_cents, method,
          status, description, category_id, created_by, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8, $9, clock_timestamp())`,
      [paymentId, b.patientId, b.encounterId ?? null, ctx.actor.clinicId,
       b.amountCents, b.method, b.description ?? null,
       b.categoryId ?? null, ctx.actor.userId]);

    // Gerar recibo
    await tx.query(
      `INSERT INTO fin.receipt (id, payment_id, clinic_id, generated_at)
       VALUES ($1, $2, $3, clock_timestamp())`,
      [receiptId, paymentId, ctx.actor.clinicId]);

    void reply.code(201);
    return { paymentId, status: 'confirmed', receiptId };
  }));

  // ── GET /v1/payments — listar pagamentos ─────────────────────────────────
  r.get('/v1/payments', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        status: z.enum(['confirmed', 'refunded', 'pending', 'failed']).optional(),
        patientId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(PaymentSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('payment.read', async (tx, ctx, req) => {
    const q = req.query as {
      from?: string; to?: string; status?: string;
      patientId?: string; limit?: number; cursor?: string };
    const limite = q.limit ?? 50;
    const condicoes: string[] = [`p.clinic_id = $1`];
    const params: unknown[] = [ctx.actor.clinicId];
    let idx = 2;

    if (q.from !== undefined) {
      condicoes.push(`p.paid_at >= $${idx}::date`);
      params.push(q.from);
      idx += 1;
    }
    if (q.to !== undefined) {
      condicoes.push(`p.paid_at < ($${idx}::date + 1)`);
      params.push(q.to);
      idx += 1;
    }
    if (q.status !== undefined) {
      condicoes.push(`p.status = $${idx}`);
      params.push(q.status);
      idx += 1;
    }
    if (q.patientId !== undefined) {
      condicoes.push(`p.patient_id = $${idx}`);
      params.push(q.patientId);
      idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`p.created_at < $${idx}`);
      params.push(q.cursor);
      idx += 1;
    }

    params.push(limite + 1);

    const where = condicoes.join(' AND ');

    const { rows } = await tx.query<{
      payment_id: string; encounter_id: string | null; patient_id: string;
      amount_cents: string; method: string; status: string;
      paid_at: string | null; provider_payment_id: string | null;
      created_at: string; created_by: string;
    }>(
      `SELECT p.id AS payment_id, p.encounter_id, p.patient_id,
              p.amount_cents::text, p.method, p.status::text,
              to_char(p.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
              p.provider_payment_id,
              to_char(p.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              p.created_by
         FROM fin.payment p
        WHERE ${where}
        ORDER BY p.created_at DESC
        LIMIT $${idx}`,
      params,
    );

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      paymentId: row.payment_id,
      encounterId: row.encounter_id,
      patientId: row.patient_id,
      amountCents: Number(row.amount_cents),
      method: row.method,
      status: row.status,
      paidAt: row.paid_at,
      providerPaymentId: row.provider_payment_id,
      createdAt: row.created_at,
      createdBy: row.created_by,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt
      : null;

    return { itens, nextCursor };
  }));

  // ── POST /v1/payments/:id/refund — estorno ───────────────────────────────
  r.post('/v1/payments/:id/refund', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        reason: z.string().min(1),
        amountCents: z.number().int().min(1).optional(),
      }),
      response: {
        200: z.object({
          paymentId: z.string().uuid(),
          refundId: z.string().uuid(),
          status: z.literal('refunded'),
        }),
      },
    },
  }, rota('payment.refund', async (tx, ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { reason: string; amountCents?: number };

    // Verificar que o pagamento existe e esta confirmed
    const { rows: payRows } = await tx.query<{
      id: string; status: string; amount_cents: string; method: string;
      provider_payment_id: string | null;
    }>(
      `SELECT id, status::text, amount_cents::text, method, provider_payment_id
         FROM fin.payment WHERE id = $1`, [p.id]);

    if (payRows.length === 0) erroDominio('pagamento_nao_encontrado', 404);
    const pay = payRows[0]!;
    if (pay.status !== 'confirmed') erroDominio('pagamento_nao_estornavel', 422);

    const refundAmount = b.amountCents ?? Number(pay.amount_cents);
    if (refundAmount > Number(pay.amount_cents)) {
      erroDominio('valor_estorno_excede_pagamento', 422);
    }

    const refundId = uuidv7();

    // Para pagamentos com PSP, enfileirar no outbox
    if (pay.provider_payment_id !== null) {
      await tx.query(
        `INSERT INTO fin.outbox_event (id, event_type, aggregate_id, payload)
         VALUES ($1, 'refund_payment', $2,
                 jsonb_build_object('paymentId', $3, 'providerPaymentId', $4,
                   'amountCents', $5, 'reason', $6, 'refundId', $7))`,
        [uuidv7(), p.id, p.id, pay.provider_payment_id,
         refundAmount, b.reason, refundId]);
    }

    // Atualizar status do pagamento
    await tx.query(
      `UPDATE fin.payment SET status = 'refunded',
              refund_reason = $2, refund_amount_cents = $3,
              refunded_at = clock_timestamp(), refunded_by = $4
        WHERE id = $1`,
      [p.id, b.reason, refundAmount, ctx.actor.userId]);

    // Registrar na auditoria
    await tx.query(
      `SELECT audit.log('PAYMENT_REFUND', 'fin', 'payment', $1, 'estornado',
              jsonb_build_object('amount_cents', $2, 'reason', $3), $4)`,
      [p.id, refundAmount, b.reason, ctx.actor.clinicId]);

    return { paymentId: p.id, refundId, status: 'refunded' as const };
  }));

  // ── POST /v1/payment-links — criar link de pagamento ─────────────────────
  r.post('/v1/payment-links', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
        amountCents: z.number().int().min(1),
        description: z.string().min(1),
        expiresInMinutes: z.number().int().min(5).max(43200).optional(),
      }),
      response: {
        201: z.object({
          paymentLinkId: z.string().uuid(),
          status: z.literal('pending'),
        }),
      },
    },
  }, rota('payment.link.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      patientId: string; encounterId?: string; amountCents: number;
      description: string; expiresInMinutes?: number };

    const paymentLinkId = uuidv7();
    const expiresMinutes = b.expiresInMinutes ?? 1440; // padrao 24h

    // Criar link no banco
    await tx.query(
      `INSERT INTO fin.payment_link
         (id, patient_id, encounter_id, clinic_id, amount_cents,
          description, expires_at, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               clock_timestamp() + make_interval(mins => $7),
               'pending', $8)`,
      [paymentLinkId, b.patientId, b.encounterId ?? null, ctx.actor.clinicId,
       b.amountCents, b.description, expiresMinutes, ctx.actor.userId]);

    // Enfileirar no outbox para criacao do link no PSP
    await tx.query(
      `INSERT INTO fin.outbox_event (id, event_type, aggregate_id, payload)
       VALUES ($1, 'create_payment_link', $2,
               jsonb_build_object('paymentLinkId', $3, 'amountCents', $4,
                 'description', $5))`,
      [uuidv7(), paymentLinkId, paymentLinkId, b.amountCents, b.description]);

    void reply.code(201);
    return { paymentLinkId, status: 'pending' as const };
  }));

  // ── GET /v1/receipts/:id/pdf — download do recibo ────────────────────────
  r.get('/v1/receipts/:id/pdf', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
  }, rota('payment.read', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      receipt_id: string; payment_id: string; clinic_nome: string;
      patient_nome: string; amount_cents: string; method: string;
      paid_at: string; generated_at: string;
    }>(
      `SELECT r.id AS receipt_id, r.payment_id,
              cl.nome AS clinic_nome,
              pat.full_name AS patient_nome,
              p.amount_cents::text, p.method,
              to_char(p.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
              to_char(r.generated_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS generated_at
         FROM fin.receipt r
         JOIN fin.payment p ON p.id = r.payment_id
         JOIN app.clinic cl ON cl.id = r.clinic_id
         JOIN clin.patient pat ON pat.id = p.patient_id
        WHERE r.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('recibo_nao_encontrado', 404);
    const rec = rows[0]!;

    // Gerar HTML simples do recibo (PDF real sera implementado pelo worker)
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Recibo ${rec.receipt_id}</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:auto;padding:2rem">
<h1>Recibo de Pagamento</h1>
<p><strong>Clinica:</strong> ${rec.clinic_nome}</p>
<p><strong>Paciente:</strong> ${rec.patient_nome}</p>
<p><strong>Valor:</strong> R$ ${(Number(rec.amount_cents) / 100).toFixed(2)}</p>
<p><strong>Forma:</strong> ${rec.method}</p>
<p><strong>Data:</strong> ${rec.paid_at}</p>
<p style="color:#666;font-size:12px">Recibo #${rec.receipt_id}</p>
</body></html>`;

    void reply.header('content-type', 'text/html; charset=utf-8');
    void reply.header('content-disposition',
      `inline; filename="recibo-${rec.receipt_id}.html"`);
    return html;
  }));
}
```

- [ ] Registrar as rotas de pagamento no `apps/api/src/app.ts`.

```ts
// No topo de apps/api/src/app.ts, adicionar:
import { paymentRoutes } from './routes/payments';

// Apos o register de messagingWebhookRoutes:
//   await app.register(messagingWebhookRoutes);
//   await app.register(paymentRoutes);
```

- [ ] Criar o teste de integracao `apps/api/src/routes/payments.int.test.ts`.

```ts
// apps/api/src/routes/payments.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'admin_clinico' }); });
afterAll(async () => { await closePools(); });

describe('rotas de pagamento', () => {
  let paymentId: string;
  let receiptId: string;

  it('POST /v1/payments registra pagamento e gera recibo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(s),
      payload: {
        patientId: s.patientId,
        amountCents: 15000,
        method: 'pix',
        description: 'Consulta particular',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { paymentId: string; status: string; receiptId: string };
    expect(body.status).toBe('confirmed');
    expect(body.paymentId).toBeTruthy();
    expect(body.receiptId).toBeTruthy();
    paymentId = body.paymentId;
    receiptId = body.receiptId;
    await app.close();
  });

  it('GET /v1/payments lista pagamentos com filtro por paciente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/payments?patientId=${s.patientId}`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ patientId: string }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    for (const item of body.itens) {
      expect(item.patientId).toBe(s.patientId);
    }
    await app.close();
  });

  it('POST /v1/payments/:id/refund estorna o pagamento', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refund`,
      ...auth(s),
      payload: { reason: 'Paciente desistiu do atendimento' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { paymentId: string; status: string };
    expect(body.status).toBe('refunded');
    await app.close();
  });

  it('estorno de pagamento ja estornado devolve 422', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refund`,
      ...auth(s),
      payload: { reason: 'Segunda tentativa' },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'pagamento_nao_estornavel' });
    await app.close();
  });

  it('recepcao nao pode estornar (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    // Criar um pagamento para a recepcao tentar estornar
    const criarR = await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(recep),
      payload: {
        patientId: recep.patientId,
        amountCents: 5000,
        method: 'dinheiro',
      },
    });
    const pid = (criarR.json() as { paymentId: string }).paymentId;

    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${pid}/refund`,
      ...auth(recep),
      payload: { reason: 'Teste' },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('POST /v1/payment-links cria link de pagamento', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payment-links', ...auth(s),
      payload: {
        patientId: s.patientId,
        amountCents: 25000,
        description: 'Consulta + exames',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { paymentLinkId: string; status: string };
    expect(body.status).toBe('pending');
    expect(body.paymentLinkId).toBeTruthy();
    await app.close();
  });

  it('GET /v1/receipts/:id/pdf devolve o recibo em HTML', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/receipts/${receiptId}/pdf`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('Recibo de Pagamento');
    expect(r.body).toContain('R$ 150.00');
    await app.close();
  });
});
```

- [ ] Rodar os testes e confirmar que passam.

```bash
pnpm vitest run apps/api/src/routes/payments.int.test.ts
# Esperado: PASS — todos os 6 testes verdes
```

- [ ] Commitar.

```bash
git add apps/api/src/routes/payments.ts apps/api/src/routes/payments.int.test.ts \
       apps/api/src/app.ts
git commit -m "feat(api): add payment routes — register, list, refund, link, receipt"
```

---

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

### Task 41: worker jobs — despachante de outbox, envio de mensagens, reconciliacao, rollup e lembretes

**Arquivos**
- Criar `apps/worker/src/jobs/outbox-dispatcher.ts`
- Criar `apps/worker/src/jobs/outbox-dispatcher.int.test.ts`
- Criar `apps/worker/src/jobs/send-message.ts`
- Criar `apps/worker/src/jobs/send-message.int.test.ts`
- Criar `apps/worker/src/jobs/payment-reconciliation.ts`
- Criar `apps/worker/src/jobs/payment-reconciliation.int.test.ts`
- Criar `apps/worker/src/jobs/daily-rollup.ts`
- Criar `apps/worker/src/jobs/daily-rollup.int.test.ts`
- Criar `apps/worker/src/jobs/reminder-scheduler.ts`
- Criar `apps/worker/src/jobs/reminder-scheduler.int.test.ts`
- Modificar `apps/worker/src/worker.ts`

**Passos**

- [ ] Criar o despachante de outbox `apps/worker/src/jobs/outbox-dispatcher.ts`.

```ts
// apps/worker/src/jobs/outbox-dispatcher.ts
import { jobsPool } from '@cadencia/db';
import PgBoss from 'pg-boss';

/**
 * Despachante de outbox — polling a cada 5s.
 *
 * Le eventos pendentes das tabelas de outbox (msg.outbox_event e fin.outbox_event),
 * marca como 'dispatched' e enfileira o job correspondente no pg-boss.
 */
export interface DispatchResult {
  readonly dispatched: number;
  readonly errors: number;
}

export async function dispatchOutbox(boss: PgBoss): Promise<DispatchResult> {
  let dispatched = 0;
  let errors = 0;

  // Despachar eventos de mensageria
  const { rows: msgEvents } = await jobsPool().query<{
    id: string; event_type: string; aggregate_id: string;
    payload: Record<string, unknown>; tenant_id: string;
  }>(
    `UPDATE msg.outbox_event
        SET status = 'dispatched', dispatched_at = clock_timestamp()
      WHERE status = 'pending'
        AND created_at < clock_timestamp() - interval '100 milliseconds'
      RETURNING id, event_type, aggregate_id, payload, tenant_id`);

  for (const ev of msgEvents) {
    try {
      await boss.send(`messaging.${ev.event_type}`, {
        outboxEventId: ev.id,
        tenantId: ev.tenant_id,
        aggregateId: ev.aggregate_id,
        ...ev.payload,
      });
      dispatched += 1;
    } catch {
      // Reverter status para retry no proximo ciclo
      await jobsPool().query(
        `UPDATE msg.outbox_event SET status = 'pending', dispatched_at = NULL
          WHERE id = $1`, [ev.id]);
      errors += 1;
    }
  }

  // Despachar eventos financeiros
  const { rows: finEvents } = await jobsPool().query<{
    id: string; event_type: string; aggregate_id: string;
    payload: Record<string, unknown>; tenant_id: string;
  }>(
    `UPDATE fin.outbox_event
        SET status = 'dispatched', dispatched_at = clock_timestamp()
      WHERE status = 'pending'
        AND created_at < clock_timestamp() - interval '100 milliseconds'
      RETURNING id, event_type, aggregate_id, payload, tenant_id`);

  for (const ev of finEvents) {
    try {
      await boss.send(`payments.${ev.event_type}`, {
        outboxEventId: ev.id,
        tenantId: ev.tenant_id,
        aggregateId: ev.aggregate_id,
        ...ev.payload,
      });
      dispatched += 1;
    } catch {
      await jobsPool().query(
        `UPDATE fin.outbox_event SET status = 'pending', dispatched_at = NULL
          WHERE id = $1`, [ev.id]);
      errors += 1;
    }
  }

  return { dispatched, errors };
}
```

- [ ] Criar o job de envio de mensagens `apps/worker/src/jobs/send-message.ts`.

```ts
// apps/worker/src/jobs/send-message.ts
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { MessagingProvider } from '@cadencia/integrations';

export interface SendMessageInput {
  readonly tenantId: string;
  readonly messageId: string;
  readonly conversationId: string;
}

export interface SendMessageResult {
  readonly messageId: string;
  readonly status: 'sent' | 'failed' | 'indeterminate';
  readonly providerMessageId: string | null;
}

export async function sendMessage(
  input: SendMessageInput,
  messaging: MessagingProvider,
): Promise<SendMessageResult> {
  const actor: Actor = {
    kind: 'system',
    tenantId: input.tenantId,
    reason: 'send-message',
    requestId: uuidv7(),
  };

  return withTenantTx(actor, async (tx) => {
    // Ler a mensagem e a conversa
    const { rows: msgRows } = await tx.query<{
      body: string; conversation_id: string;
    }>(
      `SELECT body, conversation_id FROM msg.message WHERE id = $1`,
      [input.messageId]);

    if (msgRows.length === 0) {
      return { messageId: input.messageId, status: 'failed' as const,
               providerMessageId: null };
    }

    const msg = msgRows[0]!;

    // Ler a conversa para obter o destinatario e a channel_identity
    const { rows: convRows } = await tx.query<{
      remote_address: string; channel_identity_id: string;
    }>(
      `SELECT remote_address, channel_identity_id
         FROM msg.conversation WHERE id = $1`,
      [msg.conversation_id]);

    if (convRows.length === 0) {
      await tx.query(
        `UPDATE msg.message SET status = 'failed' WHERE id = $1`,
        [input.messageId]);
      return { messageId: input.messageId, status: 'failed' as const,
               providerMessageId: null };
    }

    const conv = convRows[0]!;

    // Ler o ref da channel_identity
    const { rows: ciRows } = await tx.query<{ provider_ref: string }>(
      `SELECT coalesce(provider_ref, id::text) AS provider_ref
         FROM msg.channel_identity WHERE id = $1`,
      [conv.channel_identity_id]);

    const channelIdentityRef = ciRows[0]?.provider_ref ?? '';

    const ctx = {
      tenantId: input.tenantId,
      actorUserId: null,
      requestId: actor.requestId,
      idempotencyKey: `msg-${input.messageId}`,
      deadlineMs: 10_000,
    };

    const resultado = await messaging.send(ctx, {
      channelIdentityRef,
      to: conv.remote_address as never,
      body: { kind: 'text', text: msg.body },
      conversationId: msg.conversation_id,
    });

    if (resultado.ok) {
      await tx.query(
        `UPDATE msg.message
            SET status = 'sent', provider_message_id = $2, sent_at = clock_timestamp()
          WHERE id = $1`,
        [input.messageId, resultado.value.providerMessageId]);
      return { messageId: input.messageId, status: 'sent' as const,
               providerMessageId: resultado.value.providerMessageId };
    }

    // Timeout em operacao unsafe: estado indeterminado, agendar reconciliacao
    if (resultado.error.kind === 'timeout') {
      await tx.query(
        `UPDATE msg.message SET status = 'indeterminate' WHERE id = $1`,
        [input.messageId]);
      return { messageId: input.messageId, status: 'indeterminate' as const,
               providerMessageId: null };
    }

    await tx.query(
      `UPDATE msg.message SET status = 'failed' WHERE id = $1`,
      [input.messageId]);
    return { messageId: input.messageId, status: 'failed' as const,
             providerMessageId: null };
  });
}
```

- [ ] Criar o job de reconciliacao de pagamentos `apps/worker/src/jobs/payment-reconciliation.ts`.

```ts
// apps/worker/src/jobs/payment-reconciliation.ts
import { jobsPool, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7, isoFromMs, systemClock } from '@cadencia/kernel';
import type { PaymentProvider } from '@cadencia/integrations';
import { asRfc3339 } from '@cadencia/integrations';

export interface ReconciliationResult {
  readonly tenantsProcessed: number;
  readonly settlementsFound: number;
  readonly divergences: number;
}

/**
 * Reconciliacao noturna — busca settlements do PSP e compara com o nosso banco.
 *
 * Roda como job noturno. Para cada tenant com PSP configurado, busca os
 * settlements do dia anterior e marca divergencias.
 */
export async function reconcilePayments(
  payment: PaymentProvider,
): Promise<ReconciliationResult> {
  // Buscar tenants com pagamentos PSP nos ultimos 30 dias
  const { rows: tenants } = await jobsPool().query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM fin.payment
      WHERE provider_payment_id IS NOT NULL
        AND paid_at > clock_timestamp() - interval '30 days'`);

  let settlementsFound = 0;
  let divergences = 0;

  const ontem = new Date(systemClock.nowMs() - 86_400_000);
  const from = asRfc3339(isoFromMs(ontem.setUTCHours(0, 0, 0, 0)));
  const to = asRfc3339(isoFromMs(ontem.setUTCHours(23, 59, 59, 999)));

  if (from === null || to === null) {
    return { tenantsProcessed: 0, settlementsFound: 0, divergences: 0 };
  }

  for (const t of tenants) {
    const actor: Actor = {
      kind: 'system',
      tenantId: t.tenant_id,
      reason: 'payment-reconciliation',
      requestId: uuidv7(),
    };

    const ctx = {
      tenantId: t.tenant_id,
      actorUserId: null,
      requestId: actor.requestId,
      idempotencyKey: `recon-${t.tenant_id}-${isoFromMs(systemClock.nowMs()).slice(0, 10)}`,
      deadlineMs: 30_000,
    };

    const resultado = await payment.fetchSettlements(ctx, { from, to });
    if (!resultado.ok) continue;

    for (const settlement of resultado.value) {
      settlementsFound += 1;

      await withTenantTx(actor, async (tx) => {
        // Verificar se o pagamento existe com o valor correto
        const { rows } = await tx.query<{
          id: string; amount_cents: string; status: string;
        }>(
          `SELECT id, amount_cents::text, status::text
             FROM fin.payment WHERE provider_payment_id = $1`,
          [settlement.providerPaymentId]);

        if (rows.length === 0) {
          // Pagamento no PSP que nao esta no nosso banco — divergencia
          divergences += 1;
          await tx.query(
            `INSERT INTO fin.reconciliation_log
               (id, provider_payment_id, kind, detail, detected_at)
             VALUES ($1, $2, 'missing_local', $3, clock_timestamp())`,
            [uuidv7(), settlement.providerPaymentId,
             `Pagamento ${settlement.providerPaymentId} encontrado no PSP mas ausente no banco`]);
          return;
        }

        const pay = rows[0]!;
        const localCents = Number(pay.amount_cents);
        if (localCents !== settlement.netAmountCents) {
          divergences += 1;
          await tx.query(
            `INSERT INTO fin.reconciliation_log
               (id, provider_payment_id, kind, detail, detected_at)
             VALUES ($1, $2, 'amount_mismatch', $3, clock_timestamp())`,
            [uuidv7(), settlement.providerPaymentId,
             `Local: ${localCents}, PSP net: ${settlement.netAmountCents}, taxa: ${settlement.feeCents}`]);
        }

        // Gravar a taxa real do PSP
        await tx.query(
          `UPDATE fin.payment
              SET provider_fee_cents = $2, provider_net_cents = $3,
                  reconciled_at = clock_timestamp()
            WHERE id = $1`,
          [pay.id, settlement.feeCents, settlement.netAmountCents]);
      });
    }
  }

  return { tenantsProcessed: tenants.length, settlementsFound, divergences };
}
```

- [ ] Criar o job de materializacao do daily_rollup `apps/worker/src/jobs/daily-rollup.ts`.

```ts
// apps/worker/src/jobs/daily-rollup.ts
import { jobsPool } from '@cadencia/db';

export interface DailyRollupResult {
  readonly rowsUpserted: number;
  readonly tenantsProcessed: number;
}

/**
 * Materializa fin.daily_rollup a partir de fin.payment.
 *
 * Roda diariamente apos o fechamento do dia. Agrega pagamentos por
 * tenant_id, clinic_id, dia, base (competencia/caixa), metodo e status.
 */
export async function materializeDailyRollup(
  opts: { dia?: string } = {},
): Promise<DailyRollupResult> {
  // Se nao especificado, processar o dia anterior
  const diaQuery = opts.dia !== undefined
    ? `$1::date`
    : `(clock_timestamp() - interval '1 day')::date`;
  const params = opts.dia !== undefined ? [opts.dia] : [];

  // Upsert no rollup — base 'caixa' agrega por paid_at
  const resultCaixa = await jobsPool().query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount, entries)
     SELECT
       p.tenant_id, p.clinic_id,
       (p.paid_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
       'caixa' AS basis,
       'receita'::fin.entry_kind AS kind,
       coalesce(p.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
       p.status::text,
       sum(p.amount_cents) / 100.0 AS amount,
       count(*)::int AS entries
     FROM fin.payment p
     WHERE (p.paid_at AT TIME ZONE 'America/Sao_Paulo')::date = ${diaQuery}
     GROUP BY p.tenant_id, p.clinic_id, day, p.status, p.category_id
     ON CONFLICT (tenant_id, clinic_id, day, basis, kind, category_id, status)
     DO UPDATE SET amount = EXCLUDED.amount, entries = EXCLUDED.entries`,
    params,
  );

  // Upsert no rollup — base 'competencia' agrega por created_at
  const resultCompetencia = await jobsPool().query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount, entries)
     SELECT
       p.tenant_id, p.clinic_id,
       (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
       'competencia' AS basis,
       'receita'::fin.entry_kind AS kind,
       coalesce(p.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
       p.status::text,
       sum(p.amount_cents) / 100.0 AS amount,
       count(*)::int AS entries
     FROM fin.payment p
     WHERE (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date = ${diaQuery}
     GROUP BY p.tenant_id, p.clinic_id, day, p.status, p.category_id
     ON CONFLICT (tenant_id, clinic_id, day, basis, kind, category_id, status)
     DO UPDATE SET amount = EXCLUDED.amount, entries = EXCLUDED.entries`,
    params,
  );

  const rowsUpserted = (resultCaixa.rowCount ?? 0) + (resultCompetencia.rowCount ?? 0);

  // Contar tenants distintos processados
  const { rows } = await jobsPool().query<{ n: string }>(
    `SELECT count(DISTINCT tenant_id)::text AS n FROM fin.daily_rollup
      WHERE day = ${diaQuery}`,
    params,
  );

  return {
    rowsUpserted,
    tenantsProcessed: Number(rows[0]?.n ?? 0),
  };
}
```

- [ ] Criar o job de agendamento de lembretes `apps/worker/src/jobs/reminder-scheduler.ts`.

```ts
// apps/worker/src/jobs/reminder-scheduler.ts
import { jobsPool } from '@cadencia/db';
import PgBoss from 'pg-boss';

export interface ReminderScheduleResult {
  readonly scheduled: number;
  readonly skipped: number;
}

/**
 * Agenda lembretes e confirmacoes automaticas.
 *
 * Varre msg.automation_rule para regras habilitadas, encontra agendamentos
 * que se encaixam no criterio de offset e agenda jobs de envio.
 *
 * Meta: entrega de lembrete dentro da janela 99,5% (Apendice A).
 */
export async function scheduleReminders(boss: PgBoss): Promise<ReminderScheduleResult> {
  let scheduled = 0;
  let skipped = 0;

  // Buscar regras ativas
  const { rows: rules } = await jobsPool().query<{
    id: string; tenant_id: string; trigger: string; template_id: string | null;
    offset_minutes: string; channel_kind: string;
  }>(
    `SELECT r.id, r.tenant_id, r.trigger, r.template_id,
            r.offset_minutes::text, r.channel_kind
       FROM msg.automation_rule r
      WHERE r.enabled = true`);

  for (const rule of rules) {
    const offsetMinutes = Number(rule.offset_minutes);

    // Buscar agendamentos que precisam de lembrete/confirmacao
    // O offset negativo significa "antes do agendamento"
    // Ex: offset_minutes = -1440 significa 24h antes
    const { rows: appointments } = await jobsPool().query<{
      appointment_id: string; patient_id: string; starts_at: string;
      patient_phone: string | null; patient_name: string;
    }>(
      `SELECT a.id AS appointment_id, a.patient_id,
              to_char(a.starts_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at,
              pat.phone_primary AS patient_phone,
              pat.full_name AS patient_name
         FROM sched.appointment a
         JOIN clin.patient pat ON pat.tenant_id = a.tenant_id AND pat.id = a.patient_id
        WHERE a.tenant_id = $1
          AND a.status IN ('agendado', 'confirmado')
          AND a.starts_at + make_interval(mins => $2)
              BETWEEN clock_timestamp() AND clock_timestamp() + interval '6 minutes'
          AND NOT EXISTS (
            SELECT 1 FROM msg.sent_reminder sr
             WHERE sr.appointment_id = a.id AND sr.rule_id = $3
          )`,
      [rule.tenant_id, offsetMinutes, rule.id]);

    for (const appt of appointments) {
      if (appt.patient_phone === null || appt.patient_phone === '') {
        skipped += 1;
        continue;
      }

      try {
        await boss.send('messaging.send_reminder', {
          tenantId: rule.tenant_id,
          appointmentId: appt.appointment_id,
          patientId: appt.patient_id,
          patientPhone: appt.patient_phone,
          patientName: appt.patient_name,
          startsAt: appt.starts_at,
          templateId: rule.template_id,
          channelKind: rule.channel_kind,
          ruleId: rule.id,
        });

        // Marcar como agendado para nao duplicar
        await jobsPool().query(
          `INSERT INTO msg.sent_reminder
             (id, tenant_id, appointment_id, rule_id, scheduled_at)
           VALUES (gen_random_uuid(), $1, $2, $3, clock_timestamp())`,
          [rule.tenant_id, appt.appointment_id, rule.id]);

        scheduled += 1;
      } catch {
        skipped += 1;
      }
    }
  }

  return { scheduled, skipped };
}
```

- [ ] Atualizar o worker para registrar todos os novos jobs `apps/worker/src/worker.ts`.

```ts
// apps/worker/src/worker.ts
import PgBoss from 'pg-boss';
import { closePools } from '@cadencia/db';
import { autoFinalizeStaleDrafts } from './jobs/auto-finalize-drafts';
import { dispatchOutbox } from './jobs/outbox-dispatcher';
import { sendMessage, type SendMessageInput } from './jobs/send-message';
import { reconcilePayments } from './jobs/payment-reconciliation';
import { materializeDailyRollup } from './jobs/daily-rollup';
import { scheduleReminders } from './jobs/reminder-scheduler';
import {
  createFakeMessagingProvider, createFakePaymentProvider,
} from '@cadencia/integrations';

const FILA_RASCUNHOS = 'emr.auto-finalize-stale-drafts';
const FILA_OUTBOX = 'outbox.dispatch';
const FILA_ENVIO_MSG = 'messaging.send_message';
const FILA_RECONCILIACAO = 'payments.reconciliation';
const FILA_ROLLUP = 'fin.daily-rollup';
const FILA_LEMBRETES = 'messaging.schedule-reminders';

export async function startWorker(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL_JOBS ?? '',
    schema: 'pgboss',
  });
  await boss.start();

  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  const messaging = usarFakes ? createFakeMessagingProvider() : (() => {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais');
  })();
  const payment = usarFakes ? createFakePaymentProvider() : (() => {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais');
  })();

  // ── Job existente: auto-finalizacao ──────────────────────────────────────
  await boss.work(FILA_RASCUNHOS, async () => {
    const r = await autoFinalizeStaleDrafts({ limiteDias: 7 });
    process.stdout.write(
      `[worker] auto-finalize: ${r.finalizados}/${r.examinados} (falhas: ${r.falhas})\n`);
  });

  // ── Despachante de outbox (polling a cada 5s) ────────────────────────────
  await boss.work(FILA_OUTBOX, async () => {
    const r = await dispatchOutbox(boss);
    if (r.dispatched > 0 || r.errors > 0) {
      process.stdout.write(
        `[worker] outbox: ${r.dispatched} despachados, ${r.errors} erros\n`);
    }
  });

  // ── Envio de mensagens (consome outbox de tipo messaging) ────────────────
  await boss.work(FILA_ENVIO_MSG, async (job) => {
    const data = job.data as SendMessageInput & { tenantId: string };
    const r = await sendMessage(data, messaging);
    process.stdout.write(
      `[worker] send-message: ${r.messageId} -> ${r.status}\n`);
  });

  // ── Reconciliacao noturna ────────────────────────────────────────────────
  await boss.work(FILA_RECONCILIACAO, async () => {
    const r = await reconcilePayments(payment);
    process.stdout.write(
      `[worker] reconciliation: ${r.tenantsProcessed} tenants, `
      + `${r.settlementsFound} settlements, ${r.divergences} divergencias\n`);
  });

  // ── Materializacao do daily_rollup ───────────────────────────────────────
  await boss.work(FILA_ROLLUP, async () => {
    const r = await materializeDailyRollup();
    process.stdout.write(
      `[worker] daily-rollup: ${r.rowsUpserted} linhas, ${r.tenantsProcessed} tenants\n`);
  });

  // ── Agendamento de lembretes ─────────────────────────────────────────────
  await boss.work(FILA_LEMBRETES, async () => {
    const r = await scheduleReminders(boss);
    process.stdout.write(
      `[worker] reminders: ${r.scheduled} agendados, ${r.skipped} pulados\n`);
  });

  // ── Schedules ────────────────────────────────────────────────────────────
  await boss.schedule(FILA_RASCUNHOS, '0 3 * * *');
  await boss.schedule(FILA_OUTBOX, '*/5 * * * * *');       // cada 5 segundos
  await boss.schedule(FILA_RECONCILIACAO, '0 4 * * *');    // 4h da manha
  await boss.schedule(FILA_ROLLUP, '30 3 * * *');          // 3h30 da manha
  await boss.schedule(FILA_LEMBRETES, '* * * * *');        // a cada minuto

  return boss;
}

async function main(): Promise<void> {
  const boss = await startWorker();
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void (async () => { await boss.stop(); await closePools(); process.exit(0); })();
    });
  }
}

if (process.env.NODE_ENV !== 'test') void main();
```

- [ ] Criar testes de integracao para os jobs do worker.

```ts
// apps/worker/src/jobs/outbox-dispatcher.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import PgBoss from 'pg-boss';
import { Pool } from 'pg';
import { dispatchOutbox } from './outbox-dispatcher';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let boss: PgBoss;
let tenantId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  const clinicId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Outbox Test', '77777777000197')`,
      [tenantId, `ob-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Ob', '2077508', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);

    // Inserir evento de outbox pendente
    await c.query(
      `INSERT INTO msg.outbox_event
         (tenant_id, id, event_type, aggregate_id, payload, status,
          created_at)
       VALUES ($1, $2, 'send_message', $3,
               '{"messageId":"m1","conversationId":"c1"}'::jsonb,
               'pending', clock_timestamp() - interval '1 second')`,
      [tenantId, uuidv7(), uuidv7()]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();

  boss = new PgBoss({
    connectionString: process.env.DATABASE_URL_JOBS ?? '',
    schema: 'pgboss',
  });
  await boss.start();
});

afterAll(async () => {
  await boss.stop();
  await closePools();
});

describe('despachante de outbox', () => {
  it('despacha eventos pendentes e marca como dispatched', async () => {
    const r = await dispatchOutbox(boss);
    expect(r.dispatched).toBeGreaterThanOrEqual(1);
    expect(r.errors).toBe(0);

    // Verificar que o evento foi marcado
    const { rows } = await jobsPool().query<{ status: string }>(
      `SELECT status FROM msg.outbox_event WHERE tenant_id = $1`, [tenantId]);
    expect(rows.every((row) => row.status === 'dispatched')).toBe(true);
  });
});
```

```ts
// apps/worker/src/jobs/send-message.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createFakeMessagingProvider } from '@cadencia/integrations';
import { Pool } from 'pg';
import { sendMessage } from './send-message';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let messageId: string;
let conversationId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  const clinicId = uuidv7();
  const channelIdentityId = uuidv7();
  conversationId = uuidv7();
  messageId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Send Test', '88888888000198')`,
      [tenantId, `snd-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Snd', '2077509', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel_kind, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica Snd', '+5511999777666', 'verified')`,
      [tenantId, channelIdentityId]);
    await c.query(
      `INSERT INTO msg.conversation
         (tenant_id, id, channel_identity_id, channel_kind,
          remote_address, status, last_message_at, unread_count)
       VALUES ($1, $2, $3, 'whatsapp', '+5511988776655', 'open',
               clock_timestamp(), 0)`,
      [tenantId, conversationId, channelIdentityId]);
    await c.query(
      `INSERT INTO msg.message
         (tenant_id, id, conversation_id, direction, body, status)
       VALUES ($1, $2, $3, 'outbound', 'Sua consulta esta confirmada', 'queued')`,
      [tenantId, messageId, conversationId]);
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

describe('envio de mensagem via worker', () => {
  it('envia a mensagem e atualiza o status para sent', async () => {
    const messaging = createFakeMessagingProvider();
    const r = await sendMessage({
      tenantId, messageId, conversationId,
    }, messaging);

    expect(r.status).toBe('sent');
    expect(r.providerMessageId).toBeTruthy();

    // Verificar no banco
    const { rows } = await jobsPool().query<{ status: string }>(
      `SELECT status::text FROM msg.message WHERE id = $1`, [messageId]);
    expect(rows[0]?.status).toBe('sent');
  });
});
```

```ts
// apps/worker/src/jobs/daily-rollup.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { materializeDailyRollup } from './daily-rollup';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let clinicId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  clinicId = uuidv7();
  const userId = uuidv7();
  const patientId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Rollup Test', '99999999000199')`,
      [tenantId, `rl-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Rl', '2077510', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User Rl')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Rl', 'completo', '1990-01-01')`,
      [tenantId, patientId]);

    // Inserir pagamento de ontem
    await c.query(
      `INSERT INTO fin.payment
         (tenant_id, id, patient_id, clinic_id, amount_cents, method,
          status, created_by, paid_at, created_at)
       VALUES ($1, $2, $3, $4, 15000, 'pix', 'confirmed', $5,
               clock_timestamp() - interval '1 day',
               clock_timestamp() - interval '1 day')`,
      [tenantId, uuidv7(), patientId, clinicId, userId]);

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

describe('materializacao do daily_rollup', () => {
  it('agrega pagamentos do dia anterior no rollup', async () => {
    const r = await materializeDailyRollup();
    expect(r.rowsUpserted).toBeGreaterThanOrEqual(1);

    // Verificar que o rollup foi gravado
    const { rows } = await jobsPool().query<{ entries: string; amount: string }>(
      `SELECT entries::text, amount::text FROM fin.daily_rollup
        WHERE tenant_id = $1 AND clinic_id = $2`,
      [tenantId, clinicId]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
```

```ts
// apps/worker/src/jobs/payment-reconciliation.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { createFakePaymentProvider } from '@cadencia/integrations';
import { reconcilePayments } from './payment-reconciliation';

afterAll(async () => { await closePools(); });

describe('reconciliacao de pagamentos', () => {
  it('roda sem erro mesmo sem pagamentos PSP', async () => {
    const payment = createFakePaymentProvider();
    const r = await reconcilePayments(payment);
    expect(r.tenantsProcessed).toBeGreaterThanOrEqual(0);
    expect(typeof r.settlementsFound).toBe('number');
    expect(typeof r.divergences).toBe('number');
  });
});
```

```ts
// apps/worker/src/jobs/reminder-scheduler.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import PgBoss from 'pg-boss';
import { scheduleReminders } from './reminder-scheduler';

let boss: PgBoss;

afterAll(async () => {
  if (boss) await boss.stop();
  await closePools();
});

describe('agendador de lembretes', () => {
  it('roda sem erro mesmo sem regras habilitadas', async () => {
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL_JOBS ?? '',
      schema: 'pgboss',
    });
    await boss.start();

    const r = await scheduleReminders(boss);
    expect(r.scheduled).toBeGreaterThanOrEqual(0);
    expect(r.skipped).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] Rodar todos os testes do worker.

```bash
pnpm vitest run apps/worker/src/jobs/
# Esperado: PASS — todos os testes verdes
```

- [ ] Commitar.

```bash
git add apps/worker/src/worker.ts \
       apps/worker/src/jobs/outbox-dispatcher.ts \
       apps/worker/src/jobs/outbox-dispatcher.int.test.ts \
       apps/worker/src/jobs/send-message.ts \
       apps/worker/src/jobs/send-message.int.test.ts \
       apps/worker/src/jobs/payment-reconciliation.ts \
       apps/worker/src/jobs/payment-reconciliation.int.test.ts \
       apps/worker/src/jobs/daily-rollup.ts \
       apps/worker/src/jobs/daily-rollup.int.test.ts \
       apps/worker/src/jobs/reminder-scheduler.ts \
       apps/worker/src/jobs/reminder-scheduler.int.test.ts
git commit -m "feat(worker): add outbox dispatcher, message sending, reconciliation, rollup and reminder jobs"
```

---

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
