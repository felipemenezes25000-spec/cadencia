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
         (tenant_id, id, operadora_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, 'PROTO-SEED', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               'tiss/demo/seed.xml',
               15000, 12000, 9000, 3000, $4)`,
      [admin.tenantId, demoIdSeed, operadoraId, admin.userId]);

    const itemId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, 'GP-SEED-001',
               15000, 12000, 9000, 3000,
               '1005', 'Glosa 1005')`,
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
      itens: Array<{ itemId: string; glosaCodigo: string | null }>;
    };
    expect(body.demonstrativoId).toBe(demoIdSeed);
    expect(body.protocolo).toBe('PROTO-SEED');
    expect(body.itens.length).toBe(1);
    expect(body.itens[0]!.glosaCodigo).toBe('1005');
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
