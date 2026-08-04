import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import { documentHtml, escapeHtml, renderPdf, stampPageNumbers } from '@cadencia/documents';
import { collectRecord, type CollectedRecord, type ExportBlock } from './collect';
import { buildReceipt, receiptHtml } from './receipt';

export interface ExportRecordInput {
  readonly patientId: string;
  readonly requesterKind: 'titular' | 'representante' | 'profissional' | 'judicial' | 'fiscalizacao';
  readonly from?: string;
  readonly to?: string;
  readonly requesterNote?: string;
  readonly blocosPorLote?: number;
}

export interface ExportedRecord {
  readonly exportId: string;
  readonly pdfBytes: Uint8Array;
  readonly pageCount: number;
  readonly pdfSha256Hex: string;
  readonly durationMs: number;
}

const SOFTWARE_NOME = 'Cadência';
const SOFTWARE_VERSAO = '1.0.0';

function blocoHtml(b: ExportBlock): string {
  const versoes = b.versoes.map((v) => {
    const cabecalho = v.superseded
      ? `<div class="super">Versão ${v.versionNo} · ${escapeHtml(v.kind)} · RETIFICADA${
          v.justificativaDaSuperssao === null ? ''
            : ` — justificativa: ${escapeHtml(v.justificativaDaSuperssao)}`}</div>`
      : `<div class="vig">Versão ${v.versionNo} · ${escapeHtml(v.kind)}${
          v.incompleto ? ' · REGISTRO INCOMPLETO (auto-finalizado)' : ''}</div>`;
    const campos = v.campos.map((c) =>
      `<p><strong>${escapeHtml(c.labelSnapshot)}:</strong> ${escapeHtml(c.texto)}${
        c.displaySnapshot === null ? '' : ` (${escapeHtml(c.displaySnapshot)})`}</p>`).join('');
    const cids = v.diagnosticos.length === 0 ? ''
      : `<p><strong>CID:</strong> ${v.diagnosticos
          .map((d) => `${escapeHtml(d.code)} — ${escapeHtml(d.display)}`).join('; ')}</p>`;
    return `<section class="${v.superseded ? 'tachado' : ''}">${cabecalho}${campos}${cids}
      <p class="assin">Autor: ${escapeHtml(v.authorNome)} · finalizado em ${escapeHtml(v.finalizedAt)}</p>
    </section>`;
  }).join('');
  return `<article><h2>${escapeHtml(b.occurredDate)} — ${escapeHtml(b.clinicaNome)}</h2>${versoes}</article>`;
}

