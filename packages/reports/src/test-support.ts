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
