import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { hashPassword } from '@cadencia/authn';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

/**
 * Configuracoes da unidade e da equipe.
 *
 * A leitura da EQUIPE nao pode sair de `app.membership` direto: a policy daquela
 * tabela (migration 0007) so deixa o dono ler o proprio vinculo, e por um motivo
 * bom — ela e a raiz da confianca e uma policy mais larga abriria a porta que a
 * RLS inteira existe para fechar. Quem lista a equipe e uma leitura por
 * `id_login`, o mesmo caminho estreito do login (migration 0132), com o tenant
 * vindo do contexto e nao do cliente.
 */

const ClinicaSchema = z.object({
  clinicId: z.string().uuid(),
  nome: z.string(),
  cnpj: z.string().nullable(),
  cnes: z.string().nullable(),
  timezone: z.string(),
  tenantNome: z.string(),
});

const ClinicaResumoSchema = z.object({
  clinicId: z.string().uuid(),
  nome: z.string(),
  cnpj: z.string().nullable(),
  cnes: z.string().nullable(),
  timezone: z.string(),
});

export async function configuracaoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/configuracoes/clinica', {
    schema: { response: { 200: ClinicaSchema } },
  }, rota('clinic.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      id: string; nome: string; cnpj: string | null; cnes: string | null;
      timezone: string; razao_social: string;
    }>(
      `SELECT c.id, c.nome, c.cnpj, c.cnes, c.timezone, t.razao_social
         FROM app.clinic c
         JOIN app.tenant t ON t.id = c.tenant_id
        WHERE c.id = $1`,
      [ctx.actor.clinicId]);

    const c = rows[0];
    if (c === undefined) throw new Error('clinica do contexto nao encontrada');

    return {
      clinicId: c.id, nome: c.nome, cnpj: c.cnpj, cnes: c.cnes,
      timezone: c.timezone, tenantNome: c.razao_social,
    };
  }));

  r.put('/v1/configuracoes/clinica', {
    schema: {
      body: z.object({
        nome: z.string().min(2).max(120),
        timezone: z.string().min(3).max(60),
        cnes: z.string().regex(/^\d{7}$/).optional(),
        cnpj: z.string().regex(/^[A-Z0-9]{12}[0-9]{2}$/).optional(),
      }),
      response: {
        200: ClinicaSchema,
        422: z.object({ erro: z.literal('fuso_invalido') }),
      },
    },
  }, rota('clinic.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      nome: string; timezone: string; cnes?: string; cnpj?: string };

    // O fuso decide a data de TODO evento persistido (§10 item 10). Validar
    // contra o catalogo do proprio Postgres, e nao contra uma lista nossa, e o
    // que garante que `app.local_date` vai aceitar o mesmo valor depois.
    const { rows: fuso } = await tx.query<{ existe: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1) AS existe`,
      [b.timezone]);
    if (fuso[0]?.existe !== true) {
      return reply.code(422).send({ erro: 'fuso_invalido' as const });
    }

    const { rows } = await tx.query<{
      id: string; nome: string; cnpj: string | null; cnes: string | null;
      timezone: string;
    }>(
      `UPDATE app.clinic
          SET nome = $2, timezone = $3,
              cnes = coalesce($4, cnes), cnpj = coalesce($5, cnpj)
        WHERE id = $1
        RETURNING id, nome, cnpj, cnes, timezone`,
      [ctx.actor.clinicId, b.nome, b.timezone, b.cnes ?? null, b.cnpj ?? null]);

    const c = rows[0];
    if (c === undefined) throw new Error('clinica do contexto nao encontrada');

    const { rows: t } = await tx.query<{ razao_social: string }>(
      `SELECT razao_social FROM app.tenant WHERE id = app.current_tenant_id()`);

    return {
      clinicId: c.id, nome: c.nome, cnpj: c.cnpj, cnes: c.cnes,
      timezone: c.timezone, tenantNome: t[0]?.razao_social ?? '',
    };
  }));

  // ── Clinicas do tenant ──────────────────────────────────────────────────

  r.get('/v1/configuracoes/clinicas', {
    schema: {
      response: {
        200: z.object({ itens: z.array(ClinicaResumoSchema) }),
      },
    },
  }, rota('clinic.read', async (tx) => {
    const { rows } = await tx.query<{
      id: string; nome: string; cnpj: string | null;
      cnes: string | null; timezone: string;
    }>(`SELECT id, nome, cnpj, cnes, timezone FROM app.clinic ORDER BY nome`);

    return {
      itens: rows.map((c) => ({
        clinicId: c.id, nome: c.nome, cnpj: c.cnpj,
        cnes: c.cnes, timezone: c.timezone,
      })),
    };
  }));

  r.post('/v1/configuracoes/clinicas', {
    schema: {
      body: z.object({
        nome: z.string().min(2).max(120),
        timezone: z.string().min(3).max(60),
        cnpj: z.string().regex(/^[A-Z0-9]{12}[0-9]{2}$/).optional(),
        cnes: z.string().regex(/^\d{7}$/).optional(),
      }),
      response: {
        201: z.object({ clinicId: z.string().uuid() }),
        422: z.object({ erro: z.literal('fuso_invalido') }),
      },
    },
  }, rota('clinic.create', async (tx, ctx, req, reply) => {
    const b = req.body as {
      nome: string; timezone: string; cnpj?: string; cnes?: string;
    };

    const { rows: fuso } = await tx.query<{ existe: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1) AS existe`,
      [b.timezone]);
    if (fuso[0]?.existe !== true) {
      return reply.code(422).send({ erro: 'fuso_invalido' as const });
    }

    const clinicId = uuidv7();

    await tx.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4, $5)`,
      [clinicId, b.nome, b.cnpj ?? null, b.cnes ?? null, b.timezone]);

    await tx.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role, granted_by)
       VALUES (app.current_tenant_id(), gen_random_uuid(), $1, $2, 'admin_clinico', $1)`,
      [ctx.actor.userId, clinicId]);

    await tx.query(
      `SELECT audit.log('CLINIC_CREATE', 'app', 'clinic', $1, 'sucesso',
              jsonb_build_object('clinic_id', $2::text), $3)`,
      [clinicId, clinicId, ctx.actor.clinicId]);

    void reply.code(201);
    return { clinicId };
  }));

  r.get('/v1/configuracoes/equipe', {
    schema: {
      response: {
        200: z.object({
          itens: z.array(z.object({
            userId: z.string().uuid(),
            nome: z.string(),
            email: z.string(),
            role: z.enum(['admin_clinico', 'diretor_tecnico', 'profissional',
                          'recepcao', 'financeiro']),
            ehProfissional: z.boolean(),
            conselho: z.string().nullable(),
            desde: z.string(),
            temTotp: z.boolean(),
          })),
        }),
      },
    },
  }, rota('membership.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      user_id: string; nome: string; email: string; role: string;
      conselho: string | null; granted_at: Date; tem_totp: boolean;
    }>(
      `SELECT * FROM app.equipe_da_unidade($1)`, [ctx.actor.clinicId]);

    return {
      itens: rows.map((x) => ({
        userId: x.user_id,
        nome: x.nome,
        email: x.email,
        role: x.role as 'admin_clinico',
        ehProfissional: x.conselho !== null,
        conselho: x.conselho,
        desde: x.granted_at.toISOString(),
        temTotp: x.tem_totp,
      })),
    };
  }));

  // ── Convite ──────────────────────────────────────────────────────────────

  const ROLES_PROFISSIONAIS = ['profissional', 'diretor_tecnico'] as const;

  r.post('/v1/configuracoes/equipe', {
    schema: {
      body: z.object({
        email: z.string().email(),
        nome: z.string().min(2),
        role: z.enum(['admin_clinico', 'diretor_tecnico', 'profissional',
                      'recepcao', 'financeiro']),
        senhaTemporaria: z.string().min(8),
        cpf: z.string().regex(/^\d{11}$/).optional(),
        conselho: z.string().min(1).optional(),
        numeroConselho: z.string().min(1).optional(),
        ufConselho: z.string().regex(/^[A-Z]{2}$/).optional(),
        cbos: z.string().min(1).optional(),
      }),
      response: {
        201: z.object({
          userId: z.string().uuid(),
          membershipId: z.string().uuid(),
        }),
        409: z.object({ erro: z.literal('vinculo_duplicado') }),
        422: z.object({ erro: z.literal('dados_profissionais_obrigatorios') }),
      },
    },
  }, rota('membership.grant', async (tx, ctx, req, reply) => {
    const b = req.body as {
      email: string; nome: string; role: string; senhaTemporaria: string;
      cpf?: string; conselho?: string; numeroConselho?: string;
      ufConselho?: string; cbos?: string;
    };

    if ((ROLES_PROFISSIONAIS as readonly string[]).includes(b.role)) {
      if (!b.conselho || !b.numeroConselho || !b.ufConselho) {
        return reply.code(422).send({
          erro: 'dados_profissionais_obrigatorios' as const,
        });
      }
    }

    const senhaHash = await hashPassword(b.senhaTemporaria);

    try {
      const { rows } = await tx.query<{
        r_user_id: string; r_membership_id: string;
      }>(
        `SELECT * FROM app.conceder_vinculo($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          ctx.actor.clinicId, b.email, b.nome, b.role, senhaHash,
          b.cpf ?? null, b.conselho ?? null, b.numeroConselho ?? null,
          b.ufConselho ?? null, b.cbos ?? null,
        ],
      );

      const row = rows[0]!;

      await tx.query(
        `SELECT audit.log('MEMBERSHIP_GRANT', 'app', 'membership', $1, 'sucesso',
                jsonb_build_object('role', $2::text, 'target_user_id', $3::text,
                                   'membership_id', $4::text), $5)`,
        [row.r_membership_id, b.role, row.r_user_id, row.r_membership_id,
         ctx.actor.clinicId]);

      void reply.code(201);
      return { userId: row.r_user_id, membershipId: row.r_membership_id };
    } catch (e: unknown) {
      if (typeof e === 'object' && e !== null && 'code' in e
          && (e as { code: string }).code === '23505') {
        return reply.code(409).send({ erro: 'vinculo_duplicado' as const });
      }
      throw e;
    }
  }));

  // ── Revogacao ────────────────────────────────────────────────────────────

  r.delete('/v1/configuracoes/equipe/:userId/role/:role', {
    schema: {
      params: z.object({
        userId: z.string().uuid(),
        role: z.enum(['admin_clinico', 'diretor_tecnico', 'profissional',
                      'recepcao', 'financeiro']),
      }),
      body: z.object({
        motivo: z.string().optional(),
      }),
      response: {
        200: z.object({ ok: z.literal(true) }),
        404: z.object({ erro: z.literal('vinculo_nao_encontrado') }),
        422: z.object({ erro: z.literal('auto_revogacao') }),
      },
    },
  }, rota('membership.revoke', async (tx, ctx, req, reply) => {
    const p = req.params as { userId: string; role: string };
    const b = req.body as { motivo?: string };

    if (p.userId === ctx.actor.userId) {
      return reply.code(422).send({ erro: 'auto_revogacao' as const });
    }

    const { rows } = await tx.query<{ revogar_vinculo: number }>(
      `SELECT app.revogar_vinculo($1, $2, $3, $4)`,
      [ctx.actor.clinicId, p.userId, p.role, b.motivo ?? null],
    );

    const count = rows[0]?.revogar_vinculo ?? 0;
    if (count === 0) {
      return reply.code(404).send({
        erro: 'vinculo_nao_encontrado' as const,
      });
    }

    await tx.query(
      `SELECT audit.log('MEMBERSHIP_REVOKE', 'app', 'membership', NULL, 'sucesso',
              jsonb_build_object('role', $1::text, 'target_user_id', $2::text,
                                 'motivo', coalesce($3::text, '')), $4)`,
      [p.role, p.userId, b.motivo ?? '', ctx.actor.clinicId]);

    return { ok: true as const };
  }));

  // ── Desativacao de MFA por admin ─────────────────────────────────────────

  r.delete('/v1/configuracoes/equipe/:userId/mfa', {
    schema: {
      params: z.object({
        userId: z.string().uuid(),
      }),
      body: z.object({}),
      response: {
        200: z.object({ ok: z.literal(true) }),
        404: z.object({ erro: z.literal('mfa_nao_cadastrado') }),
        422: z.object({ erro: z.literal('auto_desativacao') }),
      },
    },
  }, rota('mfa.admin_disable', async (tx, ctx, req, reply) => {
    const p = req.params as { userId: string };

    if (p.userId === ctx.actor.userId) {
      return reply.code(422).send({ erro: 'auto_desativacao' as const });
    }

    const { rows: equipe } = await tx.query<{ user_id: string }>(
      `SELECT user_id FROM app.equipe_da_unidade($1)`,
      [ctx.actor.clinicId],
    );
    if (!equipe.some((m) => m.user_id === p.userId)) {
      return reply.code(404).send({ erro: 'mfa_nao_cadastrado' as const });
    }

    const { rows } = await tx.query<{ desativar_totp_admin: number }>(
      `SELECT id.desativar_totp_admin($1)`,
      [p.userId],
    );

    const count = rows[0]?.desativar_totp_admin ?? 0;
    if (count === 0) {
      return reply.code(404).send({ erro: 'mfa_nao_cadastrado' as const });
    }

    await tx.query(
      `SELECT audit.log('MFA_ADMIN_DISABLE', 'id', 'user_totp', NULL, 'sucesso',
              jsonb_build_object('target_user_id', $1::text), $2)`,
      [p.userId, ctx.actor.clinicId]);

    return { ok: true as const };
  }));
}
