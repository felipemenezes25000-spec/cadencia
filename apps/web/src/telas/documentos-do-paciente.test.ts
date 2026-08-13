import { describe, expect, it, vi } from 'vitest';
import { carregarDocumentosDoPaciente } from './documentos-do-paciente';

describe('carregarDocumentosDoPaciente', () => {
  it('mantém documentos emitidos quando anexos são proibidos para recepção', async () => {
    const itens = await carregarDocumentosDoPaciente(
      vi.fn(async () => ({ itens: [{
        documentId: 'doc-1', kind: 'atestado', titulo: 'Atestado',
        issuedDate: '2026-08-12', createdAt: '2026-08-12T10:00:00Z', assinado: true,
      }] })),
      vi.fn(async () => { throw new Error('403 attachment.read'); }),
    );
    expect(itens).toEqual([expect.objectContaining({
      id: 'doc-1', origem: 'emitido', titulo: 'Atestado', assinado: true,
    })]);
  });

  it('propaga falha dos documentos emitidos, que são a permissão mínima da aba', async () => {
    await expect(carregarDocumentosDoPaciente(
      async () => { throw new Error('403 document.read'); },
      async () => ({ itens: [] }),
    )).rejects.toThrow('document.read');
  });
});
