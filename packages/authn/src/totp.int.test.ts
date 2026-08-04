import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';
import { uuidv7 } from '@cadencia/kernel';
import { appPool, jobsPool } from '@cadencia/db';
import { enrollTotp, verifyTotpForUser, TOTP_PERIOD_SECONDS } from './totp';

const KEY = randomBytes(32);
const AGORA = new Date('2026-08-03T14:00:00.000Z');
const relogioFixo = { now: () => AGORA };

async function seedUser(): Promise<string> {
  const userId = uuidv7();
  // O email leva o uuid INTEIRO, nunca um prefixo: os 12 primeiros digitos hex
  // de um uuidv7 sao o timestamp em milissegundos, entao dois seedUser da mesma
  // rodada cairiam no mesmo prefixo e o segundo INSERT quebraria em
  // user_email_key (23505). Mesma razao documentada em session.int.test.ts.
  await jobsPool().query(
    `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, $3)`,
    [userId, `u-${userId}@exemplo.com.br`, 'Dra. Ana Ribeiro'],
  );
  return userId;
}

function codigoEm(secretBase32: string, at: Date): string {
  return new TOTP({
    issuer: 'Cadencia', label: 'teste', algorithm: 'SHA1', digits: 6,
    period: TOTP_PERIOD_SECONDS, secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: at.getTime() });
}

describe('TOTP persistido', () => {
  it('o segredo nao fica legivel no banco', async () => {
    const userId = await seedUser();
    const { secretBase32 } = await enrollTotp(appPool(), userId, KEY);
    const { rows } = await jobsPool().query(
      `SELECT secret_ciphertext FROM id.user_totp WHERE user_id = $1`, [userId],
    );
    expect((rows[0].secret_ciphertext as Buffer).toString('utf8')).not.toContain(secretBase32);
  });

  it('o mesmo codigo nao entra duas vezes, mesmo dentro dos 30 segundos', async () => {
    const userId = await seedUser();
    const { secretBase32 } = await enrollTotp(appPool(), userId, KEY);
    const codigo = codigoEm(secretBase32, AGORA);

    const primeira = await verifyTotpForUser(appPool(), userId, codigo, KEY, relogioFixo);
    expect(primeira.ok).toBe(true);

    const segunda = await verifyTotpForUser(appPool(), userId, codigo, KEY, relogioFixo);
    expect(segunda.ok).toBe(false);
    if (segunda.ok) return;
    expect(segunda.error).toBe('codigo_reutilizado');
  });

  it('usuario sem TOTP cadastrado falha fechado', async () => {
    const userId = await seedUser();
    const r = await verifyTotpForUser(appPool(), userId, '123456', KEY, relogioFixo);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('nao_cadastrado');
  });
});
