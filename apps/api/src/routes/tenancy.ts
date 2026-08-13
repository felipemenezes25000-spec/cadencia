import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

const RoleSchema = z.enum([
  'admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro',
]);

const OverrideSchema = z.object({
  action: z.string(), role: RoleSchema, permitido: z.boolean(),
});

/**
 * Endpoints usados pela administração multiunidade.
 *
 * Equipe e criação de unidade vivem em /v1/configuracoes/*, onde o fluxo inclui
 * senha temporária, dados profissionais, auditoria e validação de fuso. As rotas
 * antigas que retornavam ids aleatórios foram removidas: sucesso fictício é pior
 * que um 404 porque induz a interface a afirmar que algo foi persistido.
 */
export async function tenancyRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/tenants/current', {
    schema: { response: { 200: z.object({
      id: z.string().uuid(), nome: z.string(), slug: z.string(), createdAt: z.string(),
    }) } },
  }, rota('tenant.read', async (tx) => {
    const { rows } = await tx.query<{
      id: string; nome: string; slug: string; created_at: Date;
    }>(
      `SELECT id, razao_social AS nome, slug::text, created_at
         FROM app.tenant WHERE id = app.current_tenant_id()`,
    );
    const tenant = rows[0];
    if (tenant === undefined) throw new Error('tenant do contexto nao encontrado');
    return {
      id: tenant.id, nome: tenant.nome, slug: tenant.slug,
      createdAt: tenant.created_at.toISOString(),
    };
  }));

  r.get('/v1/clinics', {
    schema: { response: { 200: z.object({ itens: z.array(z.object({
      id: z.string().uuid(), nome: z.string(), cnpj: z.string().nullable(),
      cnes: z.string().nullable(), endereco: z.string().nullable(),
      fusoHorario: z.string(), ativo: z.boolean(), principal: z.boolean(),
    })) }) } },
  }, rota('tenant.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      id: string; nome: string; cnpj: string | null; cnes: string | null;
      timezone: string;
    }>(`SELECT id, nome, cnpj, cnes, timezone FROM app.clinic ORDER BY nome`);
    return { itens: rows.map((clinic) => ({
      id: clinic.id, nome: clinic.nome, cnpj: clinic.cnpj, cnes: clinic.cnes,
      endereco: null, fusoHorario: clinic.timezone, ativo: true,
      principal: clinic.id === ctx.actor.clinicId,
    })) };
  }));

  r.get('/v1/permissions', {
    schema: {
      querystring: z.object({ clinicId: z.string().uuid() }),
      response: { 200: z.object({
        overrides: z.record(z.string(), z.array(OverrideSchema)),
      }) },
    },
  }, rota('tenant.read', async (tx, _ctx, req) => {
    const query = req.query as { clinicId: string };
    const { rows } = await tx.query<{
      action: string; role: z.infer<typeof RoleSchema>; permitido: boolean;
    }>(
      `SELECT action_key AS action, role, allowed AS permitido
         FROM app.permission_override
        WHERE clinic_id = $1
        ORDER BY role, action_key`,
      [query.clinicId],
    );
    const overrides: Record<string, z.infer<typeof OverrideSchema>[]> = {};
    for (const item of rows) (overrides[item.role] ??= []).push(item);
    return { overrides };
  }));

  r.put('/v1/clinics/:id/permissions', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ overrides: z.array(OverrideSchema).max(500) }),
      response: { 200: z.object({ saved: z.number().int() }) },
    },
  }, rota('tenant.write', async (tx, _ctx, req) => {
    const params = req.params as { id: string };
    const body = req.body as { overrides: z.infer<typeof OverrideSchema>[] };
    await tx.query(`DELETE FROM app.permission_override WHERE clinic_id = $1`, [params.id]);
    for (const item of body.overrides) {
      await tx.query(
        `INSERT INTO app.permission_override
           (tenant_id, clinic_id, role, action_key, allowed)
         VALUES (app.require_tenant_id(), $1, $2, $3, $4)`,
        [params.id, item.role, item.action, item.permitido],
      );
    }
    return { saved: body.overrides.length };
  }));
}
