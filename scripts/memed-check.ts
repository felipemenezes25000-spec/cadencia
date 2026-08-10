/**
 * Valida o par api-key/secret-key da Memed e mede a latencia.
 *
 * Usa `health()` do adaptador, que bate em /sinapse-prescricao/check-key — a
 * unica rota da Memed que responde "suas chaves servem?" SEM criar, alterar nem
 * apagar nada. Nao cadastra prescritor, nao emite receita, nao toca no historico
 * de ninguem. E o teste que se pode rodar contra PRODUCAO sem consequencia.
 *
 *   npx tsx --env-file=.env scripts/memed-check.ts
 */
import { createMemedProvider } from '@cadencia/integrations';

function exigir(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`${nome} ausente no .env`);
  return v;
}

async function main(): Promise<void> {
  const baseUrl = exigir('MEMED_BASE_URL');
  const apiKey = exigir('MEMED_API_KEY');

  const p = createMemedProvider({
    baseUrl,
    scriptUrl: exigir('MEMED_SCRIPT_URL'),
    apiKey,
    secretKey: exigir('MEMED_SECRET_KEY'),
  });

  // Nunca imprime a chave inteira: a saida deste script costuma virar print.
  process.stdout.write(
    `base ....... ${baseUrl}\n` +
    `api-key .... ${apiKey.slice(0, 6)}…${apiKey.slice(-4)}\n`);

  const h = await p.health();
  process.stdout.write(
    `chaves ..... ${h.up ? 'VALIDAS' : 'RECUSADAS'}\n` +
    `latencia ... ${h.latencyMs} ms\n` +
    `verificado . ${h.checkedAt}\n`);

  process.exitCode = h.up ? 0 : 1;
}

void main().catch((e: unknown) => {
  process.stderr.write(`falhou: ${(e as Error).message}\n`);
  process.exitCode = 1;
});
