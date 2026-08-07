// packages/tiss/src/project-guia.ts
import { ok, err, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Resultado de sucesso
// ---------------------------------------------------------------------------

export interface ProjectedResult {
  readonly kind: 'projected';
  readonly guiaId: string;
  readonly numeroGuia: string;
  readonly status: 'completa' | 'incompleta';
}

export interface SkippedResult {
  readonly kind: 'skipped';
}

export type ProjectionResult = ProjectedResult | SkippedResult;

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

export interface DadosAusentesError {
  readonly kind: 'dados_obrigatorios_ausentes';
  readonly guiaId: string;
  readonly missingFields: readonly string[];
}

export interface TussNaoVigenteError {
  readonly kind: 'tuss_nao_vigente';
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly dataAtendimento: string;
}

export type ProjectionError = DadosAusentesError | TussNaoVigenteError;

// ---------------------------------------------------------------------------
// Leitura de encounter_billing
// ---------------------------------------------------------------------------

interface BillingRow {
  tenant_id: string;
  encounter_id: string;
  operadora_nome: string | null;
  registro_ans: string | null;
  numero_carteira: string | null;
  atendimento_rn: boolean;
  cnes: string;
  cnpj_contratado: string | null;
  cpf_contratado: string | null;
  codigo_prestador_na_operadora: string | null;
  conselho_profissional: string;
  numero_conselho: string;
  uf_conselho: string;
  cbos: string;
  indicacao_acidente: string;
  regime_atendimento: string;
  tipo_consulta: string;
  saude_ocupacional: string | null;
  data_atendimento: string;
  codigo_tabela: string;
  codigo_procedimento: string;
  valor_centavos: string;
  observacao: string | null;
}

async function readBilling(tx: TxClient, encounterId: string): Promise<BillingRow | undefined> {
  const { rows } = await tx.query<BillingRow>(
    `SELECT tenant_id, encounter_id, operadora_nome, registro_ans, numero_carteira,
            atendimento_rn, cnes, cnpj_contratado, cpf_contratado,
            codigo_prestador_na_operadora, conselho_profissional, numero_conselho,
            uf_conselho, cbos, indicacao_acidente, regime_atendimento, tipo_consulta,
            saude_ocupacional, data_atendimento::text AS data_atendimento,
            codigo_tabela, codigo_procedimento, valor_centavos::text AS valor_centavos,
            observacao
       FROM clin.encounter_billing
      WHERE encounter_id = $1`,
    [encounterId],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Funcao principal
// ---------------------------------------------------------------------------

/**
 * Projeta a guia de consulta TISS a partir do atendimento finalizado.
 *
 * - Atendimento particular (sem registro_ans): retorna ok({ kind: 'skipped' }).
 * - Dados obrigatorios ausentes: insere guia com status 'incompleta' e retorna
 *   err com lista de campos faltando.
 * - Procedimento nao vigente na TUSS: retorna err sem inserir guia.
 * - Tudo ok: insere guia com status 'completa' e retorna ok.
 */
export async function projectGuiaConsulta(
  tx: TxClient,
  encounterId: string,
  encounterVersionId: string,
): Promise<Result<ProjectionResult, ProjectionError>> {
  // 1. Le encounter_billing
  const billing = await readBilling(tx, encounterId);
  if (billing === undefined) {
    // Sem billing: nada a projetar (nao deveria acontecer, mas e seguro)
    return ok({ kind: 'skipped' });
  }

  // 2. Particular: registro_ans NULL → skip
  if (billing.registro_ans === null) {
    return ok({ kind: 'skipped' });
  }

  // 3. Busca operadora pelo registro_ans
  const { rows: opRows } = await tx.query<{ id: string }>(
    `SELECT id FROM tiss.operadora
      WHERE registro_ans = $1
      LIMIT 1`,
    [billing.registro_ans],
  );
  const operadora = opRows[0];
  if (operadora === undefined) {
    // Operadora nao cadastrada — guia incompleta
    return insertIncompleteGuia(tx, billing, encounterVersionId, encounterId, ['operadora_nao_cadastrada']);
  }

  // 4. Busca paciente_convenio
  const { rows: _pcRows } = await tx.query<{ numero_carteira: string }>(
    `SELECT numero_carteira FROM tiss.paciente_convenio
      WHERE encounter_id IS NOT NULL OR TRUE
        AND operadora_id = $1
        AND numero_carteira = $2
      LIMIT 1`,
    [operadora.id, billing.numero_carteira],
  );

  // 5. Busca contrato
  const { rows: _ctRows } = await tx.query<{
    codigo_prestador_na_operadora: string | null;
  }>(
    `SELECT codigo_prestador_na_operadora FROM tiss.contrato
      WHERE operadora_id = $1
      LIMIT 1`,
    [operadora.id],
  );

  // 6. Valida TUSS vigente na data do atendimento
  const { rows: tussRows } = await tx.query<{ codigo: string }>(
    `SELECT codigo FROM ref.tuss_at($1::smallint, $2, $3::date)`,
    [billing.codigo_tabela, billing.codigo_procedimento, billing.data_atendimento],
  );
  if (tussRows.length === 0) {
    return err({
      kind: 'tuss_nao_vigente',
      codigoTabela: billing.codigo_tabela,
      codigoProcedimento: billing.codigo_procedimento,
      dataAtendimento: billing.data_atendimento,
    });
  }

  // 7. Verifica campos obrigatorios
  const missingFields: string[] = [];
  if (!billing.numero_carteira) missingFields.push('numero_carteira');
  if (!billing.cnes) missingFields.push('cnes');
  if (!billing.conselho_profissional) missingFields.push('conselho_profissional');
  if (!billing.numero_conselho) missingFields.push('numero_conselho');
  if (!billing.uf_conselho) missingFields.push('uf_conselho');
  if (!billing.cbos) missingFields.push('cbos');
  if (
    !billing.codigo_prestador_na_operadora &&
    !billing.cpf_contratado &&
    !billing.cnpj_contratado
  ) {
    missingFields.push('identificacao_prestador');
  }

  if (missingFields.length > 0) {
    return insertIncompleteGuia(tx, billing, encounterVersionId, encounterId, missingFields);
  }

  // 8. Gera numero da guia
  const { rows: guiaNumRows } = await tx.query<{ next_guia_number: string }>(
    `SELECT tiss.next_guia_number($1)`,
    [billing.tenant_id],
  );
  const numeroGuia = String(guiaNumRows[0]!.next_guia_number);

  // 9. Insere a guia completa
  const guiaId = await insertGuia(tx, billing, encounterVersionId, operadora.id, numeroGuia, 'completa');

  return ok({
    kind: 'projected',
    guiaId,
    numeroGuia,
    status: 'completa',
  });
}

// ---------------------------------------------------------------------------
// Helpers de insercao
// ---------------------------------------------------------------------------

async function insertGuia(
  tx: TxClient,
  billing: BillingRow,
  encounterVersionId: string,
  operadoraId: string,
  numeroGuia: string,
  status: 'completa' | 'incompleta',
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO tiss.encounter_guia_consulta (
        tenant_id, id, encounter_id, encounter_version_id,
        operadora_id, registro_ans, numero_guia_prestador, numero_carteira,
        atendimento_rn, codigo_prestador_na_operadora, cpf_contratado, cnpj_contratado,
        cnes, conselho_profissional, numero_conselho, uf_conselho, cbos,
        indicacao_acidente, regime_atendimento, saude_ocupacional,
        data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
        valor_procedimento, observacao, status, created_by)
     VALUES (
        $1, gen_random_uuid(), $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18, $19,
        $20::date, $21, $22, $23,
        $24, $25, $26, app.current_user_id())
     RETURNING id::text AS id`,
    [
      billing.tenant_id, billing.encounter_id, encounterVersionId,
      operadoraId, billing.registro_ans, numeroGuia, billing.numero_carteira,
      billing.atendimento_rn, billing.codigo_prestador_na_operadora,
      billing.cpf_contratado, billing.cnpj_contratado,
      billing.cnes, billing.conselho_profissional, billing.numero_conselho,
      billing.uf_conselho, billing.cbos,
      billing.indicacao_acidente, billing.regime_atendimento, billing.saude_ocupacional,
      billing.data_atendimento, billing.tipo_consulta, billing.codigo_tabela,
      billing.codigo_procedimento,
      (Number(billing.valor_centavos) / 100).toFixed(2),
      billing.observacao, status,
    ],
  );
  return rows[0]!.id;
}

async function insertIncompleteGuia(
  tx: TxClient,
  billing: BillingRow,
  encounterVersionId: string,
  _encounterId: string,
  missingFields: string[],
): Promise<Result<ProjectionResult, ProjectionError>> {
  // Busca operadora para o INSERT. Se nao existir, usa placeholder.
  const { rows: opRows } = await tx.query<{ id: string }>(
    `SELECT id FROM tiss.operadora WHERE registro_ans = $1 LIMIT 1`,
    [billing.registro_ans],
  );
  const operadoraId = opRows[0]?.id;

  if (operadoraId === undefined) {
    // Sem operadora cadastrada nao da para inserir guia (FK obrigatoria)
    return err({
      kind: 'dados_obrigatorios_ausentes',
      guiaId: '',
      missingFields,
    });
  }

  // Gera numero da guia mesmo para incompleta
  const { rows: guiaNumRows } = await tx.query<{ next_guia_number: string }>(
    `SELECT tiss.next_guia_number($1)`,
    [billing.tenant_id],
  );
  const numeroGuia = String(guiaNumRows[0]!.next_guia_number);

  const guiaId = await insertGuia(tx, billing, encounterVersionId, operadoraId, numeroGuia, 'incompleta');

  return err({
    kind: 'dados_obrigatorios_ausentes',
    guiaId,
    missingFields,
  });
}
