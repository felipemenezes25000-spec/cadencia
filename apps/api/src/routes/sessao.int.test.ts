import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';
import {
  hashPassword, newCsrfToken, enrollTotp, TOTP_PERIOD_SECONDS,
} from '@cadencia/authn';
import { appPool, jobsPool, closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, type SementeSessao } from '../test-support';

const SENHA = 'Recepcao@2026';
const CHAVE_TOTP = randomBytes(32);

function codigoEm(secretBase32: string, at: Date): string {
  return new TOTP({
    issuer: 'Cadencia', label: 'teste', algorithm: 'SHA1', digits: 6,
    period: TOTP_PERIOD_SECONDS, secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: at.getTime() });
}

let s: SementeSessao;

/**
 * A credencial nasce fora de `semearSessao` de proposito: quase toda suite do
 * repositorio quer uma sessao ja aberta e nao paga o custo do Argon2id. Aqui e
 * o unico lugar que exerce o caminho de login de verdade.
 */
async function semearCredencial(userId: string, senha: string): Promise<void> {
  const admin = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    await admin.query(
      `INSERT INTO id.user_credential (user_id, password_hash) VALUES ($1, $2)`,
      [userId, await hashPassword(senha)]);
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  s = await semearSessao({ role: 'recepcao' });
  await semearCredencial(s.userId, SENHA);
});
afterAll(async () => { await closePools(); });

/** Cabecalhos de um navegador que ainda nao tem sessao, so o cookie de CSRF. */
function anonimo() {
  const csrf = newCsrfToken();
  return {
    cookies: { '__Host-cadencia_csrf': csrf },
    headers: { 'x-csrf-token': csrf },
  };
}

/** Faz o login de verdade e devolve os cookies que o navegador teria guardado. */
async function logar(app: Awaited<ReturnType<typeof buildApp>>): Promise<{ sid: string; csrf: string }> {
  const r = await app.inject({
    method: 'POST', url: '/v1/sessao', ...anonimo(),
    payload: { email: `${s.userId}@example.test`, senha: SENHA },
  });
  const le = (nome: string): string => {
    const c = r.cookies.find((x) => x.name === nome);
    if (c === undefined) throw new Error(`login nao emitiu o cookie ${nome}`);
    return c.value as string;
  };
  return { sid: le('__Host-cadencia_sid'), csrf: le('__Host-cadencia_csrf') };
}

