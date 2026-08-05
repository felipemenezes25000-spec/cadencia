### Task 11: `sendMessage` e `receiveInbound` — envio e recebimento de mensagem

Adiciona as duas funcoes restantes do dominio de mensageria. `sendMessage` cria uma mensagem outbound com status `queued` (o worker despacha pelo provedor). `receiveInbound` grava o payload bruto em `inbound_event` ANTES de qualquer parse, resolve a conversa e cria a mensagem inbound.

**Arquivos**

- Modificar `packages/messaging/src/messaging.ts`
- Modificar `packages/messaging/src/messaging.int.test.ts`
- Modificar `packages/messaging/src/index.ts`

---

- [ ] **Passo 1 — teste que falha: sendMessage cria mensagem com status queued**

Adicionar ao final de `packages/messaging/src/messaging.int.test.ts`:

```ts
// Adicionar ao final do arquivo, DENTRO do escopo do modulo (apos os describes existentes)
import { sendMessage, receiveInbound } from './messaging';

let conversationId = '';

describe('sendMessage', () => {
  beforeAll(async () => {
    // Garantir que existe uma conversa para usar nos testes.
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511666660000',
    }));
    if (r.ok) conversationId = r.value.conversationId;
  });

  it('cria mensagem outbound com status queued', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId,
      bodyText: 'Ola, sua consulta esta confirmada!',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.messageId).toBeTruthy();

    // Verificar no banco
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      direction: string; status: string; body_text: string; channel: string;
    }>(
      `SELECT direction, status, body_text, channel
         FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(rows[0]).toEqual({
      direction: 'outbound',
      status: 'queued',
      body_text: 'Ola, sua consulta esta confirmada!',
      channel: 'whatsapp',
    });
  });

  it('cria mensagem outbound com template_key', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId,
      bodyText: 'Ola Maria, sua consulta esta confirmada para 14/08 as 10:00.',
      templateKey: 'confirmacao_consulta',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      template_key: string | null;
    }>(
      `SELECT template_key FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(rows[0]?.template_key).toBe('confirmacao_consulta');
  });

  it('atualiza last_message_at da conversa', async () => {
    const antes = await withTenantTx(actor, (tx) => tx.query<{
      last_message_at: string | null;
    }>(
      `SELECT last_message_at::text FROM msg.conversation WHERE id = $1`,
      [conversationId]));
    const tAntes = antes.rows[0]?.last_message_at;

    await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId, bodyText: 'outra mensagem',
    }));

    const depois = await withTenantTx(actor, (tx) => tx.query<{
      last_message_at: string | null;
    }>(
      `SELECT last_message_at::text FROM msg.conversation WHERE id = $1`,
      [conversationId]));
    const tDepois = depois.rows[0]?.last_message_at;
    expect(tDepois).not.toBeNull();
    if (tAntes !== null && tDepois !== null) {
      expect(tDepois >= tAntes).toBe(true);
    }
  });

  it('recusa conversa inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId: uuidv7(),
      bodyText: 'nao vai',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'conversa_nao_encontrada' } });
  });
});

describe('receiveInbound', () => {
  it('grava payload bruto em inbound_event e cria mensagem inbound', async () => {
    const rawPayload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-fake-001', changes: [{ value: { messages: [{ id: 'wamid.xyz' }] } }] }],
    };

    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: s.channelIdentityId,
      rawPayload,
      remotePhone: '+5511555550000',
      bodyText: 'Quero marcar consulta',
      externalId: 'wamid.xyz',
      sentAt: '2026-08-04T10:00:00.000Z',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.eventId).toBeTruthy();
    expect(r.value.messageId).toBeTruthy();
    expect(r.value.conversationId).toBeTruthy();

    // Verificar inbound_event gravado
    const { rows: evtRows } = await withTenantTx(actor, (tx) => tx.query<{
      raw_payload: unknown; processed_at: string | null;
    }>(
      `SELECT raw_payload, processed_at FROM msg.inbound_event WHERE id = $1`,
      [r.value.eventId]));
    expect(evtRows[0]?.raw_payload).toEqual(rawPayload);
    expect(evtRows[0]?.processed_at).not.toBeNull();

    // Verificar mensagem inbound criada
    const { rows: msgRows } = await withTenantTx(actor, (tx) => tx.query<{
      direction: string; status: string; body_text: string; external_id: string;
    }>(
      `SELECT direction, status, body_text, external_id
         FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(msgRows[0]).toEqual({
      direction: 'inbound',
      status: 'delivered',
      body_text: 'Quero marcar consulta',
      external_id: 'wamid.xyz',
    });
  });

  it('vincula paciente na conversa quando telefone bate', async () => {
    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: s.channelIdentityId,
      rawPayload: { test: true },
      remotePhone: s.patientPhone,
      bodyText: 'Boa tarde',
      externalId: 'wamid.abc',
      sentAt: '2026-08-04T11:00:00.000Z',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // A conversa para o telefone do paciente ja existe (criada no describe anterior);
    // deve ter o patient_id vinculado.
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      patient_id: string | null;
    }>(
      `SELECT patient_id FROM msg.conversation WHERE id = $1`,
      [r.value.conversationId]));
    expect(rows[0]?.patient_id).toBe(s.patientId);
  });

  it('recusa canal inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: uuidv7(),
      rawPayload: {},
      remotePhone: '+5511999990001',
      bodyText: 'teste',
      externalId: 'wamid.000',
      sentAt: '2026-08-04T12:00:00.000Z',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'canal_nao_encontrado' } });
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: falha — `sendMessage` e `receiveInbound` nao existem em `./messaging`.

---

- [ ] **Passo 2 — implementar sendMessage**

Adicionar ao final de `packages/messaging/src/messaging.ts`:

