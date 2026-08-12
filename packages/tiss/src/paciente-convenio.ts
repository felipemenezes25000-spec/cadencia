// packages/tiss/src/paciente-convenio.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type PacienteConvenioFailure =
  | { kind: 'vinculo_nao_encontrado' }
  | { kind: 'carteira_duplicada' }
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'paciente_nao_encontrado' }
  | { kind: 'dependente_sem_titular' }
  | { kind: 'ja_desativado' };

export interface CreatePacienteConvenioInput {
  readonly patientId: string;
  readonly operadoraId: string;
  readonly numeroCarteira: string;
  readonly validade?: string;
  readonly nomePlano?: string;
  readonly tipoBeneficiario?: 'T' | 'D';
  readonly titularNome?: string;
  readonly titularCarteira?: string;
}

export interface PacienteConvenioRow {
  readonly id: string;
  readonly patientId: string;
  readonly operadoraId: string;
  readonly numeroCarteira: string;
  readonly validade: string | null;
  readonly nomePlano: string | null;
  readonly tipoBeneficiario: string;
  readonly titularNome: string | null;
  readonly titularCarteira: string | null;
  readonly active: boolean;
}

export interface UpdatePacienteConvenioInput {
  readonly id: string;
  readonly numeroCarteira?: string;
  readonly validade?: string | null;
  readonly nomePlano?: string | null;
  readonly tipoBeneficiario?: 'T' | 'D';
  readonly titularNome?: string | null;
  readonly titularCarteira?: string | null;
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

export async function createPacienteConvenio(
  tx: TxClient,
  i: CreatePacienteConvenioInput,
  createdBy: string,
): Promise<Result<PacienteConvenioRow, PacienteConvenioFailure>> {
  const tipo = i.tipoBeneficiario ?? 'T';

  if (tipo === 'D' && (i.titularNome === undefined || i.titularNome === null)) {
    return err({ kind: 'dependente_sem_titular' });
  }

  const id = uuidv7();

  try {
    await tx.query(
      `INSERT INTO tiss.paciente_convenio
         (tenant_id, id, patient_id, operadora_id, numero_carteira,
          validade, nome_plano, tipo_beneficiario,
          titular_nome, titular_carteira, created_by)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4,
               $5::date, $6, $7,
               $8, $9, $10)`,
      [id, i.patientId, i.operadoraId, i.numeroCarteira,
       i.validade ?? null, i.nomePlano ?? null, tipo,
       i.titularNome ?? null, i.titularCarteira ?? null, createdBy]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    const sqlState = (e as { code?: string }).code;
    if (sqlState === '23505' && msg.includes('numero_carteira')) {
      return err({ kind: 'carteira_duplicada' });
    }
    if (sqlState === '23503') {
      if (msg.includes('operadora')) {
        return err({ kind: 'operadora_nao_encontrada' });
      }
      if (msg.includes('patient')) {
        return err({ kind: 'paciente_nao_encontrado' });
      }
    }
    throw e;
  }

  return ok({
    id,
    patientId: i.patientId,
    operadoraId: i.operadoraId,
    numeroCarteira: i.numeroCarteira,
    validade: i.validade ?? null,
    nomePlano: i.nomePlano ?? null,
    tipoBeneficiario: tipo,
    titularNome: i.titularNome ?? null,
    titularCarteira: i.titularCarteira ?? null,
    active: true,
  });
}

export async function updatePacienteConvenio(
  tx: TxClient,
  i: UpdatePacienteConvenioInput,
): Promise<Result<PacienteConvenioRow, PacienteConvenioFailure>> {
  const { rows } = await tx.query<{
    id: string; patient_id: string; operadora_id: string;
    numero_carteira: string; validade: string | null;
    nome_plano: string | null; tipo_beneficiario: string;
    titular_nome: string | null; titular_carteira: string | null;
    active: boolean;
  }>(
    `SELECT id::text, patient_id::text, operadora_id::text,
            numero_carteira, validade::text, nome_plano, tipo_beneficiario,
            titular_nome, titular_carteira, active
       FROM tiss.paciente_convenio WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'vinculo_nao_encontrado' });

  const numeroCarteira = i.numeroCarteira ?? existing.numero_carteira;
  const validade = i.validade !== undefined ? i.validade : existing.validade;
  const nomePlano = i.nomePlano !== undefined ? i.nomePlano : existing.nome_plano;
  const tipoBeneficiario = i.tipoBeneficiario ?? existing.tipo_beneficiario;
  const titularNome = i.titularNome !== undefined ? i.titularNome : existing.titular_nome;
  const titularCarteira = i.titularCarteira !== undefined ? i.titularCarteira : existing.titular_carteira;

  try {
    await tx.query(
      `UPDATE tiss.paciente_convenio
          SET numero_carteira = $2, validade = $3::date, nome_plano = $4,
              tipo_beneficiario = $5, titular_nome = $6, titular_carteira = $7
        WHERE id = $1`,
      [i.id, numeroCarteira, validade, nomePlano,
       tipoBeneficiario, titularNome, titularCarteira]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    const sqlState = (e as { code?: string }).code;
    if (sqlState === '23505' && msg.includes('numero_carteira')) {
      return err({ kind: 'carteira_duplicada' });
    }
    throw e;
  }

  return ok({
    id: existing.id,
    patientId: existing.patient_id,
    operadoraId: existing.operadora_id,
    numeroCarteira,
    validade,
    nomePlano,
    tipoBeneficiario,
    titularNome,
    titularCarteira,
    active: existing.active,
  });
}

export async function deactivatePacienteConvenio(
  tx: TxClient,
  pcId: string,
): Promise<Result<{ id: string }, PacienteConvenioFailure>> {
  const { rows } = await tx.query<{ active: boolean }>(
    `SELECT active FROM tiss.paciente_convenio WHERE id = $1`, [pcId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'vinculo_nao_encontrado' });
  if (!existing.active) return err({ kind: 'ja_desativado' });

  await tx.query(
    `UPDATE tiss.paciente_convenio SET active = false WHERE id = $1`,
    [pcId]);

  return ok({ id: pcId });
}

export async function listPacienteConvenios(
  tx: TxClient,
  patientId: string,
  onlyActive: boolean = true,
): Promise<PacienteConvenioRow[]> {
  const whereActive = onlyActive ? 'AND pc.active = true' : '';
  const { rows } = await tx.query<{
    id: string; patient_id: string; operadora_id: string;
    numero_carteira: string; validade: string | null;
    nome_plano: string | null; tipo_beneficiario: string;
    titular_nome: string | null; titular_carteira: string | null;
    active: boolean;
  }>(
    `SELECT pc.id::text, pc.patient_id::text, pc.operadora_id::text,
            pc.numero_carteira, pc.validade::text, pc.nome_plano,
            pc.tipo_beneficiario, pc.titular_nome, pc.titular_carteira,
            pc.active
       FROM tiss.paciente_convenio pc
      WHERE pc.patient_id = $1 ${whereActive}
      ORDER BY pc.created_at DESC`,
    [patientId]);
  return rows.map((r) => ({
    id: r.id,
    patientId: r.patient_id,
    operadoraId: r.operadora_id,
    numeroCarteira: r.numero_carteira,
    validade: r.validade,
    nomePlano: r.nome_plano,
    tipoBeneficiario: r.tipo_beneficiario,
    titularNome: r.titular_nome,
    titularCarteira: r.titular_carteira,
    active: r.active,
  }));
}
