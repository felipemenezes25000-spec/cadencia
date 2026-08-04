import { resolve } from 'node:path';

export function migrationsDir(): string {
  return resolve(import.meta.dirname, '../migrations');
}
