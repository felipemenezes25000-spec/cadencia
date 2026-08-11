import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { searchPatients, createMinimalPatient, completePatient, dataDebt } from '@cadencia/patients';
import { rota } from '../guard';

const HitSchema = z.object({
  patientId: z.string().uuid(),
  displayName: z.string(),
  legalName: z.string(),
  hasSocialName: z.boolean(),
  birthDate: z.string().nullable(),
  cadastroStatus: z.enum(['preliminar', 'completo']),
  phonePrimary: z.string().nullable(),
});

export async function patientRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/pacientes', {
    schema: {
      querystring: z.object({ termo: z.string().min(1), limit: z.coerce.number().int().optional() }),
      response: { 200: z.object({ itens: z.array(HitSchema) }) },
    },
  }, rota('patient.read', async (tx, _ctx, req) => {
    const q = req.query as { termo: string; limit?: number };
    const itens = await searchPatients(tx, {
      termo: q.termo, ...(q.limit === undefined ? {} : { limit: q.limit }) });
    return { itens };
  }));

  /**
   * A LISTA de pacientes, que nao e a busca.
   *
   * `searchPatients` devolve conjunto vazio para termo vazio de proposito: um
   * combobox nao deve despejar a base inteira a cada foco. Mas a tela Pacientes
   * e uma lista com facetas — chegar nela e nao ver ninguem ate digitar algo faz
   * o produto parecer quebrado. Sao ferramentas diferentes e por isso rotas
   * diferentes, cada uma com a consulta que lhe serve.
   */
  r.get('/v1/pacientes/lista', {
    schema: {
      querystring: z.object({
        faceta: z.enum(['ativos', 'inativos', 'obitos', 'cadastro_preliminar', 'sem_retorno'])
          .optional(),
        termo: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
      response: { 200: z.object({ itens: z.array(HitSchema) }) },
    },
  }, rota('patient.read', async (tx, _ctx, req) => {
    const q = req.query as { faceta?: string; termo?: string; limit?: number };
    const faceta = q.faceta ?? 'ativos';
    const termo = (q.termo ?? '').trim();

    const { rows } = await tx.query<{
      id: string; display_name: string; full_name: string; nome_social: string | null;
      birth_date: string | null; cadastro_status: 'preliminar' | 'completo';
      phone_primary: string | null;
    }>(
      `SELECT p.id, p.display_name, p.full_name, p.nome_social,
              p.birth_date::text AS birth_date, p.cadastro_status, p.phone_primary
         FROM clin.patient p
        WHERE p.merged_into_id IS NULL
          AND CASE $1::text
                WHEN 'inativos'            THEN p.inactivated_at IS NOT NULL
                WHEN 'obitos'              THEN p.deceased_at    IS NOT NULL
                WHEN 'cadastro_preliminar' THEN p.cadastro_status = 'preliminar'
                                                AND p.deceased_at IS NULL
                WHEN 'sem_retorno'         THEN p.deceased_at IS NULL
                                                AND p.inactivated_at IS NULL
                                                AND NOT EXISTS (
                                                  SELECT 1 FROM sched.appointment a
                                                   WHERE a.tenant_id = p.tenant_id
                                                     AND a.patient_id = p.id
                                                     AND a.starts_at > clock_timestamp()
                                                                       - interval '6 months')
                ELSE p.inactivated_at IS NULL AND p.deceased_at IS NULL
              END
          AND ($2::text = '' OR p.search_name LIKE unaccent(lower($2::text)) || '%')
        -- COLLATE explicito: o cluster e C.UTF-8 e sem isto 'Alvaro' cai depois
        -- de 'Zulmira' — o paciente "some" da letra onde a recepcao procura.
        ORDER BY p.display_name COLLATE "pt-BR-x-icu"
        LIMIT $3`,
      [faceta, termo, q.limit ?? 100]);

    return {
      itens: rows.map((x) => ({
        patientId: x.id,
        displayName: x.display_name,
        legalName: x.full_name,
        hasSocialName: x.nome_social !== null,
        birthDate: x.birth_date,
        cadastroStatus: x.cadastro_status,
        phonePrimary: x.phone_primary,
      })),
    };
  }));

  r.get('/v1/pacientes/existe', {
    schema: {
      querystring: z.object({
        kind: z.enum(['CPF', 'CNS', 'DNV', 'PASSAPORTE', 'RG', 'CARTEIRINHA']),
        value: z.string().min(1),
      }),
      response: { 200: z.object({ existe: z.boolean() }) },
    },
  }, rota('patient.read', async (tx, _ctx, req) => {
    const q = req.query as { kind: string; value: string };
    const { rows } = await tx.query<{ existe: boolean }>(
      `SELECT clin.patient_exists_by_identifier($1, $2) AS existe`, [q.kind, q.value]);
    return { existe: rows[0]?.existe ?? false };
  }));

  r.post('/v1/pacientes', {
    schema: {
      body: z.object({
        fullName: z.string().min(2),
        nomeSocial: z.string().optional(),
        phonePrimary: z.string().optional(),
        email: z.string().email().optional(),
        cpf: z.string().optional(),
      }),
      response: {
        201: z.object({ patientId: z.string().uuid(), cadastroStatus: z.literal('preliminar') }),
      },
    },
  }, rota('patient.write', async (tx, _ctx, req, reply) => {
    const resultado = await createMinimalPatient(tx, req.body as never);
    if (!resultado.ok) {
      throw Object.assign(new Error(resultado.error.kind), {
        statusCode: 422, dominio: resultado.error.kind });
    }
    void reply.code(201);
    return resultado.value;
  }));

  r.patch('/v1/pacientes/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        sexAtBirth: z.enum(['M', 'F', 'I']),
        cpf: z.string().optional(),
      }),
      response: { 200: z.object({ patientId: z.string().uuid() }) },
    },
  }, rota('patient.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { birthDate: string; sexAtBirth: 'M' | 'F' | 'I'; cpf?: string };
    const resultado = await completePatient(tx, { patientId: p.id, ...b });
    if (!resultado.ok) {
      throw Object.assign(new Error(resultado.error.kind), {
        statusCode: 422, dominio: resultado.error.kind });
    }
    return resultado.value;
  }));

  r.patch('/v1/pacientes/:id/contato', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        phonePrimary: z.string().nullable().optional(),
        phoneSecondary: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        emergencyContactName: z.string().max(200).nullable().optional(),
        emergencyContactPhone: z.string().nullable().optional(),
      }),
      response: {
        200: z.object({ patientId: z.string().uuid() }),
        404: z.object({ erro: z.literal('nao_encontrado') }),
        422: z.object({ erro: z.string() }),
      },
    },
  }, rota('patient.write', async (tx, ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as {
      phonePrimary?: string | null; phoneSecondary?: string | null;
      email?: string | null;
      emergencyContactName?: string | null; emergencyContactPhone?: string | null;
    };

    const { rows: current } = await tx.query<{
      phone_primary: string | null; phone_secondary: string | null;
      email: string | null;
      emergency_contact_name: string | null; emergency_contact_phone: string | null;
    }>(
      `SELECT phone_primary, phone_secondary, email,
              emergency_contact_name, emergency_contact_phone
         FROM clin.patient WHERE id = $1`, [p.id]);
    const old = current[0];
    if (old === undefined) return reply.code(404).send({ erro: 'nao_encontrado' as const });

    const normalize = (v: string | null | undefined): string | null => {
      if (v === undefined) return undefined as unknown as null;
      if (v === null) return null;
      const digits = v.replace(/\D+/g, '');
      return digits.length === 0 ? null : digits;
    };

    const phonePri = b.phonePrimary !== undefined ? normalize(b.phonePrimary) : old.phone_primary;
    const phoneSec = b.phoneSecondary !== undefined ? normalize(b.phoneSecondary) : old.phone_secondary;
    const email = b.email !== undefined ? (b.email === null ? null : b.email.trim() || null) : old.email;
    const emName = b.emergencyContactName !== undefined
      ? (b.emergencyContactName === null ? null : b.emergencyContactName.trim() || null)
      : old.emergency_contact_name;
    const emPhone = b.emergencyContactPhone !== undefined
      ? normalize(b.emergencyContactPhone)
      : old.emergency_contact_phone;

    if (phonePri !== null && phonePri.length < 10) {
      return reply.code(422).send({ erro: 'telefone_invalido' });
    }
    if (phoneSec !== null && phoneSec.length < 10) {
      return reply.code(422).send({ erro: 'telefone_secundario_invalido' });
    }
    if (emPhone !== null && emPhone.length < 10) {
      return reply.code(422).send({ erro: 'telefone_emergencia_invalido' });
    }
    if (phonePri === null && (email === null || email === '')) {
      return reply.code(422).send({ erro: 'canal_obrigatorio' });
    }

    const cpfDigits = await tx.query<{ search_digits: string | null }>(
      `SELECT search_digits FROM clin.patient WHERE id = $1`, [p.id]);
    const oldSearch = cpfDigits.rows[0]?.search_digits ?? '';
    const cpfPart = oldSearch.replace(old.phone_primary ?? '', '').trim();
    const newSearch = [cpfPart, phonePri].filter(Boolean).join(' ') || null;

    await tx.query(
      `UPDATE clin.patient
          SET phone_primary = $2, phone_secondary = $3, email = $4,
              emergency_contact_name = $5, emergency_contact_phone = $6,
              search_digits = $7
        WHERE id = $1`,
      [p.id, phonePri, phoneSec, email, emName, emPhone, newSearch]);

    const changes: Array<{ field: string; old_value: string | null }> = [];
    if (phonePri !== old.phone_primary) changes.push({ field: 'phone_primary', old_value: old.phone_primary });
    if (phoneSec !== old.phone_secondary) changes.push({ field: 'phone_secondary', old_value: old.phone_secondary });
    if (email !== old.email) changes.push({ field: 'email', old_value: old.email });
    if (emName !== old.emergency_contact_name) changes.push({ field: 'emergency_contact_name', old_value: old.emergency_contact_name });
    if (emPhone !== old.emergency_contact_phone) changes.push({ field: 'emergency_contact_phone', old_value: old.emergency_contact_phone });

    for (const c of changes) {
      await tx.query(
        `SELECT audit.log('PATIENT_CONTACT_UPDATE', 'clin', 'patient', $1, 'sucesso',
                jsonb_build_object('field', $2::text, 'old_value', $3::text), $4)`,
        [p.id, c.field, c.old_value ?? '', ctx.actor.clinicId]);
    }

    return { patientId: p.id };
  }));

  /**
   * O cadastro de UM paciente, para o cabecalho da ficha.
   *
   * Devolve 404 — nao 403 — para paciente de outro tenant. A diferenca importa:
   * 403 confirma que o cadastro existe em algum lugar, e isso ja e vazamento.
   * A RLS entrega conjunto vazio e a rota traduz como nao encontrado, que e a
   * verdade do ponto de vista de quem pergunta.
   */
  r.get('/v1/pacientes/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: HitSchema.extend({
          email: z.string().nullable(),
          phoneSecondary: z.string().nullable(),
          nomeSocial: z.string().nullable(),
          emergencyContactName: z.string().nullable(),
          emergencyContactPhone: z.string().nullable(),
          inativoEm: z.string().nullable(),
          obitoEm: z.string().nullable(),
        }),
        404: z.object({ erro: z.literal('nao_encontrado') }),
      },
    },
  }, rota('patient.read', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    const { rows } = await tx.query<{
      id: string; display_name: string; full_name: string;
      nome_social: string | null; birth_date: string | null;
      cadastro_status: 'preliminar' | 'completo';
      phone_primary: string | null; phone_secondary: string | null;
      email: string | null;
      emergency_contact_name: string | null; emergency_contact_phone: string | null;
      inactivated_at: Date | null; deceased_at: Date | null;
    }>(
      `SELECT id, display_name, full_name, nome_social, birth_date::text AS birth_date,
              cadastro_status, phone_primary, phone_secondary, email,
              emergency_contact_name, emergency_contact_phone,
              inactivated_at, deceased_at
         FROM clin.patient
        WHERE id = $1 AND merged_into_id IS NULL`, [p.id]);

    const x = rows[0];
    if (x === undefined) return reply.code(404).send({ erro: 'nao_encontrado' as const });

    return {
      patientId: x.id,
      displayName: x.display_name,
      legalName: x.full_name,
      hasSocialName: x.nome_social !== null,
      nomeSocial: x.nome_social,
      birthDate: x.birth_date,
      cadastroStatus: x.cadastro_status,
      phonePrimary: x.phone_primary,
      phoneSecondary: x.phone_secondary,
      email: x.email,
      emergencyContactName: x.emergency_contact_name,
      emergencyContactPhone: x.emergency_contact_phone,
      inativoEm: x.inactivated_at === null ? null : x.inactivated_at.toISOString(),
      obitoEm: x.deceased_at === null ? null : x.deceased_at.toISOString(),
    };
  }));

  r.get('/v1/pacientes/:id/pendencias', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ patientId: z.string(), pendentes: z.array(z.string()).readonly() }) },
    },
  }, rota('patient.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    return dataDebt(tx, p.id);
  }));

  r.get('/v1/pacientes/:id/prontuario', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
  }, rota('encounter.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rows } = await tx.query<{
      encounterId: string; occurredDate: string; status: string;
      professionalId: string; profissionalNome: string; clinicId: string;
      headVersionId: string | null; versionCount: number;
    }>(
      // O nome do profissional vem junto: a linha do historico diz COM QUEM o
      // paciente esteve, e um uuid nao responde isso para ninguem.
      `SELECT e.id AS "encounterId", e.occurred_date::text AS "occurredDate",
              e.status::text AS status, e.professional_id AS "professionalId",
              coalesce(u.full_name, '') AS "profissionalNome",
              e.clinic_id AS "clinicId", e.head_version_id AS "headVersionId",
              e.version_count AS "versionCount"
         FROM clin.encounter e
         LEFT JOIN app.professional pr
                ON (pr.tenant_id, pr.id) = (e.tenant_id, e.professional_id)
         LEFT JOIN id."user" u ON u.id = pr.user_id
        WHERE e.patient_id = $1
        ORDER BY e.occurred_date DESC, e.created_at DESC
        LIMIT 200`, [p.id]);
    return { itens: rows };
  }));
}
