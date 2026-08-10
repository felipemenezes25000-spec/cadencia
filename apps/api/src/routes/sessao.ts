import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { appPool } from '@cadencia/db';
import { systemClock } from '@cadencia/kernel';
import {
  createSession, resolveSession, revokeSession, verifyPassword, verifyTotpForUser,
  CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, SESSION_IDLE_MINUTES,
  csrfMatches, newCsrfToken, type ResolvedSession,
} from '@cadencia/authn';

const VinculoSchema = z.object({
  tenantId: z.string().uuid(),
  tenantNome: z.string(),
  clinicId: z.string().uuid(),
  clinicNome: z.string(),
  timezone: z.string(),
  role: z.enum(['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro']),
});

/**
 * Erro nomeado. O contrato do front e o NOME, nunca o texto: mensagem e coisa
 * de tela e muda com copy; `credenciais_invalidas` nao muda nunca.
 */
const Erro = <const T extends readonly [string, ...string[]]>(...nomes: T) =>
  z.object({ erro: z.enum(nomes) });

interface LinhaVinculo {
  tenant_id: string; tenant_nome: string;
  clinic_id: string; clinic_nome: string;
  clinic_tz: string; role: string;
}

/**
 * O login e a unica rota mutante do sistema que nao passa por `rota()`: nao ha
 * sessao para o guard resolver, e exigir permissao para autenticar seria
 * circular. O que NAO se abre mao e a defesa de CSRF — sem ela, um formulario
 * em site de terceiro loga a vitima numa conta do atacante (login CSRF), e todo
 * dado que ela digitar depois vai parar no prontuario errado.
 */
function csrfOk(req: FastifyRequest): boolean {
  return csrfMatches(req.cookies[CSRF_COOKIE], req.headers[CSRF_HEADER]);
}

/**
 * Trava de forca bruta. As colunas `failed_attempts` e `locked_until` existem
 * em id.user_credential desde a migration 0016 e ficaram sem nenhum escritor —
 * provisionar a coluna nao e implementar a defesa.
 *
 * A trava vale para a senha CERTA tambem. Travar so o erro nao atrapalha um
 * atacante em nada: ele continua tentando ate acertar, e o unico efeito seria
 * incomodar o dono da conta depois.
 */
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MINUTOS = 15;

/**
 * Hash de isca, verificado quando o e-mail nao existe. Sem ele, "usuario
 * inexistente" responde em microssegundos e "senha errada" gasta os ~50 ms do
 * Argon2id — e essa diferenca de tempo e um oraculo de enumeracao que anula a
 * resposta identica que a rota tem o cuidado de devolver. A senha de origem e
 * literal e publica de proposito: isto nunca e credencial de ninguem.
 */
const HASH_ISCA =
  '$argon2id$v=19$m=19456,t=2,p=1$HWYd/GB8q4cg8SEFh42XhA$aMtP9PEgWt45JzdlMjLbH9iIKxOhGe9vFoU2ViIXIXw';

/**
 * Chave AES-256-GCM que protege o segredo TOTP em repouso. Em producao vem do
 * Secrets Manager por variavel de ambiente; a leitura e por chamada, e nao no
 * carregamento do modulo, para que rotacionar a chave nao exija redeploy.
 */
function chaveTotp(): Buffer {
  const b64 = process.env['CADENCIA_TOTP_KEY'];
  if (b64 === undefined || b64 === '') {
    throw new Error('CADENCIA_TOTP_KEY ausente — o segundo fator nao pode ser verificado');
  }
  const chave = Buffer.from(b64, 'base64');
  if (chave.length !== 32) {
    throw new Error(`CADENCIA_TOTP_KEY tem ${chave.length} bytes; AES-256-GCM exige 32`);
  }
  return chave;
}

/**
 * `authn` declara um `Clock` proprio (`now(): Date`) porque nao pode importar o
 * do kernel — sao irmaos em L0 e import entre irmaos e proibido (§2.2 regra 2).
 * A ponte entre os dois formatos e responsabilidade de L3, e e aqui. Nao ha
 * leitura direta do relogio: o milissegundo vem de `systemClock`, no kernel,
 * que e o unico lugar do repositorio autorizado a ler o relogio do sistema.
 *
 * (A frase acima evita de proposito escrever o nome da funcao proibida: o lint
 * de fonte de tempo varre linha a linha e nao distingue comentario de codigo.
 * Preferi ajustar a prosa a afrouxar a varredura — uma guarda que interpreta o
 * arquivo para decidir o que ignorar e uma guarda que se engana.)
 */
const relogioTotp = { now: (): Date => new Date(systemClock.nowMs()) };

function emitirCookies(reply: FastifyReply, sessionToken: string): void {
  const base = {
    path: '/', secure: true, sameSite: 'lax' as const,
    maxAge: SESSION_IDLE_MINUTES * 60,
  };
  reply.setCookie(SESSION_COOKIE, sessionToken, { ...base, httpOnly: true });
  // Legivel por JS de proposito: o front le e reenvia no header (double-submit).
  reply.setCookie(CSRF_COOKIE, newCsrfToken(), { ...base, httpOnly: false });
}

