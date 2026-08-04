import { err, isOk, ok, parseCpf, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export interface CreateMinimalInput {
  readonly fullName: string;
  readonly nomeSocial?: string;
  readonly phonePrimary?: string;
  readonly email?: string;
  readonly cpf?: string;
}

export type CreateFailure =
  | { kind: 'nome_obrigatorio' }
  | { kind: 'canal_obrigatorio' }
  | { kind: 'cpf_invalido' }
  | { kind: 'cpf_duplicado' };

/**
 * §5.5 fluxo (a) — a regra PACIENTE MINIMO VIAVEL. Nome + UM canal bastam para
 * agendar; o cadastro nasce `preliminar` e CPF, nascimento e sexo viram DIVIDA
 * DE DADOS, cobrada no check-in (com a pessoa na frente) e BLOQUEANTE na
 * finalizacao do atendimento e no faturamento de convenio.
 *
 * A justificativa e empirica, nao estetica: dado exigido na hora errada e dado
 * falso, e dado falso contamina o grafico de distribuicao etaria e o disparo de
 * aniversariantes para sempre. E por isso que recepcionista digita 000.000.000-00
 * — e por isso que este caminho RECUSA um CPF invalido em vez de aceita-lo.
 */
export async function createMinimalPatient(
  tx: TxClient, input: CreateMinimalInput,
): Promise<Result<{ patientId: string; cadastroStatus: 'preliminar' }, CreateFailure>> {
  const nome = input.fullName.trim();
  if (nome.length < 2) return err({ kind: 'nome_obrigatorio' });

  const fone = input.phonePrimary?.replace(/\D+/g, '') ?? '';
  const email = input.email?.trim() ?? '';
  if (fone.length < 10 && email.length === 0) return err({ kind: 'canal_obrigatorio' });

  let cpfDigitos = '';
  if (input.cpf !== undefined && input.cpf.trim().length > 0) {
    const r = parseCpf(input.cpf);
    if (!isOk(r)) return err({ kind: 'cpf_invalido' });
    cpfDigitos = r.value;
  }

  const patientId = uuidv7();
  const digitos = [cpfDigitos, fone].filter((d) => d.length > 0).join(' ');

  await tx.query(
    `INSERT INTO clin.patient
       (id, full_name, nome_social, phone_primary, email, search_digits, cadastro_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'preliminar')`,
    [patientId, nome, input.nomeSocial ?? null, fone === '' ? null : fone,
     email === '' ? null : email, digitos === '' ? null : digitos]);

  if (cpfDigitos !== '') {
    const dup = await gravarCpf(tx, patientId, cpfDigitos);
    if (!dup.ok) return dup;
  }

  // A chave de meta e `kind`, da whitelist de audit.meta_keys_ok (0009). Um
  // `cadastro_status` ali violaria a CHECK meta_sem_pii e abortaria a transacao.
  await tx.query(
    `SELECT audit.log('PATIENT_CREATE', 'clin', 'patient', $1, 'sucesso',
                      jsonb_build_object('kind', 'preliminar'), NULL)`,
    [patientId]);

  return ok({ patientId, cadastroStatus: 'preliminar' });
}

async function gravarCpf(
  tx: TxClient, patientId: string, cpfDigitos: string,
): Promise<Result<true, CreateFailure>> {
  // ux_pid e UNIQUE (tenant_id, kind, value): o duplicado e 23505 e vira um erro
  // de dominio nomeado, nao um 500 com "duplicate key" na cara da recepcionista.
  const { rowCount } = await tx.query(
    `INSERT INTO clin.patient_identifier (id, patient_id, kind, value)
     VALUES (gen_random_uuid(), $1, 'CPF', $2)
     ON CONFLICT (tenant_id, kind, value) WHERE kind <> 'SEM_DOCUMENTO' DO NOTHING`,
    [patientId, cpfDigitos]);
  if (rowCount === 0) return err({ kind: 'cpf_duplicado' });
  return ok(true);
}

export interface CompleteInput {
  readonly patientId: string;
  readonly birthDate: string;
  readonly sexAtBirth: 'M' | 'F' | 'I';
  readonly cpf?: string;
}

/** Paga a divida de dados e promove o cadastro para `completo`. */
export async function completePatient(
  tx: TxClient, input: CompleteInput,
): Promise<Result<{ patientId: string }, CreateFailure>> {
  if (input.cpf !== undefined && input.cpf.trim().length > 0) {
    const r = parseCpf(input.cpf);
    if (!isOk(r)) return err({ kind: 'cpf_invalido' });
    const dup = await gravarCpf(tx, input.patientId, r.value);
    if (!dup.ok) return dup;
    await tx.query(
      `UPDATE clin.patient
          SET search_digits = btrim(coalesce($2 || ' ', '') || coalesce(phone_primary, ''))
        WHERE id = $1`, [input.patientId, r.value]);
  }

  await tx.query(
    `UPDATE clin.patient
        SET birth_date = $2::date, sex_at_birth = $3, cadastro_status = 'completo'
      WHERE id = $1`,
    [input.patientId, input.birthDate, input.sexAtBirth]);

  await tx.query(
    `SELECT audit.log('PATIENT_COMPLETE', 'clin', 'patient', $1, 'sucesso', '{}'::jsonb, NULL)`,
    [input.patientId]);

  return ok({ patientId: input.patientId });
}

export interface DataDebt {
  readonly patientId: string;
  readonly pendentes: readonly string[];
}

/** A barra "N dados pendentes" do Perfil, e o bloqueio da finalizacao. */
export async function dataDebt(tx: TxClient, patientId: string): Promise<DataDebt> {
  const { rows } = await tx.query<{
    birth_date: string | null; sex_at_birth: string | null; tem_cpf: boolean }>(
    `SELECT p.birth_date::text AS birth_date, p.sex_at_birth,
            EXISTS (SELECT 1 FROM clin.patient_identifier i
                     WHERE i.tenant_id = p.tenant_id AND i.patient_id = p.id
                       AND i.kind IN ('CPF','CNS','DNV','PASSAPORTE','SEM_DOCUMENTO')) AS tem_cpf
       FROM clin.patient p WHERE p.id = $1`, [patientId]);
  const r = rows[0];
  if (!r) return { patientId, pendentes: [] };
  const pendentes: string[] = [];
  if (r.birth_date === null) pendentes.push('birth_date');
  if (!r.tem_cpf) pendentes.push('cpf');
  if (r.sex_at_birth === null) pendentes.push('sex_at_birth');
  return { patientId, pendentes };
}
