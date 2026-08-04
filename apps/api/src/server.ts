import { closePools } from '@cadencia/db';
import { buildApp } from './app';

const PORTA = Number(process.env['PORT'] ?? 3001);

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: PORTA, host: '0.0.0.0' });

  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void (async () => {
        await app.close();
        await closePools();
        process.exit(0);
      })();
    });
  }
}

void main();
