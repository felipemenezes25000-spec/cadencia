import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageAdapter } from './fs-adapter';

const raizes: string[] = [];
function raiz(): string {
  const d = mkdtempSync(join(tmpdir(), 'cadencia-store-'));
  raizes.push(d);
  return d;
}
afterEach(() => {
  for (const d of raizes.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('FsStorageAdapter', () => {
  it('grava e devolve os MESMOS bytes', async () => {
    const a = new FsStorageAdapter(raiz());
    const dados = new Uint8Array([0, 255, 10, 13, 26, 127]);
    await a.put('anexos/x.bin', dados, 'application/octet-stream');
    const lido = await a.get('anexos/x.bin');
    // Bytes de controle (0x00, 0x0d, 0x1a) sao onde leitura em modo texto
    // corrompe silenciosamente. Anexo clinico tem que voltar identico.
    expect(lido).toEqual(dados);
  });

  it('chave inexistente devolve null, nao excecao', async () => {
    const a = new FsStorageAdapter(raiz());
    expect(await a.get('nao/existe')).toBeNull();
    expect(await a.exists('nao/existe')).toBe(false);
  });

  it('recusa chave que escapa da raiz', async () => {
    const a = new FsStorageAdapter(raiz());
    // `../` numa chave vinda de requisicao leria qualquer arquivo do servidor.
    // A chave e opaca por contrato, mas a defesa mora aqui e nao na confianca.
    await expect(a.get('../../etc/passwd')).rejects.toThrow(/chave/i);
    await expect(a.put('../fuga', new Uint8Array([1]), 'x')).rejects.toThrow(/chave/i);
  });

  it('apagar remove de verdade', async () => {
    const a = new FsStorageAdapter(raiz());
    await a.put('k', new Uint8Array([1, 2]), 'x');
    await a.delete('k');
    expect(await a.exists('k')).toBe(false);
    // Apagar de novo nao explode: purga da LGPD roda mais de uma vez.
    await a.delete('k');
  });
});
