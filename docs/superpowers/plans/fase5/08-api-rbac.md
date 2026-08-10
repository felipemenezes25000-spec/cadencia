### Task 45: Acoes RBAC para demonstrativo, glosa e recurso no catalogo de autorizacao

**Arquivos**
- Modificar: `packages/authz/src/actions.ts`
- Criar: `packages/authz/src/actions-fase5.test.ts`

**Passos**

- [ ] Escrever o teste que valida as 6 novas acoes da Fase 5:

```ts
// packages/authz/src/actions-fase5.test.ts
import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('acoes TISS Fase 5 (demonstrativo, glosa, recurso)', () => {
  const fase5Keys = [
    'tiss.demonstrativo.import',
    'tiss.demonstrativo.read',
    'tiss.glosa.read',
    'tiss.glosa.manage',
    'tiss.recurso.manage',
    'tiss.recurso.send',
  ];

  it.each(fase5Keys)('acao "%s" existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('tiss.demonstrativo.import so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.demonstrativo.import')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('profissional');
    expect(action.roles).not.toContain('recepcao');
  });

  it('tiss.demonstrativo.read permite admin_clinico, diretor_tecnico, financeiro e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.demonstrativo.read')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('diretor_tecnico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.glosa.read permite admin_clinico, diretor_tecnico, financeiro e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.glosa.read')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('diretor_tecnico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.glosa.manage so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.glosa.manage')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.recurso.manage so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.recurso.manage')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.recurso.send so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.recurso.send')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('nenhuma acao Fase 5 TISS exige MFA', () => {
    for (const key of fase5Keys) {
      const action = ACTION_BY_KEY.get(key)!;
      expect(action.requiresMfa).toBeUndefined();
    }
  });

  it('nenhuma chave duplicada no catalogo', () => {
    const keys = ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/authz/src/actions-fase5.test.ts
# ESPERADO: FAIL — acao "tiss.demonstrativo.import" nao existe no catalogo
```

- [ ] Adicionar as 6 acoes ao catalogo. Em `packages/authz/src/actions.ts`, inserir antes do `] as const satisfies readonly ActionDef[];`:

```ts
  // ── Fase 5 · Demonstrativo, glosa e recurso ──────────────────────────
  { key: 'tiss.demonstrativo.import', description: 'Importar demonstrativo XML da operadora',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.demonstrativo.read', description: 'Listar e visualizar demonstrativos de retorno',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro', 'recepcao'] },
  { key: 'tiss.glosa.read', description: 'Listar e visualizar glosas',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro', 'recepcao'] },
  { key: 'tiss.glosa.manage', description: 'Aceitar glosa individual',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.recurso.manage', description: 'Criar, montar e gerenciar recursos de glosa',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.recurso.send', description: 'Enviar recurso de glosa para operadora',
    roles: ['admin_clinico', 'financeiro'] },
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/authz/src/actions-fase5.test.ts
# ESPERADO: PASS — todas as 9 assercoes verdes
```

- [ ] Commitar:

```bash
git add packages/authz/src/actions.ts packages/authz/src/actions-fase5.test.ts
git commit -m "feat(authz): add Fase 5 RBAC actions for demonstrativo, glosa and recurso

Add tiss.demonstrativo.import, tiss.demonstrativo.read,
tiss.glosa.read, tiss.glosa.manage, tiss.recurso.manage
and tiss.recurso.send to the action catalog.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 46: Rotas de demonstrativos TISS (importar XML multipart, listar, detalhe)

**Arquivos**
- Criar: `apps/api/src/routes/tiss/demonstrativos.ts`
- Criar: `apps/api/src/routes/tiss/demonstrativos.int.test.ts`
- Modificar: `apps/api/src/app.ts` (registrar plugin)

**Passos**

- [ ] Instalar dependencia de multipart:

```bash
pnpm add @fastify/multipart --filter @cadencia/api
```

- [ ] Escrever o teste de integracao:

```ts
// apps/api/src/routes/tiss/demonstrativos.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let recepcao: SementeSessao;
let medico: SementeSessao;
let operadoraId: string;
let demoIdSeed: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

function buildMinimalDemonstrativoXml(protocolo: string): string {
  return [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
    '<ans:cabecalho>',
    '<ans:identificacaoTransacao>',
    '<ans:tipoTransacao>DEMONSTRATIVO_RETORNO</ans:tipoTransacao>',
    '</ans:identificacaoTransacao>',
    '</ans:cabecalho>',
    '<ans:operacaoANS>',
    '<ans:demonstrativoRetorno>',
    '<ans:demonstrativoAnalise>',
    '<ans:cabecalhoDemonstrativo>',
    `<ans:numeroDemonstrativo>${protocolo}</ans:numeroDemonstrativo>`,
    '</ans:cabecalhoDemonstrativo>',
    '<ans:relacaoGuias>',
    '<ans:guia>',
    '<ans:dadosGuia>',
    '<ans:numeroGuiaPrestador>GP-00001</ans:numeroGuiaPrestador>',
    '</ans:dadosGuia>',
    '<ans:procedimentosRealizados>',
    '<ans:procedimento>',
    '<ans:codigoProcedimento>10101012</ans:codigoProcedimento>',
    '<ans:valorInformado>150.00</ans:valorInformado>',
    '<ans:valorProcessado>120.00</ans:valorProcessado>',
    '<ans:valorGlosa>30.00</ans:valorGlosa>',
    '<ans:codigoGlosa>1005</ans:codigoGlosa>',
    '</ans:procedimento>',
    '</ans:procedimentosRealizados>',
    '</ans:guia>',
    '</ans:relacaoGuias>',
    '</ans:demonstrativoAnalise>',
    '</ans:demonstrativoRetorno>',
    '</ans:operacaoANS>',
    '</ans:mensagemTISS>',
  ].join('\n');
}

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });
  recepcao = await semearSessao({ role: 'recepcao' });
  medico = await semearSessao({ role: 'profissional' });

  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, active, created_by)
       VALUES ($1, $2, '339679', 'Op Demo', '11111111000190', '3.05',
               'arquivo', true, $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    // Semear demonstrativo para teste de listagem e detalhe
    demoIdSeed = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, protocolo, tipo, data_emissao,
          total_informado_cents, total_processado_cents, total_glosa_cents,
          item_count, imported_by)
       VALUES ($1, $2, $3, 'PROTO-SEED', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               15000, 12000, 3000, 1, $4)`,
      [admin.tenantId, demoIdSeed, operadoraId, admin.userId]);

    const itemId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, codigo_glosa, status, aceite)
       VALUES ($1, $2, $3, 'GP-SEED-001',
               '10101012', 15000, 12000, 3000, '1005',
               'glosado_parcial', 'pendente')`,
      [admin.tenantId, itemId, demoIdSeed]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
});
afterAll(async () => { await closePools(); });

