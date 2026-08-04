import type { Client } from 'pg';
import * as F from './fixtures';

/**
 * Dois tenants reais e conflitantes de proposito:
 * - Aurora (A): rede com unidade em Sao Paulo e em Manaus. Ana e admin_clinico em
 *   SP e apenas profissional em Manaus. Carla e recepcao (nao e profissional).
 * - Boreal (B): unidade em Rio Branco, com o MESMO CPF cadastrado que o tenant A.
 * Roda como superusuario, antes de qualquer teste, uma unica vez.
 */
export async function seedDoisTenants(admin: Client): Promise<void> {
  await admin.query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj, retencao_anos) VALUES
       ($1, 'aurora', 'Clinica Aurora Ltda', $3, NULL),
       ($2, 'boreal', 'Clinica Boreal Ltda', $4, 25)`,
    [F.TENANT_A, F.TENANT_B, F.CNPJ_A, F.CNPJ_B],
  );

  await admin.query(
    `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone) VALUES
       ($1, $3, 'Aurora Paulista',   '2077485', 'America/Sao_Paulo'),
       ($1, $4, 'Aurora Manaus',     '2077493', 'America/Manaus'),
       ($2, $5, 'Boreal Rio Branco', '2077507', 'America/Rio_Branco')`,
    [F.TENANT_A, F.TENANT_B, F.CLINIC_A_SP, F.CLINIC_A_MANAUS, F.CLINIC_B_RIO_BRANCO],
  );

  await admin.query(
    `INSERT INTO id."user" (id, email, full_name) VALUES
       ($1, 'ana.medica@aurora.test',    'Ana Ribeiro'),
       ($2, 'bruno.medico@aurora.test',  'Bruno Tavares'),
       ($3, 'carla.recepcao@aurora.test','Carla Nogueira'),
       ($4, 'diego.medico@boreal.test',  'Diego Sales')`,
    [F.USER_A_ANA, F.USER_A_BRUNO, F.USER_A_CARLA, F.USER_B_DIEGO],
  );

  await admin.query(
    `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role) VALUES
       ($1, $6,  $3, $8,  'admin_clinico'),
       ($1, $7,  $3, $9,  'profissional'),
       ($1, $10, $4, $8,  'profissional'),
       ($1, $11, $5, $8,  'recepcao'),
       ($2, $12, $13, $14,'admin_clinico')`,
    [
      F.TENANT_A, F.TENANT_B, F.USER_A_ANA, F.USER_A_BRUNO, F.USER_A_CARLA,
      F.MEMBERSHIP_ANA_SP, F.MEMBERSHIP_ANA_MANAUS, F.CLINIC_A_SP, F.CLINIC_A_MANAUS,
      F.MEMBERSHIP_BRUNO_SP, F.MEMBERSHIP_CARLA_SP, F.MEMBERSHIP_DIEGO_RB,
      F.USER_B_DIEGO, F.CLINIC_B_RIO_BRANCO,
    ],
  );

  await admin.query(
    `INSERT INTO app.professional
       (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos) VALUES
       ($1, $3, $5, '06', '123456', 'SP', '225125'),
       ($1, $4, $6, '06', '654321', 'AM', '225125'),
       ($2, $7, $8, '06', '111222', 'AC', '225125')`,
    [
      F.TENANT_A, F.TENANT_B, F.PROF_A_ANA, F.PROF_A_BRUNO, F.USER_A_ANA,
      F.USER_A_BRUNO, F.PROF_B_DIEGO, F.USER_B_DIEGO,
    ],
  );

  await admin.query(
    `INSERT INTO clin.patient (tenant_id, id, full_name, nome_social, birth_date,
                               cadastro_status, search_digits) VALUES
       ($1, $3, 'Joao Ferreira da Silva', 'Joana Ferreira da Silva', '1988-03-14',
            'completo', $6),
       ($1, $4, 'RN de Joana Ferreira', NULL, NULL, 'preliminar', NULL),
       ($2, $5, 'Marcos Andrade Lima', NULL, '1975-11-02', 'completo', $6)`,
    [F.TENANT_A, F.TENANT_B, F.PATIENT_A_JOANA, F.PATIENT_A_RECEM_NASCIDO,
     F.PATIENT_B_MARCOS, F.CPF_VALIDO],
  );

  await admin.query(
    `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value) VALUES
       ($1, $3, $6, 'CPF', $9),
       ($1, $4, $7, 'SEM_DOCUMENTO', 'sem documento apresentado'),
       ($2, $5, $8, 'CPF', $9)`,
    [F.TENANT_A, F.TENANT_B, F.PID_A_JOANA_CPF, F.PID_A_RN_SEM_DOCUMENTO,
     F.PID_B_MARCOS_CPF, F.PATIENT_A_JOANA, F.PATIENT_A_RECEM_NASCIDO,
     F.PATIENT_B_MARCOS, F.CPF_VALIDO],
  );
}
