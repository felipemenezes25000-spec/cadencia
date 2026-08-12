// apps/api/src/routes/tiss/operadoras.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const OperadoraSchema = z.object({
  operadoraId: z.string().uuid(),
  nome: z.string(),
  registroAns: z.string(),
  cnpj: z.string(),
  tissVersion: z.string(),
  transportMode: z.enum(['arquivo', 'webservice']),
  telefone: z.string().nullable(),
  email: z.string().nullable(),
  // Quantos pacientes têm carteirinha desta operadora. É o número que decide se
  // vale a pena manter o contrato: operadora com dois pacientes é trabalho de
  // faturamento igual ao de uma com duzentos.
  totalPacientes: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
});

export async function operadoraRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // -- POST /v1/tiss/operadoras -- cadastrar operadora -----------------------
  r.post('/v1/tiss/operadoras', {
    schema: {
      body: z.object({
        nome: z.string().min(1).max(300),
        registroAns: z.string().regex(/^[0-9]{6}$/),
        cnpj: z.string().regex(/^[A-Z0-9]{12}[0-9]{2}$/),
        tissVersion: z.string().min(1).max(5),
        transportMode: z.enum(['arquivo', 'webservice']),
      }),
      response: { 201: z.object({ operadoraId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.write', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      nome: string; registroAns: string; cnpj: string;
      tissVersion: string; transportMode: string };
    const id = uuidv7();

    // Verificar unicidade de registro_ans dentro do tenant
    const { rowCount: existe } = await tx.query(
      `SELECT 1 FROM tiss.operadora
        WHERE registro_ans = $1 AND active = true`,
      [b.registroAns]);
    if (existe !== null && existe > 0) {
      erroDominio('operadora_registro_ans_duplicado', 422);
    }

    await tx.query(
      `INSERT INTO tiss.operadora
         (id, registro_ans, razao_social, cnpj, tiss_version, transport_mode, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, app.current_user_id())`,
      [id, b.registroAns, b.nome, b.cnpj, b.tissVersion, b.transportMode]);

    void reply.code(201);
    return { operadoraId: id };
  }));

  // -- GET /v1/tiss/operadoras -- listar operadoras --------------------------
  r.get('/v1/tiss/operadoras', {
    schema: {
      querystring: z.object({
        search: z.string().optional(),
        active: z.enum(['true', 'false']).optional(),
      }),
      response: { 200: z.object({ itens: z.array(OperadoraSchema) }) },
    },
  }, rota('tiss.operadora.read', async (tx, _ctx, req) => {
    const q = req.query as { search?: string; active?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.search !== undefined) {
      condicoes.push(`o.razao_social ILIKE $${idx}`);
      params.push(`%${q.search}%`); idx += 1;
    }
    if (q.active !== undefined) {
      condicoes.push(`o.active = $${idx}`);
      params.push(q.active === 'true'); idx += 1;
    }

    const where = condicoes.length > 0 ? `AND ${condicoes.join(' AND ')}` : '';
    const { rows } = await tx.query<{
      id: string; razao_social: string; registro_ans: string; cnpj: string;
      tiss_version: string; transport_mode: string;
      active: boolean; created_at: string;
    }>(
      `SELECT o.id, o.razao_social, o.registro_ans, o.cnpj, o.tiss_version,
              o.transport_mode, o.telefone, o.email, o.active,
              (SELECT count(*) FROM tiss.paciente_convenio pc
                WHERE pc.tenant_id = o.tenant_id AND pc.operadora_id = o.id
                  AND pc.active) AS total_pacientes,
              to_char(o.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.operadora o
        WHERE true ${where}
        ORDER BY o.razao_social COLLATE "pt-BR-x-icu"`,
      params);

    return {
      itens: rows.map((row) => ({
        operadoraId: row.id,
        nome: row.razao_social,
        registroAns: row.registro_ans,
        cnpj: row.cnpj,
        tissVersion: row.tiss_version,
        transportMode: row.transport_mode as 'arquivo' | 'webservice',
        telefone: (row as { telefone?: string | null }).telefone ?? null,
        email: (row as { email?: string | null }).email ?? null,
        totalPacientes: Number((row as { total_pacientes?: string }).total_pacientes ?? 0),
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // -- GET /v1/tiss/operadoras/:id -- detalhe --------------------------------
  r.get('/v1/tiss/operadoras/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: OperadoraSchema },
    },
  }, rota('tiss.operadora.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rows } = await tx.query<{
      id: string; razao_social: string; registro_ans: string; cnpj: string;
      tiss_version: string; transport_mode: string;
      active: boolean; created_at: string;
    }>(
      `SELECT id, razao_social, registro_ans, cnpj, tiss_version, transport_mode,
              active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.operadora WHERE id = $1`,
      [p.id]);
    if (rows.length === 0) erroDominio('operadora_nao_encontrada', 404);
    const row = rows[0]!;
    return {
      operadoraId: row.id,
      nome: row.razao_social,
      registroAns: row.registro_ans,
      cnpj: row.cnpj,
      tissVersion: row.tiss_version,
      transportMode: row.transport_mode as 'arquivo' | 'webservice',
      telefone: (row as { telefone?: string | null }).telefone ?? null,
      email: (row as { email?: string | null }).email ?? null,
      totalPacientes: Number((row as { total_pacientes?: string }).total_pacientes ?? 0),
      active: row.active,
      createdAt: row.created_at,
    };
  }));

  // -- PUT /v1/tiss/operadoras -- atualizar operadora ------------------------
  r.put('/v1/tiss/operadoras', {
    schema: {
      body: z.object({
        operadoraId: z.string().uuid(),
        nome: z.string().min(1).max(300).optional(),
        cnpj: z.string().regex(/^[A-Z0-9]{12}[0-9]{2}$/).optional(),
        tissVersion: z.string().min(1).max(5).optional(),
        transportMode: z.enum(['arquivo', 'webservice']).optional(),
      }),
      response: { 200: z.object({ operadoraId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.write', async (tx, _ctx, req) => {
    const b = req.body as {
      operadoraId: string; nome?: string; cnpj?: string;
      tissVersion?: string; transportMode?: string };
    const sets: string[] = [];
    const params: unknown[] = [b.operadoraId];
    let idx = 2;
    if (b.nome !== undefined) { sets.push(`razao_social = $${idx}`); params.push(b.nome); idx += 1; }
    if (b.cnpj !== undefined) { sets.push(`cnpj = $${idx}`); params.push(b.cnpj); idx += 1; }
    if (b.tissVersion !== undefined) { sets.push(`tiss_version = $${idx}`); params.push(b.tissVersion); idx += 1; }
    if (b.transportMode !== undefined) { sets.push(`transport_mode = $${idx}`); params.push(b.transportMode); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE tiss.operadora SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('operadora_nao_encontrada', 404);
    return { operadoraId: b.operadoraId };
  }));

  // -- DELETE /v1/tiss/operadoras/:id -- desativar (soft-delete) -------------
  r.delete('/v1/tiss/operadoras/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ operadoraId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rowCount } = await tx.query(
      `UPDATE tiss.operadora SET active = false WHERE id = $1 AND active = true`,
      [p.id]);
    if (rowCount === 0) erroDominio('operadora_nao_encontrada', 404);
    return { operadoraId: p.id };
  }));
}
