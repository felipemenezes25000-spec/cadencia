import { describe, expect, it, vi } from 'vitest';
import { providers, type Providers } from './providers';

function ambienteMemed(): void {
  process.env['MEMED_BASE_URL'] ??= 'https://api.memed.test/v1';
  process.env['MEMED_SCRIPT_URL'] ??= 'https://memed.test/s.js';
  process.env['MEMED_API_KEY'] ??= 'k';
  process.env['MEMED_SECRET_KEY'] ??= 's';
  process.env['PSP_WEBHOOK_SECRET'] ??= 'segredo-de-teste-psp';
  process.env['WHATSAPP_APP_SECRET'] ??= 'segredo-de-teste-whatsapp';
}

function ambienteReal(): void {
  ambienteMemed();
  process.env['BIRDID_CLIENT_ID'] ??= 'bid';
  process.env['BIRDID_CLIENT_SECRET'] ??= 'bsec';
  process.env['WHATSAPP_ACCESS_TOKEN'] ??= 'wa-tok';
  process.env['WHATSAPP_PHONE_NUMBER_ID'] ??= 'wa-phone';
  process.env['TWILIO_ACCOUNT_SID'] ??= 'AC-test';
  process.env['TWILIO_AUTH_TOKEN'] ??= 'tw-tok';
  process.env['TWILIO_FROM_NUMBER'] ??= '+5511999999999';
  process.env['ASAAS_API_KEY'] ??= 'asaas-k';
  process.env['ASAAS_WEBHOOK_TOKEN'] ??= 'asaas-wh';
}

async function recarregarProviders(): Promise<() => Providers> {
  vi.resetModules();
  return (await import('./providers')).providers;
}

describe('registry de providers (fake)', () => {
  it('inclui signature, prescription, messaging e payment', () => {
    const p: Providers = providers();
    expect(p.signature.id).toBe('signature-fake');
    expect(p.prescription.id).toBe('prescription-fake');
    expect(p.messaging.id).toBe('messaging-whatsapp-fake');
    expect(p.payment.id).toBe('payment-fake');
  });

  it('todos declaram safety para seus metodos', () => {
    const p = providers();
    expect(Object.keys(p.messaging.safety).length).toBeGreaterThan(0);
    expect(Object.keys(p.payment.safety).length).toBeGreaterThan(0);
  });

  it('todos declaram capabilities', () => {
    const p = providers();
    expect(p.messaging.capabilities.size).toBeGreaterThan(0);
    expect(p.payment.capabilities.size).toBeGreaterThan(0);
  });
});

describe('modo so-prescricao', () => {
  it('CADENCIA_PROVIDERS=memed liga a Memed sem exigir assinatura ICP-Brasil', async () => {
    // A chave existe porque `real` é tudo-ou-nada e trava no boot enquanto não
    // houver adaptador ICP-Brasil. Sem este meio-termo a Memed nunca poderia ser
    // ligada — e para RECEITA a própria Memed é a camada de assinatura
    // qualificada, então a trava estava protegendo o documento errado.
    const anterior = process.env['CADENCIA_PROVIDERS'];
    process.env['CADENCIA_PROVIDERS'] = 'memed';
    ambienteMemed();
    const recarregado = await recarregarProviders();
    try {
      const p = recarregado() as Providers;
      expect(p.prescription.id).toBe('memed');
      expect(p.signature.id).toBe('signature-nao-contratado');
    } finally {
      if (anterior === undefined) delete process.env['CADENCIA_PROVIDERS'];
      else process.env['CADENCIA_PROVIDERS'] = anterior;
    }
  });
});

describe('assinatura fora de desenvolvimento', () => {
  it('modo memed NAO usa assinatura fake', async () => {
    const anterior = process.env['CADENCIA_PROVIDERS'];
    process.env['CADENCIA_PROVIDERS'] = 'memed';
    ambienteMemed();
    const recarregado = await recarregarProviders();
    try {
      const p = recarregado() as Providers;
      expect(p.signature.id).toBe('signature-nao-contratado');
      expect(p.signature.capabilities.has('ad-rt')).toBe(false);
    } finally {
      if (anterior === undefined) delete process.env['CADENCIA_PROVIDERS'];
      else process.env['CADENCIA_PROVIDERS'] = anterior;
    }
  });

  it('modo real usa BirdID para assinatura ICP-Brasil', async () => {
    const anterior = process.env['CADENCIA_PROVIDERS'];
    process.env['CADENCIA_PROVIDERS'] = 'real';
    ambienteReal();
    const recarregado = await recarregarProviders();
    try {
      const p = recarregado() as Providers;
      expect(p.signature.id).toBe('signature-birdid');
    } finally {
      if (anterior === undefined) delete process.env['CADENCIA_PROVIDERS'];
      else process.env['CADENCIA_PROVIDERS'] = anterior;
    }
  });
});

describe('segredo de webhook fora de desenvolvimento', () => {
  for (const [modo, variavel, ambienteFn] of [
    ['real', 'ASAAS_WEBHOOK_TOKEN', ambienteReal],
    ['real', 'WHATSAPP_APP_SECRET', ambienteReal],
    ['memed', 'PSP_WEBHOOK_SECRET', ambienteMemed],
    ['memed', 'WHATSAPP_APP_SECRET', ambienteMemed],
  ] as const) {
    it(`modo ${modo} nao sobe sem ${variavel}`, async () => {
      const antesModo = process.env['CADENCIA_PROVIDERS'];
      const antesVar = process.env[variavel];
      process.env['CADENCIA_PROVIDERS'] = modo;
      (ambienteFn as () => void)();
      delete process.env[variavel];
      const recarregado = await recarregarProviders();
      try {
        expect(() => (recarregado as () => Providers)()).toThrow(variavel);
      } finally {
        if (antesVar === undefined) delete process.env[variavel];
        else process.env[variavel] = antesVar;
        if (antesModo === undefined) delete process.env['CADENCIA_PROVIDERS'];
        else process.env['CADENCIA_PROVIDERS'] = antesModo;
      }
    });
  }
});
