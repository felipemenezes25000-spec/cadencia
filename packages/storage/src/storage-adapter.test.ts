import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryStorageAdapter } from './index';

describe('InMemoryStorageAdapter', () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it('put e get devolvem os mesmos bytes', async () => {
    const dados = new TextEncoder().encode('conteudo do lote TISS');
    await storage.put('tiss/lote-001.xml', dados, 'application/xml');

    const resultado = await storage.get('tiss/lote-001.xml');
    expect(resultado).not.toBeNull();
    expect(resultado).toEqual(dados);
  });

  it('get retorna null para chave inexistente', async () => {
    const resultado = await storage.get('nao-existe');
    expect(resultado).toBeNull();
  });

  it('exists retorna true para chave existente e false para inexistente', async () => {
    const dados = new Uint8Array([1, 2, 3]);
    await storage.put('chave-a', dados, 'application/octet-stream');

    expect(await storage.exists('chave-a')).toBe(true);
    expect(await storage.exists('chave-b')).toBe(false);
  });

  it('delete remove o objeto armazenado', async () => {
    const dados = new Uint8Array([10, 20]);
    await storage.put('temp', dados, 'text/plain');
    expect(await storage.exists('temp')).toBe(true);

    await storage.delete('temp');
    expect(await storage.exists('temp')).toBe(false);
    expect(await storage.get('temp')).toBeNull();
  });

  it('put sobrescreve dados existentes na mesma chave', async () => {
    const v1 = new TextEncoder().encode('versao 1');
    const v2 = new TextEncoder().encode('versao 2');
    await storage.put('doc', v1, 'text/plain');
    await storage.put('doc', v2, 'text/plain');

    const resultado = await storage.get('doc');
    expect(resultado).toEqual(v2);
  });

  it('put faz copia defensiva dos bytes', async () => {
    const original = new Uint8Array([1, 2, 3]);
    await storage.put('copia', original, 'application/octet-stream');
    original[0] = 99;

    const resultado = await storage.get('copia');
    expect(resultado![0]).toBe(1);
  });

  it('get faz copia defensiva dos bytes retornados', async () => {
    const dados = new Uint8Array([5, 6, 7]);
    await storage.put('safe', dados, 'application/octet-stream');

    const r1 = await storage.get('safe');
    r1![0] = 99;

    const r2 = await storage.get('safe');
    expect(r2![0]).toBe(5);
  });

  it('keys() lista todas as chaves armazenadas', async () => {
    await storage.put('a', new Uint8Array([1]), 'text/plain');
    await storage.put('b', new Uint8Array([2]), 'text/plain');

    expect(storage.keys().sort()).toEqual(['a', 'b']);
  });

  it('clear() esvazia o armazenamento', async () => {
    await storage.put('x', new Uint8Array([1]), 'text/plain');
    storage.clear();

    expect(storage.keys()).toEqual([]);
    expect(await storage.exists('x')).toBe(false);
  });
});
