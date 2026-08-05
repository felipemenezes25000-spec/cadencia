### Task 16: adaptador WhatsApp Cloud API — estrutura e webhook

**Arquivos**
- Criar `packages/integrations/src/adapters/whatsapp-cloud.ts`
- Teste `packages/integrations/src/adapters/whatsapp-cloud.test.ts`

- [ ] **Teste que falha** — criar `packages/integrations/src/adapters/whatsapp-cloud.test.ts`:

```ts
// packages/integrations/src/adapters/whatsapp-cloud.test.ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyWhatsAppWebhook,
  parseWhatsAppInbound,
  buildSendPayload,
  buildTemplateSendPayload,
} from './whatsapp-cloud';
import type { InboundMessage, StatusUpdate } from '../contracts/messaging';

const APP_SECRET = 'test-app-secret-1234';

describe('WhatsApp Cloud API — webhook e parsing', () => {
  it('verifyWhatsAppWebhook aceita assinatura HMAC-SHA256 valida', () => {
    const payload = Buffer.from('{"entry":[]}');
    const hmac = createHmac('sha256', APP_SECRET).update(payload).digest('hex');
    const headers = { 'x-hub-signature-256': `sha256=${hmac}` };
    expect(verifyWhatsAppWebhook(payload, headers, APP_SECRET))
      .toEqual({ valid: true });
  });

  it('verifyWhatsAppWebhook rejeita assinatura invalida', () => {
    const payload = Buffer.from('{"entry":[]}');
    const headers = { 'x-hub-signature-256': 'sha256=invalido' };
    expect(verifyWhatsAppWebhook(payload, headers, APP_SECRET))
      .toEqual({ valid: false, reason: 'assinatura HMAC invalida' });
  });

  it('verifyWhatsAppWebhook rejeita quando header ausente', () => {
    const payload = Buffer.from('{"entry":[]}');
    expect(verifyWhatsAppWebhook(payload, {}, APP_SECRET))
      .toEqual({ valid: false, reason: 'header x-hub-signature-256 ausente' });
  });

  it('parseWhatsAppInbound extrai mensagem de texto', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.HBgN',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'text',
              text: { body: 'Boa tarde, confirmo a consulta' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.kind).toBe('message');
    expect(msg.providerMessageId).toBe('wamid.HBgN');
    expect(msg.from).toBe('+5511999887766');
    expect(msg.body).toEqual({ kind: 'text', text: 'Boa tarde, confirmo a consulta' });
  });

  it('parseWhatsAppInbound extrai mensagem de imagem com caption', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.IMG1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'image',
              image: { id: 'media-img-1', mime_type: 'image/jpeg', caption: 'exame de sangue' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('image');
    if (msg.body.kind === 'image') {
      expect(msg.body.providerMediaId).toBe('media-img-1');
      expect(msg.body.caption).toBe('exame de sangue');
    }
  });

  it('parseWhatsAppInbound extrai mensagem de audio', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.AUD1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'audio',
              audio: { id: 'media-aud-1', mime_type: 'audio/ogg; codecs=opus' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('audio');
  });

  it('parseWhatsAppInbound extrai mensagem de documento', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.DOC1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'document',
              document: { id: 'media-doc-1', mime_type: 'application/pdf', filename: 'laudo.pdf' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('document');
    if (msg.body.kind === 'document') {
      expect(msg.body.filename).toBe('laudo.pdf');
    }
  });

  it('parseWhatsAppInbound extrai status updates', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [
              { id: 'wamid.S1', status: 'sent', timestamp: '1722772800' },
              { id: 'wamid.S1', status: 'delivered', timestamp: '1722772801' },
              { id: 'wamid.S1', status: 'read', timestamp: '1722772805' },
            ],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(3);
    expect((events[0] as StatusUpdate).status).toBe('sent');
    expect((events[1] as StatusUpdate).status).toBe('delivered');
    expect((events[2] as StatusUpdate).status).toBe('read');
  });

  it('parseWhatsAppInbound extrai status failed com codigo de erro', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [{
              id: 'wamid.F1', status: 'failed', timestamp: '1722772800',
              errors: [{ code: 131026, title: 'Message Undeliverable' }],
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const st = events[0] as StatusUpdate;
    expect(st.status).toBe('failed');
    expect(st.errorCode).toBe('131026');
    expect(st.errorDetail).toBe('Message Undeliverable');
  });

  it('parseWhatsAppInbound devolve array vazio para payload sem mensagens', () => {
    const raw = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: {} }] }] }));
    expect(parseWhatsAppInbound(raw)).toEqual([]);
  });

  it('parseWhatsAppInbound ignora tipos de mensagem desconhecidos', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.UNK', from: '5511999887766', timestamp: '1722772800',
              type: 'sticker', sticker: { id: 'stk-1' },
            }],
          },
        }],
      }],
    }));
    expect(parseWhatsAppInbound(raw)).toEqual([]);
  });

  it('buildSendPayload monta o corpo para envio de texto via Cloud API', () => {
    const payload = buildSendPayload('+5511987654321', { kind: 'text', text: 'Ola, bom dia!' });
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+5511987654321',
      type: 'text',
      text: { preview_url: false, body: 'Ola, bom dia!' },
    });
  });

  it('buildTemplateSendPayload monta o corpo para envio de template', () => {
    const payload = buildTemplateSendPayload('+5511987654321', {
      kind: 'template',
      templateName: 'confirmacao_consulta',
      language: 'pt_BR',
      variables: ['Maria', '14/08/2026', '10:00'],
    });
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+5511987654321',
      type: 'template',
      template: {
        name: 'confirmacao_consulta',
        language: { code: 'pt_BR' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: 'Maria' },
            { type: 'text', text: '14/08/2026' },
            { type: 'text', text: '10:00' },
          ],
        }],
      },
    });
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/integrations/src/adapters/whatsapp-cloud.test.ts
# ESPERADO: falha — modulo './whatsapp-cloud' nao existe
```

