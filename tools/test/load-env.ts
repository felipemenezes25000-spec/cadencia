import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Node 24 tem process.loadEnvFile nativo. Sem isto, DATABASE_URL_ADMIN nao chega
// aos testes de integracao e cada arquivo teria que ler o .env por conta propria.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

/**
 * Teste NUNCA fala com parceiro de verdade.
 *
 * O `.env` da maquina pode estar em `memed` ou `real` porque alguem estava
 * verificando a integracao. Sem esta linha a suite herda isso e passa a chamar a
 * API de PRODUCAO da Memed a cada rodada — criando prescritor, gastando cota e
 * fazendo o resultado do teste depender da internet do desenvolvedor.
 *
 * Quem quiser exercitar o adaptador real faz isso explicitamente, no proprio
 * teste, e nunca por herança de ambiente.
 */
process.env['CADENCIA_PROVIDERS'] = 'fake';

/**
 * Teste tambem nao escreve no disco do desenvolvedor. Anexo gravado em arquivo
 * a cada rodada deixa lixo que ninguem limpa e faz a suite depender do estado
 * do sistema de arquivos — o mesmo problema que ja temos com o banco.
 */
process.env['STORAGE_DRIVER'] = 'memory';
