import type { Client, PoolClient } from 'pg';

/** Conexao ja dentro de uma transacao de negocio. */
export type Tx = Client | PoolClient;

export type AuditOutcome = 'sucesso' | 'negado' | 'erro';

/** Valores aceitos em `meta`. Chaves fora da whitelist do banco sao recusadas. */
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
 * Canal A. Grava DENTRO da transacao de negocio recebida em `tx`.
 * Se a transacao fizer rollback, o evento some junto — de proposito:
 * o evento so e verdade se a escrita commitou.
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
