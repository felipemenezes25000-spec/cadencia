import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FsStorageAdapter, InMemoryStorageAdapter, type StorageAdapter,
} from '@cadencia/storage';

let cache: StorageAdapter | null = null;

/**
 * O armazenamento de objetos da API.
 *
 * `STORAGE_DIR` aponta o disco. Sem ele, cai num diretorio temporario — que e
 * suficiente para teste e demonstracao e some no reboot da maquina, o que e
 * exatamente o que se quer de dado de teste.
 *
 * `STORAGE_DRIVER=memory` existe para a suite: escrever em disco a cada teste de
 * anexo deixa lixo em qualquer maquina que rode a suite duas vezes.
 *
 * Em producao o lugar disto e um S3-compatible em sa-east-1 (decisao 15). A
 * troca e de uma linha porque o contrato `StorageAdapter` e o mesmo.
 */
export function armazenamento(): StorageAdapter {
  if (cache !== null) return cache;

  if (process.env['STORAGE_DRIVER'] === 'memory') {
    cache = new InMemoryStorageAdapter();
    return cache;
  }

  const raiz = process.env['STORAGE_DIR']
    ?? join(tmpdir(), 'cadencia-storage');
  cache = new FsStorageAdapter(raiz);
  return cache;
}

/** Zera o cache. So para teste: cada suite escolhe o proprio adaptador. */
export function limparArmazenamento(): void {
  cache = null;
}