describe('rotas de sessao', () => {
  it('POST /v1/sessao com senha correta abre sessao e devolve os vinculos', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/sessao', ...anonimo(),
      payload: { email: `${s.userId}@example.test`, senha: SENHA },
    });

    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      userId: string; precisaMfa: boolean;
      vinculos: { tenantId: string; clinicId: string; role: string }[];
    };
    expect(body.userId).toBe(s.userId);
    expect(body.precisaMfa).toBe(false);
    expect(body.vinculos).toContainEqual(
      expect.objectContaining({ clinicId: s.clinicId, role: 'recepcao' }));
    expect(r.cookies.some((c) => c.name === '__Host-cadencia_sid')).toBe(true);

    await app.close();
  });

  it('POST /v1/sessao com senha errada devolve o MESMO erro de e-mail inexistente', async () => {
    const app = await buildApp();
    const senhaErrada = await app.inject({
      method: 'POST', url: '/v1/sessao', ...anonimo(),
      payload: { email: `${s.userId}@example.test`, senha: 'nao-e-essa' },
    });
    const emailInexistente = await app.inject({
      method: 'POST', url: '/v1/sessao', ...anonimo(),
      payload: { email: 'ninguem@example.test', senha: SENHA },
    });

    expect(senhaErrada.statusCode).toBe(401);
    expect(emailInexistente.statusCode).toBe(401);
    // Respostas identicas byte a byte: distinguir as duas transforma o login em
    // oraculo de "quem trabalha nesta clinica".
    expect(senhaErrada.body).toBe(emailInexistente.body);

    await app.close();
  });

  it('POST /v1/sessao sem cookie de CSRF e recusado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/sessao',
      payload: { email: `${s.userId}@example.test`, senha: SENHA },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ erro: 'csrf_invalido' });
    await app.close();
  });

  it('GET /v1/sessao devolve quem sou e os vinculos, sem exigir x-clinic-id', async () => {
    const app = await buildApp();
    const sessao = await logar(app);

    const r = await app.inject({
      method: 'GET', url: '/v1/sessao',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
    });

    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      userId: string; email: string; nome: string;
      mfaCadastrado: boolean;
      unidadeAtiva: { clinicId: string } | null;
      vinculos: { clinicId: string }[];
    };
    expect(body.userId).toBe(s.userId);
    expect(body.email).toBe(`${s.userId}@example.test`);
    // Ainda nao escolheu unidade: o login nao decide por ela.
    expect(body.unidadeAtiva).toBeNull();
    expect(body.vinculos).toHaveLength(1);
    expect(body).toHaveProperty('mfaCadastrado', false);

    await app.close();
  });

  it('POST /v1/sessao/unidade fixa a clinica ativa e destrava as demais rotas', async () => {
    const app = await buildApp();
    const sessao = await logar(app);

    // Antes de escolher a unidade, rota comum nao responde: a sessao existe mas
    // nao tem tenant, e todo o resto do sistema depende de tenant.
    const antes = await app.inject({
      method: 'GET', url: '/v1/pacientes?termo=pacient',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-clinic-id': s.clinicId },
    });
    expect(antes.statusCode).toBe(401);

    const escolha = await app.inject({
      method: 'POST', url: '/v1/sessao/unidade',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
      payload: { clinicId: s.clinicId },
    });
    expect(escolha.statusCode).toBe(200);
    expect(escolha.json()).toMatchObject({
      tenantId: s.tenantId, clinicId: s.clinicId, role: 'recepcao' });

    const depois = await app.inject({
      method: 'GET', url: '/v1/pacientes?termo=pacient',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-clinic-id': s.clinicId },
    });
    expect(depois.statusCode).toBe(200);

    await app.close();
  });

  it('POST /v1/sessao/unidade recusa clinica onde nao ha vinculo', async () => {
    const app = await buildApp();
    const sessao = await logar(app);

    const r = await app.inject({
      method: 'POST', url: '/v1/sessao/unidade',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
      payload: { clinicId: s.clinicIdDeOutroTenant },
    });

    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ erro: 'sem_vinculo_na_unidade' });

    await app.close();
  });

  it('DELETE /v1/sessao revoga a sessao e o cookie para de valer', async () => {
    const app = await buildApp();
    const sessao = await logar(app);

    const saida = await app.inject({
      method: 'DELETE', url: '/v1/sessao',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
    });
    expect(saida.statusCode).toBe(204);

    const depois = await app.inject({
      method: 'GET', url: '/v1/sessao',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
    });
    expect(depois.statusCode).toBe(401);

    await app.close();
  });
});

describe('forca bruta', () => {
  let b: SementeSessao;

  beforeAll(async () => {
    b = await semearSessao({ role: 'recepcao' });
    await semearCredencial(b.userId, SENHA);
  });

  it('trava a conta depois de tentativas seguidas e recusa ate a senha certa', async () => {
    const app = await buildApp();
    const email = `${b.userId}@example.test`;

    for (let i = 0; i < 5; i += 1) {
      const r = await app.inject({
        method: 'POST', url: '/v1/sessao', ...anonimo(),
        payload: { email, senha: 'errada' } });
      expect(r.statusCode).toBe(401);
    }

    // A senha CORRETA agora tambem falha: e isso que transforma a contagem em
    // defesa. Travar so a senha errada nao atrapalha um atacante em nada.
    const comSenhaCerta = await app.inject({
      method: 'POST', url: '/v1/sessao', ...anonimo(),
      payload: { email, senha: SENHA } });
    expect(comSenhaCerta.statusCode).toBe(423);
    expect(comSenhaCerta.json()).toMatchObject({ erro: 'conta_bloqueada' });

    await app.close();
  });

  it('acerto antes do limite zera o contador', async () => {
    const app = await buildApp();
    const c = await semearSessao({ role: 'recepcao' });
    await semearCredencial(c.userId, SENHA);
    const email = `${c.userId}@example.test`;

    for (let i = 0; i < 3; i += 1) {
      await app.inject({ method: 'POST', url: '/v1/sessao', ...anonimo(),
        payload: { email, senha: 'errada' } });
    }
    const acerto = await app.inject({ method: 'POST', url: '/v1/sessao', ...anonimo(),
      payload: { email, senha: SENHA } });
    expect(acerto.statusCode).toBe(200);

    const { rows } = await jobsPool().query(
      `SELECT failed_attempts, locked_until FROM id.user_credential WHERE user_id = $1`,
      [c.userId]);
    expect(rows[0]?.failed_attempts).toBe(0);
    expect(rows[0]?.locked_until).toBeNull();

    await app.close();
  });
});

