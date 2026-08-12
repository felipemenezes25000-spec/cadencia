// packages/tiss/src/contrato.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ContratoFailure =
  | { kind: 'contrato_nao_encontrado' }
  | { kind: 'contrato_duplicado' }
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'clinica_nao_encontrada' }
  | { kind: 'vigencia_invalida' }
  | { kind: 'ja_desativado' };

export interface CreateContratoInput {
  readonly operadoraId: string;
  readonly clinicId: string;
  readonly codigoPrestadorNaOperadora: string;
  readonly tipoAcomodacao?: '1' | '2' | '3';
  readonly abrangencia?: 'nacional' | 'estadual' | 'grupo_estadual' | 'municipal';
  readonly vigenciaInicio: string;
  readonly vigenciaFim?: string;
  readonly tabelaPrecosRef?: string;
  readonly observacao?: string;
}

export interface ContratoRow {
  readonly id: string;
  readonly operadoraId: string;
  readonly clinicId: string;
  readonly codigoPrestadorNaOperadora: string;
  readonly tipoAcomodacao: string;
  readonly abrangencia: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly tabelaPrecosRef: string | null;
  readonly observacao: string | null;
  readonly active: boolean;
}

export interface UpdateContratoInput {
  readonly id: string;
  readonly codigoPrestadorNaOperadora?: string;
  readonly tipoAcomodacao?: '1' | '2' | '3';
  readonly abrangencia?: 'nacional' | 'estadual' | 'grupo_estadual' | 'municipal';
  readonly vigenciaFim?: string | null;
  readonly tabelaPrecosRef?: string | null;
  readonly observacao?: string | null;
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

export async function createContrato(
  tx: TxClient,
  i: CreateContratoInput,
  createdBy: string,
): Promise<Result<ContratoRow, ContratoFailure>> {
  if (i.vigenciaFim !== undefined && i.vigenciaFim < i.vigenciaInicio) {
    return err({ kind: 'vigencia_invalida' });
  }

  const id = uuidv7();

  try {
    await tx.query(
      `INSERT INTO tiss.contrato
         (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora,
          tipo_acomodacao, abrangencia, vigencia_inicio, vigencia_fim,
          tabela_precos_ref, observacao, created_by)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4,
               $5, $6, $7::date, $8::date,
               $9, $10, $11)`,
      [id, i.operadoraId, i.clinicId, i.codigoPrestadorNaOperadora,
       i.tipoAcomodacao ?? '1', i.abrangencia ?? 'nacional',
       i.vigenciaInicio, i.vigenciaFim ?? null,
       i.tabelaPrecosRef ?? null, i.observacao ?? null, createdBy]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    const sqlState = (e as { code?: string }).code;
    if (sqlState === '23505' && msg.includes('operadora_id')) {
      return err({ kind: 'contrato_duplicado' });
    }
    if (sqlState === '23503') {
      if (msg.includes('operadora')) {
        return err({ kind: 'operadora_nao_encontrada' });
      }
      if (msg.includes('clinic')) {
        return err({ kind: 'clinica_nao_encontrada' });
      }
    }
    throw e;
  }

  return ok({
    id,
    operadoraId: i.operadoraId,
    clinicId: i.clinicId,
    codigoPrestadorNaOperadora: i.codigoPrestadorNaOperadora,
    tipoAcomodacao: i.tipoAcomodacao ?? '1',
    abrangencia: i.abrangencia ?? 'nacional',
    vigenciaInicio: i.vigenciaInicio,
    vigenciaFim: i.vigenciaFim ?? null,
    tabelaPrecosRef: i.tabelaPrecosRef ?? null,
    observacao: i.observacao ?? null,
    active: true,
  });
}

export async function updateContrato(
  tx: TxClient,
  i: UpdateContratoInput,
): Promise<Result<ContratoRow, ContratoFailure>> {
  const { rows } = await tx.query<{
    id: string; operadora_id: string; clinic_id: string;
    codigo_prestador_na_operadora: string; tipo_acomodacao: string;
    abrangencia: string; vigencia_inicio: string; vigencia_fim: string | null;
    tabela_precos_ref: string | null; observacao: string | null; active: boolean;
  }>(
    `SELECT id::text, operadora_id::text, clinic_id::text,
            codigo_prestador_na_operadora, tipo_acomodacao, abrangencia,
            vigencia_inicio::text, vigencia_fim::text,
            tabela_precos_ref, observacao, active
       FROM tiss.contrato WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'contrato_nao_encontrado' });

  const codigoPrestadorNaOperadora = i.codigoPrestadorNaOperadora ?? existing.codigo_prestador_na_operadora;
  const tipoAcomodacao = i.tipoAcomodacao ?? existing.tipo_acomodacao;
  const abrangencia = i.abrangencia ?? existing.abrangencia;
  const vigenciaFim = i.vigenciaFim !== undefined ? i.vigenciaFim : existing.vigencia_fim;
  const tabelaPrecosRef = i.tabelaPrecosRef !== undefined ? i.tabelaPrecosRef : existing.tabela_precos_ref;
  const observacao = i.observacao !== undefined ? i.observacao : existing.observacao;

  await tx.query(
    `UPDATE tiss.contrato
        SET codigo_prestador_na_operadora = $2,
            tipo_acomodacao = $3, abrangencia = $4,
            vigencia_fim = $5::date, tabela_precos_ref = $6,
            observacao = $7
      WHERE id = $1`,
    [i.id, codigoPrestadorNaOperadora, tipoAcomodacao, abrangencia,
     vigenciaFim, tabelaPrecosRef, observacao]);

  return ok({
    id: existing.id,
    operadoraId: existing.operadora_id,
    clinicId: existing.clinic_id,
    codigoPrestadorNaOperadora,
    tipoAcomodacao,
    abrangencia,
    vigenciaInicio: existing.vigencia_inicio,
    vigenciaFim,
    tabelaPrecosRef,
    observacao,
    active: existing.active,
  });
}

export async function deactivateContrato(
  tx: TxClient,
  contratoId: string,
): Promise<Result<{ id: string }, ContratoFailure>> {
  const { rows } = await tx.query<{ active: boolean }>(
    `SELECT active FROM tiss.contrato WHERE id = $1`, [contratoId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'contrato_nao_encontrado' });
  if (!existing.active) return err({ kind: 'ja_desativado' });

  await tx.query(
    `UPDATE tiss.contrato SET active = false WHERE id = $1`,
    [contratoId]);

  return ok({ id: contratoId });
}

export async function listContratos(
  tx: TxClient,
  onlyActive: boolean = true,
): Promise<ContratoRow[]> {
  const whereActive = onlyActive ? 'AND c.active = true' : '';
  const { rows } = await tx.query<{
    id: string; operadora_id: string; clinic_id: string;
    codigo_prestador_na_operadora: string; tipo_acomodacao: string;
    abrangencia: string; vigencia_inicio: string; vigencia_fim: string | null;
    tabela_precos_ref: string | null; observacao: string | null; active: boolean;
  }>(
    `SELECT c.id::text, c.operadora_id::text, c.clinic_id::text,
            c.codigo_prestador_na_operadora, c.tipo_acomodacao, c.abrangencia,
            c.vigencia_inicio::text, c.vigencia_fim::text,
            c.tabela_precos_ref, c.observacao, c.active
       FROM tiss.contrato c
      WHERE 1=1 ${whereActive}
      ORDER BY c.created_at DESC`);
  return rows.map((r) => ({
    id: r.id,
    operadoraId: r.operadora_id,
    clinicId: r.clinic_id,
    codigoPrestadorNaOperadora: r.codigo_prestador_na_operadora,
    tipoAcomodacao: r.tipo_acomodacao,
    abrangencia: r.abrangencia,
    vigenciaInicio: r.vigencia_inicio,
    vigenciaFim: r.vigencia_fim,
    tabelaPrecosRef: r.tabela_precos_ref,
    observacao: r.observacao,
    active: r.active,
  }));
}
