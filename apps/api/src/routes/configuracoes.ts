import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
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
}
