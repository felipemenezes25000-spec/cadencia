import { hash, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';

/**
 * Parametros minimos recomendados pela OWASP para Argon2id (19 MiB, 2 iteracoes,
 * paralelismo 1). Mudar qualquer valor aqui obriga a mudar PREFIXO_ATUAL abaixo,
 * senao needsRehash() para de detectar hashes antigos e ninguem nunca migra.
 *
 * Algorithm.Argon2id vale 2. O @node-rs/argon2 declara Algorithm como `const enum`
 * ambiente, e ler um membro dele e proibido sob verbatimModuleSyntax (TS2748), entao
 * o valor entra literal e o tipo do enum volta pela asercao. O prefixo do hash
 * checado nos testes prova que o algoritmo usado e mesmo o Argon2id.
 */
export const ARGON2ID_PARAMS = {
  algorithm: 2 as Algorithm,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const PREFIXO_ATUAL = '$argon2id$v=19$m=19456,t=2,p=1$';

/**
 * Unifica a forma Unicode: NFC no cadastro e no login. Sem isto, "Recepcao@2026"
 * com acento digitado no Windows e no macOS sao dois strings diferentes.
 */
function normalizar(plain: string): string {
  return plain.normalize('NFC');
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(normalizar(plain), ARGON2ID_PARAMS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  if (storedHash.length === 0) return false;
  try {
    return await verify(storedHash, normalizar(plain), ARGON2ID_PARAMS);
  } catch {
    // Hash corrompido, truncado ou de outro algoritmo: falha fechada.
    return false;
  }
}

export function needsRehash(storedHash: string): boolean {
  return !storedHash.startsWith(PREFIXO_ATUAL);
}
