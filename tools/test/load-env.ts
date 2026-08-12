import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Node 24 tem process.loadEnvFile nativo. Sem isto, DATABASE_URL_ADMIN não chega
// aos testes de integração e cada arquivo teria que ler o .env por conta própria.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

/**
 * Teste NUNCA fala com parceiro de verdade.
 *
 * O `.env` da máquina pode estar em `memed` ou `real` porque alguém estava
 * verificando a integração. Sem esta linha a suite herda isso e passa a chamar a
 * API de PRODUÇÃO da Memed a cada rodada — criando prescritor, gastando cota e
 * fazendo o resultado do teste depender da internet do desenvolvedor.
 *
 * Quem quiser exercitar o adaptador real faz isso explicitamente, no próprio
 * teste, e nunca por herança de ambiente.
 */
process.env['CADENCIA_PROVIDERS'] = 'fake';

/**
 * Teste também não escreve no disco do desenvolvedor. Anexo gravado em arquivo
 * a cada rodada deixa lixo que ninguém limpa e faz a suite depender do estado
 * do sistema de arquivos — o mesmo problema que já temos com o banco.
 */
process.env['STORAGE_DRIVER'] = 'memory';
