import { mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { StorageAdapter } from './contract';

/**
 * Armazenamento em disco local.
 *
 * Existe porque o único adaptador até agora era o em memória, e anexo que some
 * quando a API reinicia não é anexo: o exame que o paciente trouxe some junto.
 * Em produção o lugar disto é um S3-compatible em sa-east-1 (decisão 15), e a
 * troca é de uma linha porque o contrato é o mesmo.
 */
export class FsStorageAdapter implements StorageAdapter {
  private readonly raiz: string;

  constructor(raiz: string) {
    this.raiz = resolve(raiz);
  }

  /**
   * Resolve a chave DENTRO da raiz, ou recusa.
   *
   * A chave é opaca por contrato, mas "por contrato" não é defesa: um `../` que
   * escape daqui lê qualquer arquivo do servidor. A checagem é feita no caminho
   * já resolvido, e não por procura de `..` no texto — `a/../../b` e `%2e%2e`
   * passam por qualquer filtro textual.
   */
  private caminho(chave: string): string {
    const alvo = resolve(this.raiz, chave);
    if (alvo !== this.raiz && !alvo.startsWith(this.raiz + sep)) {
      throw new Error(`chave fora da raiz de armazenamento: ${chave}`);
    }
    return alvo;
  }

  async put(chave: string, dados: Uint8Array, _contentType: string): Promise<void> {
    const alvo = this.caminho(chave);
    await mkdir(dirname(alvo), { recursive: true });
    await writeFile(alvo, dados);
  }

  async get(chave: string): Promise<Uint8Array | null> {
    const alvo = this.caminho(chave);
    try {
      return new Uint8Array(await readFile(alvo));
    } catch (e) {
      // Ausência é resposta válida, não falha. Quem chama distingue "não existe"
      // de "não consegui ler" pelo erro que sobe.
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async exists(chave: string): Promise<boolean> {
    try {
      await access(this.caminho(chave));
      return true;
    } catch {
      return false;
    }
  }

  async delete(chave: string): Promise<void> {
    // `force` porque apagar o que já não existe é sucesso: a purga da LGPD roda
    // mais de uma vez sobre o mesmo acervo e não pode falhar na segunda.
    await rm(this.caminho(chave), { force: true });
  }

  /** Caminho absoluto de uma chave. Útil em diagnóstico, nunca em resposta. */
  caminhoDe(chave: string): string {
    return join(this.raiz, chave);
  }
}
