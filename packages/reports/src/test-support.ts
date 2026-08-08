import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeVariacao {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalIdA: string;
  professionalIdB: string;
  patientIds: string[];
  procedureIdConsulta: string;
  procedureIdRetorno: string;
  paymentMethodId: string;
  categoryId: string;
  operadoraId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

/**
 * Semeia dados sinteticos para testes de variacao. Cria dois profissionais,
 * dois procedimentos (consulta R$250, retorno R$100), e varios pacientes.
 * NAO cria agendamentos nem lancamentos: cada teste cria os seus.
 */
export async function semearVariacao(): Promise<SementeVariacao> {
  const patientIds = Array.from({ length: 10 }, () => uuidv7());
  const s: SementeVariacao = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalIdA: uuidv7(), professionalIdB: uuidv7(),
    patientIds,
    procedureIdConsulta: uuidv7(), procedureIdRetorno: uuidv7(),
    paymentMethodId: uuidv7(), categoryId: uuidv7(),
    operadoraId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Variacao', '11ABC22301DE44')`,
      [s.tenantId, `v-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Var', '1112233', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Gestora Var')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    // Dois profissionais
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '111111', 'SP', '225125')`,
      [s.tenantId, s.professionalIdA, s.userId]);
    // Segundo profissional precisa de segundo usuario
    const userIdB = uuidv7();
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Dr. Beta')`,
      [userIdB, `${userIdB}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [s.tenantId, userIdB, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '222222', 'RJ', '225125')`,
      [s.tenantId, s.professionalIdB, userIdB]);
    // Pacientes
    for (let i = 0; i < patientIds.length; i++) {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES ($1, $2, $3, 'completo')`,
        [s.tenantId, patientIds[i], `Paciente Var ${i + 1}`]);
    }
    // Procedimentos
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000),
              ($1, $3, 'RET',  'Retorno',  '#5fd02f', 15, 10000)`,
      [s.tenantId, s.procedureIdConsulta, s.procedureIdRetorno]);
    // Metodo de pagamento e categoria
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro Var')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Consulta Var', 'receita')`,
      [s.tenantId, s.categoryId]);
    // Operadora (para testes de glosa)
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, created_by)
       VALUES ($1, $2, '123456', 'Operadora Var', '11ABC22301DE44',
               '4.01', 'arquivo', $3)`,
      [s.tenantId, s.operadoraId, s.userId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}

/**
 * Cria um agendamento e um lancamento financeiro vinculado, para usar nos
 * testes de variacao. Permite controlar profissional, procedimento, valor,
 * status do agendamento (atendido/faltou), data e se e particular ou convenio.
 */
export async function criarAtendimentoComLancamento(opts: {
  tenantId: string;
  clinicId: string;
  patientId: string;
  professionalId: string;
  procedureId: string;
  userId: string;
  paymentMethodId: string;
  categoryId: string;
  amountCents: number;
  date: string;          // 'YYYY-MM-DD'
  status: 'atendido' | 'faltou' | 'cancelado';
  operadoraNome: string | null;  // null = particular
  pago: boolean;
}): Promise<{ appointmentId: string; entryId: string | null }> {
  const appointmentId = uuidv7();
  const entryId = opts.status === 'atendido' && opts.pago ? uuidv7() : null;

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    const startsAt = `${opts.date}T10:00:00-03:00`;
    const endsAt = `${opts.date}T10:30:00-03:00`;
    await c.query(
      `INSERT INTO sched.appointment
         (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
          operadora_nome, starts_at, ends_at, appointment_date, status,
          confirmed_at, arrived_at, started_at, finished_at,
          cancelled_at, cancel_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               $7, $8::timestamptz, $9::timestamptz, $10::date, $11::sched.appointment_status,
               CASE WHEN $11 IN ('atendido','faltou') THEN clock_timestamp() END,
               CASE WHEN $11 = 'atendido' THEN clock_timestamp() END,
               CASE WHEN $11 = 'atendido' THEN clock_timestamp() END,
               CASE WHEN $11 = 'atendido' THEN clock_timestamp() END,
               CASE WHEN $11 = 'cancelado' THEN clock_timestamp() END,
               CASE WHEN $11 = 'cancelado' THEN 'teste' END,
               $12)`,
      [appointmentId, opts.tenantId, opts.patientId, opts.professionalId,
       opts.clinicId, opts.procedureId, opts.operadoraNome,
       startsAt, endsAt, opts.date, opts.status, opts.userId]);

    if (entryId !== null) {
      await c.query(
        `INSERT INTO fin.entry
           (tenant_id, id, clinic_id, patient_id, appointment_id, professional_id,
            kind, amount_cents, status, description,
            payment_method_id, paid_at, idempotency_key, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 'receita', $7, 'pago', 'Atendimento variacao',
                 $8, $9::timestamptz, $10, $11, $9::timestamptz)`,
        [opts.tenantId, entryId, opts.clinicId, opts.patientId,
         appointmentId, opts.professionalId, opts.amountCents,
         opts.paymentMethodId, `${opts.date}T18:00:00-03:00`,
         `var-${appointmentId}`, opts.userId]);
    }

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return { appointmentId, entryId };
}

/**
 * Cria um encounter finalizado, uma guia de consulta e uma glosa aceita.
 * Retorna os IDs criados para verificacao no teste.
 */
export async function criarGlosaAceita(opts: {
  tenantId: string;
  clinicId: string;
  patientId: string;
  professionalId: string;
  userId: string;
  operadoraId: string;
  valorGlosadoCents: number;
  dataAtendimento: string; // 'YYYY-MM-DD'
}): Promise<{ encounterId: string; guiaId: string; glosaId: string }> {
  const encounterId = uuidv7();
  const versionId = uuidv7();
  const guiaId = uuidv7();
  const glosaId = uuidv7();
  const guiaNumero = `G${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // 1. Encounter finalizado
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status, version_count)
       VALUES ($1, $2, $3, $4, $5,
               ($6::date)::timestamptz, $6::date, 'finalizado', 1)`,
      [opts.tenantId, encounterId, opts.patientId, opts.professionalId,
       opts.clinicId, opts.dataAtendimento]);

    // 2. Encounter version (original)
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind,
          author_user_id, author_professional_id, finalized_at,
          content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original',
               $4, $5, clock_timestamp(),
               decode(lpad('', 64, 'ab'), 'hex'), 'test-v1')`,
      [opts.tenantId, versionId, encounterId, opts.userId,
       opts.professionalId]);

    // Atualizar head_version_id do encounter
    await c.query(
      `UPDATE clin.encounter
          SET head_version_id = $2
        WHERE tenant_id = $1 AND id = $3`,
      [opts.tenantId, versionId, encounterId]);

    // 3. Guia de consulta
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira,
          atendimento_rn, cnpj_contratado, cnes,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, data_atendimento,
          tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, created_by, status)
       VALUES ($1, $2, $3, $4, $5,
               '123456', $6, 'CART001',
               false, '11ABC22301DE44', '1112233',
               '06', '111111', 'SP', '225125',
               '9', '01', $7::date,
               '1', '22', '10101012',
               ($8::numeric / 100.0), $9, 'completa')`,
      [opts.tenantId, guiaId, encounterId, versionId, opts.operadoraId,
       guiaNumero, opts.dataAtendimento, opts.valorGlosadoCents, opts.userId]);

    // 4. Lote + demonstrativo + demonstrativo_item (pre-requisitos para tiss.glosa)
    const loteId = uuidv7();
    const demoId = uuidv7();
    const demoItemId = uuidv7();
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, '1', 'retornado', '4.01', 1, $4,
               'lote/glosa-var.xml', 'aabb00112233445566778899aabbccdd',
               'PROT-VAR', clock_timestamp(), $5)`,
      [opts.tenantId, loteId, opts.operadoraId,
       opts.valorGlosadoCents, opts.userId]);
    await c.query(
      `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
       VALUES ($1, $2, $3, 1)`,
      [opts.tenantId, loteId, guiaId]);
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-VAR', 'analise',
               $5::date, 'demo/glosa-var.xml',
               $6, 0, 0, $6, $7)`,
      [opts.tenantId, demoId, opts.operadoraId, loteId,
       opts.dataAtendimento, opts.valorGlosadoCents, opts.userId]);
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, 'M001', 'Glosa de teste')`,
      [opts.tenantId, demoItemId, demoId, guiaId, guiaNumero, opts.valorGlosadoCents]);

    // 5. Glosa aceita (todas as colunas NOT NULL preenchidas)
    await c.query(
      `INSERT INTO tiss.glosa
         (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
          codigo_glosa, descricao_glosa, valor_glosado_cents,
          status, resolved_at, resolved_by)
       VALUES ($1, $2, $3, $4, $5,
               'M001', 'Glosa de teste', $6,
               'aceita', clock_timestamp(), $7)`,
      [opts.tenantId, glosaId, demoItemId, guiaId, versionId,
       opts.valorGlosadoCents, opts.userId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return { encounterId, guiaId, glosaId };
}
