import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StorageAdapter } from './contract';
import { FsStorageAdapter } from './fs-adapter';
import { S3StorageAdapter } from './s3-adapter';

/** L0 — contrato e adaptadores de armazenamento de objetos. */
export type { StorageAdapter } from './contract';
export { FsStorageAdapter } from './fs-adapter';
export { S3StorageAdapter, type S3StorageOptions } from './s3-adapter';

/**
 * InMemoryStorageAdapter — para testes unitários e de integração.
 * NÃO usar em produção. Não persiste entre reinicializações.
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, { data: Uint8Array; contentType: string }>();

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    this.store.set(key, { data: new Uint8Array(data), contentType });
  }

  async get(key: string): Promise<Uint8Array | null> {
    const entry = this.store.get(key);
    return entry !== undefined ? new Uint8Array(entry.data) : null;
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  keys(): string[] { return [...this.store.keys()]; }
  clear(): void { this.store.clear(); }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') throw new Error(`variavel de ambiente ausente: ${name}`);
  return value;
}

/**
 * Fabrica única para API e worker. Em produção é fail-closed: filesystem e
 * memória são recusados, e S3 sem KMS também. Isso impede uma task Fargate de
 * subir aparentemente saudável enquanto grava prontuário no disco efêmero.
 */
export function createStorageAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): StorageAdapter {
  const driver = env['STORAGE_DRIVER'] ?? 'fs';
  const production = env['CADENCIA_ENV'] === 'production';

  if (production && driver !== 's3') {
    throw new Error('STORAGE_DRIVER=s3 obrigatorio em CADENCIA_ENV=production');
  }

  if (driver === 's3') {
    const kmsKeyId = env['STORAGE_KMS_KEY_ID'];
    if (production && (!kmsKeyId || kmsKeyId.trim() === '')) {
      throw new Error('STORAGE_KMS_KEY_ID obrigatorio em producao');
    }
    return new S3StorageAdapter({
      bucket: required(env, 'STORAGE_S3_BUCKET'),
      region: env['AWS_REGION'] ?? env['AWS_DEFAULT_REGION'] ?? 'sa-east-1',
      ...(kmsKeyId ? { kmsKeyId } : {}),
    });
  }

  if (driver === 'memory') return new InMemoryStorageAdapter();
  if (driver !== 'fs') throw new Error(`STORAGE_DRIVER desconhecido: ${driver}`);
  return new FsStorageAdapter(env['STORAGE_DIR'] ?? join(tmpdir(), 'cadencia-storage'));
}
