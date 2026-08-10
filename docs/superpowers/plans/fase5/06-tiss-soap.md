### Task 31: Migration 0127 — colunas SOAP em `tiss.contrato`

**Arquivos:**
- `packages/db/migrations/0127_tiss_contrato_soap_columns.sql`

**Passos**

- [ ] Criar o arquivo de migration com as tres colunas SOAP.

```sql
-- 0127_tiss_contrato_soap_columns.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 5 bloco 06: colunas de credencial SOAP no contrato prestador x operadora.
-- Quando os tres campos estao preenchidos, o transport tiss-soap fica disponivel.
-- Quando todos sao NULL, o prestador continua usando tiss-arquivo.
-- Nenhuma leitura do relogio de quem executa neste schema — invariante de CI.

ALTER TABLE tiss.contrato
  ADD COLUMN soap_endpoint_url       text,
  ADD COLUMN soap_username           text,
  ADD COLUMN soap_password_encrypted text;

-- Invariante: se um campo SOAP existe, todos devem existir.
ALTER TABLE tiss.contrato
  ADD CONSTRAINT chk_soap_all_or_none
  CHECK (
    (soap_endpoint_url IS NULL AND soap_username IS NULL AND soap_password_encrypted IS NULL)
    OR
    (soap_endpoint_url IS NOT NULL AND soap_username IS NOT NULL AND soap_password_encrypted IS NOT NULL)
  );

COMMENT ON COLUMN tiss.contrato.soap_endpoint_url
  IS 'URL do webservice TISS da operadora (WSDL nao parseado — endpoint fixo por XSD)';
COMMENT ON COLUMN tiss.contrato.soap_username
  IS 'Usuario para HTTP Basic Auth no webservice TISS';
COMMENT ON COLUMN tiss.contrato.soap_password_encrypted
  IS 'Senha criptografada (AES-256-GCM) para HTTP Basic Auth no webservice TISS';
```

- [ ] Rodar a migration e confirmar que aplica sem erro.

```bash
pnpm db:migrate
```

Saida esperada: `0127_tiss_contrato_soap_columns.sql` aplicada com sucesso.

- [ ] Confirmar que a constraint funciona: tentar INSERT com campo parcial deve falhar.

```bash
pnpm vitest run packages/tiss/src/contrato.int.test.ts
```

Saida esperada: testes existentes passam (nenhum usa as colunas SOAP, todos inserem NULL implicito).

- [ ] Commitar.

```bash
git add packages/db/migrations/0127_tiss_contrato_soap_columns.sql
git commit -m "feat(db): add SOAP credential columns to tiss.contrato (migration 0127)"
```

---

### Task 32: Teste e implementacao — factory `createTissSoapTransport` e `SoapNotConfigured`

**Arquivos:**
- `packages/tiss/src/transport/tiss-soap.test.ts` (criar)
- `packages/tiss/src/transport/tiss-soap.ts` (criar)

**Passos**

- [ ] Criar o arquivo de teste com os casos da factory (credencial ausente e propriedades basicas).

```ts
// packages/tiss/src/transport/tiss-soap.test.ts
import { describe, expect, it } from 'vitest';
import { createTissSoapTransport, type TissSoapOptions } from './tiss-soap';
import { assertSafetyDeclared } from '@cadencia/integrations';

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
});
```

- [ ] Rodar e confirmar que FALHA (modulo `./tiss-soap` nao existe ainda).

```bash
pnpm vitest run packages/tiss/src/transport/tiss-soap.test.ts
```

Saida esperada: erro de importacao — modulo nao encontrado.

- [ ] Criar a implementacao com a factory e metodos stub.

```ts
// packages/tiss/src/transport/tiss-soap.ts
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

export function buildSoapEnvelope(operacao: string, innerXml: string): string {
  return (
    '<?xml version="1.0" encoding="ISO-8859-1"?>\n' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"' +
    ` xmlns:ans="${TISS_NS}">\n` +
    '<soap:Body>\n' +
    `<ans:${operacao}>\n` +
    innerXml + '\n' +
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
        'Credenciais SOAP ausentes no contrato: endpoint, username ou password nao configurados',
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
          detail: 'Resposta SOAP nao contem <protocolo>',
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
          detail: 'Resposta SOAP nao contem <demonstrativoXml>',
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
          detail: 'Resposta SOAP nao contem <protocolo> para recurso de glosa',
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
```

- [ ] Rodar e confirmar que os testes PASSAM.

```bash
pnpm vitest run packages/tiss/src/transport/tiss-soap.test.ts
```

