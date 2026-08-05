import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementePagamento {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  appointmentId: string;
  categoryId: string;
  paymentMethodDinheiroId: string;
  paymentMethodPixId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

export async function semearPagamento(): Promise<SementePagamento> {
  const s: SementePagamento = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(), appointmentId: uuidv7(),
    categoryId: uuidv7(),
    paymentMethodDinheiroId: uuidv7(), paymentMethodPixId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Pagamento', '12ABC34501DE35')`,
      [s.tenantId, `p-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao Pag')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Pagamento', 'completo')`,
      [s.tenantId, s.patientId]);

    // Procedimento e agendamento para vincular ao pagamento
    const procedureId = uuidv7();
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
      [s.tenantId, procedureId]);
    await c.query(
      `INSERT INTO sched.appointment
         (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
          starts_at, ends_at, appointment_date, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               '2026-10-15T14:00:00Z', '2026-10-15T14:30:00Z', '2026-10-15',
               'atendendo', $7)`,
      [s.appointmentId, s.tenantId, s.patientId, s.professionalId,
       s.clinicId, procedureId, s.userId]);

    // Categoria e metodos de pagamento
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Consulta', 'receita')`,
      [s.tenantId, s.categoryId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro'),
              ($1, $3, 'pix', 'Pix')`,
      [s.tenantId, s.paymentMethodDinheiroId, s.paymentMethodPixId]);

    // Provisiona o contador de recibo
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);

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
