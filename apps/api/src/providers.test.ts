import { describe, expect, it } from 'vitest';
import { providers, type Providers } from './providers';

/**
 * Ambiente mínimo de um modo que não é `fake`.
 *
 * Os segredos de webhook entram aqui junto das chaves da Memed porque são
 * exigência do MESMO nível: `real` e `memed` registram as rotas de webhook, que
 * atendem sem sessão e têm o HMAC como única barreira.
 */
function ambienteNaoFake(): void {
  process.env['MEMED_BASE_URL'] ??= 'https://api.memed.test/v1';
  process.env['MEMED_SCRIPT_URL'] ??= 'https://memed.test/s.js';
  process.env['MEMED_API_KEY'] ??= 'k';
  process.env['MEMED_SECRET_KEY'] ??= 's';
  process.env['PSP_WEBHOOK_SECRET'] ??= 'segredo-de-teste-psp';
  process.env['WHATSAPP_APP_SECRET'] ??= 'segredo-de-teste-whatsapp';
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
    ambienteNaoFake();
    const { providers: recarregado } = await import(`./providers?memed=${Date.now()}`);
    try {
      const p = recarregado() as Providers;
      expect(p.prescription.id).toBe('memed');
      // Assinatura NÃO é fake: é a que RECUSA. O fake assina com sucesso e
      // reporta 'valida' — num modo que emite receita de verdade isso gravaria
      // atestado 'assinado' sem valor legal, indistinguível no banco.
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
    ambienteNaoFake();
    const { providers: recarregado } = await import(`./providers?assin=${Date.now()}`);
    try {
      const p = recarregado() as Providers;
      // O fake ASSINA e reporta 'valida'. Num ambiente que emite documento de
      // verdade isso grava atestado com estado 'assinado' e sem valor legal —
      // e ninguém consegue distinguir depois. Aqui tem que recusar.
      expect(p.signature.id).toBe('signature-nao-contratado');
      expect(p.signature.capabilities.has('ad-rt')).toBe(false);
    } finally {
      if (anterior === undefined) delete process.env['CADENCIA_PROVIDERS'];
      else process.env['CADENCIA_PROVIDERS'] = anterior;
    }
  });

  it('modo real SOBE — documento nasce pendente em vez de o sistema nao subir', async () => {
    const anterior = process.env['CADENCIA_PROVIDERS'];
    process.env['CADENCIA_PROVIDERS'] = 'real';
    ambienteNaoFake();
    const { providers: recarregado } = await import(`./providers?real=${Date.now()}`);
    try {
      // Antes isto lançava no boot. Travar o sistema inteiro não protegia
      // ninguém: com a API no chão ninguém emite documento nenhum, nem os que
      // funcionam. Com o provedor que recusa, a clínica opera e o atestado fica
      // explicitamente pendente até haver PSC.
      const p = recarregado() as Providers;
      expect(p.signature.id).toBe('signature-nao-contratado');
    } finally {
      if (anterior === undefined) delete process.env['CADENCIA_PROVIDERS'];
      else process.env['CADENCIA_PROVIDERS'] = anterior;
    }
  });
});

describe('segredo de webhook fora de desenvolvimento', () => {
  /**
   * `POST /v1/payments/webhook` e `POST /v1/messaging/webhook/:channel` são
   * registradas sem sessão: quem chama é o PSP e a Meta. A única coisa que
   * separa um evento legítimo de um forjado é o HMAC.
   *
   * Os adaptadores reais ainda não existem, então os dois modos de produção
   * usam o fake — e o fake tem segredo DEFAULT escrito no repositório
   * (`fake-payment-secret`). Subir assim significa que qualquer leitor deste
   * código assina um `payment.confirmed` válido e marca lançamento como pago,
   * em qualquer tenant, sem que dinheiro nenhum tenha entrado.
   *
   * Este teste existe para que o default NUNCA mais chegue a produção: fora de
   * `fake`, sem segredo no ambiente, o processo tem de recusar subir.
   */
  for (const [modo, variavel] of [
    ['real', 'PSP_WEBHOOK_SECRET'],
    ['real', 'WHATSAPP_APP_SECRET'],
    ['memed', 'PSP_WEBHOOK_SECRET'],
    ['memed', 'WHATSAPP_APP_SECRET'],
  ] as const) {
    it(`modo ${modo} nao sobe sem ${variavel}`, async () => {
      const antesModo = process.env['CADENCIA_PROVIDERS'];
      const antesVar = process.env[variavel];
      process.env['CADENCIA_PROVIDERS'] = modo;
      ambienteNaoFake();
      delete process.env[variavel];
      const { providers: recarregado } =
        await import(`./providers?semsegredo=${modo}${variavel}${Date.now()}`);
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