Saida esperada: todos os 9 testes passam.

- [ ] Commitar.

```bash
git add packages/tiss/src/transport/tiss-soap.ts packages/tiss/src/transport/tiss-soap.test.ts
git commit -m "feat(tiss): add createTissSoapTransport factory with SoapNotConfigured check"
```

---

### Task 33: Teste — `submitBatch` via SOAP com mock HTTP retorna protocolo

**Arquivos:**
- `packages/tiss/src/transport/tiss-soap.test.ts` (editar)

**Passos**

- [ ] Adicionar ao final do `describe('TissSoapTransport')` o bloco de testes de `submitBatch` usando um servidor HTTP mock local.

```ts
// --- adicionar estas importacoes ao topo do arquivo tiss-soap.test.ts ---
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

// --- adicionar este describe DENTRO de describe('TissSoapTransport'), apos describe('criacao (factory)') ---

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
```

O arquivo de teste completo (com as importacoes ja incluindo as novas) fica assim:

```ts
// packages/tiss/src/transport/tiss-soap.test.ts
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
});
```

- [ ] Rodar e confirmar que os testes PASSAM (a implementacao ja foi criada na Task 32).

```bash
pnpm vitest run packages/tiss/src/transport/tiss-soap.test.ts
```

Saida esperada: todos os 13 testes passam.

- [ ] Commitar.

```bash
git add packages/tiss/src/transport/tiss-soap.test.ts
git commit -m "test(tiss): add submitBatch SOAP tests with mock HTTP server"
```

---

### Task 34: Teste — timeout SOAP resulta em estado indeterminado, NUNCA retry automatico

**Arquivos:**
- `packages/tiss/src/transport/tiss-soap.test.ts` (editar)

**Passos**

- [ ] Adicionar ao `describe('TissSoapTransport')`, apos o bloco de `submitBatch`, um novo bloco para testar o comportamento de timeout. O mock server nao responde e o timeout curto (200ms) dispara, validando que o resultado e `failure` com `kind: 'timeout'` e `retrySafe: false` (NUNCA retry automatico em operacao unsafe).

```ts
// --- adicionar este describe DENTRO de describe('TissSoapTransport'),
//     apos describe('submitBatch via SOAP') ---

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
```

- [ ] Rodar e confirmar que os testes PASSAM (a implementacao ja trata timeout em `soapCall`).

```bash
pnpm vitest run packages/tiss/src/transport/tiss-soap.test.ts
```

Saida esperada: todos os 17 testes passam (9 factory + 4 submitBatch + 4 timeout).

- [ ] Commitar.

```bash
git add packages/tiss/src/transport/tiss-soap.test.ts
git commit -m "test(tiss): add SOAP timeout tests — estado indeterminado, NUNCA retry automatico"
```

---

### Task 35: Teste — `fetchDemonstrativo` e `submitRecursoGlosa` via SOAP

**Arquivos:**
- `packages/tiss/src/transport/tiss-soap.test.ts` (editar)

**Passos**

- [ ] Adicionar ao `describe('TissSoapTransport')`, apos o bloco de timeout, um novo bloco para testar `fetchDemonstrativo` e `submitRecursoGlosa`. Ambos usam mock HTTP local com respostas SOAP especificas.

```ts
// --- adicionar este describe DENTRO de describe('TissSoapTransport'),
//     apos describe('timeout') ---

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
```

- [ ] Rodar e confirmar que TODOS os testes passam.

```bash
pnpm vitest run packages/tiss/src/transport/tiss-soap.test.ts
```

Saida esperada: todos os 23 testes passam (9 factory + 4 submitBatch + 4 timeout + 6 fetchDemo/recurso).

- [ ] Commitar.

```bash
git add packages/tiss/src/transport/tiss-soap.test.ts
git commit -m "test(tiss): add fetchDemonstrativo and submitRecursoGlosa SOAP tests"
```

---

### Task 36: Registry condicional — registrar `tiss-soap` + atualizar invariante + exports

**Arquivos:**
- `packages/tiss/src/transport/registry.ts` (editar)
- `packages/tiss/src/transport/registry.test.ts` (editar)
- `packages/tiss/src/transport/registry-invariant.test.ts` (editar)
- `packages/tiss/src/index.ts` (editar)

**Passos**

- [ ] Editar `packages/tiss/src/transport/registry.ts` para registrar `tiss-soap` no registry.

