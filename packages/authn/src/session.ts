import { createHash, randomBytes } from 'node:crypto';
import { err, ok, type Result } from './result';

/** Superficie minima de conexao. Quem passa o pool e L3 (§2.2 regra 3). */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export const SESSION_TOKEN_BYTES = 32;
export const SESSION_IDLE_MINUTES = 30;
export const SESSION_ABSOLUTE_HOURS = 12;

export type SessionFailure =
  | 'nao_encontrada' | 'revogada' | 'expirada_inatividade' | 'expirada_absoluta';

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  activeTenantId: string | null;
  activeClinicId: string | null;
  mfaAt: Date | null;
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export async function createSession(
  db: Queryable,
  input: {
    userId: string;
    activeTenantId?: string | null;
    activeClinicId?: string | null;
    ip?: string | null;
    userAgentHash?: Buffer | null;
  },
): Promise<{ sessionId: string; token: string }> {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const { rows } = await db.query(
    `INSERT INTO id.session
       (user_id, token_hash, active_tenant_id, active_clinic_id,
        idle_expires_at, absolute_expires_at, ip, user_agent_hash)
     VALUES ($1, $2, $3, $4,
             clock_timestamp() + make_interval(mins => $5::int),
             clock_timestamp() + make_interval(hours => $6::int),
             $7, $8)
     RETURNING id`,
    [
      input.userId, hashSessionToken(token),
      input.activeTenantId ?? null, input.activeClinicId ?? null,
      SESSION_IDLE_MINUTES, SESSION_ABSOLUTE_HOURS,
      input.ip ?? null, input.userAgentHash ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('id.session insert returned no row');
  return { sessionId: row.id as string, token };
}

export async function resolveSession(
  db: Queryable, token: string,
): Promise<Result<ResolvedSession, SessionFailure>> {
  const tokenHash = hashSessionToken(token);

  // Resolver e renovar sao UMA operacao atomica. O WHERE revalida todas as
  // condições no instante do UPDATE; se uma revogação/desativação concorrente
  // vencer a corrida, nenhuma linha retorna e esta request não herda uma sessão
  // que era válida alguns microssegundos antes.
  const { rows } = await db.query(
    `UPDATE id.session s
        SET last_seen_at = clock_timestamp(),
            idle_expires_at = clock_timestamp() + make_interval(mins => $2::int)
       FROM id."user" u
      WHERE s.token_hash = $1
        AND u.id = s.user_id
        AND u.disabled_at IS NULL
        AND u.status = 'ativo'
        AND s.revoked_at IS NULL
        AND s.idle_expires_at >= clock_timestamp()
        AND s.absolute_expires_at >= clock_timestamp()
      RETURNING s.id, s.user_id, s.active_tenant_id, s.active_clinic_id, s.mfa_at`,
    [tokenHash, SESSION_IDLE_MINUTES],
  );

  const row = rows[0];
  if (row) {
    return ok({
      sessionId: row.id as string,
      userId: row.user_id as string,
      activeTenantId: (row.active_tenant_id as string | null) ?? null,
      activeClinicId: (row.active_clinic_id as string | null) ?? null,
      mfaAt: (row.mfa_at as Date | null) ?? null,
    });
  }

  // Segunda leitura só CLASSIFICA a falha para telemetria/testes. Ela nunca pode
  // transformar a resposta em sucesso, portanto uma nova corrida aqui não abre
  // acesso. Conta inativa continua indistinguível de token inexistente.
  const falha = await db.query(
    `SELECT s.revoked_at IS NOT NULL AS revogada,
            s.idle_expires_at < clock_timestamp() AS idle_expirou,
            s.absolute_expires_at < clock_timestamp() AS absoluta_expirou,
            (u.id IS NOT NULL AND u.disabled_at IS NULL AND u.status = 'ativo') AS usuario_ativo
       FROM id.session s
       LEFT JOIN id."user" u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [tokenHash],
  );
  const motivo = falha.rows[0];
  if (!motivo || !motivo.usuario_ativo) return err('nao_encontrada');
  if (motivo.revogada) return err('revogada');
  if (motivo.absoluta_expirou) return err('expirada_absoluta');
  if (motivo.idle_expirou) return err('expirada_inatividade');

  // Estado mudou durante a classificação (por exemplo, uma revogação recém
  // commitada). Falhar fechado é sempre mais seguro do que tentar de novo.
  return err('nao_encontrada');
}

export async function revokeSession(
  db: Queryable, sessionId: string, reason: string,
): Promise<void> {
  await db.query(
    `UPDATE id.session
        SET revoked_at = clock_timestamp(), revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, reason],
  );
}

export async function revokeAllSessionsOfUser(
  db: Queryable, userId: string, reason: string,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE id.session
        SET revoked_at = clock_timestamp(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
  return rowCount ?? 0;
}
