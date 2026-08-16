import {
  createStorageAdapterFromEnv, type StorageAdapter,
} from '@cadencia/storage';

let cache: StorageAdapter | null = null;

/**
 * O armazenamento de objetos da API. A fábrica compartilhada é fail-closed em
 * produção: Fargate só sobe com S3 + KMS; dev/teste continuam podendo usar fs
 * ou memória sem mudar os testes existentes.
 */
export function armazenamento(): StorageAdapter {
  cache ??= createStorageAdapterFromEnv();
  return cache;
}

/** Zera o cache. Só para teste: cada suíte escolhe o próprio adaptador. */
export function limparArmazenamento(): void {
  cache = null;
}