```ts
// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

export interface SendMessageInput {
  readonly conversationId: string;
  readonly bodyText?: string;
  readonly bodyMediaKey?: string;
  readonly templateKey?: string;
}

export async function sendMessage(
  tx: TxClient, i: SendMessageInput,
): Promise<Result<{ messageId: string }, MessagingFailure>> {
  // 1. Verificar que a conversa existe e obter o canal.
  const conv = await tx.query<{ channel: string }>(
    `SELECT ci.channel
       FROM msg.conversation c
       JOIN msg.channel_identity ci
         ON ci.tenant_id = c.tenant_id AND ci.id = c.channel_identity_id
      WHERE c.id = $1`,
    [i.conversationId]);
  if (conv.rows.length === 0) return err({ kind: 'conversa_nao_encontrada' });

  const channel = conv.rows[0]!.channel;
  const messageId = uuidv7();

  // 2. Inserir mensagem com status queued (o worker despacha via provedor).
  await tx.query(
    `INSERT INTO msg.message
       (id, conversation_id, direction, channel, body_text, body_media_key,
        template_key, status)
     VALUES ($1, $2, 'outbound', $3, $4, $5, $6, 'queued')`,
    [messageId, i.conversationId, channel,
     i.bodyText ?? null, i.bodyMediaKey ?? null, i.templateKey ?? null]);

  // 3. Atualizar last_message_at da conversa.
  await tx.query(
    `UPDATE msg.conversation SET last_message_at = clock_timestamp() WHERE id = $1`,
    [i.conversationId]);

  return ok({ messageId });
}
```

---

- [ ] **Passo 3 — implementar receiveInbound**

Adicionar ao final de `packages/messaging/src/messaging.ts`:

```ts
// ---------------------------------------------------------------------------
// receiveInbound
// ---------------------------------------------------------------------------

export interface ReceiveInboundInput {
  readonly channelIdentityId: string;
  readonly rawPayload: unknown;
  readonly remotePhone: string;
  readonly bodyText?: string;
  readonly bodyMediaKey?: string;
  readonly externalId: string;
  readonly sentAt: string;            // RFC 3339
}

export interface ReceivedInbound {
  readonly eventId: string;
  readonly messageId: string;
  readonly conversationId: string;
}

export async function receiveInbound(
  tx: TxClient, i: ReceiveInboundInput,
): Promise<Result<ReceivedInbound, MessagingFailure>> {
  // 1. Verificar que a identidade de canal existe.
  const ci = await tx.query<{ id: string }>(
    `SELECT id FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  if (ci.rows.length === 0) return err({ kind: 'canal_nao_encontrado' });

  // 2. Gravar payload bruto em inbound_event — ANTES de qualquer parse.
  //    Parser bugado nao perde mensagem de paciente.
  const eventId = uuidv7();
  await tx.query(
    `INSERT INTO msg.inbound_event
       (id, channel_identity_id, raw_payload, processed_at)
     VALUES ($1, $2, $3, clock_timestamp())`,
    [eventId, i.channelIdentityId, JSON.stringify(i.rawPayload)]);

  // 3. Resolver conversa pelo telefone.
  const convResult = await resolveConversation(tx, {
    channelIdentityId: i.channelIdentityId,
    remotePhone: i.remotePhone,
  });
  if (!convResult.ok) return convResult;

  const conversationId = convResult.value.conversationId;

  // 4. Obter o canal da identidade.
  const chQuery = await tx.query<{ channel: string }>(
    `SELECT channel FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  const channel = chQuery.rows[0]!.channel;

  // 5. Criar mensagem inbound.
  const messageId = uuidv7();
  await tx.query(
    `INSERT INTO msg.message
       (id, conversation_id, direction, channel, body_text, body_media_key,
        status, external_id, sent_at)
     VALUES ($1, $2, 'inbound', $3, $4, $5, 'delivered', $6, $7::timestamptz)`,
    [messageId, conversationId, channel,
     i.bodyText ?? null, i.bodyMediaKey ?? null,
     i.externalId, i.sentAt]);

  // 6. Atualizar last_message_at da conversa.
  await tx.query(
    `UPDATE msg.conversation SET last_message_at = clock_timestamp() WHERE id = $1`,
    [conversationId]);

  return ok({ eventId, messageId, conversationId });
}
```

---

- [ ] **Passo 4 — atualizar o barrel para exportar tudo**

Modificar `packages/messaging/src/index.ts`:

```ts
// packages/messaging/src/index.ts
export {
  resolveConversation,
  sendMessage,
  receiveInbound,
  type ResolveConversationInput, type ResolvedConversation,
  type SendMessageInput,
  type ReceiveInboundInput, type ReceivedInbound,
  type MessagingFailure,
} from './messaging';
```

---

- [ ] **Passo 5 — rodar e confirmar que todos os testes passam**

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: 12 testes passando (5 de resolveConversation + 4 de sendMessage + 3 de receiveInbound).

---

- [ ] **Passo 6 — verificar que arch:check passa**

```bash
pnpm arch:check
```

Saida esperada: sem violacao. `@cadencia/messaging` (L2) importa apenas de `@cadencia/kernel` (L0) e `@cadencia/db` (L0).

---

- [ ] **Passo 7 — commitar**

```bash
git add packages/messaging/src/messaging.ts packages/messaging/src/messaging.int.test.ts packages/messaging/src/index.ts
git commit -m "feat(messaging): sendMessage and receiveInbound domain functions

sendMessage creates a queued outbound message — the worker dispatches
via the provider. receiveInbound stores the raw webhook payload in
inbound_event BEFORE any parsing (parser bugs never lose patient
messages), then resolves the conversation and creates the inbound
message record.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```