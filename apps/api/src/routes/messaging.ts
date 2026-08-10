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
  // Nulo e caso NORMAL, nao erro: quem escreve pela primeira vez ainda nao esta
  // no cadastro, e a recepcao precisa ver o numero para decidir se vincula.
  patientName: z.string().nullable(),
  channelIdentityId: z.string().uuid(),
  channel: z.string(),
  remotePhone: z.string(),
  status: z.string(),
  lastMessageAt: z.string().nullable(),
  lastMessageBody: z.string(),
  lastMessageDirection: z.enum(['inbound', 'outbound']).nullable(),
  // Derivado de mensagem ENTRANTE sem read_at. Nao existe coluna de contador:
  // um contador denormalizado erra na primeira corrida entre duas abas abertas.
  unreadCount: z.number().int(),
});

const MessageSchema = z.object({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  direction: z.enum(['inbound', 'outbound']),
  channel: z.string(),
  bodyText: z.string().nullable(),
  bodyMediaKey: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
});

const TemplateSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string(),
  channelIdentityId: z.string().uuid(),
  channel: z.string(),
  category: z.string(),
  bodyTemplate: z.string(),
  variables: z.unknown(),
  status: z.string(),
  updatedAt: z.string(),
});

const AutomationRuleSchema = z.object({
  ruleId: z.string().uuid(),
  trigger: z.string(),
  channelIdentityId: z.string().uuid(),
  templateId: z.string().uuid(),
  timingOffsetMinutes: z.number().int(),
  active: z.boolean(),
  channel: z.string(),
  updatedAt: z.string(),
});