describe('segundo fator', () => {
  // Usuario proprio: habilitar TOTP muda o `precisaMfa` do login, e reaproveitar
  // o usuario dos testes acima faria a ordem de execucao virar pre-requisito.
  let m: SementeSessao;
  let segredo: string;

  beforeAll(async () => {
    process.env['CADENCIA_TOTP_KEY'] = CHAVE_TOTP.toString('base64');
    m = await semearSessao({ role: 'profissional', comMfa: false });
    await semearCredencial(m.userId, SENHA);
    const inscricao = await enrollTotp(appPool(), m.userId, CHAVE_TOTP);
    segredo = inscricao.secretBase32;
    // Confirma por SQL em vez de gastar um passo de 30 s: consumir um codigo
    // aqui faria o teste do endpoint cair em 'codigo_reutilizado' por estar na
    // mesma janela de tempo, e o teste passaria a depender do relogio da maquina.
    await jobsPool().query(
      `UPDATE id.user_totp SET confirmed_at = clock_timestamp() WHERE user_id = $1`,
      [m.userId]);
  });

  async function logarComoM(app: Awaited<ReturnType<typeof buildApp>>) {
    const r = await app.inject({
      method: 'POST', url: '/v1/sessao', ...anonimo(),
      payload: { email: `${m.userId}@example.test`, senha: SENHA },
    });
    const le = (nome: string): string => {
      const c = r.cookies.find((x) => x.name === nome);
      if (c === undefined) throw new Error(`login nao emitiu o cookie ${nome}`);
      return c.value as string;
    };
    return { resposta: r, sid: le('__Host-cadencia_sid'), csrf: le('__Host-cadencia_csrf') };
  }

  it('quem tem TOTP confirmado recebe precisaMfa=true no login', async () => {
    const app = await buildApp();
    const { resposta } = await logarComoM(app);
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ precisaMfa: true });
    await app.close();
  });

  it('POST /v1/sessao/mfa aceita o codigo valido e o mesmo codigo nao entra duas vezes', async () => {
    const app = await buildApp();
    const sessao = await logarComoM(app);
    const codigo = codigoEm(segredo, new Date());
    const cookies = { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf };

    const primeira = await app.inject({
      method: 'POST', url: '/v1/sessao/mfa',
      cookies, headers: { 'x-csrf-token': sessao.csrf }, payload: { codigo },
    });
    expect(primeira.statusCode).toBe(200);

    const quem = await app.inject({ method: 'GET', url: '/v1/sessao', cookies });
    expect(quem.json()).toMatchObject({ mfaOk: true });

    // Replay: o codigo lido por cima do ombro ainda esta dentro dos 30 s.
    const segunda = await app.inject({
      method: 'POST', url: '/v1/sessao/mfa',
      cookies, headers: { 'x-csrf-token': sessao.csrf }, payload: { codigo },
    });
    expect(segunda.statusCode).toBe(401);
    expect(segunda.json()).toMatchObject({ erro: 'codigo_reutilizado' });

    await app.close();
  });

  it('POST /v1/sessao/mfa recusa codigo invalido', async () => {
    const app = await buildApp();
    const sessao = await logarComoM(app);
    const r = await app.inject({
      method: 'POST', url: '/v1/sessao/mfa',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf }, payload: { codigo: '000000' },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ erro: 'codigo_invalido' });
    await app.close();
  });
});

