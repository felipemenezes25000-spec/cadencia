import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeEstoque {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  supplierId: string;
  productId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

export async function semearEstoque(): Promise<SementeEstoque> {
  const s: SementeEstoque = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), supplierId: uuidv7(), productId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Estoque', '55ABC66701DE88')`,
      [s.tenantId, `inv-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Inv', '8888881', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Estoquista')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '888888', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO inv.supplier (tenant_id, id, name)
       VALUES ($1, $2, 'Fornecedor A')`,
      [s.tenantId, s.supplierId]);
    await c.query(
      `INSERT INTO inv.product (tenant_id, id, name, unit, min_stock, cost_price_cents, sale_price_cents, supplier_id)
       VALUES ($1, $2, 'Gaze esteril 10x10', 'un', 20, 150, 500, $3)`,
      [s.tenantId, s.productId, s.supplierId]);
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
