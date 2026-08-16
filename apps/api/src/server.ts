import { closePools } from '@cadencia/db';
import { buildApp } from './app';
import { armazenamento } from './storage';

const PORTA = Number(process.env['PORT'] ?? 3001);

async function main(): Promise<void> {
  // Fail closed antes de abrir a porta. Em CADENCIA_ENV=production a fabrica
  // recusa filesystem/memoria e S3 sem KMS; portanto uma task mal configurada
  // nunca aparece como saudavel no ALB para so falhar no primeiro anexo.
  armazenamento();

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
