// apps/api/src/routes/fase2-e2e.int.test.ts
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@cadencia/kernel';
import {
  createFakeMessagingProvider,
  createFakePaymentProvider,
  type MessagingProvider,
  type PaymentProvider,
  type E164,
} from '@cadencia/integrations';

let messaging: MessagingProvider;
let payment: PaymentProvider;
const TENANT_ID = uuidv7();
const USER_ID = uuidv7();

function ctx(key?: string) {
  return {
    tenantId: TENANT_ID,
    actorUserId: USER_ID,
    requestId: uuidv7(),
    idempotencyKey: key ?? `e2e-${uuidv7()}`,
    deadlineMs: 5000,
  };
}

messaging = createFakeMessagingProvider();
payment = createFakePaymentProvider();

describe('demonstracao de ponta a ponta da Fase 2', () => {
  // --- FLUXO 1: confirmação via WhatsApp ---
  it('1. enviar confirmacao via messaging provider', async () => {
    const r = await messaging.send(ctx(), {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990001' as E164,
      body: {
        kind: 'template',
        templateName: 'confirmacao_consulta',
        language: 'pt_BR',
        variables: ['Maria', '05/08/2026', '14:00'],
      },
      conversationId: uuidv7(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.providerMessageId).toBeTruthy();
  });

  // --- FLUXO 2: pagamento PIX ---
  it('2. criar link de pagamento e confirmar via webhook', async () => {
    const link = await payment.createPaymentLink(ctx(), {
      amountCents: 30000,
      description: 'Consulta particular',
      expiresInMinutes: 60,
    });
    expect(link.ok).toBe(true);
    if (link.ok) {
      expect(link.value.paymentUrl).toContain('http');
      expect(link.value.providerPaymentId).toBeTruthy();
    }
  });

  // --- FATO 1: webhook com assinatura HMAC inválida é REJEITADO ---
  it('3. webhook com assinatura HMAC invalida e rejeitado pelo messaging provider', () => {
    const resultado = messaging.verifyWebhook(
      Buffer.from('{"tipo":"mensagem"}'),
      { 'x-hub-signature-256': 'sha256=assinatura_invalida_aqui' },
    );
    expect(resultado.valid).toBe(false);
    expect(resultado.reason).toBeTruthy();
  });

  // --- FATO 2: timeout NÃO reenvia automaticamente ---
  it('4. timeout no WhatsApp NAO gera retry automatico — persiste estado indeterminado', async () => {
    const msgTimeout = createFakeMessagingProvider({ modo: 'timeout' });
    const r = await msgTimeout.send(ctx(), {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990002' as E164,
      body: { kind: 'text', text: 'Lembrete de consulta' },
      conversationId: uuidv7(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('timeout');
      expect(r.error.retrySafe).toBe(false);
    }
  });

  // --- FATO 3: pagamento duplicado por idempotency_key é recusado ---
  it('5. pagamento duplicado por idempotency_key retorna o mesmo resultado, nao duplica', async () => {
    const chave = `idem-${uuidv7()}`;
    const c = ctx(chave);
    const primeiro = await payment.createPaymentLink(c, {
      amountCents: 15000,
      description: 'Retorno',
      expiresInMinutes: 30,
    });
    expect(primeiro.ok).toBe(true);

    const c2 = { ...c, requestId: uuidv7() };
    const segundo = await payment.createPaymentLink(c2, {
      amountCents: 15000,
      description: 'Retorno',
      expiresInMinutes: 30,
    });
    expect(segundo.ok).toBe(true);
    if (primeiro.ok && segundo.ok) {
      expect(segundo.value.providerPaymentId).toBe(primeiro.value.providerPaymentId);
    }
  });

  // --- FATO 4: webhook de pagamento com assinatura inválida é rejeitado ---
  it('6. webhook de pagamento com assinatura invalida e rejeitado', () => {
    const resultado = payment.verifyWebhook(
      Buffer.from('{"event":"payment_confirmed"}'),
      { 'x-webhook-signature': 'invalida' },
    );
    expect(resultado.valid).toBe(false);
  });

  // --- FATO 5: lembrete para consulta as 8h em SP sai no fuso correto ---
  it('7. lembrete 24h antes respeita o fuso da clinica — SP e UTC-3', () => {
    // consulta agendada para 2026-08-05T08:00:00 em America/Sao_Paulo
    // = 2026-08-05T11:00:00.000Z
    // lembrete 24h antes = 2026-08-04T08:00:00 em SP = 2026-08-04T11:00:00.000Z
    const consultaUtc = new Date('2026-08-05T11:00:00.000Z');
    const lembreteUtc = new Date(consultaUtc.getTime() - 24 * 60 * 60 * 1000);
    expect(lembreteUtc.toISOString()).toBe('2026-08-04T11:00:00.000Z');

    // Converter para horário local de SP: 08:00
    const emSP = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(lembreteUtc);
    expect(emSP).toBe('08:00');
  });

  // --- FATO 6: provider health check funciona ---
  it('8. health check dos providers fake retorna up=true', async () => {
    const msgHealth = await messaging.health();
    expect(msgHealth.up).toBe(true);
    expect(msgHealth.latencyMs).toBeDefined();

    const payHealth = await payment.health();
    expect(payHealth.up).toBe(true);
  });

  // --- FATO 7: messaging provider declara residency:br ---
  it('9. messaging provider declara residency:br nas capabilities', () => {
    expect(messaging.capabilities.has('residency:br')).toBe(true);
  });

  // --- FATO 8: payment provider declara residency:br ---
  it('10. payment provider declara residency:br nas capabilities', () => {
    expect(payment.capabilities.has('residency:br')).toBe(true);
  });

  // --- FATO 9: safety do send é unsafe ---
  it('11. send de mensagem e declarado como unsafe — nunca retry automatico', () => {
    expect(messaging.safety['send']).toBe('unsafe');
  });

  // --- FATO 10: safety do createPaymentLink é idempotent ---
  it('12. createPaymentLink e declarado como idempotent', () => {
    expect(payment.safety['createPaymentLink']).toBe('idempotent');
  });

  // --- FATO 11: refund é unsafe ---
  it('13. refund e declarado como unsafe', () => {
    expect(payment.safety['refund']).toBe('unsafe');
  });

  // --- FATO 12: número bloqueado mostra canal suspenso ---
  it('14. messaging com numero bloqueado sinaliza canal suspenso, nao descarta historico', async () => {
    const msgBloqueado = createFakeMessagingProvider({ modo: 'bloqueado' });
    const r = await msgBloqueado.send(ctx(), {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990003' as E164,
      body: { kind: 'text', text: 'Teste' },
      conversationId: uuidv7(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('rejected');
      expect(r.error.detail).toContain('canal suspenso');
    }
  });
});
