// apps/api/src/routes/tiss/convenios-paciente.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const ConvenioSchema = z.object({
  convenioId: z.string().uuid(),
  patientId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  registroAns: z.string(),
  numeroCarteira: z.string(),
  validadeCarteira: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});

export async function convenioPacienteRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/tiss/pacientes/:patientId/convenios — vincular convenio ──
  r.post('/v1/tiss/pacientes/:patientId/convenios', {
    schema: {
      params: z.object({ patientId: z.string().uuid() }),
      body: z.object({
        operadoraId: z.string().uuid(),
        numeroCarteira: z.string().min(1).max(20),
        validadeCarteira: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      response: { 201: z.object({ convenioId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.write', async (tx, _ctx, req, reply) => {
    const p = req.params as { patientId: string };
    const b = req.body as {
      operadoraId: string; numeroCarteira: string; validadeCarteira?: string };
    const id = uuidv7();

    // Verificar que o paciente existe
    const { rowCount: pacExiste } = await tx.query(
      `SELECT 1 FROM clin.patient WHERE id = $1`, [p.patientId]);
    if (pacExiste === 0) erroDominio('paciente_nao_encontrado', 404);

    // Verificar que a operadora existe
    const { rowCount: opExiste } = await tx.query(
      `SELECT 1 FROM tiss.operadora WHERE id = $1 AND active = true`,
      [b.operadoraId]);
    if (opExiste === 0) erroDominio('operadora_nao_encontrada', 404);

    await tx.query(
      `INSERT INTO tiss.paciente_convenio
         (id, patient_id, operadora_id, numero_carteira, validade, created_by)
       VALUES ($1, $2, $3, $4, $5, app.current_user_id())`,
      [id, p.patientId, b.operadoraId, b.numeroCarteira,
       b.validadeCarteira ?? null]);

    void reply.code(201);
    return { convenioId: id };
  }));

  // ── GET /v1/tiss/pacientes/:patientId/convenios — listar convenios ────
  r.get('/v1/tiss/pacientes/:patientId/convenios', {
    schema: {
      params: z.object({ patientId: z.string().uuid() }),
      response: { 200: z.object({ itens: z.array(ConvenioSchema) }) },
    },
  }, rota('tiss.guia.read', async (tx, _ctx, req) => {
    const p = req.params as { patientId: string };

    const { rows } = await tx.query<{
      id: string; patient_id: string; operadora_id: string;
      operadora_nome: string; registro_ans: string;
      numero_carteira: string; validade: string | null;
      active: boolean; created_at: string;
    }>(
      `SELECT pc.id, pc.patient_id, pc.operadora_id,
              o.razao_social AS operadora_nome, o.registro_ans,
              pc.numero_carteira,
              pc.validade::text,
              pc.active,
              to_char(pc.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.paciente_convenio pc
         JOIN tiss.operadora o
           ON o.tenant_id = pc.tenant_id AND o.id = pc.operadora_id
        WHERE pc.patient_id = $1 AND pc.active = true
        ORDER BY o.razao_social COLLATE "pt-BR-x-icu"`,
      [p.patientId]);

    return {
      itens: rows.map((row) => ({
        convenioId: row.id,
        patientId: row.patient_id,
        operadoraId: row.operadora_id,
        operadoraNome: row.operadora_nome,
        registroAns: row.registro_ans,
        numeroCarteira: row.numero_carteira,
        validadeCarteira: row.validade,
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/tiss/pacientes/:patientId/convenios — atualizar convenio ──
  r.put('/v1/tiss/pacientes/:patientId/convenios', {
    schema: {
      params: z.object({ patientId: z.string().uuid() }),
      body: z.object({
        convenioId: z.string().uuid(),
        numeroCarteira: z.string().min(1).max(20).optional(),
        validadeCarteira: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      response: { 200: z.object({ convenioId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.write', async (tx, _ctx, req) => {
    const p = req.params as { patientId: string };
    const b = req.body as {
      convenioId: string; numeroCarteira?: string; validadeCarteira?: string };
    const sets: string[] = [];
    const params: unknown[] = [b.convenioId, p.patientId];
    let idx = 3;
    if (b.numeroCarteira !== undefined) {
      sets.push(`numero_carteira = $${idx}`); params.push(b.numeroCarteira); idx += 1;
    }
    if (b.validadeCarteira !== undefined) {
      sets.push(`validade = $${idx}`); params.push(b.validadeCarteira); idx += 1;
    }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE tiss.paciente_convenio SET ${sets.join(', ')}
        WHERE id = $1 AND patient_id = $2`,
      params);
    if (rowCount === 0) erroDominio('convenio_nao_encontrado', 404);
    return { convenioId: b.convenioId };
  }));

  // ── DELETE /v1/tiss/pacientes/:patientId/convenios/:id — desativar ────
  r.delete('/v1/tiss/pacientes/:patientId/convenios/:id', {
    schema: {
      params: z.object({
        patientId: z.string().uuid(),
        id: z.string().uuid(),
      }),
      response: { 200: z.object({ convenioId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.write', async (tx, _ctx, req) => {
    const p = req.params as { patientId: string; id: string };
    const { rowCount } = await tx.query(
      `UPDATE tiss.paciente_convenio SET active = false
        WHERE id = $1 AND patient_id = $2 AND active = true`,
      [p.id, p.patientId]);
    if (rowCount === 0) erroDominio('convenio_nao_encontrado', 404);
    return { convenioId: p.id };
  }));
}
