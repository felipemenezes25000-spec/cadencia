import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { openDraft, saveDraft, finalizeEncounter, amendEncounter,
  type FinalizeInput, type AmendInput } from '@cadencia/emr';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const ValorSchema = z.discriminatedUnion('slot', [
  z.object({ slot: z.literal('value_text'), text: z.string() }),
  z.object({ slot: z.literal('value_num'), num: z.string() }),
  z.object({ slot: z.literal('value_bool'), bool: z.boolean() }),
  z.object({ slot: z.literal('value_date'), date: z.string() }),
  z.object({ slot: z.literal('value_ts'), ts: z.string() }),
  z.object({ slot: z.literal('value_json'), json: z.unknown() }),
  z.object({ slot: z.literal('value_ref_code'), source: z.string(), code: z.string() }),
]);

const PayloadClinico = z.object({
  fields: z.array(z.object({
    fieldId: z.string().uuid(), fieldGeneration: z.number().int(),
    labelSnapshot: z.string(), displaySnapshot: z.string().nullable(),
    terminologyVersion: z.string().nullable(),
    sectionInstance: z.number().int(), ordinal: z.number().int(),
    value: ValorSchema,
  })),
  diagnoses: z.array(z.object({
    codeSystem: z.string(), code: z.string(), displaySnapshot: z.string(),
    terminologyVersion: z.string(), isPrincipal: z.boolean() })),
  observations: z.array(z.object({
    // `clin.observation.field_id` é NOT NULL. Sem este campo no schema, o zod
    // removia o que o cliente mandava e o INSERT estourava 23502 — qualquer
    // atendimento com peso ou pressão arterial devolvia 500.
    fieldId: z.string().uuid(),
    observationCode: z.string(), valueNum: z.string(), unit: z.string().nullable(),
    componentOrdinal: z.number().int() })),
  findings: z.array(z.object({
    fieldCode: z.string(), optionCode: z.string(),
    displaySnapshot: z.string(), ordinal: z.number().int() })),
  procedures: z.array(z.object({
    codeSystem: z.string(), tabela: z.number().int().nullable(), code: z.string(),
    displaySnapshot: z.string(), terminologyVersion: z.string().nullable(),
    quantidade: z.number().int(), valorCentavos: z.number().int() })),
  ai: z.array(z.object({
    provider: z.string(), modelId: z.string(), modelVersion: z.string(),
    purpose: z.string(), riskClass: z.string(), residency: z.string(),
    inputHash: z.string(), outputHash: z.string(), clinicianDecision: z.string() })),
});

