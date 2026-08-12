import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { err, ok, type Result } from './result';
import type { Queryable } from './session';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Janela de 1 passo para cada lado: tolera ate 30 s de drift no celular. */
export const TOTP_WINDOW = 1;
const ISSUER = 'Cadencia';

/**
 * Relógio injetado. Declarado aqui e não importado de @cadencia/kernel porque
 * `authn` e `kernel` são irmãos em L0 (§2.2 regra 2). NÃO existe valor padrão:
 * construir um Date do relógio do sistema aqui seria reprovado pelo guarda
 * tools/repo/time-source.ts, cuja regra é explícita — a correção nunca é
 * acrescentar o arquivo a allowlist. Quem escolhe o relógio é L3.
 */
export interface Clock {
  now(): Date;
}

export type TotpFailure = 'codigo_invalido' | 'codigo_reutilizado' | 'nao_cadastrado';

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totp(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER, label, algorithm: 'SHA1', digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS, secret: Secret.fromBase32(secretBase32),
  });
}

export function totpUri(email: string, secretBase32: string): string {
  return totp(secretBase32, email).toString();
}

export function stepAt(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * Valida o codigo e devolve o PASSO aceito. `lastAcceptedStep` e o ultimo passo
 * ja consumido por este usuario: sem ele, o mesmo codigo de 6 digitos vale por
 * 90 segundos para quem o interceptar.
 */
export function verifyTotpAgainstStep(
  secretBase32: string, code: string, at: Date, lastAcceptedStep: number | null,
): Result<number, TotpFailure> {
  if (!/^[0-9]{6}$/.test(code)) return err('codigo_invalido');
  let delta: number | null;
  try {
    delta = totp(secretBase32, 'x').validate({
      token: code, timestamp: at.getTime(), window: TOTP_WINDOW,
    });
  } catch {
    return err('codigo_invalido');
  }
  if (delta === null) return err('codigo_invalido');
  const step = stepAt(at) + delta;
  if (lastAcceptedStep !== null && step <= lastAcceptedStep) return err('codigo_reutilizado');
  return ok(step);
}

/** AES-256-GCM: [12 bytes IV][16 bytes tag][ciphertext]. */
export function encryptTotpSecret(secretBase32: string, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptTotpSecret(blob: Buffer, key: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export async function enrollTotp(
  db: Queryable, userId: string, key: Buffer,
): Promise<{ secretBase32: string; uri: string; email: string }> {
  const secretBase32 = newTotpSecret();
  const { rows } = await db.query(`SELECT email FROM id."user" WHERE id = $1`, [userId]);
  const email = rows[0]?.email as string;
  await db.query(
    `INSERT INTO id.user_totp (user_id, secret_ciphertext)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET secret_ciphertext = EXCLUDED.secret_ciphertext,
           confirmed_at = NULL, last_accepted_step = NULL`,
    [userId, encryptTotpSecret(secretBase32, key)],
  );
  return { secretBase32, uri: totpUri(email, secretBase32), email };
}

export async function verifyTotpForUser(
  db: Queryable, userId: string, code: string, key: Buffer, clock: Clock,
): Promise<Result<number, TotpFailure>> {
  const { rows } = await db.query(
    `SELECT secret_ciphertext, last_accepted_step FROM id.user_totp WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return err('nao_cadastrado');

  const secret = decryptTotpSecret(row.secret_ciphertext as Buffer, key);
  const last = row.last_accepted_step === null ? null : Number(row.last_accepted_step);
  const r = verifyTotpAgainstStep(secret, code, clock.now(), last);
  if (!r.ok) return r;

  // Consome o passo. A condicao no WHERE fecha a corrida entre duas abas.
  const upd = await db.query(
    `UPDATE id.user_totp
        SET last_accepted_step = $2, confirmed_at = coalesce(confirmed_at, clock_timestamp())
      WHERE user_id = $1
        AND (last_accepted_step IS NULL OR last_accepted_step < $2)`,
    [userId, r.value],
  );
  if ((upd.rowCount ?? 0) === 0) return err('codigo_reutilizado');
  return r;
}
