import type { StorageAdapter } from './contract';
/**
 * L0 — Adaptador abstrato de armazenamento de objetos.
 * Implementação local (fs) para dev; S3-compatible para produção.
 * Chaves são opacos UUIDv7 com prefixo de namespace (ex: "tiss/lote-001.xml").
 */
export type { StorageAdapter } from './contract';

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

  /** Utilitário de teste: retorna todas as chaves armazenadas. */
  keys(): string[] {
    return [...this.store.keys()];
  }

  /** Utilitário de teste: limpa todo o armazenamento. */
  clear(): void {
    this.store.clear();
  }
}

export { FsStorageAdapter } from './fs-adapter';