describe('rotas de demonstrativos TISS', () => {
  let demoIdImported: string;

  it('POST /v1/tiss/demonstrativos/importar importa XML via multipart', async () => {
    const app = await buildApp();
    const boundary = '----TestBoundary7MA4YWxkTrZu0gW';
    const xmlContent = buildMinimalDemonstrativoXml('PROTO-IMP-001');
    const payload = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="operadoraId"',
      '',
      operadoraId,
      `--${boundary}`,
      'Content-Disposition: form-data; name="xml"; filename="demo.xml"',
      'Content-Type: application/xml',
      '',
      xmlContent,
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const r = await app.inject({
      method: 'POST',
      url: '/v1/tiss/demonstrativos/importar',
      headers: {
        ...auth(admin).headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      cookies: auth(admin).cookies,
      payload,
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { demonstrativoId: string; itemCount: number };
    expect(body.demonstrativoId).toBeTruthy();
    expect(body.itemCount).toBe(1);
    demoIdImported = body.demonstrativoId;
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('GET /v1/tiss/demonstrativos lista demonstrativos do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      itens: Array<{ demonstrativoId: string; protocolo: string }>;
      nextCursor: string | null;
    };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    expect(body.itens.some((d) => d.demonstrativoId === demoIdSeed)).toBe(true);
    await app.close();
  });

  it('GET /v1/tiss/demonstrativos/:id detalhe com itens', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/demonstrativos/${demoIdSeed}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      demonstrativoId: string;
      protocolo: string;
      itens: Array<{ itemId: string; codigoGlosa: string | null }>;
    };
    expect(body.demonstrativoId).toBe(demoIdSeed);
    expect(body.protocolo).toBe('PROTO-SEED');
    expect(body.itens.length).toBe(1);
    expect(body.itens[0]!.codigoGlosa).toBe('1005');
    await app.close();
  });

  it('recepcao le demonstrativos com tiss.demonstrativo.read', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(recepcao),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('recepcao recebe 403 ao tentar importar demonstrativo', async () => {
    const app = await buildApp();
    const boundary = '----TestBoundary';
    const payload = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="operadoraId"',
      '',
      operadoraId,
      `--${boundary}`,
      'Content-Disposition: form-data; name="xml"; filename="demo.xml"',
      'Content-Type: application/xml',
      '',
      '<?xml version="1.0"?><dummy/>',
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const r = await app.inject({
      method: 'POST',
      url: '/v1/tiss/demonstrativos/importar',
      headers: {
        ...auth(recepcao).headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      cookies: auth(recepcao).cookies,
      payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('medico recebe 403 ao tentar listar demonstrativos', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(medico),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/demonstrativos.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado / rota nao existe
```

- [ ] Criar o arquivo de rotas:

```ts
// apps/api/src/routes/tiss/demonstrativos.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';
import { comTransacao } from '../../context';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

// ---------------------------------------------------------------------------
// Parser minimo de demonstrativo TISS XML
// ---------------------------------------------------------------------------

interface DemoParsedItem {
  numeroGuiaPrestador: string;
  codigoProcedimento: string;
  valorInformadoCents: number;
  valorProcessadoCents: number;
  valorGlosaCents: number;
  codigoGlosa: string | null;
}

interface DemoParsed {
  protocolo: string;
  tipo: 'analise' | 'pagamento';
  itens: DemoParsedItem[];
}

function tagValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:ans:)?${tag}>([^<]*)<\\/(?:ans:)?${tag}>`);
  const m = xml.match(re);
  return m ? m[1]! : null;
}

function realToCents(val: string | null): number {
  if (val === null || val === '') return 0;
  return Math.round(Number(val.replace(',', '.')) * 100);
}

function parseDemonstrativoXml(xmlBytes: Buffer): DemoParsed {
  const xml = new TextDecoder('iso-8859-1').decode(xmlBytes);

  const protocolo = tagValue(xml, 'numeroDemonstrativo') ?? '';
  if (protocolo === '') erroDominio('xml_protocolo_ausente', 422);

  const tipo: 'analise' | 'pagamento' =
    xml.includes('demonstrativoAnalise') ? 'analise' : 'pagamento';

  // Extrair blocos de guia
  const guiaRegex = /<(?:ans:)?guia>([\s\S]*?)<\/(?:ans:)?guia>/g;
  const itens: DemoParsedItem[] = [];

  let guiaMatch: RegExpExecArray | null;
  while ((guiaMatch = guiaRegex.exec(xml)) !== null) {
    const guiaBlock = guiaMatch[1]!;
    const nrGuia = tagValue(guiaBlock, 'numeroGuiaPrestador') ?? '';

    // Extrair procedimentos dentro da guia
    const procRegex =
      /<(?:ans:)?procedimento>([\s\S]*?)<\/(?:ans:)?procedimento>/g;
    let procMatch: RegExpExecArray | null;
    while ((procMatch = procRegex.exec(guiaBlock)) !== null) {
      const pb = procMatch[1]!;
      itens.push({
        numeroGuiaPrestador: nrGuia,
        codigoProcedimento: tagValue(pb, 'codigoProcedimento') ?? '',
        valorInformadoCents: realToCents(tagValue(pb, 'valorInformado')),
        valorProcessadoCents: realToCents(tagValue(pb, 'valorProcessado')),
        valorGlosaCents: realToCents(tagValue(pb, 'valorGlosa')),
        codigoGlosa: tagValue(pb, 'codigoGlosa'),
      });
    }
  }

  return { protocolo, tipo, itens };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const DemoResumoSchema = z.object({
  demonstrativoId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  protocolo: z.string(),
  tipo: z.enum(['analise', 'pagamento']),
  dataEmissao: z.string(),
  totalInformadoCents: z.number().int(),
  totalProcessadoCents: z.number().int(),
  totalGlosaCents: z.number().int(),
  itemCount: z.number().int(),
  createdAt: z.string(),
});

const DemoItemSchema = z.object({
  itemId: z.string().uuid(),
  numeroGuiaPrestador: z.string(),
  codigoProcedimento: z.string(),
  valorInformadoCents: z.number().int(),
  valorProcessadoCents: z.number().int(),
  valorGlosaCents: z.number().int(),
  codigoGlosa: z.string().nullable(),
  status: z.string(),
  aceite: z.string(),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function demonstrativoRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/tiss/demonstrativos/importar — multipart upload ──────────
  r.post('/v1/tiss/demonstrativos/importar', {
    schema: {
      response: {
        201: z.object({
          demonstrativoId: z.string().uuid(),
          itemCount: z.number().int(),
        }),
      },
    },
  }, async (req, reply) => {
    // Extrair campos do multipart
    let xmlBuffer: Buffer | undefined;
    let operadoraIdField: string | undefined;
    const parts = req.parts();

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'xml') {
        xmlBuffer = await part.toBuffer();
      } else if (part.type === 'field' && part.fieldname === 'operadoraId') {
        operadoraIdField = String(part.value);
      }
    }

    if (xmlBuffer === undefined || xmlBuffer.length === 0) {
      erroDominio('xml_ausente', 400);
    }
    if (operadoraIdField === undefined || operadoraIdField === '') {
      erroDominio('operadora_id_ausente', 400);
    }

    const parsed = parseDemonstrativoXml(xmlBuffer);
    const capturedXml = xmlBuffer;
    const capturedOpId = operadoraIdField;

    // Delegar ao guard de RBAC + transacao
    const handler = rota('tiss.demonstrativo.import', async (tx, _ctx) => {
      // Verificar que a operadora existe
      const { rowCount: opExiste } = await tx.query(
        `SELECT 1 FROM tiss.operadora WHERE id = $1 AND active = true`,
        [capturedOpId]);
      if (opExiste === 0) erroDominio('operadora_nao_encontrada', 404);

      const demoId = uuidv7();
      let totalInf = 0;
      let totalProc = 0;
      let totalGlosa = 0;

      for (const item of parsed.itens) {
        totalInf += item.valorInformadoCents;
        totalProc += item.valorProcessadoCents;
        totalGlosa += item.valorGlosaCents;
      }

      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, protocolo, tipo, data_emissao,
            total_informado_cents, total_processado_cents, total_glosa_cents,
            item_count, imported_by)
         VALUES ($1, $2, $3, $4,
                 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
                 $5, $6, $7, $8, app.current_user_id())`,
        [demoId, capturedOpId, parsed.protocolo, parsed.tipo,
         totalInf, totalProc, totalGlosa, parsed.itens.length]);

      // Inserir itens
      for (const item of parsed.itens) {
        const itemStatus = item.valorGlosaCents > 0
          ? (item.valorProcessadoCents === 0 ? 'glosado_total' : 'glosado_parcial')
          : 'pago';

        await tx.query(
          `INSERT INTO tiss.demonstrativo_item
             (id, demonstrativo_id, numero_guia_prestador,
              codigo_procedimento, valor_informado_cents, valor_processado_cents,
              valor_glosa_cents, codigo_glosa, status, aceite)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendente')`,
          [uuidv7(), demoId, item.numeroGuiaPrestador,
           item.codigoProcedimento, item.valorInformadoCents,
           item.valorProcessadoCents, item.valorGlosaCents,
           item.codigoGlosa, itemStatus]);
      }

      // Auditoria
      await tx.query(
        `SELECT audit.log('TISS_DEMO_IMPORT', 'tiss', 'demonstrativo', $1,
                'sucesso',
                jsonb_build_object('protocolo', $2::text,
                                   'item_count', $3::int), $4)`,
        [demoId, parsed.protocolo, parsed.itens.length,
         _ctx.actor.clinicId]);

      void reply.code(201);
      return { demonstrativoId: demoId, itemCount: parsed.itens.length };
    });

    return handler(req, reply);
  });

  // ── GET /v1/tiss/demonstrativos — listar com paginacao ────────────────
  r.get('/v1/tiss/demonstrativos', {
    schema: {
      querystring: z.object({
        operadoraId: z.string().uuid().optional(),
        tipo: z.enum(['analise', 'pagamento']).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(DemoResumoSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('tiss.demonstrativo.read', async (tx, _ctx, req) => {
    const q = req.query as {
      operadoraId?: string; tipo?: string;
      limit?: number; cursor?: string;
    };
    const limite = q.limit ?? 25;
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.operadoraId !== undefined) {
      condicoes.push(`d.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }
    if (q.tipo !== undefined) {
      condicoes.push(`d.tipo = $${idx}`);
      params.push(q.tipo); idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`d.created_at < $${idx}::timestamptz`);
      params.push(q.cursor); idx += 1;
    }

    params.push(limite + 1);
    const where = condicoes.length > 0
      ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      protocolo: string; tipo: string; data_emissao: string;
      total_informado_cents: string; total_processado_cents: string;
      total_glosa_cents: string; item_count: number; created_at: string;
    }>(
      `SELECT d.id, d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo, d.tipo, d.data_emissao::text,
              d.total_informado_cents::text, d.total_processado_cents::text,
              d.total_glosa_cents::text, d.item_count,
              to_char(d.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.demonstrativo d
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
         ${where}
        ORDER BY d.created_at DESC
        LIMIT $${idx}`,
      params);

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      demonstrativoId: row.id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      protocolo: row.protocolo,
      tipo: row.tipo as 'analise' | 'pagamento',
      dataEmissao: row.data_emissao,
      totalInformadoCents: Number(row.total_informado_cents),
      totalProcessadoCents: Number(row.total_processado_cents),
      totalGlosaCents: Number(row.total_glosa_cents),
      itemCount: row.item_count,
      createdAt: row.created_at,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt : null;

    return { itens, nextCursor };
  }));

  // ── GET /v1/tiss/demonstrativos/:id — detalhe com itens ───────────────
  r.get('/v1/tiss/demonstrativos/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: DemoResumoSchema.extend({
          itens: z.array(DemoItemSchema),
        }),
      },
    },
  }, rota('tiss.demonstrativo.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      protocolo: string; tipo: string; data_emissao: string;
      total_informado_cents: string; total_processado_cents: string;
      total_glosa_cents: string; item_count: number; created_at: string;
    }>(
      `SELECT d.id, d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo, d.tipo, d.data_emissao::text,
              d.total_informado_cents::text, d.total_processado_cents::text,
              d.total_glosa_cents::text, d.item_count,
              to_char(d.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.demonstrativo d
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
        WHERE d.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('demonstrativo_nao_encontrado', 404);
    const demo = rows[0]!;

    const { rows: itemRows } = await tx.query<{
      id: string; numero_guia_prestador: string; codigo_procedimento: string;
      valor_informado_cents: string; valor_processado_cents: string;
      valor_glosa_cents: string; codigo_glosa: string | null;
      status: string; aceite: string;
    }>(
      `SELECT id, numero_guia_prestador, codigo_procedimento,
              valor_informado_cents::text, valor_processado_cents::text,
              valor_glosa_cents::text, codigo_glosa, status, aceite
         FROM tiss.demonstrativo_item
        WHERE demonstrativo_id = $1
        ORDER BY created_at`,
      [p.id]);

    return {
      demonstrativoId: demo.id,
      operadoraId: demo.operadora_id,
      operadoraNome: demo.operadora_nome,
      protocolo: demo.protocolo,
      tipo: demo.tipo as 'analise' | 'pagamento',
      dataEmissao: demo.data_emissao,
      totalInformadoCents: Number(demo.total_informado_cents),
      totalProcessadoCents: Number(demo.total_processado_cents),
      totalGlosaCents: Number(demo.total_glosa_cents),
      itemCount: demo.item_count,
      createdAt: demo.created_at,
      itens: itemRows.map((i) => ({
        itemId: i.id,
        numeroGuiaPrestador: i.numero_guia_prestador,
        codigoProcedimento: i.codigo_procedimento,
        valorInformadoCents: Number(i.valor_informado_cents),
        valorProcessadoCents: Number(i.valor_processado_cents),
        valorGlosaCents: Number(i.valor_glosa_cents),
        codigoGlosa: i.codigo_glosa,
        status: i.status,
        aceite: i.aceite,
      })),
    };
  }));
}
```

- [ ] Registrar o plugin em `apps/api/src/app.ts`. Adicionar o import no bloco de imports:

```ts
import { demonstrativoRoutes } from './routes/tiss/demonstrativos';
```

E adicionar no corpo de `buildApp`, apos `await app.register(convenioPacienteRoutes);`:

```ts
  await app.register(demonstrativoRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/demonstrativos.int.test.ts
# ESPERADO: PASS — 6 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/demonstrativos.ts apps/api/src/routes/tiss/demonstrativos.int.test.ts apps/api/src/app.ts package.json pnpm-lock.yaml
git commit -m "feat(api): add TISS demonstrativo routes (import/list/detail)

POST /v1/tiss/demonstrativos/importar (multipart XML upload with
inline parsing), GET /v1/tiss/demonstrativos (cursor pagination),
GET /v1/tiss/demonstrativos/:id (detail with items).
RBAC: tiss.demonstrativo.import for upload, tiss.demonstrativo.read
for list/detail. no-store on all responses.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 47: Rotas de glosas TISS (listar com filtros, detalhe, aceitar)

**Arquivos**
- Criar: `apps/api/src/routes/tiss/glosas.ts`
- Criar: `apps/api/src/routes/tiss/glosas.int.test.ts`
- Modificar: `apps/api/src/app.ts` (registrar plugin)

**Passos**

- [ ] Escrever o teste de integracao:

```ts
// apps/api/src/routes/tiss/glosas.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let recepcao: SementeSessao;
let medico: SementeSessao;
let operadoraId: string;
let demoId: string;
let glosaItemId: string;
let glosaItemPagoId: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });
  recepcao = await semearSessao({ role: 'recepcao' });
  medico = await semearSessao({ role: 'profissional' });

  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, active, created_by)
       VALUES ($1, $2, '339679', 'Op Glosa', '11111111000190', '3.05',
               'arquivo', true, $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    demoId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, protocolo, tipo, data_emissao,
          total_informado_cents, total_processado_cents, total_glosa_cents,
          item_count, imported_by)
       VALUES ($1, $2, $3, 'PROTO-GLOSA', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               30000, 15000, 15000, 2, $4)`,
      [admin.tenantId, demoId, operadoraId, admin.userId]);

    glosaItemId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, codigo_glosa, motivo_glosa, status, aceite)
       VALUES ($1, $2, $3, 'GP-GL-001',
               '10101012', 15000, 0, 15000, '1005',
               'Procedimento nao autorizado', 'glosado_total', 'pendente')`,
      [admin.tenantId, glosaItemId, demoId]);

    glosaItemPagoId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, status, aceite)
       VALUES ($1, $2, $3, 'GP-GL-002',
               '10101020', 15000, 15000, 0, 'pago', 'pendente')`,
      [admin.tenantId, glosaItemPagoId, demoId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
});
afterAll(async () => { await closePools(); });

describe('rotas de glosas TISS', () => {
  it('GET /v1/tiss/glosas lista somente itens glosados', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      itens: Array<{ itemId: string; status: string }>;
      nextCursor: string | null;
    };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    // Somente itens glosados, nao pagos
    const ids = body.itens.map((i) => i.itemId);
    expect(ids).toContain(glosaItemId);
    expect(ids).not.toContain(glosaItemPagoId);
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('GET /v1/tiss/glosas filtra por operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas?operadoraId=${operadoraId}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ itemId: string }> };
    expect(body.itens.some((i) => i.itemId === glosaItemId)).toBe(true);
    await app.close();
  });

  it('GET /v1/tiss/glosas filtra por aceite pendente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/tiss/glosas?aceite=pendente',
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ aceite: string }> };
    for (const item of body.itens) {
      expect(item.aceite).toBe('pendente');
    }
    await app.close();
  });

  it('GET /v1/tiss/glosas/:id detalhe da glosa', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas/${glosaItemId}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      itemId: string; codigoGlosa: string;
      motivoGlosa: string; valorGlosaCents: number;
    };
    expect(body.itemId).toBe(glosaItemId);
    expect(body.codigoGlosa).toBe('1005');
    expect(body.motivoGlosa).toBe('Procedimento nao autorizado');
    expect(body.valorGlosaCents).toBe(15000);
    await app.close();
  });

  it('POST /v1/tiss/glosas/:id/aceitar aceita glosa individual', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/glosas/${glosaItemId}/aceitar`,
      ...auth(admin),
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itemId: string; aceite: string };
    expect(body.itemId).toBe(glosaItemId);
    expect(body.aceite).toBe('aceita');
    await app.close();
  });

  it('recepcao le glosas mas nao pode aceitar', async () => {
    const app = await buildApp();
    const r1 = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(recepcao),
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await app.inject({
      method: 'POST',
      url: `/v1/tiss/glosas/${glosaItemId}/aceitar`,
      ...auth(recepcao),
      payload: {},
    });
    expect(r2.statusCode).toBe(403);
    await app.close();
  });

  it('medico recebe 403 ao tentar listar glosas', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(medico),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/glosas.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado / rota nao existe
```

- [ ] Criar o arquivo de rotas:

```ts
// apps/api/src/routes/tiss/glosas.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const GlosaResumoSchema = z.object({
  itemId: z.string().uuid(),
  demonstrativoId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  protocolo: z.string(),
  numeroGuiaPrestador: z.string(),
  codigoProcedimento: z.string(),
  valorInformadoCents: z.number().int(),
  valorProcessadoCents: z.number().int(),
  valorGlosaCents: z.number().int(),
  codigoGlosa: z.string().nullable(),
  status: z.string(),
  aceite: z.string(),
  createdAt: z.string(),
});

const GlosaDetalheSchema = GlosaResumoSchema.extend({
  motivoGlosa: z.string().nullable(),
  dataEmissao: z.string(),
});

export async function glosaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /v1/tiss/glosas — listar glosas com filtros ───────────────────
  r.get('/v1/tiss/glosas', {
    schema: {
      querystring: z.object({
        operadoraId: z.string().uuid().optional(),
        aceite: z.enum(['pendente', 'aceita', 'em_recurso', 'recuperada']).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(GlosaResumoSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('tiss.glosa.read', async (tx, _ctx, req) => {
    const q = req.query as {
      operadoraId?: string; aceite?: string;
      limit?: number; cursor?: string;
    };
    const limite = q.limit ?? 25;
    const condicoes: string[] = [
      `di.status IN ('glosado_total', 'glosado_parcial')`,
    ];
    const params: unknown[] = [];
    let idx = 1;

    if (q.operadoraId !== undefined) {
      condicoes.push(`d.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }
    if (q.aceite !== undefined) {
      condicoes.push(`di.aceite = $${idx}`);
      params.push(q.aceite); idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`di.created_at < $${idx}::timestamptz`);
      params.push(q.cursor); idx += 1;
    }

    params.push(limite + 1);
    const where = condicoes.join(' AND ');

    const { rows } = await tx.query<{
      id: string; demonstrativo_id: string;
      operadora_id: string; operadora_nome: string; protocolo: string;
      numero_guia_prestador: string; codigo_procedimento: string;
      valor_informado_cents: string; valor_processado_cents: string;
      valor_glosa_cents: string; codigo_glosa: string | null;
      status: string; aceite: string; created_at: string;
    }>(
      `SELECT di.id, di.demonstrativo_id,
              d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo,
              di.numero_guia_prestador, di.codigo_procedimento,
              di.valor_informado_cents::text, di.valor_processado_cents::text,
              di.valor_glosa_cents::text, di.codigo_glosa,
              di.status, di.aceite,
              to_char(di.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.demonstrativo_item di
         JOIN tiss.demonstrativo d
           ON d.tenant_id = di.tenant_id AND d.id = di.demonstrativo_id
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
        WHERE ${where}
        ORDER BY di.created_at DESC
        LIMIT $${idx}`,
      params);

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      itemId: row.id,
      demonstrativoId: row.demonstrativo_id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      protocolo: row.protocolo,
      numeroGuiaPrestador: row.numero_guia_prestador,
      codigoProcedimento: row.codigo_procedimento,
      valorInformadoCents: Number(row.valor_informado_cents),
      valorProcessadoCents: Number(row.valor_processado_cents),
      valorGlosaCents: Number(row.valor_glosa_cents),
      codigoGlosa: row.codigo_glosa,
      status: row.status,
      aceite: row.aceite,
      createdAt: row.created_at,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt : null;

    return { itens, nextCursor };
  }));

  // ── GET /v1/tiss/glosas/:id — detalhe da glosa ───────────────────────
  r.get('/v1/tiss/glosas/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: GlosaDetalheSchema },
    },
  }, rota('tiss.glosa.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; demonstrativo_id: string;
      operadora_id: string; operadora_nome: string; protocolo: string;
      numero_guia_prestador: string; codigo_procedimento: string;
      valor_informado_cents: string; valor_processado_cents: string;
      valor_glosa_cents: string; codigo_glosa: string | null;
      motivo_glosa: string | null;
      status: string; aceite: string;
      data_emissao: string; created_at: string;
    }>(
      `SELECT di.id, di.demonstrativo_id,
              d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo,
              di.numero_guia_prestador, di.codigo_procedimento,
              di.valor_informado_cents::text, di.valor_processado_cents::text,
              di.valor_glosa_cents::text, di.codigo_glosa, di.motivo_glosa,
              di.status, di.aceite,
              d.data_emissao::text,
              to_char(di.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.demonstrativo_item di
         JOIN tiss.demonstrativo d
           ON d.tenant_id = di.tenant_id AND d.id = di.demonstrativo_id
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
        WHERE di.id = $1
          AND di.status IN ('glosado_total', 'glosado_parcial')`,
      [p.id]);

    if (rows.length === 0) erroDominio('glosa_nao_encontrada', 404);
    const row = rows[0]!;

    return {
      itemId: row.id,
      demonstrativoId: row.demonstrativo_id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      protocolo: row.protocolo,
      numeroGuiaPrestador: row.numero_guia_prestador,
      codigoProcedimento: row.codigo_procedimento,
      valorInformadoCents: Number(row.valor_informado_cents),
      valorProcessadoCents: Number(row.valor_processado_cents),
      valorGlosaCents: Number(row.valor_glosa_cents),
      codigoGlosa: row.codigo_glosa,
      motivoGlosa: row.motivo_glosa,
      status: row.status,
      aceite: row.aceite,
      dataEmissao: row.data_emissao,
      createdAt: row.created_at,
    };
  }));

  // ── POST /v1/tiss/glosas/:id/aceitar — aceitar glosa individual ───────
  r.post('/v1/tiss/glosas/:id/aceitar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({}),
      response: {
        200: z.object({
          itemId: z.string().uuid(),
          aceite: z.literal('aceita'),
        }),
      },
    },
  }, rota('tiss.glosa.manage', async (tx, ctx, req) => {
    const p = req.params as { id: string };

    // Verificar que o item existe, e glosa e esta pendente
    const { rows } = await tx.query<{
      status: string; aceite: string; demonstrativo_id: string;
    }>(
      `SELECT status, aceite, demonstrativo_id
         FROM tiss.demonstrativo_item
        WHERE id = $1 FOR UPDATE`,
      [p.id]);

    if (rows.length === 0) erroDominio('glosa_nao_encontrada', 404);
    const item = rows[0]!;

    if (item.status !== 'glosado_total' && item.status !== 'glosado_parcial') {
      erroDominio('item_nao_glosado', 422);
    }
    if (item.aceite !== 'pendente') {
      erroDominio('glosa_ja_processada', 422,
        { aceiteAtual: item.aceite });
    }

    await tx.query(
      `UPDATE tiss.demonstrativo_item SET aceite = 'aceita'
        WHERE id = $1`,
      [p.id]);

    // Auditoria
    await tx.query(
      `SELECT audit.log('TISS_GLOSA_ACEITA', 'tiss', 'demonstrativo_item',
              $1, 'sucesso',
              jsonb_build_object('demonstrativo_id', $2::text), $3)`,
      [p.id, item.demonstrativo_id, ctx.actor.clinicId]);

    return { itemId: p.id, aceite: 'aceita' as const };
  }));
}
```

- [ ] Registrar o plugin em `apps/api/src/app.ts`. Adicionar o import:

```ts
import { glosaRoutes } from './routes/tiss/glosas';
```

E registrar apos `await app.register(demonstrativoRoutes);`:

```ts
  await app.register(glosaRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/glosas.int.test.ts
# ESPERADO: PASS — 7 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/glosas.ts apps/api/src/routes/tiss/glosas.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add TISS glosa routes (list/detail/accept)

GET /v1/tiss/glosas (filter by operadora/aceite, cursor pagination),
GET /v1/tiss/glosas/:id (detail with motivo),
POST /v1/tiss/glosas/:id/aceitar (accept individual glosa).
RBAC: tiss.glosa.read for list/detail, tiss.glosa.manage for accept.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 48: Rotas de recursos de glosa TISS (criar, adicionar/remover item, marcar pronto, listar, detalhe)

**Arquivos**
- Criar: `apps/api/src/routes/tiss/recursos.ts`
- Criar: `apps/api/src/routes/tiss/recursos.int.test.ts`
- Modificar: `apps/api/src/app.ts` (registrar plugin)

**Passos**

- [ ] Escrever o teste de integracao:

```ts
// apps/api/src/routes/tiss/recursos.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let recepcao: SementeSessao;
let medico: SementeSessao;
let operadoraId: string;
let demoId: string;
let glosaItemIdA: string;
let glosaItemIdB: string;
let versionId: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });
  recepcao = await semearSessao({ role: 'recepcao' });
  medico = await semearSessao({ role: 'profissional' });

  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, active, created_by)
       VALUES ($1, $2, '339679', 'Op Recurso', '11111111000190', '3.05',
               'arquivo', true, $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    // Encounter version para §3.9 (recurso sempre cita versao usada)
    versionId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind,
          author_user_id, author_professional_id,
          content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5,
               sha256('recurso-test-seed'::bytea), 'test-v1')`,
      [admin.tenantId, versionId, admin.encounterId,
       admin.userId, admin.professionalId]);

    demoId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, protocolo, tipo, data_emissao,
          total_informado_cents, total_processado_cents, total_glosa_cents,
          item_count, imported_by)
       VALUES ($1, $2, $3, 'PROTO-REC', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               30000, 10000, 20000, 2, $4)`,
      [admin.tenantId, demoId, operadoraId, admin.userId]);

    glosaItemIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, codigo_glosa, motivo_glosa, status, aceite)
       VALUES ($1, $2, $3, 'GP-REC-001',
               '10101012', 15000, 0, 15000, '1005',
               'Sem autorizacao previa', 'glosado_total', 'pendente')`,
      [admin.tenantId, glosaItemIdA, demoId]);

    glosaItemIdB = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, codigo_glosa, motivo_glosa, status, aceite)
       VALUES ($1, $2, $3, 'GP-REC-002',
               '10101020', 15000, 10000, 5000, '1010',
               'Valor acima da tabela', 'glosado_parcial', 'pendente')`,
      [admin.tenantId, glosaItemIdB, demoId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
});
afterAll(async () => { await closePools(); });

describe('rotas de recursos de glosa TISS', () => {
  let recursoId: string;
  let recursoItemIdA: string;

  it('POST /v1/tiss/recursos cria recurso vazio', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(admin),
      payload: {
        operadoraId,
        justificativaGeral: 'Recurso de glosas do lote de julho',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { recursoId: string };
    expect(body.recursoId).toBeTruthy();
    recursoId = body.recursoId;
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/itens adiciona glosa ao recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/itens`,
      ...auth(admin),
      payload: {
        demonstrativoItemId: glosaItemIdA,
        encounterVersionId: versionId,
        justificativa: 'Atendimento de urgencia, autorizacao posterior',
        valorRecursadoCents: 15000,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { itemId: string };
    expect(body.itemId).toBeTruthy();
    recursoItemIdA = body.itemId;
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/itens adiciona segunda glosa', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/itens`,
      ...auth(admin),
      payload: {
        demonstrativoItemId: glosaItemIdB,
        encounterVersionId: versionId,
        justificativa: 'Valor conforme contrato vigente',
        valorRecursadoCents: 5000,
      },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it('GET /v1/tiss/recursos lista recursos do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/recursos', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      itens: Array<{ recursoId: string; itemCount: number }>;
    };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    const rec = body.itens.find((r) => r.recursoId === recursoId);
    expect(rec).toBeDefined();
    expect(rec!.itemCount).toBe(2);
    await app.close();
  });

  it('GET /v1/tiss/recursos/:id detalhe com itens', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/recursos/${recursoId}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      recursoId: string;
      itens: Array<{
        itemId: string;
        encounterVersionId: string;
        justificativa: string;
      }>;
    };
    expect(body.recursoId).toBe(recursoId);
    expect(body.itens.length).toBe(2);
    // §3.9: recurso cita a versao usada
    expect(body.itens[0]!.encounterVersionId).toBe(versionId);
    await app.close();
  });

  it('DELETE /v1/tiss/recursos/:id/itens/:itemId remove glosa do recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/tiss/recursos/${recursoId}/itens/${recursoItemIdA}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { removido: boolean }).removido).toBe(true);

    // Re-adicionar para os testes seguintes
    const r2 = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/itens`,
      ...auth(admin),
      payload: {
        demonstrativoItemId: glosaItemIdA,
        encounterVersionId: versionId,
        justificativa: 'Atendimento de urgencia, autorizacao posterior',
        valorRecursadoCents: 15000,
      },
    });
    recursoItemIdA = (r2.json() as { itemId: string }).itemId;
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/pronto marca recurso como pronto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/pronto`,
      ...auth(admin),
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recursoId: string; status: string };
    expect(body.status).toBe('pronto');
    await app.close();
  });

  it('medico recebe 403 ao tentar criar recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(medico),
      payload: {
        operadoraId,
        justificativaGeral: 'Proibido',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('recepcao recebe 403 ao tentar criar recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(recepcao),
      payload: {
        operadoraId,
        justificativaGeral: 'Proibido',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/recursos.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado / rota nao existe
```

- [ ] Criar o arquivo de rotas:

```ts
// apps/api/src/routes/tiss/recursos.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const RecursoResumoSchema = z.object({
  recursoId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  status: z.string(),
  justificativaGeral: z.string().nullable(),
  itemCount: z.number().int(),
  totalRecursadoCents: z.number().int(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});

const RecursoItemSchema = z.object({
  itemId: z.string().uuid(),
  demonstrativoItemId: z.string().uuid(),
  encounterVersionId: z.string().uuid(),
  justificativa: z.string(),
  valorRecursadoCents: z.number().int(),
  resultado: z.string().nullable(),
  valorResultadoCents: z.number().int().nullable(),
});

export async function recursoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/tiss/recursos — criar recurso vazio ──────────────────────
  r.post('/v1/tiss/recursos', {
    schema: {
      body: z.object({
        operadoraId: z.string().uuid(),
        justificativaGeral: z.string().min(1).max(2000).optional(),
      }),
      response: { 201: z.object({ recursoId: z.string().uuid() }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req, reply) => {
    const b = req.body as { operadoraId: string; justificativaGeral?: string };
    const id = uuidv7();

    // Verificar que a operadora existe
    const { rowCount: opExiste } = await tx.query(
      `SELECT 1 FROM tiss.operadora WHERE id = $1 AND active = true`,
      [b.operadoraId]);
    if (opExiste === 0) erroDominio('operadora_nao_encontrada', 404);

    await tx.query(
      `INSERT INTO tiss.recurso_glosa
         (id, operadora_id, status, justificativa_geral,
          item_count, total_recursado_cents, created_by)
       VALUES ($1, $2, 'rascunho', $3, 0, 0, app.current_user_id())`,
      [id, b.operadoraId, b.justificativaGeral ?? null]);

    void reply.code(201);
    return { recursoId: id };
  }));

  // ── POST /v1/tiss/recursos/:id/itens — adicionar glosa ao recurso ────
  r.post('/v1/tiss/recursos/:id/itens', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        demonstrativoItemId: z.string().uuid(),
        encounterVersionId: z.string().uuid(),
        justificativa: z.string().min(1).max(2000),
        valorRecursadoCents: z.number().int().min(1),
      }),
      response: { 201: z.object({ itemId: z.string().uuid() }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as {
      demonstrativoItemId: string; encounterVersionId: string;
      justificativa: string; valorRecursadoCents: number;
    };

    // Verificar que o recurso existe e esta em rascunho
    const { rows: recRows } = await tx.query<{
      status: string; item_count: number; total_recursado_cents: string;
    }>(
      `SELECT status, item_count, total_recursado_cents::text
         FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (recRows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (recRows[0]!.status !== 'rascunho') {
      erroDominio('recurso_nao_rascunho', 422);
    }

    // Verificar que o item do demonstrativo e uma glosa pendente
    const { rows: diRows } = await tx.query<{ aceite: string }>(
      `SELECT aceite FROM tiss.demonstrativo_item
        WHERE id = $1
          AND status IN ('glosado_total', 'glosado_parcial')`,
      [b.demonstrativoItemId]);
    if (diRows.length === 0) erroDominio('glosa_nao_encontrada', 404);
    if (diRows[0]!.aceite === 'aceita') {
      erroDominio('glosa_ja_aceita', 422);
    }

    // Verificar que a encounter_version existe
    const { rowCount: verExiste } = await tx.query(
      `SELECT 1 FROM clin.encounter_version WHERE id = $1`,
      [b.encounterVersionId]);
    if (verExiste === 0) erroDominio('versao_nao_encontrada', 404);

    // Verificar se a glosa ja esta em outro recurso ativo
    const { rowCount: jaEmRecurso } = await tx.query(
      `SELECT 1 FROM tiss.recurso_glosa_item ri
         JOIN tiss.recurso_glosa rg
           ON rg.tenant_id = ri.tenant_id AND rg.id = ri.recurso_id
        WHERE ri.demonstrativo_item_id = $1
          AND rg.status IN ('rascunho', 'pronto', 'enviado')`,
      [b.demonstrativoItemId]);
    if (jaEmRecurso !== null && jaEmRecurso > 0) {
      erroDominio('glosa_ja_em_recurso', 422);
    }

    const itemId = uuidv7();
    await tx.query(
      `INSERT INTO tiss.recurso_glosa_item
         (id, recurso_id, demonstrativo_item_id, encounter_version_id,
          justificativa, valor_recursado_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [itemId, p.id, b.demonstrativoItemId, b.encounterVersionId,
       b.justificativa, b.valorRecursadoCents]);

    // Atualizar contadores no recurso
    const newCount = recRows[0]!.item_count + 1;
    const newTotal = Number(recRows[0]!.total_recursado_cents) + b.valorRecursadoCents;
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET item_count = $2, total_recursado_cents = $3
        WHERE id = $1`,
      [p.id, newCount, newTotal]);

    // Marcar a glosa como em_recurso
    await tx.query(
      `UPDATE tiss.demonstrativo_item SET aceite = 'em_recurso'
        WHERE id = $1`,
      [b.demonstrativoItemId]);

    void reply.code(201);
    return { itemId };
  }));

  // ── DELETE /v1/tiss/recursos/:id/itens/:itemId — remover glosa ────────
  r.delete('/v1/tiss/recursos/:id/itens/:itemId', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
        itemId: z.string().uuid(),
      }),
      response: { 200: z.object({ removido: z.boolean() }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string; itemId: string };

    // Verificar que o recurso esta em rascunho
    const { rows: recRows } = await tx.query<{
      status: string; item_count: number; total_recursado_cents: string;
    }>(
      `SELECT status, item_count, total_recursado_cents::text
         FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (recRows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (recRows[0]!.status !== 'rascunho') {
      erroDominio('recurso_nao_rascunho', 422);
    }

    // Remover o item e pegar dados para atualizar contadores
    const { rows: removidos } = await tx.query<{
      demonstrativo_item_id: string; valor_recursado_cents: string;
    }>(
      `DELETE FROM tiss.recurso_glosa_item
        WHERE id = $1 AND recurso_id = $2
        RETURNING demonstrativo_item_id, valor_recursado_cents::text`,
      [p.itemId, p.id]);

    if (removidos.length > 0) {
      const valorRemovido = Number(removidos[0]!.valor_recursado_cents);
      const newCount = Math.max(recRows[0]!.item_count - 1, 0);
      const newTotal = Math.max(
        Number(recRows[0]!.total_recursado_cents) - valorRemovido, 0);
      await tx.query(
        `UPDATE tiss.recurso_glosa
            SET item_count = $2, total_recursado_cents = $3
          WHERE id = $1`,
        [p.id, newCount, newTotal]);

      // Reverter aceite da glosa para pendente
      await tx.query(
        `UPDATE tiss.demonstrativo_item SET aceite = 'pendente'
          WHERE id = $1 AND aceite = 'em_recurso'`,
        [removidos[0]!.demonstrativo_item_id]);
    }

    return { removido: removidos.length > 0 };
  }));

  // ── POST /v1/tiss/recursos/:id/pronto — marcar recurso como pronto ────
  r.post('/v1/tiss/recursos/:id/pronto', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({}),
      response: {
        200: z.object({
          recursoId: z.string().uuid(),
          status: z.literal('pronto'),
        }),
      },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      status: string; item_count: number;
    }>(
      `SELECT status, item_count FROM tiss.recurso_glosa
        WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (rows[0]!.status !== 'rascunho') {
      erroDominio('recurso_nao_rascunho', 422);
    }
    if (rows[0]!.item_count === 0) {
      erroDominio('recurso_sem_itens', 422);
    }

    await tx.query(
      `UPDATE tiss.recurso_glosa SET status = 'pronto'
        WHERE id = $1`,
      [p.id]);

    return { recursoId: p.id, status: 'pronto' as const };
  }));

  // ── GET /v1/tiss/recursos — listar recursos ──────────────────────────
  r.get('/v1/tiss/recursos', {
    schema: {
      querystring: z.object({
        status: z.enum(['rascunho', 'pronto', 'enviado', 'resolvido']).optional(),
        operadoraId: z.string().uuid().optional(),
      }),
      response: { 200: z.object({ itens: z.array(RecursoResumoSchema) }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const q = req.query as { status?: string; operadoraId?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.status !== undefined) {
      condicoes.push(`rg.status = $${idx}`);
      params.push(q.status); idx += 1;
    }
    if (q.operadoraId !== undefined) {
      condicoes.push(`rg.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }

    const where = condicoes.length > 0
      ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      status: string; justificativa_geral: string | null;
      item_count: number; total_recursado_cents: string;
      created_at: string; sent_at: string | null;
    }>(
      `SELECT rg.id, rg.operadora_id, o.razao_social AS operadora_nome,
              rg.status, rg.justificativa_geral,
              rg.item_count, rg.total_recursado_cents::text,
              to_char(rg.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              to_char(rg.sent_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at
         FROM tiss.recurso_glosa rg
         JOIN tiss.operadora o
           ON o.tenant_id = rg.tenant_id AND o.id = rg.operadora_id
         ${where}
        ORDER BY rg.created_at DESC`,
      params);

    return {
      itens: rows.map((row) => ({
        recursoId: row.id,
        operadoraId: row.operadora_id,
        operadoraNome: row.operadora_nome,
        status: row.status,
        justificativaGeral: row.justificativa_geral,
        itemCount: row.item_count,
        totalRecursadoCents: Number(row.total_recursado_cents),
        createdAt: row.created_at,
        sentAt: row.sent_at,
      })),
    };
  }));

  // ── GET /v1/tiss/recursos/:id — detalhe do recurso com itens ──────────
  r.get('/v1/tiss/recursos/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: RecursoResumoSchema.extend({
          itens: z.array(RecursoItemSchema),
        }),
      },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      status: string; justificativa_geral: string | null;
      item_count: number; total_recursado_cents: string;
      created_at: string; sent_at: string | null;
    }>(
      `SELECT rg.id, rg.operadora_id, o.razao_social AS operadora_nome,
              rg.status, rg.justificativa_geral,
              rg.item_count, rg.total_recursado_cents::text,
              to_char(rg.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              to_char(rg.sent_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at
         FROM tiss.recurso_glosa rg
         JOIN tiss.operadora o
           ON o.tenant_id = rg.tenant_id AND o.id = rg.operadora_id
        WHERE rg.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    const rec = rows[0]!;

    const { rows: itemRows } = await tx.query<{
      id: string; demonstrativo_item_id: string;
      encounter_version_id: string; justificativa: string;
      valor_recursado_cents: string;
      resultado: string | null; valor_resultado_cents: string | null;
    }>(
      `SELECT id, demonstrativo_item_id, encounter_version_id,
              justificativa, valor_recursado_cents::text,
              resultado, valor_resultado_cents::text
         FROM tiss.recurso_glosa_item
        WHERE recurso_id = $1
        ORDER BY created_at`,
      [p.id]);

    return {
      recursoId: rec.id,
      operadoraId: rec.operadora_id,
      operadoraNome: rec.operadora_nome,
      status: rec.status,
      justificativaGeral: rec.justificativa_geral,
      itemCount: rec.item_count,
      totalRecursadoCents: Number(rec.total_recursado_cents),
      createdAt: rec.created_at,
      sentAt: rec.sent_at,
      itens: itemRows.map((i) => ({
        itemId: i.id,
        demonstrativoItemId: i.demonstrativo_item_id,
        encounterVersionId: i.encounter_version_id,
        justificativa: i.justificativa,
        valorRecursadoCents: Number(i.valor_recursado_cents),
        resultado: i.resultado,
        valorResultadoCents: i.valor_resultado_cents !== null
          ? Number(i.valor_resultado_cents) : null,
      })),
    };
  }));

  // ── POST /v1/tiss/recursos/:id/enviar — enviar recurso ────────────────
  // Definido na Task 49
  // ── POST /v1/tiss/recursos/:id/resolver — resolver recurso ────────────
  // Definido na Task 49
}
```

- [ ] Registrar o plugin em `apps/api/src/app.ts`. Adicionar o import:

```ts
import { recursoRoutes } from './routes/tiss/recursos';
```

E registrar apos `await app.register(glosaRoutes);`:

```ts
  await app.register(recursoRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/recursos.int.test.ts
# ESPERADO: PASS — 9 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/recursos.ts apps/api/src/routes/tiss/recursos.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add TISS recurso glosa CRUD routes

POST /v1/tiss/recursos (create), POST /:id/itens (add glosa),
DELETE /:id/itens/:itemId (remove), POST /:id/pronto (mark ready),
GET /v1/tiss/recursos (list), GET /:id (detail with items).
RBAC: tiss.recurso.manage. encounter_version_id required per sec 3.9.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 49: Rotas de envio e resolucao de recurso de glosa TISS

**Arquivos**
- Modificar: `apps/api/src/routes/tiss/recursos.ts` (adicionar rotas de enviar e resolver)
- Modificar: `apps/api/src/routes/tiss/recursos.int.test.ts` (adicionar testes)

**Passos**

- [ ] Adicionar os testes de envio e resolucao ao final do `describe` em `apps/api/src/routes/tiss/recursos.int.test.ts`, antes do fechamento do `describe`:

```ts
  // --- Testes de envio e resolucao (Task 49) ---

  it('POST /v1/tiss/recursos/:id/enviar dispara serializacao e transport', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/enviar`,
      ...auth(admin),
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recursoId: string; status: string };
    expect(body.status).toBe('enviado');
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/resolver resolve recurso com resultado', async () => {
    const app = await buildApp();

    // Buscar itens do recurso para obter os IDs
    const detR = await app.inject({
      method: 'GET',
      url: `/v1/tiss/recursos/${recursoId}`,
      ...auth(admin),
    });
    const det = detR.json() as {
      itens: Array<{ itemId: string; valorRecursadoCents: number }>;
    };
    expect(det.itens.length).toBe(2);

    const resultados = det.itens.map((item) => ({
      itemId: item.itemId,
      resultado: 'deferido' as const,
      valorResultadoCents: item.valorRecursadoCents,
    }));

    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/resolver`,
      ...auth(admin),
      payload: { resultados },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recursoId: string; status: string };
    expect(body.status).toBe('resolvido');

    // Verificar que as glosas foram marcadas como recuperadas
    const glR = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas/${glosaItemIdA}`,
      ...auth(admin),
    });
    if (glR.statusCode === 200) {
      const gl = glR.json() as { aceite: string };
      expect(gl.aceite).toBe('recuperada');
    }

    await app.close();
  });

  it('recepcao recebe 403 ao tentar enviar recurso', async () => {
    // Criar novo recurso para testar envio
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/enviar`,
      ...auth(recepcao),
      payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/recursos.int.test.ts
# ESPERADO: FAIL — rota /enviar e /resolver nao existem (404)
```

- [ ] Adicionar as rotas de enviar e resolver em `apps/api/src/routes/tiss/recursos.ts`. Substituir os comentarios placeholder pelo codigo completo. Antes do fechamento da funcao `recursoRoutes`, onde estao os comentarios `// Definido na Task 49`, inserir:

```ts
  // ── POST /v1/tiss/recursos/:id/enviar — enviar recurso ────────────────
  r.post('/v1/tiss/recursos/:id/enviar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({}),
      response: {
        200: z.object({
          recursoId: z.string().uuid(),
          status: z.literal('enviado'),
        }),
      },
    },
  }, rota('tiss.recurso.send', async (tx, ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      status: string; operadora_id: string; item_count: number;
      total_recursado_cents: string;
    }>(
      `SELECT status, operadora_id, item_count, total_recursado_cents::text
         FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (rows[0]!.status !== 'pronto') {
      erroDominio('recurso_nao_pronto', 422);
    }
    if (rows[0]!.item_count === 0) {
      erroDominio('recurso_sem_itens', 422);
    }

    // Transicionar para enviado
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = 'enviado', sent_at = clock_timestamp()
        WHERE id = $1`,
      [p.id]);

    // Enfileirar no outbox para serializacao XML + transport
    await tx.query(
      `SELECT app.enqueue_outbox('tiss_recurso_send', $1::uuid,
               jsonb_build_object(
                 'recursoId', $2::text,
                 'operadoraId', $3::text,
                 'itemCount', $4::int,
                 'clinicId', $5::text))`,
      [p.id, p.id, rows[0]!.operadora_id,
       rows[0]!.item_count, ctx.actor.clinicId]);

    // Auditoria
    await tx.query(
      `SELECT audit.log('TISS_RECURSO_SEND', 'tiss', 'recurso_glosa', $1,
              'sucesso',
              jsonb_build_object('item_count', $2::int,
                                 'total_recursado_cents', $3::text), $4)`,
      [p.id, rows[0]!.item_count,
       rows[0]!.total_recursado_cents, ctx.actor.clinicId]);

    return { recursoId: p.id, status: 'enviado' as const };
  }));

  // ── POST /v1/tiss/recursos/:id/resolver — resolver com resultado ──────
  r.post('/v1/tiss/recursos/:id/resolver', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        resultados: z.array(z.object({
          itemId: z.string().uuid(),
          resultado: z.enum(['deferido', 'indeferido', 'deferido_parcial']),
          valorResultadoCents: z.number().int().min(0),
        })).min(1),
      }),
      response: {
        200: z.object({
          recursoId: z.string().uuid(),
          status: z.literal('resolvido'),
        }),
      },
    },
  }, rota('tiss.recurso.manage', async (tx, ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as {
      resultados: Array<{
        itemId: string;
        resultado: 'deferido' | 'indeferido' | 'deferido_parcial';
        valorResultadoCents: number;
      }>;
    };

    // Verificar que o recurso existe e esta enviado
    const { rows } = await tx.query<{ status: string }>(
      `SELECT status FROM tiss.recurso_glosa
        WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (rows[0]!.status !== 'enviado') {
      erroDominio('recurso_nao_enviado', 422);
    }

    // Atualizar cada item com o resultado
    for (const res of b.resultados) {
      const { rowCount } = await tx.query(
        `UPDATE tiss.recurso_glosa_item
            SET resultado = $2, valor_resultado_cents = $3
          WHERE id = $1 AND recurso_id = $4`,
        [res.itemId, res.resultado, res.valorResultadoCents, p.id]);
      if (rowCount === 0) {
        erroDominio('item_recurso_nao_encontrado', 404,
          { itemId: res.itemId });
      }

      // Se deferido (total ou parcial), marcar a glosa como recuperada
      if (res.resultado === 'deferido' || res.resultado === 'deferido_parcial') {
        await tx.query(
          `UPDATE tiss.demonstrativo_item
              SET aceite = 'recuperada'
            WHERE id = (
              SELECT demonstrativo_item_id
                FROM tiss.recurso_glosa_item
               WHERE id = $1)`,
          [res.itemId]);
      }
    }

    // Marcar recurso como resolvido
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = 'resolvido', resolved_at = clock_timestamp()
        WHERE id = $1`,
      [p.id]);

    // Auditoria
    const deferidos = b.resultados.filter(
      (r) => r.resultado === 'deferido' || r.resultado === 'deferido_parcial');
    await tx.query(
      `SELECT audit.log('TISS_RECURSO_RESOLVE', 'tiss', 'recurso_glosa', $1,
              'sucesso',
              jsonb_build_object('total_resultados', $2::int,
                                 'deferidos', $3::int), $4)`,
      [p.id, b.resultados.length, deferidos.length, ctx.actor.clinicId]);

    return { recursoId: p.id, status: 'resolvido' as const };
  }));
```

- [ ] Remover os comentarios placeholder de `recursos.ts`. Substituir:

```ts
  // ── POST /v1/tiss/recursos/:id/enviar — enviar recurso ────────────────
  // Definido na Task 49
  // ── POST /v1/tiss/recursos/:id/resolver — resolver recurso ────────────
  // Definido na Task 49
```

Por nada (as rotas completas ja foram adicionadas acima).

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/recursos.int.test.ts
# ESPERADO: PASS — 12 testes verdes (9 da Task 48 + 3 novos)
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/recursos.ts apps/api/src/routes/tiss/recursos.int.test.ts
git commit -m "feat(api): add TISS recurso send and resolve routes

POST /v1/tiss/recursos/:id/enviar (dispatch to outbox, mark enviado),
POST /v1/tiss/recursos/:id/resolver (apply results, mark recuperada
on deferred glosas). RBAC: tiss.recurso.send for send,
tiss.recurso.manage for resolve. Timeout never retries unsafe
operations (sec 7).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 50: Teste de isolamento multi-tenant para rotas TISS da Fase 5

**Arquivos**
- Criar: `apps/api/src/routes/tiss/fase5-isolation.int.test.ts`

**Passos**

- [ ] Escrever o teste de isolamento:

```ts
// apps/api/src/routes/tiss/fase5-isolation.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let a: SementeSessao;
let b: SementeSessao;
let operadoraIdA: string;
let demoIdA: string;
let glosaItemIdA: string;
let recursoIdA: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  a = await semearSessao({ role: 'admin_clinico', comMfa: true });
  b = await semearSessao({ role: 'admin_clinico', comMfa: true });

  // Semear dados completos no tenant A
  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, created_by)
       VALUES ($1, $2, '339679', 'Op Iso5 A', '11111111000190', '3.05',
               'arquivo', $3)`,
      [a.tenantId, operadoraIdA, a.userId]);

    demoIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, protocolo, tipo, data_emissao,
          total_informado_cents, total_processado_cents, total_glosa_cents,
          item_count, imported_by)
       VALUES ($1, $2, $3, 'PROTO-ISO', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               10000, 5000, 5000, 1, $4)`,
      [a.tenantId, demoIdA, operadoraIdA, a.userId]);

    glosaItemIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, codigo_glosa, status, aceite)
       VALUES ($1, $2, $3, 'GP-ISO-001',
               '10101012', 10000, 5000, 5000, '1005',
               'glosado_parcial', 'pendente')`,
      [a.tenantId, glosaItemIdA, demoIdA]);

    recursoIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.recurso_glosa
         (tenant_id, id, operadora_id, status, item_count,
          total_recursado_cents, created_by)
       VALUES ($1, $2, $3, 'rascunho', 0, 0, $4)`,
      [a.tenantId, recursoIdA, operadoraIdA, a.userId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
});
afterAll(async () => { await closePools(); });

describe('isolamento multi-tenant — rotas TISS Fase 5', () => {
  it('demonstrativos do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as {
      itens: Array<{ demonstrativoId: string }>;
    }).itens.map((i) => i.demonstrativoId);
    expect(ids).not.toContain(demoIdA);
    await app.close();
  });

  it('glosas do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as {
      itens: Array<{ itemId: string }>;
    }).itens.map((i) => i.itemId);
    expect(ids).not.toContain(glosaItemIdA);
    await app.close();
  });

  it('recursos do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/recursos', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as {
      itens: Array<{ recursoId: string }>;
    }).itens.map((i) => i.recursoId);
    expect(ids).not.toContain(recursoIdA);
    await app.close();
  });

  it('detalhe de demonstrativo de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/demonstrativos/${demoIdA}`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('detalhe de glosa de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas/${glosaItemIdA}`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('detalhe de recurso de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/recursos/${recursoIdA}`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('trocar x-clinic-id para unidade de outro tenant devolve 403', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos',
      cookies: {
        '__Host-cadencia_sid': a.token,
        '__Host-cadencia_csrf': a.csrf,
      },
      headers: {
        'x-clinic-id': b.clinicId,
        'x-csrf-token': a.csrf,
      },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_vinculo_na_unidade' });
    await app.close();
  });

  it('toda resposta Fase 5 TISS tem cache-control: no-store', async () => {
    const app = await buildApp();
    const rotas = [
      { method: 'GET' as const, url: '/v1/tiss/demonstrativos' },
      { method: 'GET' as const, url: '/v1/tiss/glosas' },
      { method: 'GET' as const, url: '/v1/tiss/recursos' },
    ];

    for (const rota of rotas) {
      const r = await app.inject({ ...rota, ...auth(a) });
      expect(r.headers['cache-control']).toBe('no-store');
    }
    await app.close();
  });

  it('medico (profissional) nao acessa demonstrativos, glosas nem recursos', async () => {
    const medicoLocal = await semearSessao({ role: 'profissional' });
    const app = await buildApp();

    const r1 = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(medicoLocal),
    });
    expect(r1.statusCode).toBe(403);

    const r2 = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(medicoLocal),
    });
    expect(r2.statusCode).toBe(403);

    const r3 = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(medicoLocal),
      payload: { operadoraId: operadoraIdA },
    });
    expect(r3.statusCode).toBe(403);

    await app.close();
  });

  it('recepcao le demonstrativos e glosas mas nao importa, aceita nem cria recurso', async () => {
    const recLocal = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();

    // Pode ler demonstrativos
    const r1 = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(recLocal),
    });
    expect(r1.statusCode).toBe(200);

    // Pode ler glosas
    const r2 = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(recLocal),
    });
    expect(r2.statusCode).toBe(200);

    // Nao pode aceitar glosa
    const r3 = await app.inject({
      method: 'POST',
      url: `/v1/tiss/glosas/${glosaItemIdA}/aceitar`,
      ...auth(recLocal),
      payload: {},
    });
    expect(r3.statusCode).toBe(403);

    // Nao pode criar recurso
    const r4 = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(recLocal),
      payload: {
        operadoraId: operadoraIdA,
        justificativaGeral: 'Proibido',
      },
    });
    expect(r4.statusCode).toBe(403);

    await app.close();
  });
});
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/fase5-isolation.int.test.ts
# ESPERADO: PASS — 10 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/fase5-isolation.int.test.ts
git commit -m "test(api): add Fase 5 TISS multi-tenant isolation tests

Verify demonstrativos, glosas and recursos are isolated by tenant,
clinic header swap returns 403, no-store on all responses, and RBAC
denies profissional and limits recepcao to read-only.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