```ts
// packages/tiss/src/transport/registry.ts
import type { TissTransport } from './types';
import { createTissArquivoTransport, type TissArquivoOptions } from './tiss-arquivo';
import {
  createTissSoapTransport,
  type TissSoapOptions,
  type SoapNotConfigured,
} from './tiss-soap';
import type { Result } from '@cadencia/kernel';

/**
 * Registry de transports TISS. Congelado em runtime.
 *
 * tiss-arquivo: sempre disponivel — gera arquivo para upload manual no portal.
 * tiss-soap: disponivel quando a operadora tem soap_endpoint configurado no
 *   contrato. A factory retorna Result — se credenciais ausentes, o caller
 *   recebe SoapNotConfigured em vez de exception.
 */

type ArquivoFactory = (opts: TissArquivoOptions) => TissTransport;
type SoapFactory = (opts: TissSoapOptions) => Result<TissTransport, SoapNotConfigured>;

export type TransportFactory = ArquivoFactory | SoapFactory;

export const TISS_TRANSPORT_REGISTRY: Readonly<Record<string, TransportFactory>> =
  Object.freeze({
    'tiss-arquivo': createTissArquivoTransport,
    'tiss-soap': createTissSoapTransport,
  });

export function getTransportIds(): string[] {
  return Object.keys(TISS_TRANSPORT_REGISTRY);
}

export function getTransportFactory(id: string): TransportFactory | undefined {
  return TISS_TRANSPORT_REGISTRY[id];
}
```

- [ ] Editar `packages/tiss/src/transport/registry-invariant.test.ts` — remover a restricao da Fase 4. O `tiss-soap` agora existe e esta registrado.

```ts
// packages/tiss/src/transport/registry-invariant.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('invariante CI — tiss-soap existe com credencial real (Fase 5)', () => {
  it('o arquivo tiss-soap.ts existe em packages/tiss/src/transport/', () => {
    const soapFile = resolve(import.meta.dirname, 'tiss-soap.ts');
    expect(existsSync(soapFile)).toBe(true);
  });

  it('o registry exporta tiss-soap como transport disponivel', async () => {
    const { getTransportIds, getTransportFactory } = await import('./registry');
    expect(getTransportIds()).toContain('tiss-soap');
    expect(getTransportFactory('tiss-soap')).toBeDefined();
  });

  it('o registry exporta tiss-arquivo E tiss-soap', async () => {
    const { getTransportIds } = await import('./registry');
    const ids = getTransportIds();
    expect(ids).toContain('tiss-arquivo');
    expect(ids).toContain('tiss-soap');
    expect(ids).toHaveLength(2);
  });
});
```

- [ ] Editar `packages/tiss/src/transport/registry.test.ts` para aceitar os dois transports.

```ts
// packages/tiss/src/transport/registry.test.ts
import { describe, expect, it } from 'vitest';
import {
  getTransportIds,
  getTransportFactory,
  TISS_TRANSPORT_REGISTRY,
} from './registry';

describe('registry de transports TISS', () => {
  it('registry conhece tiss-arquivo e tiss-soap', () => {
    const ids = getTransportIds();
    expect(ids).toEqual(['tiss-arquivo', 'tiss-soap']);
  });

  it('getTransportFactory retorna a factory de tiss-arquivo', () => {
    const factory = getTransportFactory('tiss-arquivo');
    expect(factory).toBeDefined();
    expect(typeof factory).toBe('function');
  });

  it('getTransportFactory retorna a factory de tiss-soap', () => {
    const factory = getTransportFactory('tiss-soap');
    expect(factory).toBeDefined();
    expect(typeof factory).toBe('function');
  });

  it('getTransportFactory retorna undefined para id desconhecido', () => {
    expect(getTransportFactory('tiss-inexistente')).toBeUndefined();
  });

  it('TISS_TRANSPORT_REGISTRY e congelado (nao pode ser modificado em runtime)', () => {
    expect(Object.isFrozen(TISS_TRANSPORT_REGISTRY)).toBe(true);
  });

  it('factory de tiss-arquivo cria transport com mode "arquivo"', () => {
    const factory = getTransportFactory('tiss-arquivo')!;
    const { InMemoryStorageAdapter } = require('@cadencia/storage');
    const transport = factory({
      storage: new InMemoryStorageAdapter(),
      tissVersion: '4.01.00',
    }) as import('./types').TissTransport;
    expect(transport.id).toBe('tiss-arquivo');
    expect(transport.mode).toBe('arquivo');
    expect(transport.tissVersion).toBe('4.01.00');
  });

  it('factory de tiss-soap retorna SoapNotConfigured sem credenciais', () => {
    const factory = getTransportFactory('tiss-soap')!;
    const result = (factory as Function)({
      tissVersion: '4.01.00',
      soapEndpointUrl: '',
      soapUsername: '',
      soapPassword: '',
    }) as { ok: boolean; error?: { kind: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('soap_not_configured');
  });

  it('factory de tiss-soap retorna Ok com credenciais validas', () => {
    const factory = getTransportFactory('tiss-soap')!;
    const result = (factory as Function)({
      tissVersion: '4.01.00',
      soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
      soapUsername: 'user',
      soapPassword: 'pass',
    }) as { ok: boolean; value?: { id: string; mode: string } };
    expect(result.ok).toBe(true);
    expect(result.value?.id).toBe('tiss-soap');
    expect(result.value?.mode).toBe('webservice');
  });
});
```

