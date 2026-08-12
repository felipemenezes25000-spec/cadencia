// Semeia tenant, clínica, usuário, vínculo de recepção e a lista de pacientes que
// os testes de busca interrogam. Roda com a conexão ADMINISTRATIVA porque cria o
// tenant — que é a raiz do isolamento e não existe transação de negócio capaz de
// criá-lo: `app_rw` só tem SELECT em app.tenant (0007).
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementePacientes {
  tenantId: string;
  clinicId: string;
  userId: string;
  patientMariaId: string;
}

const PACIENTES: ReadonlyArray<{
  nome: string;
  social?: string;
  cpf?: string;
  fone?: string;
  status?: 'preliminar' | 'completo';
  inativo?: boolean;
  unificado?: boolean;
}> = [
  { nome: 'Maria Souza Lima', cpf: '11144477735', fone: '11987654321', status: 'completo' },
  { nome: 'MARIA SOUSA', status: 'completo' },
  { nome: 'Joao Prado', social: 'Joana Prado', status: 'completo' },
  { nome: 'Álvaro Neto', status: 'completo' },
  { nome: 'Ana Lima', status: 'completo' },
  { nome: 'Preliminar da Silva', status: 'preliminar' },
  { nome: 'Duplicata Antiga', status: 'completo', unificado: true },
  { nome: 'Duplicata Inativa', status: 'completo', inativo: true },
];

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL_ADMIN ausente: rode `cp .env.example .env`, `pnpm db:up` e `pnpm db:migrate`',
    );
  }
  return url;
}

export async function semearPacientes(): Promise<SementePacientes> {
  const s: SementePacientes = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    patientMariaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    // O slug leva o uuid INTEIRO, nunca um prefixo: os 8 primeiros dígitos hex de
    // um uuidv7 são `ms >> 16`, um balde de ~65 segundos, então duas semeaduras
    // da mesma rodada cairiam no mesmo slug e a segunda quebraria em
    // tenant_slug_key (23505).
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Busca', '12ABC34501DE35')`,
      [s.tenantId, `b-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes) VALUES ($1, $2, 'Unidade', '1234567')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);

    let sobrevivente = '';
    for (const p of PACIENTES) {
      const id = p.nome === 'Maria Souza Lima' ? s.patientMariaId : uuidv7();
      if (p.nome === 'MARIA SOUSA') sobrevivente = id;
      // inactivated_at nasce de clock_timestamp() e nunca do relógio do Node:
      // §10 item 4 — a fonte de tempo do que é persistido é o PostgreSQL.
      await c.query(
        `INSERT INTO clin.patient
           (tenant_id, id, full_name, nome_social, cadastro_status, phone_primary,
            search_digits, birth_date, inactivated_at, merged_into_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 CASE WHEN $9::boolean THEN clock_timestamp() END, $10)`,
        [s.tenantId, id, p.nome, p.social ?? null, p.status ?? 'preliminar',
         p.fone ?? null, [p.cpf, p.fone].filter(Boolean).join(' ') || null,
         p.status === 'completo' ? '1988-03-14' : null,
         p.inativo === true,
         p.unificado === true ? sobrevivente : null]);
      if (p.cpf !== undefined) {
        await c.query(
          `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value)
           VALUES ($1, gen_random_uuid(), $2, 'CPF', $3)`, [s.tenantId, id, p.cpf]);
      }
    }
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
