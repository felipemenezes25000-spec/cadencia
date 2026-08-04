import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from './migrate';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const result = await runMigrations();
if (result.applied.length === 0) {
  console.log('nenhuma migration pendente');
} else {
  for (const name of result.applied) {
    console.log(`aplicada: ${name}`);
  }
}
