import type { Queryable } from '../queryable';

/**
 * Dois tenants de sonda, com ids fixos e formato de UUIDv7 (versao 7, variante 10xx).
 * Sao literais de proposito: uma matriz de isolamento tem que ser reproduzivel byte
 * a byte. Todos os INSERT usam ON CONFLICT DO NOTHING — semear duas vezes e no-op.
 */
export const CRUD_TENANT_A = '01930000-0000-7000-8000-0000000ca001';
export const CRUD_TENANT_B = '01930000-0000-7000-8000-0000000ca002';
export const CRUD_CLINIC_A = '01930000-0000-7000-8000-0000000ca011';
export const CRUD_CLINIC_B = '01930000-0000-7000-8000-0000000ca012';
export const CRUD_PATIENT_A = '01930000-0000-7000-8000-0000000ca021';
export const CRUD_PATIENT_B = '01930000-0000-7000-8000-0000000ca022';

/** CNPJ alfanumerico da IN RFB 2.229/2024: 12 alfanumericos + 2 digitos. */
const CNPJ_A = '12ABC34501DE35';
const CNPJ_B = '98XYZ76509FG21';

/**
 * Semeia os dois tenants pela conexao administrativa, que ignora RLS de proposito.
 * As linhas COMMITAM: a conexao do papel `api` precisa enxerga-las para que o
 * "zero linhas" da matriz signifique "a policy filtrou", e nao "nao havia nada la".
 */
export async function seedTwoTenants(db: Queryable): Promise<void> {
  await db.query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
          VALUES ($1, 'sonda-crud-a', 'Clinica Vila Nova Ltda', $3),
                 ($2, 'sonda-crud-b', 'Clinica Rio Branco Ltda', $4)
     ON CONFLICT (id) DO NOTHING`,
    [CRUD_TENANT_A, CRUD_TENANT_B, CNPJ_A, CNPJ_B],
  );

  await db.query(
    `INSERT INTO app.clinic (tenant_id, id, nome, timezone)
          VALUES ($1, $3, 'Unidade Vila Nova',  'America/Sao_Paulo'),
                 ($2, $4, 'Unidade Rio Branco', 'America/Rio_Branco')
     ON CONFLICT (id) DO NOTHING`,
    [CRUD_TENANT_A, CRUD_TENANT_B, CRUD_CLINIC_A, CRUD_CLINIC_B],
  );

  await db.query(
    `INSERT INTO clin.patient (tenant_id, id, full_name)
          VALUES ($1, $3, 'Maria Souza Lima'),
                 ($2, $4, 'Joao Pereira da Silva')
     ON CONFLICT (id) DO NOTHING`,
    [CRUD_TENANT_A, CRUD_TENANT_B, CRUD_PATIENT_A, CRUD_PATIENT_B],
  );
}