export async function encounterRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/atendimentos', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        appointmentId: z.string().uuid().optional(),
        occurredAt: z.string().datetime().optional(),
      }),
      response: {
        201: z.object({ encounterId: z.string().uuid(), status: z.literal('rascunho'),
                        rev: z.number().int(), payload: z.record(z.string(), z.unknown()) }),
      },
    },
  }, rota('encounter.write', async (tx, ctx, req, reply) => {
    const b = req.body as { patientId: string; appointmentId?: string; occurredAt?: string };
    const encounterId = uuidv7();
    await tx.query(
      `INSERT INTO clin.encounter
         (id, patient_id, professional_id, clinic_id, appointment_id, occurred_at, occurred_date)
       VALUES ($1, $2, app.current_professional_id(), $3, $4,
               coalesce($5::timestamptz, clock_timestamp()),
               app.local_date(coalesce($5::timestamptz, clock_timestamp()),
                 (SELECT c.timezone FROM app.clinic c WHERE c.id = $3)))`,
      [encounterId, b.patientId, ctx.actor.clinicId, b.appointmentId ?? null,
       b.occurredAt ?? null]);
    const aberto = await openDraft(tx, encounterId);
    if (!aberto.ok) erroDominio(aberto.error.kind, 422);
    void reply.code(201);
    return { encounterId, status: 'rascunho' as const,
             rev: aberto.value.rev, payload: aberto.value.payload };
  }));

  r.get('/v1/atendimentos/:id/rascunho', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ encounterId: z.string(), rev: z.number().int(),
                                  payload: z.record(z.string(), z.unknown()) }) },
    },
  }, rota('encounter.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const aberto = await openDraft(tx, p.id);
    if (!aberto.ok) erroDominio(aberto.error.kind, 404);
    return aberto.value;
  }));

  r.put('/v1/atendimentos/:id/rascunho', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ expectedRev: z.number().int().min(1), payload: z.record(z.string(), z.unknown()) }),
      response: { 200: z.object({ rev: z.number().int() }) },
    },
  }, rota('encounter.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { expectedRev: number; payload: Record<string, unknown> };
    const salvo = await saveDraft(tx, { encounterId: p.id, ...b });
    if (!salvo.ok) {
      if (salvo.error.kind === 'conflito_de_revisao') {
        erroDominio('conflito_de_revisao', 409, {
          currentRev: salvo.error.currentRev, currentPayload: salvo.error.currentPayload });
      }
      erroDominio(salvo.error.kind, 422);
    }
    return salvo.value;
  }));

  r.post('/v1/atendimentos/:id/finalizar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: PayloadClinico,
      response: { 200: z.object({ versionId: z.string().uuid(), versionNo: z.number().int() }) },
    },
  }, rota('encounter.finalize', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const resultado = await finalizeEncounter(tx, {
      encounterId: p.id, ...(req.body as Omit<FinalizeInput, 'encounterId'>) });
    if (!resultado.ok) {
      if (resultado.error.kind === 'cadastro_preliminar_bloqueia_finalizacao') {
        erroDominio(resultado.error.kind, 422, { faltando: resultado.error.faltando });
      }
      erroDominio(resultado.error.kind, 422);
    }
    return resultado.value;
  }));

  r.post('/v1/atendimentos/:id/versoes', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: PayloadClinico.extend({
        kind: z.enum(['retificacao', 'adendo', 'transferencia', 'anulacao']),
        supersedesVersionId: z.string().uuid().nullable(),
        justificativa: z.string().nullable(),
      }),
      response: { 200: z.object({ versionId: z.string().uuid(), versionNo: z.number().int() }) },
    },
  }, rota('encounter.amend', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const resultado = await amendEncounter(tx, {
      encounterId: p.id, ...(req.body as Omit<AmendInput, 'encounterId'>) });
    if (!resultado.ok) erroDominio(resultado.error.kind, 422);
    return resultado.value;
  }));

  r.get('/v1/atendimentos/:id/contexto', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          encounterId: z.string().uuid(),
          status: z.enum(['rascunho', 'finalizado', 'anulado']),
          inicio: z.string(),
          paciente: z.object({
            patientId: z.string().uuid(),
            nome: z.string(),
            nascimento: z.string().nullable(),
            sexo: z.string().nullable(),
            convenio: z.string().nullable(),
            cadastroPreliminar: z.boolean(),
          }),
          alergias: z.array(z.string()),
          medicamentos: z.array(z.object({
            nome: z.string(),
            posologia: z.string(),
            prescritoEm: z.string(),
          })),
          ultimosAtendimentos: z.array(z.object({
            encounterId: z.string().uuid(),
            data: z.string(),
            procedimento: z.string().nullable(),
          })),
          procedimentoNome: z.string().nullable(),
          valorSugeridoCentavos: z.number().int().nullable(),
        }),
      },
    },
  }, rota('encounter.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    // A RLS já restringe ao tenant da sessão. Um id de outro tenant não vira
    // "200 com campos vazios": não há linha, e a resposta é 404.
    const { rows: base } = await tx.query<{
      status: 'rascunho' | 'finalizado' | 'anulado';
      inicio: string;
      patient_id: string;
      nome: string;
      nascimento: string | null;
      sexo: string | null;
      cadastro_status: string;
      convenio: string | null;
      procedimento: string | null;
      valor_centavos: string | null;
    }>(
      `SELECT e.status,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS inicio,
              e.patient_id,
              p.display_name AS nome,
              -- Convertida em TEXTO no banco. node-postgres transforma date em
              -- Date de meia-noite LOCAL; quem nasceu dia 1o vira dia 31 do mes
              -- anterior num processo a oeste de Greenwich. A idade que a tela
              -- calcula erraria por um dia, e um dia erra o ano em aniversario.
              to_char(p.birth_date, 'YYYY-MM-DD') AS nascimento,
              p.sex_at_birth AS sexo,
              p.cadastro_status,
              a.operadora_nome AS convenio,
              proc.nome AS procedimento,
              proc.valor_centavos
         FROM clin.encounter e
         JOIN clin.patient p ON (p.tenant_id, p.id) = (e.tenant_id, e.patient_id)
         LEFT JOIN sched.appointment a
                ON (a.tenant_id, a.id) = (e.tenant_id, e.appointment_id)
         LEFT JOIN sched.procedure proc
                ON (proc.tenant_id, proc.id) = (a.tenant_id, a.procedure_id)
        WHERE e.id = $1`,
      [p.id]);

    const e = base[0];
    if (e === undefined) erroDominio('atendimento_nao_encontrado', 404);

    /**
     * §3.7 — acesso a conteúdo clínico registra ANTES de devolver.
     *
     * O que vem abaixo é prontuário: alergias, medicamentos em uso e histórico
     * de atendimentos do paciente. Nenhuma rota da API chamava `audit.log_read`
     * — a única coisa que chama são `clin.read_encounter` e
     * `clin.read_patient_record` (migration 0040), e essas duas só aparecem em
     * teste. Na prática a trilha de LEITURA clínica estava vazia em produção, e
     * é justamente ela que responde "quem abriu o prontuário deste paciente".
     *
     * A função já deduplica por (usuário, paciente, caso de uso) numa janela de
     * 5 minutos, então chamar em toda abertura de tela não inflaciona a trilha.
     */
    await tx.query(`SELECT audit.log_read('encounter_read', $1)`, [e.patient_id]);

    // ── alergias ────────────────────────────────────────────────────────────
    // Campo `alergias` do template de referência (0026), kind `texto_curto`.
    // São lidos os valores de TODAS as versões vivas do paciente, não só a
    // deste atendimento: alergia registrada há dois anos continua valendo hoje.
    // O texto sai inteiro, sem quebrar por vírgula — "Dipirona, Penicilina" foi
    // o que o médico escreveu, e inventar a separação inventa o registro.
    const { rows: alergias } = await tx.query<{ valor: string }>(
      `SELECT DISTINCT ON (lower(btrim(v.value_text)))
              btrim(v.value_text) AS valor
         FROM clin.encounter e2
         JOIN clin.encounter_field_value v
              ON (v.tenant_id, v.version_id) = (e2.tenant_id, e2.head_version_id)
         JOIN clin.record_field f
              ON (f.tenant_id, f.id) = (v.tenant_id, v.field_id)
        WHERE e2.patient_id = $1
          AND f.code = 'alergias'
          AND v.purged_at IS NULL
          AND btrim(coalesce(v.value_text, '')) <> ''
        ORDER BY lower(btrim(v.value_text)), v.finalized_at DESC`,
      [e.patient_id]);

    // ── medicamentos em uso ─────────────────────────────────────────────────
    // A fonte é o que foi PRESCRITO, não um campo de texto que ninguém mantém.
    // Receita cancelada não entra: exibir remédio de receita cancelada como "em
    // uso" é pior que não exibir nada — o médico checa interação contra um
    // medicamento que o paciente não toma.
    const { rows: medicamentos } = await tx.query<{
      nome: string; posologia: string; prescrito_em: string;
    }>(
      `SELECT i.nome, i.posologia,
              to_char(pr.issued_date, 'YYYY-MM-DD') AS prescrito_em
         FROM clin.prescription pr
         JOIN clin.prescription_item i
              ON (i.tenant_id, i.prescription_id) = (pr.tenant_id, pr.id)
        WHERE pr.patient_id = $1
          AND pr.cancelled_at IS NULL
        ORDER BY pr.issued_date DESC, i.ordinal
        LIMIT 20`,
      [e.patient_id]);

    // ── últimos atendimentos ────────────────────────────────────────────────
    // Só finalizados. Rascunho de outro dia é consulta que ninguém fechou, não
    // é histórico — mostrar como histórico faz o médico contar uma consulta que
    // talvez não tenha acontecido.
    const { rows: ultimos } = await tx.query<{
      id: string; data: string; procedimento: string | null;
    }>(
      `SELECT e2.id,
              to_char(e2.occurred_date, 'YYYY-MM-DD') AS data,
              proc.nome AS procedimento
         FROM clin.encounter e2
         LEFT JOIN sched.appointment a
                ON (a.tenant_id, a.id) = (e2.tenant_id, e2.appointment_id)
         LEFT JOIN sched.procedure proc
                ON (proc.tenant_id, proc.id) = (a.tenant_id, a.procedure_id)
        WHERE e2.patient_id = $1
          AND e2.id <> $2
          AND e2.status = 'finalizado'
        ORDER BY e2.occurred_date DESC
        LIMIT 5`,
      [e.patient_id, p.id]);

    return {
      encounterId: p.id,
      status: e.status,
      inicio: e.inicio,
      paciente: {
        patientId: e.patient_id,
        nome: e.nome,
        nascimento: e.nascimento,
        sexo: e.sexo,
        convenio: e.convenio,
        cadastroPreliminar: e.cadastro_status === 'preliminar',
      },
      alergias: alergias.map((x) => x.valor),
      medicamentos: medicamentos.map((x) => ({
        nome: x.nome, posologia: x.posologia, prescritoEm: x.prescrito_em,
      })),
      ultimosAtendimentos: ultimos.map((x) => ({
        encounterId: x.id, data: x.data, procedimento: x.procedimento,
      })),
      procedimentoNome: e.procedimento,
      // `valor_centavos` é bigint, e node-postgres devolve bigint como STRING
      // para não perder precisão em valores acima de 2^53. Centavos nunca chegam
      // lá (2^53 centavos são 90 trilhões de reais), então a conversão é segura
      // — o que não é seguro é mandar string onde o contrato diz número.
      valorSugeridoCentavos: e.valor_centavos === null ? null : Number(e.valor_centavos),
    };
  }));
}