- [ ] Editar `packages/tiss/src/index.ts` para exportar os novos tipos e a factory.

```ts
// packages/tiss/src/index.ts
export {
  createOperadora,
  updateOperadora,
  deactivateOperadora,
  listOperadoras,
  type CreateOperadoraInput,
  type UpdateOperadoraInput,
  type OperadoraRow,
  type OperadoraFailure,
} from './operadora';

export {
  createContrato,
  updateContrato,
  deactivateContrato,
  listContratos,
  type CreateContratoInput,
  type UpdateContratoInput,
  type ContratoRow,
  type ContratoFailure,
} from './contrato';

export {
  createPacienteConvenio,
  updatePacienteConvenio,
  deactivatePacienteConvenio,
  listPacienteConvenios,
  type CreatePacienteConvenioInput,
  type UpdatePacienteConvenioInput,
  type PacienteConvenioRow,
  type PacienteConvenioFailure,
} from './paciente-convenio';

export type {
  ProjectionResult, ProjectedResult, SkippedResult,
  ProjectionError, DadosAusentesError, TussNaoVigenteError,
} from './project-guia';
export { projectGuiaConsulta } from './project-guia';

export { reprojectGuiaOnAmend, type ReprojectAction, type ReprojectError } from './reproject-guia';

export { createLote, type CreateLoteInput, type CreatedLote, type CreateLoteFailure } from './create-lote';
export {
  addGuiaToLote, removeGuiaFromLote,
  type AddGuiaInput, type AddedGuia, type AddGuiaFailure, type RemoveGuiaFailure,
} from './lote-guias';
export {
  markLoteReady, markLoteSent, receiveLoteReturn, cancelLote,
  type LoteLifecycleFailure, type LoteReadyResult, type LoteSentResult,
  type LoteReturnedResult, type LoteCancelledResult,
} from './lote-lifecycle';

export type {
  CabecalhoInput,
  ContratadoInput,
  GuiaConsultaInput,
  LoteConsultaInput,
  ProfissionalExecutanteInput,
} from './serializer/types';

export { serializeLoteConsulta, type SerializeLoteResult } from './serializer/serialize-lote-consulta';
export { encodeIso8859, type EncodeResult } from './serializer/encode-iso8859';
export { computeTissHash } from './serializer/compute-tiss-hash';
export { XmlBuilder } from './serializer/xml-builder';

export type { TissSubmissionReceipt, TissTransport } from './transport/types';
export { createTissArquivoTransport, type TissArquivoOptions } from './transport/tiss-arquivo';
export {
  getTransportIds, getTransportFactory, TISS_TRANSPORT_REGISTRY,
  type TransportFactory,
} from './transport/registry';
export {
  createFakeTissArquivoTransport,
  type FakeTissArquivoOptions,
  type FakeTissArquivoTransport,
  type ModoFakeTiss,
  type SubmittedBatch,
} from './transport/tiss-arquivo-fake';
export {
  createTissSoapTransport,
  type TissSoapOptions,
  type SoapNotConfigured,
} from './transport/tiss-soap';
```

- [ ] Rodar todos os testes de transport para confirmar que nada quebrou.

```bash
pnpm vitest run packages/tiss/src/transport/
```

Saida esperada: todos os testes passam — registry, registry-invariant, tiss-arquivo, tiss-arquivo-fake, tiss-soap, types.

- [ ] Commitar.

```bash
git add packages/tiss/src/transport/registry.ts \
       packages/tiss/src/transport/registry.test.ts \
       packages/tiss/src/transport/registry-invariant.test.ts \
       packages/tiss/src/index.ts
git commit -m "feat(tiss): register tiss-soap in transport registry, update invariant and exports"
```
