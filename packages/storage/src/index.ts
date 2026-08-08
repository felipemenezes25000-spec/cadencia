/**
 * L0 — Adaptador abstrato de armazenamento de objetos.
 * Implementacao local (fs) para dev; S3-compatible para producao.
 * Chaves sao opacos UUIDv7 com prefixo de namespace (ex: "tiss/lote-001.xml").
 */
export interface StorageAdapter {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/**
 * InMemoryStorageAdapter — para testes unitarios e de integracao.
 * NAO usar em producao. Nao persiste entre reinicializacoes.
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

  /** Utilitario de teste: retorna todas as chaves armazenadas. */
  keys(): string[] {
    return [...this.store.keys()];
  }

  /** Utilitario de teste: limpa todo o armazenamento. */
  clear(): void {
    this.store.clear();
  }
}