export async function messagingRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /v1/conversations ────────────────────────────────────────────────
  r.get('/v1/conversations', {
    schema: {
      querystring: z.object({
        status: z.enum(['active', 'archived']).optional(),
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
      conversation_id: string; patient_id: string | null;
      channel_identity_id: string; channel: string;
      remote_phone: string; status: string;
      last_message_at: string | null;
    }>(
      `SELECT c.id AS conversation_id, c.patient_id,
              p.display_name AS patient_name,
              c.channel_identity_id, ci.channel,
              c.remote_phone, c.status,
              to_char(c.last_message_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_message_at,
              ult.body_text AS last_message_body,
              ult.direction  AS last_message_direction,
              (SELECT count(*) FROM msg.message m
                WHERE m.tenant_id = c.tenant_id AND m.conversation_id = c.id
                  AND m.direction = 'inbound' AND m.read_at IS NULL)
                AS unread_count
         FROM msg.conversation c
         JOIN msg.channel_identity ci
           ON ci.tenant_id = c.tenant_id AND ci.id = c.channel_identity_id
         LEFT JOIN clin.patient p
           ON (p.tenant_id, p.id) = (c.tenant_id, c.patient_id)
         -- LATERAL e nao subconsulta correlacionada por campo: a previa precisa
         -- do texto E da direcao da MESMA mensagem, e duas subconsultas
         -- separadas poderiam trazer linhas diferentes se houvesse empate.
         LEFT JOIN LATERAL (
           SELECT m.body_text, m.direction
             FROM msg.message m
            WHERE m.tenant_id = c.tenant_id AND m.conversation_id = c.id
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
         ) ult ON TRUE
        WHERE TRUE ${where}
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT $${idx}`,
      params,
    );

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      conversationId: row.conversation_id,
      patientId: row.patient_id,
      patientName: (row as { patient_name?: string | null }).patient_name ?? null,
      channelIdentityId: row.channel_identity_id,
      channel: row.channel,
      remotePhone: row.remote_phone,
      status: row.status,
      lastMessageAt: row.last_message_at,
      lastMessageBody: (row as { last_message_body?: string | null }).last_message_body ?? '',
      lastMessageDirection:
        (row as { last_message_direction?: 'inbound' | 'outbound' | null })
          .last_message_direction ?? null,
      unreadCount: Number((row as { unread_count?: string }).unread_count ?? 0),
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
      cursorClause = 'AND m.created_at < $2';
      params.push(q.cursor);
    }
    params.push(limite + 1);

    const { rows } = await tx.query<{
      message_id: string; conversation_id: string; direction: string;
      channel: string; body_text: string | null;
      body_media_key: string | null;
      status: string; created_at: string;
    }>(
      `SELECT m.id AS message_id, m.conversation_id,
              m.direction, m.channel,
              m.body_text, m.body_media_key, m.status,
              to_char(m.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
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
      channel: row.channel,
      bodyText: row.body_text,
      bodyMediaKey: row.body_media_key,
      status: row.status,
      createdAt: row.created_at,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt
      : null;

    return { itens, nextCursor };
  }));

  // ── POST /v1/conversations/:id/messages ──────────────────────────────────
  /**
   * O contexto que o painel lateral da conversa mostra.
   *
   * Existe para a recepcao responder SEM trocar de tela. Sem ele, cada "posso
   * remarcar?" obriga a abrir o cadastro em outra aba, e o atendimento por
   * mensagem deixa de ser mais rapido que o telefone — que e a razao inteira
   * do modulo existir.
   */
  r.get('/v1/conversations/:id/contexto', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          proximoAgendamento: z.object({
            appointmentId: z.string().uuid(),
            quando: z.string(),
            profissional: z.string(),
            procedimento: z.string().nullable(),
            status: z.string(),
          }).nullable(),
          pendencias: z.array(z.string()),
          historicoAgendamentos: z.array(z.object({
            appointmentId: z.string().uuid(),
            quando: z.string(),
            status: z.string(),
          })),
        }),
        404: z.object({ erro: z.literal('nao_encontrado') }),
      },
    },
  }, rota('messaging.conversation.read', async (tx, ctx, req, reply) => {
    const p = req.params as { id: string };

    const { rows: conv } = await tx.query<{ patient_id: string | null }>(
      `SELECT patient_id FROM msg.conversation WHERE id = $1`, [p.id]);
    if (conv.length === 0) {
      return reply.code(404).send({ erro: 'nao_encontrado' as const });
    }

    const patientId = conv[0]?.patient_id ?? null;
    // Conversa sem paciente vinculado nao tem contexto — e nao e erro. A tela
    // mostra o convite para vincular, que e a acao util nesse estado.
    if (patientId === null) {
      return { proximoAgendamento: null, pendencias: [], historicoAgendamentos: [] };
    }

    const { rows: futuros } = await tx.query<{
      id: string; quando: Date; profissional: string | null;
      procedimento: string | null; status: string;
    }>(
      `SELECT a.id,
              a.starts_at AS quando,
              u.full_name AS profissional,
              pr.nome AS procedimento,
              a.status::text AS status
         FROM sched.appointment a
         LEFT JOIN app.professional prof
                ON (prof.tenant_id, prof.id) = (a.tenant_id, a.professional_id)
         LEFT JOIN id."user" u ON u.id = prof.user_id
         LEFT JOIN sched.procedure pr
                ON (pr.tenant_id, pr.id) = (a.tenant_id, a.procedure_id)
        WHERE a.patient_id = $1 AND a.clinic_id = $2
          AND a.starts_at >= clock_timestamp() AND a.status <> 'cancelado'
        ORDER BY a.starts_at
        LIMIT 1`,
      [patientId, ctx.actor.clinicId]);

    const { rows: passados } = await tx.query<{
      id: string; quando: Date; status: string }>(
      `SELECT a.id, a.starts_at AS quando, a.status::text AS status
         FROM sched.appointment a
        WHERE a.patient_id = $1 AND a.clinic_id = $2
          AND a.starts_at < clock_timestamp()
        ORDER BY a.starts_at DESC
        LIMIT 5`,
      [patientId, ctx.actor.clinicId]);

    const { rows: deb } = await tx.query<{ pendencia: string }>(
      `SELECT 'Cadastro incompleto' AS pendencia
         FROM clin.patient WHERE id = $1 AND cadastro_status = 'preliminar'
        UNION ALL
       SELECT 'Pagamento em aberto'
         FROM fin.entry
        WHERE patient_id = $1 AND kind = 'receita' AND status = 'pendente'
        LIMIT 5`,
      [patientId]);

    const proximo = futuros[0];
    return {
      proximoAgendamento: proximo === undefined ? null : {
        appointmentId: proximo.id,
        quando: proximo.quando.toISOString(),
        profissional: proximo.profissional ?? '',
        procedimento: proximo.procedimento,
        status: proximo.status,
      },
      pendencias: [...new Set(deb.map((x) => x.pendencia))],
      historicoAgendamentos: passados.map((x) => ({
        appointmentId: x.id, quando: x.quando.toISOString(), status: x.status })),
    };
  }));

  r.post('/v1/conversations/:id/messages', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        body: z.string().min(1).max(4096),
        templateKey: z.string().optional(),
      }),
      response: {
        201: z.object({
          messageId: z.string().uuid(),
          status: z.literal('queued'),
        }),
      },
    },
  }, rota('messaging.message.write', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as { body: string; templateKey?: string };

    // Verificar que a conversa existe e obter o canal
    const { rows: convRows } = await tx.query<{ id: string; channel: string }>(
      `SELECT c.id, ci.channel
         FROM msg.conversation c
         JOIN msg.channel_identity ci
           ON ci.tenant_id = c.tenant_id AND ci.id = c.channel_identity_id
        WHERE c.id = $1`, [p.id]);
    if (convRows.length === 0) erroDominio('conversa_nao_encontrada', 404);

    const channel = convRows[0]!.channel;

    // Inserir a mensagem com status 'queued'
    const { rows } = await tx.query<{ message_id: string }>(
      `INSERT INTO msg.message
         (id, conversation_id, direction, channel, body_text, status, template_key)
       VALUES (gen_random_uuid(), $1, 'outbound', $2, $3, 'queued', $4)
       RETURNING id::text AS message_id`,
      [p.id, channel, b.body, b.templateKey ?? null]);

    // Enfileirar no outbox para envio pelo worker
    await tx.query(
      `INSERT INTO app.outbox (event_type, aggregate_id, payload)
       VALUES ('send_message', $1::uuid,
               jsonb_build_object('messageId', $2::text, 'conversationId', $3::text))`,
      [rows[0]!.message_id, rows[0]!.message_id, p.id]);

    void reply.code(201);
    return { messageId: rows[0]!.message_id, status: 'queued' as const };
  }));

  // ── GET /v1/messaging/templates ──────────────────────────────────────────
  r.get('/v1/messaging/templates', {
    schema: {
      querystring: z.object({
        category: z.string().optional(),
        channel: z.string().optional(),
      }),
      response: {
        200: z.object({ itens: z.array(TemplateSchema) }),
      },
    },
  }, rota('messaging.template.read', async (tx, _ctx, req) => {
    const q = req.query as { category?: string; channel?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.category !== undefined) {
      condicoes.push(`t.category = $${idx}`);
      params.push(q.category);
      idx += 1;
    }
    if (q.channel !== undefined) {
      condicoes.push(`t.channel = $${idx}`);
      params.push(q.channel);
      idx += 1;
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      template_id: string; name: string; channel_identity_id: string;
      channel: string; category: string;
      body_template: string; variables: unknown; status: string;
      updated_at: string;
    }>(
      `SELECT t.id AS template_id, t.name,
              t.channel_identity_id, t.channel, t.category,
              t.body_template, t.variables, t.status,
              to_char(t.updated_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
         FROM msg.template t
        ${where}
        ORDER BY t.category, t.name`,
      params,
    );

    return {
      itens: rows.map((row) => ({
        templateId: row.template_id,
        name: row.name,
        channelIdentityId: row.channel_identity_id,
        channel: row.channel,
        category: row.category,
        bodyTemplate: row.body_template,
        variables: row.variables,
        status: row.status,
        updatedAt: row.updated_at,
      })),
    };
  }));

  // ── POST /v1/messaging/templates ─────────────────────────────────────────
  r.post('/v1/messaging/templates', {
    schema: {
      body: z.object({
        templateId: z.string().uuid().optional(),
        channelIdentityId: z.string().uuid(),
        name: z.string().min(1).max(128),
        category: z.enum(['marketing', 'utility', 'authentication']),
        bodyTemplate: z.string().min(1).max(1024),
        variables: z.array(z.string()),
      }),
      response: {
        200: z.object({ templateId: z.string().uuid(), status: z.string() }),
      },
    },
  }, rota('messaging.template.write', async (tx, _ctx, req) => {
    const b = req.body as {
      templateId?: string; channelIdentityId: string; name: string;
      category: string; bodyTemplate: string; variables: string[] };

    if (b.templateId !== undefined) {
      // Upsert — atualizar template existente
      const r = await tx.query(
        `UPDATE msg.template
            SET name = $2, category = $3,
                body_template = $4, variables = $5::jsonb,
                status = 'pending',
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [b.templateId, b.name, b.category, b.bodyTemplate,
         JSON.stringify(b.variables)]);
      // O UPDATE nao reclama de linha inexistente: id errado (ou de outro
      // tenant, filtrado pela RLS) atualizava zero linhas e a rota respondia
      // 200 com `status: 'pending'`. A tela mostrava o template salvo, o
      // usuario fechava, e nada tinha sido gravado.
      if (r.rowCount === 0) erroDominio('template_nao_encontrado', 404);
      return { templateId: b.templateId, status: 'pending' };
    }

    // Buscar o canal da identidade
    const { rows: ciRows } = await tx.query<{ channel: string }>(
      `SELECT channel FROM msg.channel_identity WHERE id = $1`,
      [b.channelIdentityId]);
    if (ciRows.length === 0) erroDominio('canal_nao_encontrado', 404);

    const { rows } = await tx.query<{ template_id: string }>(
      `INSERT INTO msg.template
         (id, channel_identity_id, channel, name, category,
          body_template, variables, status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, 'pending')
       RETURNING id::text AS template_id`,
      [b.channelIdentityId, ciRows[0]!.channel, b.name, b.category,
       b.bodyTemplate, JSON.stringify(b.variables)]);
    return { templateId: rows[0]!.template_id, status: 'pending' };
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
      rule_id: string; trigger: string; channel_identity_id: string;
      template_id: string;
      timing_offset_minutes: string; active: boolean; channel: string;
      updated_at: string;
    }>(
      `SELECT r.id AS rule_id, r.trigger, r.channel_identity_id,
              r.template_id,
              r.timing_offset_minutes::text, r.active, r.channel,
              to_char(r.updated_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
         FROM msg.automation_rule r
        ORDER BY r.trigger, r.timing_offset_minutes`);
    return {
      itens: rows.map((row) => ({
        ruleId: row.rule_id,
        trigger: row.trigger,
        channelIdentityId: row.channel_identity_id,
        templateId: row.template_id,
        timingOffsetMinutes: Number(row.timing_offset_minutes),
        active: row.active,
        channel: row.channel,
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
          channelIdentityId: z.string().uuid(),
          trigger: z.enum([
            'appointment_created', 'appointment_reminder',
            'encounter_finalized', 'nps_due',
          ]),
          templateId: z.string().uuid(),
          timingOffsetMinutes: z.number().int(),
          active: z.boolean(),
          channel: z.enum(['whatsapp', 'sms', 'email']),
        })),
      }),
      response: {
        200: z.object({ saved: z.number().int() }),
      },
    },
  }, rota('messaging.automation.write', async (tx, _ctx, req) => {
    const b = req.body as {
      rules: Array<{
        ruleId?: string; channelIdentityId: string; trigger: string;
        templateId: string;
        timingOffsetMinutes: number; active: boolean; channel: string;
      }>;
    };

    let saved = 0;
    for (const rule of b.rules) {
      if (rule.ruleId !== undefined) {
        await tx.query(
          `UPDATE msg.automation_rule
              SET trigger = $2, template_id = $3, timing_offset_minutes = $4,
                  active = $5, channel = $6, updated_at = clock_timestamp()
            WHERE id = $1`,
          [rule.ruleId, rule.trigger, rule.templateId, rule.timingOffsetMinutes,
           rule.active, rule.channel]);
      } else {
        await tx.query(
          `INSERT INTO msg.automation_rule
             (id, channel_identity_id, trigger, template_id,
              timing_offset_minutes, channel, active)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
          [rule.channelIdentityId, rule.trigger, rule.templateId,
           rule.timingOffsetMinutes, rule.channel, rule.active]);
      }
      saved += 1;
    }

    return { saved };
  }));
}