describe('troca de senha', () => {
  let p: SementeSessao;

  beforeAll(async () => {
    p = await semearSessao({ role: 'recepcao' });
    await semearCredencial(p.userId, SENHA);
  });

  async function logarComoP(app: Awaited<ReturnType<typeof buildApp>>) {
    const r = await app.inject({
      method: 'POST', url: '/v1/sessao', ...anonimo(),
      payload: { email: `${p.userId}@example.test`, senha: SENHA },
    });
    const le = (nome: string): string => {
      const c = r.cookies.find((x) => x.name === nome);
      if (c === undefined) throw new Error(`login nao emitiu o cookie ${nome}`);
      return c.value as string;
    };
    return { sid: le('__Host-cadencia_sid'), csrf: le('__Host-cadencia_csrf') };
  }

  it('PUT /v1/sessao/senha com senha correta troca e revoga sessoes anteriores', async () => {
    const app = await buildApp();
    const sessaoAntiga = await logarComoP(app);
    const novaSenha = 'NovaSenha@2026';

    const r = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessaoAntiga.sid, '__Host-cadencia_csrf': sessaoAntiga.csrf },
      headers: { 'x-csrf-token': sessaoAntiga.csrf },
      payload: { senhaAtual: SENHA, senhaNova: novaSenha },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });

    // Sessao antiga invalidada
    const comAntiga = await app.inject({
      method: 'GET', url: '/v1/sessao',
      cookies: { '__Host-cadencia_sid': sessaoAntiga.sid, '__Host-cadencia_csrf': sessaoAntiga.csrf },
    });
    expect(comAntiga.statusCode).toBe(401);

    // Nova sessao emitida nos cookies da resposta
    const novaSid = r.cookies.find((c) => c.name === '__Host-cadencia_sid');
    expect(novaSid).toBeDefined();
    const novoCsrf = r.cookies.find((c) => c.name === '__Host-cadencia_csrf');
    expect(novoCsrf).toBeDefined();

    const comNova = await app.inject({
      method: 'GET', url: '/v1/sessao',
      cookies: { '__Host-cadencia_sid': novaSid!.value as string, '__Host-cadencia_csrf': novoCsrf!.value as string },
    });
    expect(comNova.statusCode).toBe(200);

    // Login com senha nova funciona
    const loginNovo = await app.inject({
      method: 'POST', url: '/v1/sessao', ...anonimo(),
      payload: { email: `${p.userId}@example.test`, senha: novaSenha },
    });
    expect(loginNovo.statusCode).toBe(200);

    // Restaura a senha original para nao quebrar outros testes
    const sessaoRestaurar = {
      sid: loginNovo.cookies.find((c) => c.name === '__Host-cadencia_sid')!.value as string,
      csrf: loginNovo.cookies.find((c) => c.name === '__Host-cadencia_csrf')!.value as string,
    };
    const restaurar = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessaoRestaurar.sid, '__Host-cadencia_csrf': sessaoRestaurar.csrf },
      headers: { 'x-csrf-token': sessaoRestaurar.csrf },
      payload: { senhaAtual: novaSenha, senhaNova: SENHA },
    });
    expect(restaurar.statusCode).toBe(200);

    await app.close();
  });

  it('PUT /v1/sessao/senha com senha atual incorreta retorna 401', async () => {
    const app = await buildApp();
    const sessao = await logarComoP(app);

    const r = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
      payload: { senhaAtual: 'errada', senhaNova: 'NovaSenha@2026' },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ erro: 'senha_incorreta' });

    await app.close();
  });

  it('PUT /v1/sessao/senha com senha nova curta retorna 422', async () => {
    const app = await buildApp();
    const sessao = await logarComoP(app);

    const r = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
      payload: { senhaAtual: SENHA, senhaNova: 'curta' },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'senha_fraca' });

    await app.close();
  });

  it('PUT /v1/sessao/senha com senha nova igual a atual retorna 422', async () => {
    const app = await buildApp();
    const sessao = await logarComoP(app);

    const r = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
      payload: { senhaAtual: SENHA, senhaNova: SENHA },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'senha_fraca' });

    await app.close();
  });

  it('PUT /v1/sessao/senha sem CSRF retorna 403', async () => {
    const app = await buildApp();
    const sessao = await logarComoP(app);

    const r = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessao.sid },
      payload: { senhaAtual: SENHA, senhaNova: 'NovaSenha@2026' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ erro: 'csrf_invalido' });

    await app.close();
  });
});
