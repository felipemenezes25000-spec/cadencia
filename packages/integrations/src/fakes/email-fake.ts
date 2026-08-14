import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type { EmailEnvelope, EmailProvider } from '../contracts/email';

export type ModoFakeEmail = 'ok' | 'indisponivel' | 'timeout';

export interface FakeEmailOptions {
  readonly modo?: ModoFakeEmail;
}

export interface SentEmail {
  readonly ctx: ProviderCtx;
  readonly envelope: EmailEnvelope;
  readonly messageId: string;
}

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

export function createFakeEmailProvider(
  opts: FakeEmailOptions = {},
): EmailProvider & { readonly sent: readonly SentEmail[] } {
  const modo = opts.modo ?? 'ok';

  function falha<T>(): ProviderResult<T> | null {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, retryAfterMs: 5000,
                          detail: 'SMTP fake indisponivel' });
    }
    if (modo === 'timeout') {
      return failure<T>({ kind: 'timeout', retrySafe: false,
                          detail: 'deadline estourou' });
    }
    return null;
  }

  const sentList: SentEmail[] = [];
  let counter = 0;

  return {
    id: 'email-smtp-fake',
    capabilities: new Set(['residency:br']),
    safety: { send: 'unsafe' },

    get sent(): readonly SentEmail[] {
      return sentList;
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async send(ctx: ProviderCtx, envelope: EmailEnvelope) {
      const f = falha<{ messageId: string }>();
      if (f) return f;

      counter += 1;
      const messageId = `email-fake-${counter}`;
      sentList.push({ ctx, envelope, messageId });
      return success({ messageId }, messageId);
    },
  };
}
