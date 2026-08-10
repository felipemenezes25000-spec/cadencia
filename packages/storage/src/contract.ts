/**
 * O contrato de armazenamento, sozinho.
 *
 * Mora fora do `index` porque os adaptadores precisam dele e o `index` os
 * reexporta — importar o barril de dentro de um adaptador fecha um ciclo que o
 * `arch:check` reprova, com razao: barril que depende do que ele exporta faz a
 * ordem de carga virar detalhe de sorte.
 */
export interface StorageAdapter {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
