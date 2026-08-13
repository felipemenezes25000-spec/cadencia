import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type RenderedCompose = {
  services: Record<string, {
    environment?: Record<string, string>;
    healthcheck?: { test?: string[] };
    depends_on?: Record<string, { condition?: string }>;
    command?: string[];
  }>;
};

let rendered: RenderedCompose | undefined;

function renderedDemoCompose(): RenderedCompose {
  if (rendered !== undefined) return rendered;
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
  rendered = JSON.parse(output) as RenderedCompose;
  return rendered;
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
  }, 30_000);

  it('mantem o worker no mesmo modo de provedores da API', () => {
    expect(renderedDemoCompose().services['worker']?.environment)
      .toMatchObject({ CADENCIA_PROVIDERS: 'memed' });
  }, 30_000);

  it('publica healthcheck da API para o orquestrador', () => {
    expect(renderedDemoCompose().services['api']?.healthcheck?.test)
      .toEqual(expect.arrayContaining(['http://127.0.0.1:3001/health']));
  }, 30_000);

  it('executa o bootstrap antes da API e do worker sem expor a senha administrativa', () => {
    const services = renderedDemoCompose().services;
    expect(services['bootstrap']?.command)
      .toEqual(expect.arrayContaining(['scripts/bootstrap-production.ts']));
    expect(services['api']?.depends_on?.['bootstrap']?.condition)
      .toBe('service_completed_successfully');
    expect(services['worker']?.depends_on?.['bootstrap']?.condition)
      .toBe('service_completed_successfully');
    expect(services['api']?.environment).toMatchObject({
      DATABASE_URL: 'postgres://api@db:5432/cadencia',
      DATABASE_PASSWORD: 'api-test',
    });
    expect(services['worker']?.environment).toMatchObject({
      DATABASE_URL_JOBS: 'postgres://jobs@db:5432/cadencia',
      DATABASE_JOBS_PASSWORD: 'jobs-test',
    });
    expect(services['api']?.environment?.['DATABASE_URL_ADMIN']).toBeUndefined();
    expect(services['worker']?.environment?.['DATABASE_URL_ADMIN']).toBeUndefined();
  }, 30_000);
});
