import { describe, expect, it } from 'vitest';
import { createFakeTissArquivoTransport } from './tiss-arquivo-fake';
import type { ProviderCtx } from '@cadencia/integrations';
import { assertSafetyDeclared } from '@cadencia/integrations';

const ctx: ProviderCtx = {
  tenantId: 'tenant-fake',
  actorUserId: 'user-fake',
  requestId: 'req-fake',
  idempotencyKey: 'idem-fake-001',
  deadlineMs: 3000,
};

describe('FakeTissArquivoTransport', () => {
  it('modo ok: submitBatch retorna receipt com kind "arquivo"', async () => {
    const transport = createFakeTissArquivoTransport();
    const xml = new TextEncoder().encode('<loteGuias>fake</loteGuias>');

    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-fake-001',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('arquivo');
    if (result.value.kind !== 'arquivo') return;
    expect(result.value.fileName).toContain('98XYZ76543AB21');
    expect(result.value.sha256).toHaveLength(64);
    expect(result.value.instructions).toContain('portal');
  });

  it('modo ok: lotes submetidos ficam disponiveis para inspecao', async () => {
    const transport = createFakeTissArquivoTransport();
    const xml = new TextEncoder().encode('<loteGuias>inspecao</loteGuias>');

    await transport.submitBatch(ctx, {
      loteId: 'lote-insp',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(transport.submittedBatches).toHaveLength(1);
    expect(transport.submittedBatches[0]!.loteId).toBe('lote-insp');
    expect(transport.submittedBatches[0]!.xml).toEqual(xml);
  });

  it('modo indisponivel: submitBatch retorna unavailable', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'indisponivel' });
    const xml = new TextEncoder().encode('<loteGuias/>');

    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-err',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unavailable');
  });

  it('modo timeout: submitBatch retorna timeout', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'timeout' });
    const xml = new TextEncoder().encode('<loteGuias/>');

    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-to',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('timeout');
  });

  it('mode e "arquivo" e id e "tiss-arquivo-fake"', () => {
    const transport = createFakeTissArquivoTransport();
    expect(transport.mode).toBe('arquivo');
    expect(transport.id).toBe('tiss-arquivo-fake');
  });

  it('safety declara todos os tres metodos', () => {
    const transport = createFakeTissArquivoTransport();
    expect(assertSafetyDeclared(transport,
      ['submitBatch', 'fetchDemonstrativo', 'submitRecursoGlosa'])).toBe(true);
  });

  it('fetchDemonstrativo retorna unsupported', async () => {
    const transport = createFakeTissArquivoTransport();
    const result = await transport.fetchDemonstrativo(ctx, {
      protocolo: 'PROT-001',
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unsupported');
  });

  it('submitRecursoGlosa retorna sucesso com arquivo', async () => {
    const transport = createFakeTissArquivoTransport();
    const result = await transport.submitRecursoGlosa(ctx, {
      recursoId: 'rec-001',
      xml: new Uint8Array([1, 2, 3]),
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('arquivo');
    expect(transport.submittedRecursos).toHaveLength(1);
    expect(transport.submittedRecursos[0]!.recursoId).toBe('rec-001');
  });

  it('submitRecursoGlosa retorna timeout quando modo e timeout', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'timeout' });
    const result = await transport.submitRecursoGlosa(ctx, {
      recursoId: 'rec-002',
      xml: new Uint8Array([4, 5, 6]),
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('timeout');
    expect(transport.submittedRecursos).toHaveLength(0);
  });

  it('health retorna up: true em modo ok e up: false em modo indisponivel', async () => {
    const ok = createFakeTissArquivoTransport();
    expect((await ok.health()).up).toBe(true);

    const down = createFakeTissArquivoTransport({ modo: 'indisponivel' });
    expect((await down.health()).up).toBe(false);
  });
});
