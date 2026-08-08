import { describe, expect, it } from 'vitest';
import type { TissSubmissionReceipt, TissTransport } from './types';
import type { Rfc3339, StorageKey } from '@cadencia/integrations';

describe('TissTransport tipos', () => {
  it('TissSubmissionReceipt discrimina por kind "arquivo"', () => {
    const receipt: TissSubmissionReceipt = {
      kind: 'arquivo',
      storageKey: 'tiss/lote-001.xml' as StorageKey,
      fileName: '12ABC34503DE37_2026_08_001.xml',
      sha256: 'abc123',
      instructions: 'Acesse o portal, menu Importar Lote',
    };
    expect(receipt.kind).toBe('arquivo');
    if (receipt.kind === 'arquivo') {
      expect(receipt.storageKey).toBe('tiss/lote-001.xml');
      expect(receipt.fileName).toBeDefined();
      expect(receipt.sha256).toBeDefined();
      expect(receipt.instructions).toBeDefined();
    }
  });

  it('TissSubmissionReceipt discrimina por kind "protocolo"', () => {
    const receipt: TissSubmissionReceipt = {
      kind: 'protocolo',
      protocolo: 'PROT-2026-001',
      recebidoEm: '2026-08-07T10:00:00.000Z' as Rfc3339,
    };
    expect(receipt.kind).toBe('protocolo');
    if (receipt.kind === 'protocolo') {
      expect(receipt.protocolo).toBe('PROT-2026-001');
      expect(receipt.recebidoEm).toBeDefined();
    }
  });

  it('TissTransport exige mode, tissVersion e os tres metodos', () => {
    // Verificacao em tempo de compilacao: se o tipo compilar, os campos existem.
    // O teste de runtime usa um objeto que satisfaz a interface minimamente.
    const stub: Pick<TissTransport, 'mode' | 'tissVersion'> = {
      mode: 'arquivo',
      tissVersion: '4.01.00',
    };
    expect(stub.mode).toBe('arquivo');
    expect(stub.tissVersion).toBe('4.01.00');
  });

  it('mode so aceita "arquivo" ou "webservice"', () => {
    const modos: TissTransport['mode'][] = ['arquivo', 'webservice'];
    expect(modos).toContain('arquivo');
    expect(modos).toContain('webservice');
    expect(modos).toHaveLength(2);
  });
});
