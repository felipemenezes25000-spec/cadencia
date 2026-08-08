// packages/tiss/src/recurso-glosa/recurso-lifecycle.ts
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type { ProviderCtx } from '@cadencia/integrations';
import type { TissTransport } from '../transport/types';
import { XmlBuilder } from '../serializer/xml-builder';
import { encodeIso8859 } from '../serializer/encode-iso8859';
import type {
  MarkReadyFailure,
  RecursoReadyResult,
  SubmitRecursoFailure,
  RecursoSentResult,
  ResolveRecursoFailure,
  ResolveRecursoInput,
  RecursoResolvedResult,
} from './types';

/**
 * Marca o recurso de glosa como pronto para envio. Validacoes:
 * - Recurso existe
 * - Status atual e 'rascunho' (transicao permitida: rascunho -> pronto)
 * - Tem pelo menos 1 item
 * - justificativa_geral esta preenchida
 */
export async function markRecursoReady(
  tx: TxClient,
  recursoId: string,
): Promise<Result<RecursoReadyResult, MarkReadyFailure>> {
  const { rows } = await tx.query<{
    id: string;
    status: string;
    item_count: number;
    total_recursado_cents: string;
    justificativa_geral: string | null;
  }>(
    `SELECT id, status, item_count, total_recursado_cents, justificativa_geral
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (rows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = rows[0]!;

  if (recurso.status !== 'rascunho') {
    return err({ kind: 'transicao_invalida', de: recurso.status, para: 'pronto' });
  }
  if (recurso.item_count === 0) {
    return err({ kind: 'sem_itens' });
  }
  if (!recurso.justificativa_geral || recurso.justificativa_geral.trim() === '') {
    return err({ kind: 'justificativa_geral_ausente' });
  }

  await tx.query(
    `UPDATE tiss.recurso_glosa SET status = 'pronto'::tiss.recurso_glosa_status WHERE id = $1`,
    [recursoId],
  );

  return ok({
    recursoId: recurso.id,
    itemCount: recurso.item_count,
    totalRecursadoCents: Number(recurso.total_recursado_cents),
  });
}

/**
 * Submete o recurso de glosa via transport. Fluxo:
 * 1. Valida que o recurso esta em status 'pronto'
 * 2. Busca dados necessarios (operadora, itens)
 * 3. Serializa XML minimo do recurso
 * 4. Chama transport.submitRecursoGlosa
 * 5. Sucesso: transita para 'enviado', grava protocolo/storageKey
 * 6. Timeout: transita para 'indeterminado' — NUNCA retry (Design S7)
 * 7. Outro erro: retorna falha sem mudar estado
 */
export async function submitRecurso(
  tx: TxClient,
  recursoId: string,
  transport: TissTransport,
  providerCtx: ProviderCtx,
): Promise<Result<RecursoSentResult, SubmitRecursoFailure>> {
  // 1. Busca o recurso
  const { rows } = await tx.query<{
    id: string;
    status: string;
    operadora_id: string;
    justificativa_geral: string;
    item_count: number;
  }>(
    `SELECT id, status, operadora_id, justificativa_geral, item_count
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (rows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = rows[0]!;
  if (recurso.status !== 'pronto') {
    return err({ kind: 'transicao_invalida', de: recurso.status, para: 'enviado' });
  }

  // 2. Busca dados da operadora
  const { rows: opRows } = await tx.query<{
    registro_ans: string;
    cnpj: string;
  }>(
    `SELECT registro_ans, cnpj FROM tiss.operadora WHERE id = $1`,
    [recurso.operadora_id],
  );
  const op = opRows[0]!;

  // 3. Busca itens do recurso com dados da glosa
  const { rows: itemRows } = await tx.query<{
    glosa_id: string;
    justificativa_item: string;
    valor_recursado_cents: string;
    glosa_codigo: string;
    numero_guia_prestador: string;
    data_atendimento: string;
    codigo_procedimento: string;
  }>(
    `SELECT rgi.glosa_id, rgi.justificativa_item, rgi.valor_recursado_cents,
            di.glosa_codigo, di.numero_guia_prestador,
            g.data_atendimento::text, g.codigo_procedimento
       FROM tiss.recurso_glosa_item rgi
       JOIN tiss.demonstrativo_item di ON di.id = rgi.glosa_id AND di.tenant_id = rgi.tenant_id
       JOIN tiss.encounter_guia_consulta g ON g.id = di.guia_id AND g.tenant_id = di.tenant_id
      WHERE rgi.recurso_id = $1
      ORDER BY rgi.glosa_id`,
    [recursoId],
  );

  // 4. Serializa XML minimo do recurso
  const xml = new XmlBuilder();
  xml.openWithAttrs('ans:mensagemTISS', {
    'xmlns:ans': 'http://www.ans.gov.br/padroes/tiss/schemas',
  });

  xml.open('ans:cabecalho');
  xml.tag('ans:versaoPadrao', transport.tissVersion);
  xml.tag('ans:registroANS', op.registro_ans);
  xml.close('ans:cabecalho');

  xml.open('ans:prestadorParaOperadora');
  xml.open('ans:recursoGlosa');
  xml.tag('ans:numeroRecursoGlosa', recursoId.slice(0, 20));

  for (let idx = 0; idx < itemRows.length; idx++) {
    const item = itemRows[idx]!;
    xml.open('ans:itemRecursoGlosa');
    xml.tag('ans:sequencialItem', String(idx + 1));
    xml.tag('ans:dataAtendimento', item.data_atendimento);
    xml.tag('ans:numeroGuiaPrestador', item.numero_guia_prestador);
    xml.tag('ans:codigoProcedimento', item.codigo_procedimento);
    xml.tag('ans:codigoGlosa', item.glosa_codigo);
    xml.tag('ans:valorRecursado', formatCentsAsReais(Number(item.valor_recursado_cents)));
    xml.tag('ans:justificativa', item.justificativa_item);
    xml.close('ans:itemRecursoGlosa');
  }

  xml.close('ans:recursoGlosa');
  xml.close('ans:prestadorParaOperadora');
  xml.close('ans:mensagemTISS');

  const encoded = encodeIso8859(xml.toString());

  // 5. Chama o transport
  const transportResult = await transport.submitRecursoGlosa(providerCtx, {
    recursoId,
    xml: encoded.bytes,
    operadoraCnpj: op.cnpj,
  });

  // 6. Trata o resultado
  if (transportResult.ok) {
    const receipt = transportResult.value;
    const storageKey = receipt.kind === 'arquivo' ? receipt.storageKey : undefined;
    const protocolo = receipt.kind === 'protocolo' ? receipt.protocolo : undefined;

    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = 'enviado'::tiss.recurso_glosa_status,
              protocolo_operadora = $2,
              xml_storage_key = $3,
              sent_at = clock_timestamp()
        WHERE id = $1`,
      [recursoId, protocolo ?? null, storageKey ?? null],
    );

    return ok({
      recursoId,
      ...(protocolo !== undefined && { protocoloOperadora: protocolo }),
      ...(storageKey !== undefined && { storageKey }),
    });
  }

  // Timeout: transita para indeterminado — NUNCA retry (Design S7)
  if (transportResult.error.kind === 'timeout') {
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = 'indeterminado'::tiss.recurso_glosa_status,
              sent_at = clock_timestamp()
        WHERE id = $1`,
      [recursoId],
    );
    return err({
      kind: 'transport_indeterminado',
      detail: transportResult.error.detail,
    });
  }

  // Outros erros: nao muda estado
  if (transportResult.error.kind === 'unavailable') {
    return err({ kind: 'transport_indisponivel', detail: transportResult.error.detail });
  }
  if (transportResult.error.kind === 'rejected') {
    return err({ kind: 'transport_rejeitado', detail: transportResult.error.detail });
  }
  return err({ kind: 'transport_nao_suportado', detail: transportResult.error.detail });
}

function formatCentsAsReais(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const cents = centavos % 100;
  return `${reais}.${String(cents).padStart(2, '0')}`;
}

/**
 * Resolve o recurso de glosa com o resultado da operadora.
 * Transicao permitida: enviado -> (deferido | indeferido | parcial).
 * Tambem aceita resolver recurso em status 'indeterminado' (apos reconciliacao).
 * Atualiza o resultado individual de cada item vinculado.
 */
export async function resolveRecurso(
  tx: TxClient,
  recursoId: string,
  input: ResolveRecursoInput,
): Promise<Result<RecursoResolvedResult, ResolveRecursoFailure>> {
  // 1. Busca o recurso
  const { rows } = await tx.query<{
    id: string;
    status: string;
  }>(
    `SELECT id, status FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (rows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = rows[0]!;

  // Transicao permitida: enviado ou indeterminado -> resultado final
  if (recurso.status !== 'enviado' && recurso.status !== 'indeterminado') {
    return err({ kind: 'transicao_invalida', de: recurso.status, para: input.resultado });
  }

  // 2. Valida que todos os itens pertencem ao recurso
  for (const item of input.itensResolvidos) {
    const { rows: itemRows } = await tx.query<{ glosa_id: string }>(
      `SELECT glosa_id FROM tiss.recurso_glosa_item
        WHERE recurso_id = $1 AND glosa_id = $2`,
      [recursoId, item.glosaId],
    );
    if (itemRows.length === 0) {
      return err({ kind: 'item_nao_encontrado', glosaId: item.glosaId });
    }
  }

  // 3. Atualiza resultado de cada item
  let deferidos = 0;
  let indeferidos = 0;
  for (const item of input.itensResolvidos) {
    await tx.query(
      `UPDATE tiss.recurso_glosa_item
          SET resultado = $3
        WHERE recurso_id = $1 AND glosa_id = $2`,
      [recursoId, item.glosaId, item.resultado],
    );
    if (item.resultado === 'deferido') deferidos++;
    if (item.resultado === 'indeferido') indeferidos++;
  }

  // 4. Atualiza status e resolved_at do recurso
  await tx.query(
    `UPDATE tiss.recurso_glosa
        SET status = $2::tiss.recurso_glosa_status,
            resolved_at = clock_timestamp()
      WHERE id = $1`,
    [recursoId, input.resultado],
  );

  return ok({
    recursoId: recurso.id,
    resultado: input.resultado,
    itensDeferidos: deferidos,
    itensIndeferidos: indeferidos,
  });
}
