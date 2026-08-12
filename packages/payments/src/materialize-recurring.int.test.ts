import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { materializeRecurringEntries } from './materialize-recurring';

interface Semente {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  categoryId: string;
  paymentMethodId: string;
  templateMonthlyId: string;
  templateEndedId: string;
  templateInactiveId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

function jobsUrl(): string {
  const url = process.env['DATABASE_URL_JOBS'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_JOBS ausente');
  }
  return url;
}

async function semear(): Promise<Semente> {
  const s: Semente = {
    tenantId: uuidv7(), clinicId: uuidv7(),
    userId: uuidv7(), professionalId: uuidv7(),
    categoryId: uuidv7(), paymentMethodId: uuidv7(),
    templateMonthlyId: uuidv7(),
    templateEndedId: uuidv7(),
    templateInactiveId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Mat', '66ABC77801DE99')`,
      [s.tenantId, `mat-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Mat', '8888888', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Mat')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '888777', 'RS', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Aluguel Mat', 'despesa')`,
      [s.tenantId, s.categoryId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix Mat')`,
      [s.tenantId, s.paymentMethodId]);

    // Template mensal ativo: next_due_date = hoje (deve materializar)
    await c.query(
      `INSERT INTO fin.recurring_template
         (tenant_id, id, description, kind, category_id, amount_cents,
          clinic_id, frequency, day_of_month, next_due_date, active,
          created_by)
       VALUES ($1, $2, 'Aluguel mensal', 'despesa', $3, 350000,
               $4, 'monthly', 15, current_date, true, $5)`,
      [s.tenantId, s.templateMonthlyId, s.categoryId, s.clinicId, s.userId]);

    // Template com ends_at no passado (não deve materializar)
    await c.query(
      `INSERT INTO fin.recurring_template
         (tenant_id, id, description, kind, amount_cents,
          clinic_id, frequency, next_due_date, active, ends_at,
          created_by)
       VALUES ($1, $2, 'Contrato encerrado', 'despesa', 100000,
               $3, 'monthly', current_date, true,
               current_date - interval '1 day', $4)`,
      [s.tenantId, s.templateEndedId, s.clinicId, s.userId]);

    // Template inativo (não deve materializar)
    await c.query(
      `INSERT INTO fin.recurring_template
         (tenant_id, id, description, kind, amount_cents,
          clinic_id, frequency, next_due_date, active,
          created_by)
       VALUES ($1, $2, 'Servico suspenso', 'despesa', 200000,
               $3, 'monthly', current_date, false, $4)`,
      [s.tenantId, s.templateInactiveId, s.clinicId, s.userId]);

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

let s: Semente;
let jobsPool: Pool;

beforeAll(async () => {
  s = await semear();
  jobsPool = new Pool({ connectionString: jobsUrl(), max: 2 });
});

afterAll(async () => {
  await jobsPool.end();
  await closePools();
});

describe('materializeRecurringEntries — job de materializacao', () => {
  it('materializa entry do template ativo com next_due_date <= hoje + 30d', async () => {
    const client = await jobsPool.connect();
    try {
      await client.query('BEGIN');
      const result = await materializeRecurringEntries(
        { query: (sql, params) => client.query(sql, params === undefined ? undefined : [...params]) },
        s.tenantId,
      );
      await client.query('COMMIT');

      // Pelo menos 1 entry gerada (do template mensal ativo)
      expect(result.generated).toBeGreaterThanOrEqual(1);
      expect(result.skipped).toBeGreaterThanOrEqual(0);
    } finally {
      client.release();
    }

    // Verifica que a entry foi criada com recurring_template_id
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    try {
      const { rows } = await admin.query<{
        description: string; kind: string;
        amount_cents: string; status: string;
        recurring_template_id: string;
      }>(
        `SELECT description, kind::text, amount_cents::text,
                status::text, recurring_template_id::text
           FROM fin.entry
          WHERE tenant_id = $1 AND recurring_template_id = $2`,
        [s.tenantId, s.templateMonthlyId]);

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.kind).toBe('despesa');
      expect(rows[0]?.amount_cents).toBe('350000');
      expect(rows[0]?.status).toBe('pendente');
    } finally {
      await admin.end();
    }
  });

  it('nao materializa template inativo', async () => {
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    try {
      const { rows } = await admin.query<{ id: string }>(
        `SELECT id::text FROM fin.entry
          WHERE tenant_id = $1 AND recurring_template_id = $2`,
        [s.tenantId, s.templateInactiveId]);

      expect(rows).toHaveLength(0);
    } finally {
      await admin.end();
    }
  });

  it('nao materializa template com ends_at no passado', async () => {
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    try {
      const { rows } = await admin.query<{ id: string }>(
        `SELECT id::text FROM fin.entry
          WHERE tenant_id = $1 AND recurring_template_id = $2`,
        [s.tenantId, s.templateEndedId]);

      expect(rows).toHaveLength(0);
    } finally {
      await admin.end();
    }
  });

  it('avanca next_due_date apos materializar', async () => {
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    try {
      const { rows } = await admin.query<{ next_due_date: string }>(
        `SELECT next_due_date::text FROM fin.recurring_template WHERE id = $1`,
        [s.templateMonthlyId]);

      // next_due_date deve ter avançado (não mais a data original)
      const nextDue = new Date(rows[0]!.next_due_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      expect(nextDue.getTime()).toBeGreaterThan(today.getTime());
    } finally {
      await admin.end();
    }
  });

  it('nao duplica entry na segunda execucao (idempotency_key por template+data)', async () => {
    // Roda novamente — não deve gerar duplicata
    const client = await jobsPool.connect();
    try {
      await client.query('BEGIN');
      const result = await materializeRecurringEntries(
        { query: (sql, params) => client.query(sql, params === undefined ? undefined : [...params]) },
        s.tenantId,
      );
      await client.query('COMMIT');

      // Nada gerado na segunda vez (next_due_date já avançou)
      expect(result.generated).toBe(0);
    } finally {
      client.release();
    }
  });
});