- [ ] **Implementar** — criar `packages/integrations/src/adapters/whatsapp-cloud.ts`:

```ts
// packages/integrations/src/adapters/whatsapp-cloud.ts
import { createHmac } from 'node:crypto';
import { isoFromMs } from '@cadencia/kernel';
import type { InboundEvent, InboundMessage, InboundMessageBody, OutboundBody, StatusUpdate } from '../contracts/messaging';

/**
 * §7.3 — funcoes puras do adaptador WhatsApp Cloud API v21+.
 *
 * Estas funcoes NAO fazem chamadas HTTP — elas transformam dados.
 * A chamada HTTP real sai exclusivamente pelo worker via outbox (§7.1).
 *
 * O adaptador completo (que implementa MessagingProvider) vive no
 * pacote de messaging e usa estas funcoes como building blocks.
 */

// ── Verificacao de webhook ─────────────────────────────────────────────

export function verifyWhatsAppWebhook(
  raw: Buffer,
  headers: Record<string, string>,
  appSecret: string,
): { valid: boolean; reason?: string } {
  const sig = headers['x-hub-signature-256'];
  if (sig === undefined) {
    return { valid: false, reason: 'header x-hub-signature-256 ausente' };
  }
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
  if (sig !== expected) {
    return { valid: false, reason: 'assinatura HMAC invalida' };
  }
  return { valid: true };
}

// ── Parsing de inbound ─────────────────────────────────────────────────

interface RawWhatsAppPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id: string; from: string; timestamp: string; type: string;
          text?: { body: string };
          image?: { id: string; mime_type: string; caption?: string };
          audio?: { id: string; mime_type: string };
          document?: { id: string; mime_type: string; filename?: string };
        }>;
        statuses?: Array<{
          id: string; status: string; timestamp: string;
          errors?: Array<{ code: number; title: string }>;
        }>;
      };
    }>;
  }>;
}

export function parseWhatsAppInbound(raw: Buffer): InboundEvent[] {
  const parsed: RawWhatsAppPayload = JSON.parse(raw.toString('utf-8'));
  const events: InboundEvent[] = [];

  for (const entry of parsed.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (value === undefined) continue;

      for (const msg of value.messages ?? []) {
        let body: InboundMessageBody;
        switch (msg.type) {
          case 'text':
            body = { kind: 'text', text: msg.text?.body ?? '' };
            break;
          case 'image':
            body = {
              kind: 'image',
              providerMediaId: msg.image!.id,
              mime: msg.image!.mime_type,
              ...(msg.image!.caption !== undefined ? { caption: msg.image!.caption } : {}),
            };
            break;
          case 'audio':
            body = {
              kind: 'audio',
              providerMediaId: msg.audio!.id,
              mime: msg.audio!.mime_type,
            };
            break;
          case 'document':
            body = {
              kind: 'document',
              providerMediaId: msg.document!.id,
              mime: msg.document!.mime_type,
              ...(msg.document!.filename !== undefined
                ? { filename: msg.document!.filename } : {}),
            };
            break;
          default:
            continue;
        }

        const ts = Number(msg.timestamp) * 1000;
        const inbound: InboundMessage = {
          kind: 'message',
          providerMessageId: msg.id,
          from: msg.from.startsWith('+') ? msg.from : `+${msg.from}`,
          timestamp: isoFromMs(ts),
          body,
        };
        events.push(inbound);
      }

      for (const st of value.statuses ?? []) {
        const mapped = st.status as StatusUpdate['status'];
        if (!['sent', 'delivered', 'read', 'failed'].includes(mapped)) continue;
        const ts = Number(st.timestamp) * 1000;
        const status: StatusUpdate = {
          kind: 'status',
          providerMessageId: st.id,
          status: mapped,
          timestamp: isoFromMs(ts),
          ...(st.errors?.[0] !== undefined ? {
            errorCode: String(st.errors[0].code),
            errorDetail: st.errors[0].title,
          } : {}),
        };
        events.push(status);
      }
    }
  }

  return events;
}

// ── Construcao de payload de envio ─────────────────────────────────────

export interface CloudApiTextPayload {
  readonly messaging_product: 'whatsapp';
  readonly recipient_type: 'individual';
  readonly to: string;
  readonly type: 'text';
  readonly text: { readonly preview_url: false; readonly body: string };
}

export interface CloudApiTemplatePayload {
  readonly messaging_product: 'whatsapp';
  readonly recipient_type: 'individual';
  readonly to: string;
  readonly type: 'template';
  readonly template: {
    readonly name: string;
    readonly language: { readonly code: string };
    readonly components: readonly [{
      readonly type: 'body';
      readonly parameters: readonly Array<{ readonly type: 'text'; readonly text: string }>;
    }];
  };
}

export function buildSendPayload(
  to: string,
  body: Extract<OutboundBody, { kind: 'text' }>,
): CloudApiTextPayload {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: body.text },
  };
}

export function buildTemplateSendPayload(
  to: string,
  body: Extract<OutboundBody, { kind: 'template' }>,
): CloudApiTemplatePayload {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: body.templateName,
      language: { code: body.language },
      components: [{
        type: 'body',
        parameters: body.variables.map((v) => ({ type: 'text' as const, text: v })),
      }],
    },
  };
}
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/adapters/whatsapp-cloud.test.ts
# ESPERADO: 12 testes passam
```

- [ ] Commitar:

```bash
git add packages/integrations/src/adapters/whatsapp-cloud.ts packages/integrations/src/adapters/whatsapp-cloud.test.ts
git commit -m "feat(integrations): WhatsApp Cloud API adapter — webhook verify, inbound parse, send payload

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### ~~Task 17: migration 0073 — tabela msg.channel_identity~~ REMOVIDA

> **COLISAO RESOLVIDA**: esta migration duplica a criacao de `msg.channel_identity`
> que ja e feita pela migration 0070 (Bloco 02, Task 6). A migration 0073 NAO
> deve ser criada. Os testes de integracao desta task devem validar a tabela
> existente (criada por 0070) usando a coluna `phone` (nao `phone_number`).
> O arquivo `0073_msg_channel_identity.sql` NAO deve ser criado.