export async function exportRecord(
  tx: TxClient, i: ExportRecordInput,
): Promise<Result<ExportedRecord, { kind: 'paciente_nao_encontrado' }>> {
  const inicio = Date.now();

  const cab = await tx.query<{
    display_name: string; cpf: string | null;
    razao_social: string; cnpj: string; cnes: string; solicitante: string }>(
    `SELECT p.display_name, t.razao_social, t.cnpj,
            coalesce(c.cnes, '0000000') AS cnes,
            (SELECT i.value FROM clin.patient_identifier i
              WHERE i.tenant_id = p.tenant_id AND i.patient_id = p.id AND i.kind = 'CPF'
              LIMIT 1) AS cpf,
            (SELECT u.full_name FROM id."user" u WHERE u.id = app.current_user_id()) AS solicitante
       FROM clin.patient p
       JOIN app.tenant t ON t.id = p.tenant_id
       LEFT JOIN app.clinic c ON c.tenant_id = p.tenant_id
                             AND c.id = nullif(current_setting('app.clinic_id', true), '')::uuid
      WHERE p.id = $1`, [i.patientId]);
  const h = cab.rows[0];
  if (!h) return { ok: false, error: { kind: 'paciente_nao_encontrado' } };

  const coletado: CollectedRecord = await collectRecord(tx, {
    patientId: i.patientId,
    ...(i.from === undefined ? {} : { from: i.from }),
    ...(i.to === undefined ? {} : { to: i.to }),
  });

  const final = await PDFDocument.create();
  final.setTitle('Prontuário — exportação integral');
  final.setProducer(`${SOFTWARE_NOME} ${SOFTWARE_VERSAO}`);
  final.setLanguage('pt-BR');

  const porLote = Math.max(i.blocosPorLote ?? 25, 1);
  for (let inicioLote = 0; inicioLote < coletado.blocos.length; inicioLote += porLote) {
    const lote = coletado.blocos.slice(inicioLote, inicioLote + porLote);
    const html = documentHtml({
      titulo: 'PRONTUÁRIO — EXPORTAÇÃO INTEGRAL',
      clinica: { nome: h.razao_social, cnpj: h.cnpj, cnes: h.cnes, endereco: '' },
      profissional: { nome: h.solicitante, conselho: '', numero: '', uf: '' },
      paciente: { nome: h.display_name, nascimento: null, cpf: h.cpf },
      emitidoEm: new Date().toISOString(),
      corpo: lote.map(blocoHtml).join(''),
    });
    const parcial = await PDFDocument.load(await renderPdf(html));
    const paginas = await final.copyPages(parcial, parcial.getPageIndices());
    for (const p of paginas) final.addPage(p);
  }

  if (coletado.anexos.length > 0) {
    const listaHtml = documentHtml({
      titulo: 'ANEXOS DO PRONTUÁRIO',
      clinica: { nome: h.razao_social, cnpj: h.cnpj, cnes: h.cnes, endereco: '' },
      profissional: { nome: h.solicitante, conselho: '', numero: '', uf: '' },
      paciente: { nome: h.display_name, nascimento: null, cpf: h.cpf },
      emitidoEm: new Date().toISOString(),
      corpo: `<ol>${coletado.anexos.map((a) =>
        `<li>${escapeHtml(a.originalName)} — ${escapeHtml(a.contentType)} — SHA-256 ${
          escapeHtml(a.sha256Hex)}</li>`).join('')}</ol>`,
    });
    const parcial = await PDFDocument.load(await renderPdf(listaHtml));
    const paginas = await final.copyPages(parcial, parcial.getPageIndices());
    for (const p of paginas) final.addPage(p);
  }

  const exportId = uuidv7();
  const semRecibo = await final.save();
  const shaProvisorio = createHash('sha256').update(semRecibo).digest('hex');

  const recibo = buildReceipt({
    exportId,
    patientNome: h.display_name, patientCpf: h.cpf,
    tenantRazaoSocial: h.razao_social, tenantCnpj: h.cnpj, clinicaCnes: h.cnes,
    requesterKind: i.requesterKind, requestedByNome: h.solicitante,
    emitidoEm: new Date().toISOString(),
    periodoDe: i.from ?? null, periodoAte: i.to ?? null,
    totalVersoes: coletado.blocos.reduce((n, b) => n + b.versoes.length, 0),
    totalAnexos: coletado.anexos.length,
    totalDocumentos: coletado.documentos.length,
    pageCount: final.getPageCount() + 1,
    pdfSha256Hex: shaProvisorio,
    softwareNome: SOFTWARE_NOME, softwareVersao: SOFTWARE_VERSAO,
  });

  const reciboPdf = await PDFDocument.load(await renderPdf(receiptHtml(recibo)));
  const paginasRecibo = await final.copyPages(reciboPdf, reciboPdf.getPageIndices());
  for (const p of paginasRecibo) final.addPage(p);

  const carimbado = await stampPageNumbers(await final.save(), { prefixo: 'Prontuário' });
  const sha = createHash('sha256').update(carimbado).digest();
  const pdfKey = uuidv7();
  const pageCount = (await PDFDocument.load(carimbado)).getPageCount();
  const durationMs = Date.now() - inicio;

  await tx.query(
    `INSERT INTO clin.record_export (
        id, patient_id, requested_by, requester_kind, requester_note,
        period_from, period_to, version_ids, attachment_ids, document_ids,
        page_count, pdf_key, pdf_sha256, receipt_json, duration_ms)
     VALUES ($1, $2, app.current_user_id(), $3, $4, $5::date, $6::date,
             $7::uuid[], $8::uuid[], $9::uuid[], $10, $11, $12, $13::jsonb, $14)`,
    [exportId, i.patientId, i.requesterKind, i.requesterNote ?? null,
     i.from ?? null, i.to ?? null,
     coletado.blocos.flatMap((b) => b.versoes.map((v) => v.versionId)),
     coletado.anexos.map((a) => a.attachmentId),
     coletado.documentos.map((d) => d.documentId),
     pageCount, pdfKey, sha, JSON.stringify(recibo), durationMs]);

  await tx.query(
    `SELECT audit.log('RECORD_EXPORT', 'clin', 'record_export', $1, 'sucesso',
                      jsonb_build_object('paginas', $2::int, 'ms', $3::int,
                                         'qualidade', $4::text), NULL)`,
    [exportId, pageCount, durationMs, i.requesterKind]);

  return ok({ exportId, pdfBytes: carimbado, pageCount,
              pdfSha256Hex: sha.toString('hex'), durationMs });
}
