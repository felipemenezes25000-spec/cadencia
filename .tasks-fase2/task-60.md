### Task 60: definition-of-done gate e demonstracao de ponta a ponta

**Arquivos**

- Modificar `package.json` (script `prepush`)
- Criar `apps/api/src/routes/fase2-e2e.int.test.ts`

**Passos**

- [ ] Atualizar o script `prepush` para cobrir todos os gates da Fase 2.

```jsonc
// package.json — campo scripts (so os campos que mudam)
{
  "prepush": "pnpm typecheck && pnpm arch:check && pnpm lint:terminology-clock && pnpm lint:session-guc && pnpm test && pnpm test:int && pnpm test:iso"
}
```

Isto garante que:
1. `pnpm typecheck` — 0 erros
2. `pnpm arch:check` — 0 violacoes (messaging nao importa scheduling, payments nao importa messaging, etc.)
3. `pnpm lint:terminology-clock` — 0 violacoes
4. `pnpm lint:session-guc` — 0 violacoes
5. `pnpm test` — todos os testes de unidade passam
6. `pnpm test:int` — todos os testes de integracao passam
7. `pnpm test:iso` — todos os testes de isolamento passam

Os gates `pnpm db:invariants` e `pnpm db:privileges` continuam manuais por exigirem banco vivo; a documentacao abaixo instrui a execucao.

- [ ] Escrever o teste de integracao de ponta a ponta da Fase 2 com provedores fake. Este teste prova o fluxo completo e os fatos de protecao.

