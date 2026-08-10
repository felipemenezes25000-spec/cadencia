import { mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { StorageAdapter } from './contract';

/**
 * Armazenamento em disco local.
 *
 * Existe porque o unico adaptador ate agora era o em memoria, e anexo que some
 * quando a API reinicia nao e anexo: o exame que o paciente trouxe some junto.
 * Em producao o lugar disto e um S3-compatible em sa-east-1 (decisao 15), e a
 * troca e de uma linha porque o contrato e o mesmo.
 */
export class FsStorageAdapter implements StorageAdapter {
  private readonly raiz: string;

  constructor(raiz: string) {
    this.raiz = resolve(raiz);
  }

  /**
   * Resolve a chave DENTRO da raiz, ou recusa.
   *
   * A chave e opaca por contrato, mas "por contrato" nao e defesa: um `../` que
   * escape daqui le qualquer arquivo do servidor. A checagem e feita no caminho
   * ja resolvido, e nao por procura de `..` no texto — `a/../../b` e `%2e%2e`
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
      // Ausencia e resposta valida, nao falha. Quem chama distingue "nao existe"
      // de "nao consegui ler" pelo erro que sobe.
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
    // `force` porque apagar o que ja nao existe e sucesso: a purga da LGPD roda
    // mais de uma vez sobre o mesmo acervo e nao pode falhar na segunda.
    await rm(this.caminho(chave), { force: true });
  }

  /** Caminho absoluto de uma chave. Util em diagnostico, nunca em resposta. */
  caminhoDe(chave: string): string {
    return join(this.raiz, chave);
  }
}
