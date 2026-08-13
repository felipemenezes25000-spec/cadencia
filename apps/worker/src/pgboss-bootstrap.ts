import PgBoss from 'pg-boss';
import { FILAS } from './queues';

async function createQueueWithRetry(boss: PgBoss, queue: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await boss.createQueue(queue);
      return;
    } catch (error) {
      if ((error as { code?: unknown }).code !== '40P01' || attempt === 3) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

/** Instala/migra o schema interno da fila antes de o worker de runtime subir. */
export async function installJobSchema(
  connectionString: string,
  password?: string,
): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    ...(password === undefined ? {} : { password }),
    schema: 'pgboss',
  });
  await boss.start();
  for (const queue of FILAS) await createQueueWithRetry(boss, queue);
  await boss.stop({ graceful: true, timeout: 10_000 });
}
