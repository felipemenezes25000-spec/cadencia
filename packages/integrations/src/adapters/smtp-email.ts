// nodemailer deve estar em dependencies de @cadencia/integrations
import nodemailer from 'nodemailer';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import { failure, success, type ProviderResult, type Rfc3339 } from '../contracts/common';
import type { EmailEnvelope, EmailProvider } from '../contracts/email';

export interface SmtpEmailConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: string;
  readonly from: string;
  readonly secure?: boolean;
}

export function createSmtpEmailProvider(cfg: SmtpEmailConfig): EmailProvider {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  return {
    id: 'email-smtp',
    capabilities: new Set(['residency:br']),
    safety: { send: 'unsafe' },

    async health() {
      const t0 = systemClock.nowMs();
      let up = false;
      try {
        await transporter.verify();
        up = true;
      } catch { /* servidor fora */ }
      return {
        up,
        latencyMs: systemClock.nowMs() - t0,
        checkedAt: isoFromMs(systemClock.nowMs()) as Rfc3339,
      };
    },

    async send(_ctx, envelope: EmailEnvelope): Promise<ProviderResult<{ messageId: string }>> {
      try {
        const info = await transporter.sendMail({
          from: cfg.from,
          to: envelope.to,
          subject: envelope.subject,
          html: envelope.html,
          ...(envelope.text !== undefined ? { text: envelope.text } : {}),
          ...(envelope.replyTo !== undefined ? { replyTo: envelope.replyTo } : {}),
        });
        const messageId = typeof info.messageId === 'string' ? info.messageId : '';
        return success({ messageId }, messageId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes('ETIMEDOUT') || msg.includes('ESOCKET') || msg.includes('timeout')) {
          return failure({ kind: 'timeout', retrySafe: false, detail: msg });
        }
        if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
          return failure({ kind: 'unavailable', retrySafe: true, detail: msg });
        }
        return failure({ kind: 'rejected', retrySafe: false, code: 'SMTP_ERROR', detail: msg });
      }
    },
  };
}
