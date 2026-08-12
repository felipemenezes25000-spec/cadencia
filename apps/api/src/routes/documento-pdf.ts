import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { documentHtml, escapeHtml, renderPdf } from '@cadencia/documents';
import { rota } from '../guard';

function erroDominio(kind: string, status: number): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind });
}

const TITULOS: Record<string, string> = {
  atestado: 'Atestado medico',
  pedido_exame: 'Solicitacao de exames',
  relatorio: 'Relatorio medico',
  declaracao_comparecimento: 'Declaracao de comparecimento',
};

/**
 * O documento clínico impresso.
 *
 * O documento existia no banco com hash e assinatura, e não havia como o
 * paciente levar nada embora — emitir sem imprimir é emitir para ninguém.
 *
 * O PDF é gerado a partir do PAYLOAD GRAVADO, nunca de dados vindos da
 * requisição. Um atestado cujo texto pudesse ser passado na URL seria um
 * atestado que qualquer um reimprime com o conteúdo que quiser, com o cabeçalho
 * da clínica e o nome do médico.
 */
export async function documentoPdfRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/documentos/:id/pdf', {
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, rota('document.read', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      kind: string; payload: Record<string, unknown>; emitido_em: string;
      clinica_nome: string; clinica_cnpj: string; clinica_cnes: string;
      prof_nome: string | null; conselho: string; numero: string; uf: string;
      patient_id: string;
      paciente_nome: string; nascimento: string | null; cpf: string | null;
    }>(
      `SELECT d.kind::text AS kind, d.payload,
              to_char(d.issued_date, 'DD/MM/YYYY') AS emitido_em,
              -- CNES nulo é clínica que ainda não se cadastrou no CNES, o que é
              -- legítimo. O cabeçalho sai sem o número em vez de a impressão
              -- inteira falhar por causa de um campo administrativo.
              c.nome AS clinica_nome,
              coalesce(c.cnpj, '') AS clinica_cnpj,
              coalesce(c.cnes, '') AS clinica_cnes,
              u.full_name AS prof_nome,
              pr.conselho_profissional AS conselho,
              pr.numero_conselho AS numero, pr.uf_conselho AS uf,
              d.patient_id,
              pat.display_name AS paciente_nome,
              to_char(pat.birth_date, 'DD/MM/YYYY') AS nascimento,
              (SELECT pi.value FROM clin.patient_identifier pi
                WHERE (pi.tenant_id, pi.patient_id) = (pat.tenant_id, pat.id)
                  AND pi.kind = 'cpf' LIMIT 1) AS cpf
         FROM clin.document d
         JOIN app.clinic c ON (c.tenant_id, c.id) = (d.tenant_id, d.clinic_id)
         JOIN app.professional pr
              ON (pr.tenant_id, pr.id) = (d.tenant_id, d.professional_id)
         JOIN id."user" u ON u.id = pr.user_id
         JOIN clin.patient pat
              ON (pat.tenant_id, pat.id) = (d.tenant_id, d.patient_id)
        WHERE d.id = $1`,
      [p.id]);

    const d = rows[0];
    if (d === undefined) erroDominio('documento_nao_encontrado', 404);

    // §3.7 — atestado, relatório e pedido de exame são documento clínico do
    // paciente. Imprimir é ler, e leitura de prontuário deixa rastro.
    await tx.query(`SELECT audit.log_read('document_read', $1)`, [d.patient_id]);

    // O texto vem de um `<textarea>`: é TEXTO, não HTML, e `documentHtml`
    // interpola `corpo` sem escapar (contrato do template — o exportador de
    // prontuário monta lista com ele). Sem escapar aqui, `saturacao <95%` some
    // do atestado impresso a partir do `<`. E sem `pre-wrap` as quebras de
    // linha do modelo colapsam: o pedido de exame vira um parágrafo corrido.
    const corpoTexto = typeof d.payload['corpo'] === 'string' ? d.payload['corpo'] : '';
    const corpo = `<p style="white-space:pre-wrap">${escapeHtml(corpoTexto)}</p>`;
    const titulo = typeof d.payload['titulo'] === 'string'
      ? d.payload['titulo'] : (TITULOS[d.kind] ?? 'Documento');

    const html = documentHtml({
      titulo,
      clinica: {
        nome: d.clinica_nome, cnpj: d.clinica_cnpj,
        cnes: d.clinica_cnes, endereco: '',
      },
      profissional: {
        nome: d.prof_nome ?? '', conselho: d.conselho,
        numero: d.numero, uf: d.uf,
      },
      paciente: {
        nome: d.paciente_nome, nascimento: d.nascimento, cpf: d.cpf,
      },
      emitidoEm: d.emitido_em,
      corpo,
    });

    const pdf = await renderPdf(html);

    // `inline` e não `attachment`: o médico quer ver antes de imprimir, e o
    // download forçado obrigaria a abrir o arquivo baixado para conferir se o
    // texto saiu certo.
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition',
        `inline; filename="${d.kind}-${p.id.slice(0, 8)}.pdf"`)
      // Documento clínico não entra em cache de proxy: é dado de saúde com nome
      // de paciente no corpo.
      .header('cache-control', 'private, no-store');
    return reply.send(Buffer.from(pdf));
  }));
}
