import type { Provider, ProviderCtx, ProviderResult } from './common';

export interface EmailEnvelope {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
  readonly replyTo?: string;
}

export interface EmailProvider extends Provider {
  send(ctx: ProviderCtx, envelope: EmailEnvelope):
    Promise<ProviderResult<{ messageId: string }>>;
}
