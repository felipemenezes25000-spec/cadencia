import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createTissSoapTransport, type TissSoapOptions } from './tiss-soap';
import type { ProviderCtx } from '@cadencia/integrations';
import { assertSafetyDeclared } from '@cadencia/integrations';

const ctx: ProviderCtx = {
  tenantId: 'tenant-soap-001',
  actorUserId: 'user-soap-001',
  requestId: 'req-soap-001',
  idempotencyKey: 'idem-soap-001',
  deadlineMs: 10_000,
};

describe('TissSoapTransport', () => {
  describe('criacao (factory)', () => {
    it('retorna SoapNotConfigured se soapEndpointUrl ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: '',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured se soapUsername ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://example.com/tiss',
        soapUsername: '',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured se soapPassword ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://example.com/tiss',
        soapUsername: 'user',
        soapPassword: '',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured com detail descritivo', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: '',
        soapUsername: '',
        soapPassword: '',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.detail).toContain('SOAP');
    });

    it('retorna Ok com transport valido quando credenciais presentes', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
    });

    it('transport tem id "tiss-soap" e mode "webservice"', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe('tiss-soap');
      expect(result.value.mode).toBe('webservice');
    });

    it('tissVersion reflete o valor passado', () => {
      const result = createTissSoapTransport({
        tissVersion: '3.05.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tissVersion).toBe('3.05.00');
    });

    it('safety declara os tres metodos publicos', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(assertSafetyDeclared(
        result.value,
        ['submitBatch', 'fetchDemonstrativo', 'submitRecursoGlosa'],
      )).toBe(true);
    });

    it('capabilities inclui residency:br e tiss-soap', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.capabilities.has('residency:br')).toBe(true);
      expect(result.value.capabilities.has('tiss-soap')).toBe(true);
    });

    it('health retorna up: true', async () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const h = await result.value.health();
      expect(h.up).toBe(true);
      expect(h.checkedAt).toBeDefined();
    });
  });

  describe('submitBatch via SOAP', () => {
    let server: Server;
    let port: number;
    let handler: (req: IncomingMessage, res: ServerResponse) => void;

    beforeAll(async () => {
      server = createServer((req, res) => handler(req, res));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as { port: number }).port;
    });

    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    function readBody(req: IncomingMessage): Promise<string> {
      return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
      });
    }

    function soapOpts(): TissSoapOptions {
      return {
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'operadora_user',
        soapPassword: 'operadora_pass',
        timeoutMs: 5_000,
      };
    }

    it('submitBatch envia envelope SOAP e extrai protocolo da resposta', async () => {
      handler = async (req, res) => {
        const body = await readBody(req);
        expect(body).toContain('soap:Envelope');
        expect(body).toContain('tissFaturamentoWS');
        expect(req.headers['soapaction']).toBe('tissFaturamentoWS');
        expect(req.headers['authorization']).toContain('Basic ');
        expect(req.headers['content-type']).toContain('ISO-8859-1');

        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<protocoloRecebimento>' +
          '<protocolo>PROT-2026-001</protocolo>' +
          '<dataRecebimento>2026-08-07T10:30:00.000Z</dataRecebimento>' +
          '</protocoloRecebimento>' +
          '</soap:Body>' +
          '</soap:Envelope>';

        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const transport = r.value;

      const xml = new TextEncoder().encode('<loteGuias>conteudo SOAP</loteGuias>');
      const result = await transport.submitBatch(ctx, {
        loteId: 'lote-soap-001',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('protocolo');
      if (result.value.kind !== 'protocolo') return;
      expect(result.value.protocolo).toBe('PROT-2026-001');
      expect(result.value.recebidoEm).toBe('2026-08-07T10:30:00.000Z');
    });

    it('submitBatch retorna rejected quando SOAP Fault', async () => {
      handler = (_req, res) => {
        const faultXml =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<soap:Fault>' +
          '<faultcode>soap:Server</faultcode>' +
          '<faultstring>Lote rejeitado: duplicidade de protocolo</faultstring>' +
          '</soap:Fault>' +
          '</soap:Body>' +
          '</soap:Envelope>';

        res.writeHead(500, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(faultXml);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>lote duplicado</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-soap-dup',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('soap:Server');
      expect(result.error.detail).toContain('duplicidade');
    });

    it('submitBatch retorna unavailable quando HTTP 503', async () => {
      handler = (_req, res) => {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>lote 503</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-soap-503',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('unavailable');
      expect(result.error.retrySafe).toBe(true);
    });

    it('submitBatch retorna rejected quando resposta nao contem protocolo', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body><vazio/></soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>sem protocolo</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-soap-sem-prot',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('PROTOCOLO_AUSENTE');
    });
  });

  describe('timeout — estado indeterminado, NUNCA retry (secao 7)', () => {
    let server: Server;
    let port: number;

    beforeAll(async () => {
      server = createServer((_req, _res) => {
        // Proposital: nunca responde. Conexao fica aberta ate timeout.
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as { port: number }).port;
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    });

    it('submitBatch com timeout curto retorna failure kind "timeout"', async () => {
      const r = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'user',
        soapPassword: 'pass',
        timeoutMs: 200,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>timeout test</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-timeout',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('timeout');
      expect(result.error.detail).toContain('timeout');
    }, 10_000);

    it('timeout tem retrySafe: false — NUNCA retry automatico em operacao unsafe', async () => {
      const r = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'user',
        soapPassword: 'pass',
        timeoutMs: 200,
      });
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>no retry</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-no-retry',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('timeout');
      // A regra mais cara do documento: timeout em operacao unsafe NAO permite retry.
      // retrySafe: false garante que o caller sabe que NAO pode reenviar.
      expect(result.error.retrySafe).toBe(false);
    }, 10_000);

    it('submitRecursoGlosa com timeout tambem retorna retrySafe: false', async () => {
      const r = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'user',
        soapPassword: 'pass',
        timeoutMs: 200,
      });
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<recurso>timeout glosa</recurso>');
      const result = await r.value.submitRecursoGlosa(ctx, {
        recursoId: 'rec-timeout',
        xml,
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('timeout');
      expect(result.error.retrySafe).toBe(false);
    }, 10_000);

    it('deadline mais curto que timeoutMs prevalece', async () => {
      const shortDeadlineCtx: ProviderCtx = {
        ...ctx,
        deadlineMs: 150, // menor que timeoutMs=5000
      };

      const r = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'user',
        soapPassword: 'pass',
        timeoutMs: 5_000,
      });
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>deadline curto</loteGuias>');
      const result = await r.value.submitBatch(shortDeadlineCtx, {
        loteId: 'lote-deadline',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('timeout');
    }, 10_000);
  });

  describe('fetchDemonstrativo e submitRecursoGlosa via SOAP', () => {
    let server: Server;
    let port: number;
    let handler: (req: IncomingMessage, res: ServerResponse) => void;

    beforeAll(async () => {
      server = createServer((req, res) => handler(req, res));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as { port: number }).port;
    });

    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    function soapOpts(): TissSoapOptions {
      return {
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'user',
        soapPassword: 'pass',
        timeoutMs: 5_000,
      };
    }

    it('fetchDemonstrativo extrai XML e kind "analise" da resposta SOAP', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<tissSolicitacaoDemonstrativoRetornoResponse>' +
          '<tipoDemonstrativo>analise</tipoDemonstrativo>' +
          '<demonstrativoXml>conteudo-demonstrativo-xml</demonstrativoXml>' +
          '</tissSolicitacaoDemonstrativoRetornoResponse>' +
          '</soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const result = await r.value.fetchDemonstrativo(ctx, {
        protocolo: 'PROT-2026-001',
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('analise');
      const xmlText = Buffer.from(result.value.xml).toString('latin1');
      expect(xmlText).toBe('conteudo-demonstrativo-xml');
    });

    it('fetchDemonstrativo extrai kind "pagamento" quando indicado', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<tissSolicitacaoDemonstrativoRetornoResponse>' +
          '<tipoDemonstrativo>pagamento</tipoDemonstrativo>' +
          '<demonstrativoXml>demonstrativo-pago</demonstrativoXml>' +
          '</tissSolicitacaoDemonstrativoRetornoResponse>' +
          '</soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const result = await r.value.fetchDemonstrativo(ctx, {
        protocolo: 'PROT-2026-002',
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('pagamento');
    });

    it('fetchDemonstrativo retorna rejected quando demonstrativoXml ausente', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body><vazio/></soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const result = await r.value.fetchDemonstrativo(ctx, {
        protocolo: 'PROT-VAZIO',
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('DEMONSTRATIVO_AUSENTE');
    });

    it('submitRecursoGlosa envia XML e extrai protocolo da resposta', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<tissRecursoGlosaResponse>' +
          '<protocolo>REC-PROT-001</protocolo>' +
          '<dataRecebimento>2026-08-08T14:00:00.000Z</dataRecebimento>' +
          '</tissRecursoGlosaResponse>' +
          '</soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<recursoGlosa>dados do recurso</recursoGlosa>');
      const result = await r.value.submitRecursoGlosa(ctx, {
        recursoId: 'rec-glosa-001',
        xml,
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('protocolo');
      if (result.value.kind !== 'protocolo') return;
      expect(result.value.protocolo).toBe('REC-PROT-001');
      expect(result.value.recebidoEm).toBe('2026-08-08T14:00:00.000Z');
    });

    it('submitRecursoGlosa retorna rejected quando protocolo ausente', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body><semProtocolo/></soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<recurso>sem resposta</recurso>');
      const result = await r.value.submitRecursoGlosa(ctx, {
        recursoId: 'rec-glosa-sem',
        xml,
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('PROTOCOLO_AUSENTE');
    });

    it('submitRecursoGlosa retorna rejected quando SOAP Fault', async () => {
      handler = (_req, res) => {
        const faultXml =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<soap:Fault>' +
          '<faultcode>soap:Client</faultcode>' +
          '<faultstring>Recurso de glosa nao pertence ao prestador</faultstring>' +
          '</soap:Fault>' +
          '</soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(500, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(faultXml);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<recurso>glosa invalida</recurso>');
      const result = await r.value.submitRecursoGlosa(ctx, {
        recursoId: 'rec-fault',
        xml,
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('soap:Client');
      expect(result.error.detail).toContain('nao pertence');
    });
  });
});
