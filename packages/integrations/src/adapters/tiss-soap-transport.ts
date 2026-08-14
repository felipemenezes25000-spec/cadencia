import { createHash } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type Rfc3339,
} from '../contracts/common';
import type { TissTransportProvider } from '../contracts/tiss-transport';
import { serializeLoteXml, wrapInSoapEnvelope } from './tiss-xml';

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

function extractTagValue(xml: string, tagName: string): string | null {
  const re = new RegExp(`<[^>]*:?${tagName}[^>]*>([^<]+)</`, 'i');
  const m = xml.match(re);
  return m?.[1] ?? null;
}

export function createTissSoapTransportProvider(): TissTransportProvider {
  return {
    id: 'tiss-soap',
    capabilities: new Set(['residency:br', 'tiss_4.01']),
    safety: {
      enviarLote: 'idempotent',
      consultarProtocolo: 'safe',
    },

    async health() {
      return { up: true, latencyMs: 0, checkedAt: agora() };
    },

    async enviarLote(ctx: ProviderCtx, i) {
      const tissXml = serializeLoteXml(i.lote);
      const soapXml = wrapInSoapEnvelope(tissXml);
      const hashLote = createHash('md5').update(tissXml, 'utf-8').digest('hex');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ctx.deadlineMs);
      try {
        const res = await fetch(i.endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=UTF-8',
            'SOAPAction': 'tissLoteGuias',
            'User-Agent': 'cadencia/1.0',
          },
          body: soapXml,
          signal: controller.signal,
        });

        if (res.status >= 500) {
          return failure({ kind: 'unavailable', retrySafe: true,
            detail: `soap ${res.status}` });
        }

        const body = await res.text();

        if (!res.ok) {
          const faultString = extractTagValue(body, 'faultstring');
          return failure({ kind: 'rejected', retrySafe: false,
            code: `SOAP_${res.status}`,
            detail: faultString ?? `status ${res.status}` });
        }

        const protocolo = extractTagValue(body, 'numeroProtocolo')
          ?? extractTagValue(body, 'protocolo')
          ?? hashLote;

        return success({
          protocolo,
          dataRecebimento: agora(),
          hashLote,
        }, protocolo);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('abort')) {
          return failure({ kind: 'timeout', retrySafe: false,
            detail: `deadline ${ctx.deadlineMs}ms` });
        }
        return failure({ kind: 'unavailable', retrySafe: true, detail: msg });
      } finally {
        clearTimeout(timer);
      }
    },

    async consultarProtocolo(ctx: ProviderCtx, i) {
      const soapXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <tissConsultaProtocolo>
      <registroANS>${i.registroAns}</registroANS>
      <numeroProtocolo>${i.protocolo}</numeroProtocolo>
    </tissConsultaProtocolo>
  </soap:Body>
</soap:Envelope>`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ctx.deadlineMs);
      try {
        const res = await fetch(i.endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=UTF-8',
            'SOAPAction': 'tissConsultaProtocolo',
            'User-Agent': 'cadencia/1.0',
          },
          body: soapXml,
          signal: controller.signal,
        });

        if (res.status >= 500) {
          return failure({ kind: 'unavailable', retrySafe: true,
            detail: `soap ${res.status}` });
        }

        const body = await res.text();
        if (!res.ok) {
          const faultString = extractTagValue(body, 'faultstring');
          return failure({ kind: 'rejected', retrySafe: false,
            code: `SOAP_${res.status}`,
            detail: faultString ?? `status ${res.status}` });
        }

        const guiasAceitas = Number(extractTagValue(body, 'quantidadeGuiasAceitas') ?? '0');
        const guiasRejeitadas = Number(extractTagValue(body, 'quantidadeGuiasRejeitadas') ?? '0');

        let status: 'processando' | 'aceito' | 'rejeitado' | 'parcial';
        if (guiasRejeitadas === 0 && guiasAceitas > 0) status = 'aceito';
        else if (guiasAceitas === 0 && guiasRejeitadas > 0) status = 'rejeitado';
        else if (guiasAceitas > 0 && guiasRejeitadas > 0) status = 'parcial';
        else status = 'processando';

        return success({
          status,
          guiasAceitas,
          guiasRejeitadas,
          erros: [],
        }, i.protocolo);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('abort')) {
          return failure({ kind: 'timeout', retrySafe: false,
            detail: `deadline ${ctx.deadlineMs}ms` });
        }
        return failure({ kind: 'unavailable', retrySafe: true, detail: msg });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
