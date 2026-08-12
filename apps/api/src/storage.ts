import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FsStorageAdapter, InMemoryStorageAdapter, type StorageAdapter,
} from '@cadencia/storage';

let cache: StorageAdapter | null = null;

/**
 * O armazenamento de objetos da API.
 *
 * `STORAGE_DIR` aponta o disco. Sem ele, cai num diretório temporário — que é
 * suficiente para teste e demonstração e some no reboot da máquina, o que é
 * exatamente o que se quer de dado de teste.
 *
 * `STORAGE_DRIVER=memory` existe para a suíte: escrever em disco a cada teste de
 * anexo deixa lixo em qualquer máquina que rode a suíte duas vezes.
 *
 * Em produção o lugar disto é um S3-compatible em sa-east-1 (decisão 15). A
 * troca é de uma linha porque o contrato `StorageAdapter` é o mesmo.
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

/** Zera o cache. Só para teste: cada suíte escolhe o próprio adaptador. */
export function limparArmazenamento(): void {
  cache = null;
}
