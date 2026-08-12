import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '@cadencia/integrations';
import { err, ok, isoFromMs, systemClock, type Result } from '@cadencia/kernel';
import type { TissSubmissionReceipt, TissTransport } from './types';

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------

export type SoapNotConfigured = { kind: 'soap_not_configured'; detail: string };

export interface TissSoapOptions {
  readonly tissVersion: string;
  readonly soapEndpointUrl: string;
  readonly soapUsername: string;
  readonly soapPassword: string;
  readonly timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

const TISS_NS = 'http://www.ans.gov.br/padroes/tiss/schemas';

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

/**
 * Remove o prólogo XML de um fragmento que vai ser EMBUTIDO em outro documento.
 *
 * `XmlBuilder` abre todo documento com
 * `<?xml version="1.0" encoding="ISO-8859-1"?>` — correto para o arquivo do
 * lote, que é um documento inteiro. Mas o mesmo texto entra aqui como FILHO de
 * `<soap:Body>`, e declaração XML só é válida na primeira posição do documento.
 * Embutida no meio, o envelope inteiro deixa de ser XML bem formado e qualquer
 * parser conformante — o da operadora inclusive — recusa antes de olhar o
 * conteúdo. O erro que volta é de sintaxe, então ninguém associa ao lote.
 */
function semPrologo(xml: string): string {
  return xml.replace(/^﻿?\s*<\?xml[^?]*\?>\s*/i, '');
}

export function buildSoapEnvelope(operacao: string, innerXml: string): string {
  return (
    '<?xml version="1.0" encoding="ISO-8859-1"?>\n' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"' +
    ` xmlns:ans="${TISS_NS}">\n` +
    '<soap:Body>\n' +
    `<ans:${operacao}>\n` +
    semPrologo(innerXml) + '\n' +
    `</ans:${operacao}>\n` +
    '</soap:Body>\n' +
    '</soap:Envelope>'
  );
}

export function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[^:]+:)?${tag}[^>]*>([^<]+)</(?:[^:]+:)?${tag}>`);
  const m = xml.match(re);
  return m?.[1] ?? null;
}

export function isSoapFault(xml: string): { faultCode: string; faultString: string } | null {
  if (!xml.includes('Fault')) return null;
  const code = extractTag(xml, 'faultcode');
  const str = extractTag(xml, 'faultstring');
  if (code && str) return { faultCode: code, faultString: str };
  return null;
}

interface HttpPostResult {
  readonly statusCode: number;
  readonly body: string;
}

export function httpPost(
  url: string,
  body: Buffer,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<HttpPostResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqFn = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    let settled = false;

    const req: ClientRequest = reqFn(
      parsed,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=ISO-8859-1',
          'Content-Length': body.length.toString(),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (!settled) {
            settled = true;
            resolve({
              statusCode: res.statusCode ?? 500,
              body: Buffer.concat(chunks).toString('latin1'),
            });
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('SOAP_TIMEOUT'));
    });

    req.on('error', (e: Error) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTissSoapTransport(
  opts: TissSoapOptions,
): Result<TissTransport, SoapNotConfigured> {
  if (!opts.soapEndpointUrl || !opts.soapUsername || !opts.soapPassword) {
    return err({
      kind: 'soap_not_configured' as const,
      detail:
        'Credenciais SOAP ausentes no contrato: endpoint, username ou password não configurados',
    });
  }

  const {
    soapEndpointUrl,
    soapUsername,
    soapPassword,
    tissVersion,
    timeoutMs = 30_000,
  } = opts;

  const basicAuth = Buffer.from(`${soapUsername}:${soapPassword}`).toString('base64');

  async function soapCall(
    operacao: string,
    soapAction: string,
    innerXml: string,
    deadlineMs: number,
  ): Promise<ProviderResult<string>> {
    const envelope = buildSoapEnvelope(operacao, innerXml);
    const body = Buffer.from(envelope, 'latin1');
    const effectiveTimeout = Math.min(timeoutMs, deadlineMs);

    let response: HttpPostResult;
    try {
      response = await httpPost(
        soapEndpointUrl,
        body,
        {
          SOAPAction: soapAction,
          Authorization: `Basic ${basicAuth}`,
        },
        effectiveTimeout,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg === 'SOAP_TIMEOUT' ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('socket hang up')
      ) {
        return failure({
          kind: 'timeout',
          retrySafe: false,
          detail: `SOAP timeout apos ${effectiveTimeout}ms para ${soapEndpointUrl}`,
        });
      }
      return failure({
        kind: 'unavailable',
        retrySafe: true,
        detail: `Erro de conexao SOAP: ${msg}`,
      });
    }

    const fault = isSoapFault(response.body);
    if (fault) {
      return failure({
        kind: 'rejected',
        retrySafe: false,
        code: fault.faultCode,
        detail: fault.faultString,
      });
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return failure({
        kind: 'unavailable',
        retrySafe: true,
        detail: `HTTP ${response.statusCode} de ${soapEndpointUrl}`,
      });
    }

    return success(response.body, `soap-${operacao}`);
  }

  const transport: TissTransport = {
    id: 'tiss-soap',
    mode: 'webservice',
    tissVersion,
    capabilities: new Set(['residency:br', 'tiss-soap']),
    safety: {
      submitBatch: 'unsafe',
      fetchDemonstrativo: 'safe',
      submitRecursoGlosa: 'unsafe',
    },

    async health() {
      return { up: true, latencyMs: 0, checkedAt: agora() };
    },

    async submitBatch(ctx: ProviderCtx, i) {
      const xmlContent = Buffer.from(i.xml).toString('latin1');
      const result = await soapCall(
        'tissFaturamentoWS',
        'tissFaturamentoWS',
        xmlContent,
        ctx.deadlineMs,
      );
      if (!result.ok) return result;

      const protocolo = extractTag(result.value, 'protocolo');
      const dataRecebimento = extractTag(result.value, 'dataRecebimento');

      if (!protocolo) {
        return failure({
          kind: 'rejected',
          retrySafe: false,
          code: 'PROTOCOLO_AUSENTE',
          detail: 'Resposta SOAP não contém <protocolo>',
        });
      }

      const recebidoEm = dataRecebimento
        ? (asRfc3339(dataRecebimento) ?? agora())
        : agora();

      const receipt: TissSubmissionReceipt = {
        kind: 'protocolo',
        protocolo,
        recebidoEm,
      };
      return success(receipt, `soap-lote-${i.loteId}`);
    },

    async fetchDemonstrativo(ctx: ProviderCtx, i) {
      const innerXml =
        `<ans:protocolo>${i.protocolo}</ans:protocolo>`;
      const result = await soapCall(
        'tissSolicitacaoDemonstrativoRetorno',
        'tissSolicitacaoDemonstrativoRetorno',
        innerXml,
        ctx.deadlineMs,
      );
      if (!result.ok) return result;

      const tipoDemonstrativo = extractTag(result.value, 'tipoDemonstrativo');
      const xmlContent = extractTag(result.value, 'demonstrativoXml');

      if (!xmlContent) {
        return failure({
          kind: 'rejected',
          retrySafe: false,
          code: 'DEMONSTRATIVO_AUSENTE',
          detail: 'Resposta SOAP não contém <demonstrativoXml>',
        });
      }

      const xmlBytes = Buffer.from(xmlContent, 'latin1');
      const kind: 'analise' | 'pagamento' =
        tipoDemonstrativo === 'pagamento' ? 'pagamento' : 'analise';

      return success(
        { xml: new Uint8Array(xmlBytes), kind },
        `soap-demo-${i.protocolo}`,
      );
    },

    async submitRecursoGlosa(ctx: ProviderCtx, i) {
      const xmlContent = Buffer.from(i.xml).toString('latin1');
      const result = await soapCall(
        'tissRecursoGlosa',
        'tissRecursoGlosa',
        xmlContent,
        ctx.deadlineMs,
      );
      if (!result.ok) return result;

      const protocolo = extractTag(result.value, 'protocolo');
      const dataRecebimento = extractTag(result.value, 'dataRecebimento');

      if (!protocolo) {
        return failure({
          kind: 'rejected',
          retrySafe: false,
          code: 'PROTOCOLO_AUSENTE',
          detail: 'Resposta SOAP não contém <protocolo> para recurso de glosa',
        });
      }

      const recebidoEm = dataRecebimento
        ? (asRfc3339(dataRecebimento) ?? agora())
        : agora();

      const receipt: TissSubmissionReceipt = {
        kind: 'protocolo',
        protocolo,
        recebidoEm,
      };
      return success(receipt, `soap-recurso-${i.recursoId}`);
    },
  };

  return ok(transport);
}
