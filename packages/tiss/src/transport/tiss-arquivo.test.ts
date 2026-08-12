import { describe, expect, it, beforeEach } from 'vitest';
import { createTissArquivoTransport } from './tiss-arquivo';
import { InMemoryStorageAdapter } from '@cadencia/storage';
import type { ProviderCtx } from '@cadencia/integrations';
import { assertSafetyDeclared } from '@cadencia/integrations';

const ctx: ProviderCtx = {
  tenantId: 'tenant-001',
  actorUserId: 'user-001',
  requestId: 'req-001',
  idempotencyKey: 'idem-lote-001',
  deadlineMs: 5000,
};

describe('TissArquivoTransport', () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it('submitBatch grava XML no storage e retorna receipt kind "arquivo"', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });

    const xml = new TextEncoder().encode('<loteGuias>conteudo</loteGuias>');
    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-001',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const receipt = result.value;
    expect(receipt.kind).toBe('arquivo');
    if (receipt.kind !== 'arquivo') return;

    // nome segue convenção ANS: CNPJ_ANO_MES_SEQ.xml
    expect(receipt.fileName).toMatch(/^98XYZ76543AB21_\d{4}_\d{2}_\d+\.xml$/);
    expect(receipt.sha256).toHaveLength(64);
    expect(receipt.instructions).toContain('portal');
    expect(receipt.storageKey).toBeDefined();
  });

  it('submitBatch grava os bytes IDENTICOS ao XML recebido', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });

    const xml = new TextEncoder().encode('<loteGuias>bytes identicos</loteGuias>');
    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-002',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.kind !== 'arquivo') return;

    const stored = await storage.get(result.value.storageKey);
    expect(stored).toEqual(xml);
  });

  it('SHA-256 e deterministico: mesmo XML produz mesmo hash', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });

    const xml = new TextEncoder().encode('<loteGuias>determinismo</loteGuias>');
    const r1 = await transport.submitBatch(ctx, {
      loteId: 'lote-a', xml, operadoraCnpj: '11111111111111',
      prestador: { cnpj: '22222222222222', cnes: '1234567' },
    });
    const r2 = await transport.submitBatch(ctx, {
      loteId: 'lote-b', xml, operadoraCnpj: '11111111111111',
      prestador: { cnpj: '22222222222222', cnes: '1234567' },
    });

    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    if (r1.value.kind !== 'arquivo' || r2.value.kind !== 'arquivo') return;
    expect(r1.value.sha256).toBe(r2.value.sha256);
  });

  it('mode e "arquivo"', () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    expect(transport.mode).toBe('arquivo');
  });

  it('tissVersion reflete o valor passado na criacao', () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '3.05.00',
    });
    expect(transport.tissVersion).toBe('3.05.00');
  });

  it('id e "tiss-arquivo"', () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    expect(transport.id).toBe('tiss-arquivo');
  });

  it('safety declara todos os tres metodos publicos', () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    expect(assertSafetyDeclared(transport,
      ['submitBatch', 'fetchDemonstrativo', 'submitRecursoGlosa'])).toBe(true);
  });

  it('fetchDemonstrativo retorna unsupported (Fase 5)', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    const result = await transport.fetchDemonstrativo(ctx, {
      protocolo: 'PROT-001',
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unsupported');
  });

  it('submitRecursoGlosa retorna unsupported (Fase 5)', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    const result = await transport.submitRecursoGlosa(ctx, {
      recursoId: 'rec-001',
      xml: new Uint8Array([1, 2, 3]),
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unsupported');
  });

  it('health retorna up: true', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    const h = await transport.health();
    expect(h.up).toBe(true);
    expect(h.latencyMs).toBeGreaterThanOrEqual(0);
    expect(h.checkedAt).toBeDefined();
  });

  it('instructions contem o nome do arquivo e a operadora', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    const xml = new TextEncoder().encode('<loteGuias/>');
    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-instr',
      xml,
      operadoraCnpj: '55ABC66703DE89',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.kind !== 'arquivo') return;

    expect(result.value.instructions).toContain(result.value.fileName);
    expect(result.value.instructions).toContain('55ABC66703DE89');
  });
});
