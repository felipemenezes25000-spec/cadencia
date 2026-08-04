import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@cadencia/kernel';
import { appPool, jobsPool } from '@cadencia/db';
import {
  createSession, resolveSession, revokeSession, revokeAllSessionsOfUser, hashSessionToken,
} from './session';

async function seedUser(fullName: string): Promise<string> {
  const userId = uuidv7();
  // O email leva o uuid INTEIRO, nunca um prefixo: os 12 primeiros digitos hex
  // de um uuidv7 sao o timestamp em milissegundos, entao dois seedUser da mesma
  // rodada cairiam no mesmo prefixo e o segundo INSERT quebraria em
  // user_email_key (23505). Mesma razao documentada em identity-global.int.test.ts.
  await jobsPool().query(
    `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, $3)`,
    [userId, `u-${userId}@exemplo.com.br`, fullName],
  );
  return userId;
}

describe('sessao opaca', () => {
  it('o pool de aplicacao assume app_rw sozinho: `api` e NOINHERIT', async () => {
    const { rows } = await appPool().query<{ papel: string }>('SELECT current_user AS papel');
    expect(rows[0]?.papel).toBe('app_rw');
  });

  it('resolve uma sessao recem-criada e devolve o usuario dono dela', async () => {
    const userId = await seedUser('Dra. Ana Ribeiro');
    const { token, sessionId } = await createSession(appPool(), { userId });

    const r = await resolveSession(appPool(), token);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.userId).toBe(userId);
    expect(r.value.sessionId).toBe(sessionId);
  });

  it('REVOGAR MATA NA HORA: a requisicao seguinte ja e recusada', async () => {
    // Esta e a razao de a sessao nao ser JWT. Com token assinado, este teste
    // so poderia passar com uma lista de revogacao consultada no banco --
    // ou seja, com o mesmo custo e sem nenhuma das vantagens.
    const userId = await seedUser('Dr. Bruno Camargo');
    const { token, sessionId } = await createSession(appPool(), { userId });
    expect((await resolveSession(appPool(), token)).ok).toBe(true);

    await revokeSession(appPool(), sessionId, 'desligamento');

    const depois = await resolveSession(appPool(), token);
    expect(depois.ok).toBe(false);
    if (depois.ok) return;
    expect(depois.error).toBe('revogada');
  });

  it('o token nunca fica em claro no banco: so o sha256 dele', async () => {
    const userId = await seedUser('Dra. Carla Nunes');
    const { token, sessionId } = await createSession(appPool(), { userId });

    const { rows } = await jobsPool().query(
      `SELECT token_hash FROM id.session WHERE id = $1`, [sessionId],
    );
    const guardado = rows[0].token_hash as Buffer;
    expect(guardado.length).toBe(32);
    expect(guardado.equals(Buffer.from(token, 'utf8'))).toBe(false);
    expect(guardado.equals(hashSessionToken(token))).toBe(true);
  });

  it('token inexistente e recusado sem revelar se ja existiu', async () => {
    const r = await resolveSession(appPool(), 'token-que-nunca-foi-emitido');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('nao_encontrada');
  });

  it('sessao parada alem da janela de inatividade e recusada', async () => {
    const userId = await seedUser('Dr. Diego Alves');
    const { token, sessionId } = await createSession(appPool(), { userId });
    await jobsPool().query(
      `UPDATE id.session SET idle_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
      [sessionId],
    );
    const r = await resolveSession(appPool(), token);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('expirada_inatividade');
  });

  it('sessao alem do limite absoluto e recusada mesmo com uso continuo', async () => {
    const userId = await seedUser('Dra. Elisa Prado');
    const { token, sessionId } = await createSession(appPool(), { userId });
    await jobsPool().query(
      `UPDATE id.session SET absolute_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
      [sessionId],
    );
    const r = await resolveSession(appPool(), token);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('expirada_absoluta');
  });

  it('usar a sessao empurra a janela de inatividade para frente', async () => {
    const userId = await seedUser('Dr. Fabio Lins');
    const { token, sessionId } = await createSession(appPool(), { userId });
    const antes = await jobsPool().query(
      `SELECT idle_expires_at FROM id.session WHERE id = $1`, [sessionId],
    );
    await new Promise((r) => setTimeout(r, 30));
    await resolveSession(appPool(), token);
    const depois = await jobsPool().query(
      `SELECT idle_expires_at FROM id.session WHERE id = $1`, [sessionId],
    );
    expect(new Date(depois.rows[0].idle_expires_at).getTime())
      .toBeGreaterThan(new Date(antes.rows[0].idle_expires_at).getTime());
  });

  it('desligar o funcionario derruba todas as sessoes dele de uma vez', async () => {
    const userId = await seedUser('Dra. Gabriela Souza');
    const s1 = await createSession(appPool(), { userId });
    const s2 = await createSession(appPool(), { userId });

    const n = await revokeAllSessionsOfUser(appPool(), userId, 'desligamento');
    expect(n).toBe(2);
    expect((await resolveSession(appPool(), s1.token)).ok).toBe(false);
    expect((await resolveSession(appPool(), s2.token)).ok).toBe(false);
  });
});
