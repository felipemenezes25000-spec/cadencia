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
    readonly components: ReadonlyArray<{
      readonly type: 'body';
      readonly parameters: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
    }>;
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
