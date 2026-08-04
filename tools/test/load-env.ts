import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Node 24 tem process.loadEnvFile nativo. Sem isto, DATABASE_URL_ADMIN nao chega
// aos testes de integracao e cada arquivo teria que ler o .env por conta propria.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