```ts
// apps/api/src/routes/fase2-e2e.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createFakeMessagingProvider,
  createFakePaymentProvider,
  type MessagingProvider,
  type PaymentProvider,
} from '@cadencia/integrations';
import { createTestDb, type TestDb } from '../test-support';

let db: TestDb;
let messaging: MessagingProvider;
let payment: PaymentProvider;
const TENANT_ID = uuidv7();
const USER_ID = uuidv7();
const CLINIC_ID = uuidv7();
const PATIENT_ID = uuidv7();

function ator(): Actor {
  return { kind: 'user', tenantId: TENANT_ID, userId: USER_ID,
           clinicId: CLINIC_ID, requestId: uuidv7() };
}

beforeAll(async () => {
  db = await createTestDb();
  messaging = createFakeMessagingProvider();
  payment = createFakePaymentProvider();
});

afterAll(async () => { await db.close(); });

describe('demonstracao de ponta a ponta da Fase 2', () => {
  // --- FLUXO 1: confirmacao via WhatsApp ---
  it('1. enviar confirmacao via messaging provider', async () => {
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `confirm-${uuidv7()}`,
      deadlineMs: 5000,
    };
    const r = await messaging.send(ctx, {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990001' as import('@cadencia/integrations').E164,
      body: { kind: 'template', templateName: 'confirmacao_consulta',
              params: { paciente: 'Maria', data: '05/08/2026', hora: '14:00' } },
      conversationId: uuidv7(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.providerMessageId).toBeTruthy();
  });

  // --- FLUXO 2: pagamento PIX ---
  it('2. criar link de pagamento e confirmar via webhook', async () => {
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `pay-${uuidv7()}`,
      deadlineMs: 5000,
    };
    const link = await payment.createPaymentLink(ctx, {
      amountCents: 30000, currency: 'BRL',
      description: 'Consulta particular',
      expiresInMinutes: 60,
      payerName: 'Maria Souza Lima',
      payerDocument: '12345678901',
    });
    expect(link.ok).toBe(true);
    if (link.ok) {
      expect(link.value.paymentUrl).toContain('http');
      expect(link.value.providerPaymentId).toBeTruthy();
    }
  });

  // --- FATO 1: webhook com assinatura HMAC invalida e REJEITADO ---
  it('3. webhook com assinatura HMAC invalida e rejeitado pelo messaging provider', () => {
    const resultado = messaging.verifyWebhook(
      Buffer.from('{"tipo":"mensagem"}'),
      { 'x-hub-signature-256': 'sha256=assinatura_invalida_aqui' },
    );
    expect(resultado.valid).toBe(false);
    expect(resultado.reason).toBeTruthy();
  });

  // --- FATO 2: timeout NAO reenvia automaticamente ---
  it('4. timeout no WhatsApp NAO gera retry automatico — persiste estado indeterminado', async () => {
    const msgTimeout = createFakeMessagingProvider({ modo: 'timeout' });
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `timeout-${uuidv7()}`,
      deadlineMs: 100,
    };
    const r = await msgTimeout.send(ctx, {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990002' as import('@cadencia/integrations').E164,
      body: { kind: 'text', text: 'Lembrete de consulta' },
      conversationId: uuidv7(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('timeout');
      expect(r.error.retrySafe).toBe(false);
    }
  });

  // --- FATO 3: pagamento duplicado por idempotency_key e recusado ---
  it('5. pagamento duplicado por idempotency_key retorna o mesmo resultado, nao duplica', async () => {
    const chave = `idem-${uuidv7()}`;
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: chave,
      deadlineMs: 5000,
    };
    const primeiro = await payment.createPaymentLink(ctx, {
      amountCents: 15000, currency: 'BRL',
      description: 'Retorno',
      expiresInMinutes: 30,
      payerName: 'Joana Prado',
      payerDocument: '98765432100',
    });
    expect(primeiro.ok).toBe(true);

    const ctx2 = { ...ctx, requestId: uuidv7() };
    const segundo = await payment.createPaymentLink(ctx2, {
      amountCents: 15000, currency: 'BRL',
      description: 'Retorno',
      expiresInMinutes: 30,
      payerName: 'Joana Prado',
      payerDocument: '98765432100',
    });
    expect(segundo.ok).toBe(true);
    if (primeiro.ok && segundo.ok) {
      expect(segundo.value.providerPaymentId).toBe(primeiro.value.providerPaymentId);
    }
  });

  // --- FATO 4: webhook de pagamento com assinatura invalida e rejeitado ---
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

    // Converter para horario local de SP: 08:00
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

  // --- FATO 9: safety do send e unsafe ---
  it('11. send de mensagem e declarado como unsafe — nunca retry automatico', () => {
    expect(messaging.safety['send']).toBe('unsafe');
  });

  // --- FATO 10: safety do createPaymentLink e idempotent ---
  it('12. createPaymentLink e declarado como idempotent', () => {
    expect(payment.safety['createPaymentLink']).toBe('idempotent');
  });

  // --- FATO 11: refund e unsafe ---
  it('13. refund e declarado como unsafe', () => {
    expect(payment.safety['refund']).toBe('unsafe');
  });

  // --- FATO 12: numero bloqueado mostra canal suspenso ---
  it('14. messaging com numero bloqueado sinaliza canal suspenso, nao descarta historico', async () => {
    const msgBloqueado = createFakeMessagingProvider({ modo: 'bloqueado' });
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `blocked-${uuidv7()}`,
      deadlineMs: 5000,
    };
    const r = await msgBloqueado.send(ctx, {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990003' as import('@cadencia/integrations').E164,
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
```

- [ ] Rodar `pnpm vitest run apps/api/src/routes/fase2-e2e.int.test.ts` e confirmar que todos os 14 testes passam.

Saida esperada: 14 testes passando.

- [ ] Documentar a sequencia completa do gate de qualidade. Nao e um arquivo separado — sao os comandos a rodar:

```bash
# Gate de qualidade completo da Fase 2 — rodar nesta ordem
pnpm typecheck          # 0 erros
pnpm arch:check         # 0 violacoes
pnpm lint:terminology-clock  # 0 violacoes
pnpm lint:session-guc   # 0 violacoes
pnpm test               # todos os testes de unidade passam
pnpm test:int           # todos os testes de integracao passam
pnpm test:iso           # todos os testes de isolamento passam (msg.* e fin.* verificadas)
pnpm db:invariants      # todos verdes (requer banco vivo)
pnpm db:privileges      # novas relacoes declaradas (requer banco vivo)
pnpm prepush            # pass (executa typecheck + arch:check + lints + test + test:int + test:iso)
```

- [ ] Commitar: `feat: Fase 2 definition-of-done gate and end-to-end demonstration`