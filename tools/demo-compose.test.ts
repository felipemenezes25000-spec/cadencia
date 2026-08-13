import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function renderedDemoCompose(): {
  services: Record<string, { environment?: Record<string, string> }>;
} {
  const output = execFileSync(
    'docker', ['compose', '-f', 'docker-compose.demo.yml', 'config', '--format', 'json'],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: {
        ...process.env,
        POSTGRES_PASSWORD: 'postgres-test',
        API_PASSWORD: 'api-test',
        JOBS_PASSWORD: 'jobs-test',
        CADENCIA_TOTP_KEY: Buffer.alloc(32, 1).toString('base64'),
        CADENCIA_PROVIDERS: 'memed',
        MEMED_BASE_URL: 'https://memed.example/v1',
        MEMED_SCRIPT_URL: 'https://memed.example/sinapse.js',
        MEMED_API_KEY: 'memed-api-test',
        MEMED_SECRET_KEY: 'memed-secret-test',
        OPENAI_API_KEY: 'openai-test',
        ICD_CLIENT_ID: 'icd-client-test',
        ICD_CLIENT_SECRET: 'icd-secret-test',
        WHATSAPP_APP_SECRET: 'whatsapp-test',
        PSP_WEBHOOK_SECRET: 'psp-test',
      },
    },
  );
  return JSON.parse(output) as {
    services: Record<string, { environment?: Record<string, string> }>;
  };
}

describe('compose da demonstracao', () => {
  it('repassa a selecao de provedores e suas credenciais para a API', () => {
    const environment = renderedDemoCompose().services['api']?.environment;

    expect(environment).toMatchObject({
      CADENCIA_PROVIDERS: 'memed',
      MEMED_BASE_URL: 'https://memed.example/v1',
      MEMED_SCRIPT_URL: 'https://memed.example/sinapse.js',
      MEMED_API_KEY: 'memed-api-test',
      MEMED_SECRET_KEY: 'memed-secret-test',
      OPENAI_API_KEY: 'openai-test',
      ICD_CLIENT_ID: 'icd-client-test',
      ICD_CLIENT_SECRET: 'icd-secret-test',
      WHATSAPP_APP_SECRET: 'whatsapp-test',
      PSP_WEBHOOK_SECRET: 'psp-test',
    });
  });

  it('mantem o worker no mesmo modo de provedores da API', () => {
    expect(renderedDemoCompose().services['worker']?.environment)
      .toMatchObject({ CADENCIA_PROVIDERS: 'memed' });
  });
});
