import { businessPool } from '@cadencia/db';

export interface TrialExpirationResult {
  readonly expired: number;
  readonly skipped: number;
}

export async function expireTrials(): Promise<TrialExpirationResult> {
  const pool = businessPool();
  const { rows } = await pool.query<{ id: string; tenant_id: string }>(
    `UPDATE com.assinatura
        SET status = 'suspensa',
            motivo_suspensao = 'trial_expirado',
            updated_at = clock_timestamp()
      WHERE status = 'trial'
        AND trial_termino_em <= CURRENT_DATE
      RETURNING id, tenant_id`,
  );

  for (const row of rows) {
    await pool.query(
      `INSERT INTO app.notification (id, tenant_id, user_id, kind, title, body)
       SELECT gen_random_uuid(), $1, m.user_id, 'billing',
              'Trial expirado',
              'O periodo de teste do seu plano terminou. Contrate um plano para continuar usando o sistema.'
         FROM app.membership m
        WHERE m.tenant_id = $1
          AND m.role = 'admin_clinico'
       ON CONFLICT DO NOTHING`,
      [row.tenant_id],
    );
  }

  return { expired: rows.length, skipped: 0 };
}
