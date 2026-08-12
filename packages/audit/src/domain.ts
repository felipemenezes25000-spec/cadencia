import type { Client, PoolClient } from 'pg';

/** Conexão já dentro de uma transação de negócio. */
export type Tx = Client | PoolClient;

export type AuditOutcome = 'sucesso' | 'negado' | 'erro';

/** Valores aceitos em `meta`. Chaves fora da whitelist do banco são recusadas. */
export type AuditMeta = Readonly<Record<string, string | number | boolean | null>>;

export interface DomainAuditEvent {
  readonly eventType: string;
  readonly entitySchema: string;
  readonly entityTable: string;
  readonly entityId?: string | null;
  readonly outcome?: AuditOutcome;
  readonly meta?: AuditMeta;
  readonly clinicId?: string | null;
}

/**
 * Canal A. Grava DENTRO da transação de negócio recebida em `tx`.
 * Se a transação fizer rollback, o evento some junto — de propósito:
 * o evento só é verdade se a escrita commitou.
 */
export async function logDomainEvent(tx: Tx, event: DomainAuditEvent): Promise<bigint> {
  const res = await tx.query<{ id: string }>(
    'SELECT audit.log($1, $2, $3, $4, $5, $6::jsonb, $7) AS id',
    [
      event.eventType,
      event.entitySchema,
      event.entityTable,
      event.entityId ?? null,
      event.outcome ?? 'sucesso',
      JSON.stringify(event.meta ?? {}),
      event.clinicId ?? null,
    ],
  );
  const row = res.rows[0];
  if (!row) {
    throw new Error('audit.log returned no row');
  }
  return BigInt(row.id);
}