async function vinculosDe(userId: string): Promise<z.infer<typeof VinculoSchema>[]> {
  const { rows } = await appPool().query(
    `SELECT tenant_id, tenant_nome, clinic_id, clinic_nome, clinic_tz, role
       FROM id.memberships_for_login($1)`, [userId]);
  return (rows as LinhaVinculo[]).map((r) => ({
    tenantId: r.tenant_id, tenantNome: r.tenant_nome,
    clinicId: r.clinic_id, clinicNome: r.clinic_nome,
    timezone: r.clinic_tz, role: r.role as z.infer<typeof VinculoSchema>['role'],
  }));
}

/**
 * A sessao das proprias rotas de sessao. Nao passa por `resolveContext` de
 * proposito: aquele exige `x-clinic-id`, e estas sao exatamente as rotas que
 * existem para o usuario DESCOBRIR qual clinica pode informar.
 */
async function sessaoDaRequisicao(req: FastifyRequest): Promise<ResolvedSession | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (token === undefined || token === '') return null;
  const r = await resolveSession(appPool(), token);
  return r.ok ? r.value : null;
}

export async function sessaoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Metodo seguro sem cookie de CSRF: emite um agora. Sem este caminho o
  // primeiro POST /v1/sessao de todo navegador cai no 403 — o front nao tem
  // como fabricar um cookie __Host- para reenviar no header.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' && req.cookies[CSRF_COOKIE] === undefined) {
      reply.setCookie(CSRF_COOKIE, newCsrfToken(), {
        path: '/', secure: true, sameSite: 'lax', httpOnly: false,
        maxAge: SESSION_IDLE_MINUTES * 60,
      });
    }
  });

  r.post('/v1/sessao', {
    schema: {
      body: z.object({ email: z.string().email(), senha: z.string().min(1) }),
      response: {
        200: z.object({
          userId: z.string().uuid(),
          precisaMfa: z.boolean(),
          vinculos: z.array(VinculoSchema),
        }),
        401: Erro('credenciais_invalidas'),
        403: Erro('csrf_invalido'),
        423: Erro('conta_bloqueada'),
      },
    },
  }, async (req, reply) => {
    if (!csrfOk(req)) return reply.code(403).send({ erro: 'csrf_invalido' });

    const { email, senha } = req.body as { email: string; senha: string };
    const db = appPool();

    const { rows } = await db.query(
      `SELECT u.id, c.password_hash, c.failed_attempts,
              c.locked_until > clock_timestamp() AS travada,
              t.confirmed_at IS NOT NULL AS tem_totp
         FROM id."user" u
         JOIN id.user_credential c ON c.user_id = u.id
         LEFT JOIN id.user_totp   t ON t.user_id = u.id
        WHERE u.email = $1 AND u.disabled_at IS NULL AND u.status = 'ativo'`,
      [email]);

    const linha = rows[0] as {
      id: string; password_hash: string; travada: boolean; tem_totp: boolean;
    } | undefined;

    // O Argon2id roda SEMPRE, inclusive contra o hash de isca. E o que iguala o
    // tempo de resposta dos dois caminhos.
    const senhaOk = await verifyPassword(linha?.password_hash ?? HASH_ISCA, senha);

    if (linha === undefined || !senhaOk) {
      if (linha !== undefined) {
        await db.query(
          `UPDATE id.user_credential
              SET failed_attempts = failed_attempts + 1,
                  locked_until = CASE
                    WHEN failed_attempts + 1 >= $2
                    THEN clock_timestamp() + make_interval(mins => $3::int)
                    ELSE locked_until END
            WHERE user_id = $1`,
          [linha.id, MAX_TENTATIVAS, BLOQUEIO_MINUTOS]);
      }
      // Mesma resposta para e-mail inexistente e senha errada: distinguir os dois
      // transforma o login em oraculo de "quem trabalha nesta clinica".
      return reply.code(401).send({ erro: 'credenciais_invalidas' });
    }

    // A checagem da trava vem DEPOIS da senha, nao antes: responder
    // 'conta_bloqueada' a quem errou a senha diria "este e-mail existe".
    if (linha.travada) {
      return reply.code(423).send({ erro: 'conta_bloqueada' });
    }

    await db.query(
      `UPDATE id.user_credential
          SET failed_attempts = 0, locked_until = NULL
        WHERE user_id = $1 AND (failed_attempts <> 0 OR locked_until IS NOT NULL)`,
      [linha.id]);

    const { token } = await createSession(db, { userId: linha.id });
    emitirCookies(reply, token);

    return reply.code(200).send({
      userId: linha.id,
      precisaMfa: linha.tem_totp,
      vinculos: await vinculosDe(linha.id),
    });
  });

  r.get('/v1/sessao', {
    schema: {
      response: {
        200: z.object({
          userId: z.string().uuid(),
          email: z.string(),
          nome: z.string(),
          mfaOk: z.boolean(),
          unidadeAtiva: z.object({
            tenantId: z.string().uuid(), clinicId: z.string().uuid(),
          }).nullable(),
          vinculos: z.array(VinculoSchema),
        }),
        401: Erro('sem_sessao'),
      },
    },
  }, async (req, reply) => {
    const sessao = await sessaoDaRequisicao(req);
    if (sessao === null) return reply.code(401).send({ erro: 'sem_sessao' });

    const { rows } = await appPool().query(
      `SELECT email, full_name FROM id."user" WHERE id = $1`, [sessao.userId]);
    const u = rows[0] as { email: string; full_name: string } | undefined;
    if (u === undefined) return reply.code(401).send({ erro: 'sem_sessao' });

    return reply.code(200).send({
      userId: sessao.userId,
      email: u.email,
      nome: u.full_name,
      mfaOk: sessao.mfaAt !== null,
      unidadeAtiva: sessao.activeTenantId === null || sessao.activeClinicId === null
        ? null
        : { tenantId: sessao.activeTenantId, clinicId: sessao.activeClinicId },
      vinculos: await vinculosDe(sessao.userId),
    });
  });

  r.post('/v1/sessao/unidade', {
    schema: {
      body: z.object({ clinicId: z.string().uuid() }),
      response: {
        200: z.object({
          tenantId: z.string().uuid(),
          clinicId: z.string().uuid(),
          role: VinculoSchema.shape.role,
        }),
        401: Erro('sem_sessao'),
        403: Erro('csrf_invalido', 'sem_vinculo_na_unidade'),
      },
    },
  }, async (req, reply) => {
    if (!csrfOk(req)) return reply.code(403).send({ erro: 'csrf_invalido' });

    const sessao = await sessaoDaRequisicao(req);
    if (sessao === null) return reply.code(401).send({ erro: 'sem_sessao' });

    const { clinicId } = req.body as { clinicId: string };
    // A lista vem da funcao de bootstrap, nao do corpo da requisicao: e ela que
    // define o que este usuario pode assumir. Escolher unidade e um SELECT
    // dentro de um conjunto fechado, nunca um valor que o cliente informa.
    const vinculo = (await vinculosDe(sessao.userId)).find((v) => v.clinicId === clinicId);
    if (vinculo === undefined) {
      return reply.code(403).send({ erro: 'sem_vinculo_na_unidade' });
    }

    await appPool().query(
      `UPDATE id.session
          SET active_tenant_id = $2, active_clinic_id = $3
        WHERE id = $1 AND revoked_at IS NULL`,
      [sessao.sessionId, vinculo.tenantId, vinculo.clinicId]);

    return reply.code(200).send({
      tenantId: vinculo.tenantId, clinicId: vinculo.clinicId, role: vinculo.role });
  });

  r.post('/v1/sessao/mfa', {
    schema: {
      body: z.object({ codigo: z.string().length(6) }),
      response: {
        200: z.object({ mfaOk: z.literal(true) }),
        401: Erro('sem_sessao', 'codigo_invalido', 'codigo_reutilizado', 'nao_cadastrado'),
        403: Erro('csrf_invalido'),
      },
    },
  }, async (req, reply) => {
    if (!csrfOk(req)) return reply.code(403).send({ erro: 'csrf_invalido' });

    const sessao = await sessaoDaRequisicao(req);
    if (sessao === null) return reply.code(401).send({ erro: 'sem_sessao' });

    const { codigo } = req.body as { codigo: string };
    const db = appPool();
    const r = await verifyTotpForUser(db, sessao.userId, codigo, chaveTotp(), relogioTotp);
    if (!r.ok) return reply.code(401).send({ erro: r.error });

    // O carimbo vive na SESSAO, nao no usuario: o step-up vale para este
    // navegador e morre com ele. MFA gravado na pessoa faria a segunda aba,
    // em outra maquina, herdar um fator que ninguem apresentou ali.
    await db.query(
      `UPDATE id.session SET mfa_at = clock_timestamp()
        WHERE id = $1 AND revoked_at IS NULL`, [sessao.sessionId]);

    return reply.code(200).send({ mfaOk: true as const });
  });

  r.delete('/v1/sessao', {
    schema: {
      response: { 204: z.null(), 403: Erro('csrf_invalido') },
    },
  }, async (req, reply) => {
    if (!csrfOk(req)) return reply.code(403).send({ erro: 'csrf_invalido' });

    const sessao = await sessaoDaRequisicao(req);
    // Sair de uma sessao que ja morreu e sucesso, nao erro: o efeito desejado
    // ("nao estou mais logado") ja vale, e devolver 401 aqui so ensina o front
    // a tratar como falha algo que nao e.
    if (sessao !== null) {
      await revokeSession(appPool(), sessao.sessionId, 'logout');
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie(CSRF_COOKIE, { path: '/' });
    return reply.code(204).send(null);
  });
}
