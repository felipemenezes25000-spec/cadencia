/**
 * Cria um usuario de acesso ao sistema, pela linha de comando.
 *
 * Existe para o primeiro acesso e para operacao: a tela de equipe
 * (`/configuracoes/equipe`) so cria usuario para quem JA esta dentro com papel
 * `admin_clinico`, entao um banco recem-migrado nao tem por onde comecar. Este
 * script e a unica porta que nao exige uma sessao previa.
 *
 *   npx tsx --env-file=.env scripts/criar-usuario.ts \
 *     --nome "Akiko" --email akiko@aurora.demo --senha 'Cece1602$'
 *
 * Chama `app.conceder_vinculo`, a MESMA funcao que a rota de convite usa, e nao
 * um INSERT proprio: usuario, credencial, vinculo e ficha de profissional
 * nascem pelo caminho de producao, com as mesmas travas. Um script que
 * inserisse na mao criaria contas que a aplicacao nao sabe explicar.
 *
 * Roda pela conexao ADMIN porque atravessa `id` e `app`, e o papel `jobs` nao
 * tem GRANT em todos os schemas (BYPASSRLS ignora POLICY, nao ignora GRANT).
 *
 * Reexecutar e seguro: e-mail ja cadastrado reaproveita a identidade global
 * (uma pessoa, um cadastro) e so acrescenta o vinculo. A senha de quem ja
 * existe NAO e sobrescrita sem `--redefinir-senha` — trocar a senha de alguem
 * por engano ao rodar de novo e o tipo de acidente que este script nao deve
 * permitir em silencio.
 */
import { Pool, type PoolClient } from 'pg';
import { parseArgs } from 'node:util';
import { hashPassword, MEMBERSHIP_ROLES } from '@cadencia/authn';

/** Espelha `ROLES_PROFISSIONAIS` da rota de convite: quem atende tem conselho. */
const ROLES_PROFISSIONAIS = ['profissional', 'diretor_tecnico'] as const;

/** Mesmo minimo da rota de convite e da troca de senha (§ sessao). */
const SENHA_MINIMA = 8;

const AJUDA = `
Cria um usuario e o vincula a uma clinica.

  npx tsx --env-file=.env scripts/criar-usuario.ts --nome NOME --email EMAIL --senha SENHA [opcoes]

Obrigatorios
  --nome              Nome completo, como aparece na equipe.
  --email             E-mail de login. E a identidade global da pessoa.
  --senha             Senha de acesso (minimo ${SENHA_MINIMA} caracteres).

Opcionais
  --papel             ${MEMBERSHIP_ROLES.join(' | ')}   (padrao: recepcao)
  --tenant            Slug do tenant. Obrigatorio se houver mais de um.
  --clinica           UUID da clinica. Obrigatorio se o tenant tiver mais de uma.
  --cpf               11 digitos, sem pontuacao. Obrigatorio para quem prescreve
                      pela Memed, que identifica o prescritor por ele.
  --conselho          Codigo do conselho (ex.: 06 = CRM). Obrigatorio para
  --numero-conselho   ${ROLES_PROFISSIONAIS.join(' e ')}.
  --uf-conselho       Duas letras maiusculas (ex.: SP).
  --cbos              Ocupacao CBO-S (ex.: 225125).
  --redefinir-senha   Sobrescreve a senha de um e-mail ja cadastrado e derruba
                      as sessoes abertas dele.
  --ajuda             Mostra este texto.
`;

interface Opcoes {
  nome: string;
  email: string;
  senha: string;
  papel: string;
  tenant: string | undefined;
  clinica: string | undefined;
  cpf: string | undefined;
  conselho: string | undefined;
  numeroConselho: string | undefined;
  ufConselho: string | undefined;
  cbos: string | undefined;
  redefinirSenha: boolean;
}

class ErroDeUso extends Error {}

function lerOpcoes(): Opcoes | null {
  const { values } = parseArgs({
    options: {
      nome: { type: 'string' },
      email: { type: 'string' },
      senha: { type: 'string' },
      papel: { type: 'string' },
      tenant: { type: 'string' },
      clinica: { type: 'string' },
      cpf: { type: 'string' },
      conselho: { type: 'string' },
      'numero-conselho': { type: 'string' },
      'uf-conselho': { type: 'string' },
      cbos: { type: 'string' },
      'redefinir-senha': { type: 'boolean', default: false },
      ajuda: { type: 'boolean', default: false },
    },
  });

  if (values.ajuda === true) return null;

  const nome = values.nome ?? '';
  const email = values.email ?? '';
  const senha = values.senha ?? '';
  const papel = values.papel ?? 'recepcao';

  if (nome.trim().length < 2) throw new ErroDeUso('--nome e obrigatorio (2+ caracteres)');
  // Deliberadamente frouxo: quem valida e-mail de verdade e o zod da rota de
  // login. Aqui basta recusar o obvio para nao criar conta com a qual ninguem
  // consegue entrar.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ErroDeUso('--email e obrigatorio e precisa ser um e-mail valido');
  }
  if (senha.length < SENHA_MINIMA) {
    throw new ErroDeUso(`--senha e obrigatoria (minimo ${SENHA_MINIMA} caracteres)`);
  }
  if (!(MEMBERSHIP_ROLES as readonly string[]).includes(papel)) {
    throw new ErroDeUso(`--papel invalido. Use um de: ${MEMBERSHIP_ROLES.join(', ')}`);
  }

  const cpf = values.cpf;
  if (cpf !== undefined && !/^\d{11}$/.test(cpf)) {
    throw new ErroDeUso('--cpf precisa ter 11 digitos, sem pontuacao');
  }
  const ufConselho = values['uf-conselho'];
  if (ufConselho !== undefined && !/^[A-Z]{2}$/.test(ufConselho)) {
    throw new ErroDeUso('--uf-conselho precisa ser a sigla em maiusculas, ex.: SP');
  }

  const conselho = values.conselho;
  const numeroConselho = values['numero-conselho'];
  if ((ROLES_PROFISSIONAIS as readonly string[]).includes(papel)
      && (conselho === undefined || numeroConselho === undefined || ufConselho === undefined)) {
    // Mesma regra da rota (422 dados_profissionais_obrigatorios): profissional
    // sem conselho nao consegue emitir guia nem assinar documento, e a conta
    // nasceria pela metade.
    throw new ErroDeUso(
      `--papel ${papel} exige --conselho, --numero-conselho e --uf-conselho`);
  }

  return {
    nome: nome.trim(), email: email.trim(), senha, papel,
    tenant: values.tenant, clinica: values.clinica, cpf,
    conselho, numeroConselho, ufConselho, cbos: values.cbos,
    redefinirSenha: values['redefinir-senha'] === true,
  };
}

function adminPool(): Pool {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new ErroDeUso('DATABASE_URL_ADMIN ausente');
  return new Pool({ connectionString: url, max: 1 });
}

/** Resolve o tenant pelo slug, ou pelo unico que existir. */
async function resolverTenant(c: PoolClient, slug: string | undefined): Promise<string> {
  if (slug !== undefined) {
    const { rows } = await c.query<{ id: string }>(
      `SELECT id FROM app.tenant WHERE slug = $1`, [slug]);
    const id = rows[0]?.id;
    if (id === undefined) throw new ErroDeUso(`tenant '${slug}' nao existe`);
    return id;
  }
  const { rows } = await c.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM app.tenant ORDER BY slug`);
  if (rows.length === 0) {
    throw new ErroDeUso('nenhum tenant no banco. Rode `pnpm db:migrate` e crie a clinica antes');
  }
  if (rows.length > 1) {
    throw new ErroDeUso(
      `ha ${rows.length} tenants: escolha com --tenant ` +
      `(${rows.map((t) => t.slug).join(', ')})`);
  }
  return rows[0]!.id;
}

/** Resolve a clinica pelo id, ou pela unica do tenant. */
async function resolverClinica(
  c: PoolClient, tenantId: string, clinicaId: string | undefined,
): Promise<{ id: string; nome: string }> {
  const { rows } = await c.query<{ id: string; nome: string }>(
    `SELECT id, nome FROM app.clinic
      WHERE tenant_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
      ORDER BY nome`,
    [tenantId, clinicaId ?? null]);
  if (rows.length === 0) {
    throw new ErroDeUso(clinicaId === undefined
      ? 'o tenant nao tem nenhuma clinica'
      : `clinica ${clinicaId} nao existe neste tenant`);
  }
  if (rows.length > 1) {
    throw new ErroDeUso(
      `ha ${rows.length} clinicas: escolha com --clinica\n` +
      rows.map((x) => `  ${x.id}  ${x.nome}`).join('\n'));
  }
  return rows[0]!;
}

/**
 * Quem consta como autor da concessao. Um admin da propria clinica, se houver;
 * senao NULL — e o caso do PRIMEIRO usuario, que nao tem quem o conceda, e
 * inventar um autor ali seria mentir na trilha.
 */
async function resolverAutor(c: PoolClient, clinicId: string): Promise<string | null> {
  const { rows } = await c.query<{ user_id: string }>(
    `SELECT user_id FROM app.membership
      WHERE clinic_id = $1 AND revoked_at IS NULL
        AND role IN ('admin_clinico', 'diretor_tecnico')
      ORDER BY granted_at LIMIT 1`,
    [clinicId]);
  return rows[0]?.user_id ?? null;
}

async function main(): Promise<void> {
  const o = lerOpcoes();
  if (o === null) { process.stdout.write(AJUDA); return; }

  const pool = adminPool();
  const c = await pool.connect();

  try {
    await c.query('BEGIN');

    const tenantId = await resolverTenant(c, o.tenant);
    const clinica = await resolverClinica(c, tenantId, o.clinica);
    const autor = await resolverAutor(c, clinica.id);

    // Estado ANTES da chamada: `conceder_vinculo` reaproveita e-mail e
    // credencial existentes em silencio, e sem olhar antes nao da para dizer se
    // a senha informada e a que vale.
    const { rows: antes } = await c.query<{
      id: string; status: string; disabled_at: Date | null; tem_credencial: boolean;
    }>(
      `SELECT u.id, u.status, u.disabled_at,
              EXISTS (SELECT 1 FROM id.user_credential k WHERE k.user_id = u.id)
                AS tem_credencial
         FROM id."user" u WHERE u.email = $1`,
      [o.email]);
    const jaExistia = antes[0];

    // O contexto de transacao alimenta app.current_tenant_id() e
    // app.current_user_id() dentro da funcao. `actor_kind = system` porque quem
    // executa aqui e um operador com acesso ao banco, nao uma sessao do produto.
    await c.query(
      `SELECT set_config('app.tenant_id', $1, TRUE),
              set_config('app.user_id', $2, TRUE),
              set_config('app.clinic_id', $3, TRUE),
              set_config('app.actor_kind', $4, TRUE),
              set_config('app.request_id', '', TRUE)`,
      [tenantId, autor ?? '', clinica.id, autor === null ? 'system' : 'user']);

    const senhaHash = await hashPassword(o.senha);

    let userId: string;
    try {
      const { rows } = await c.query<{ r_user_id: string; r_membership_id: string }>(
        `SELECT * FROM app.conceder_vinculo($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [clinica.id, o.email, o.nome, o.papel, senhaHash,
         o.cpf ?? null, o.conselho ?? null, o.numeroConselho ?? null,
         o.ufConselho ?? null, o.cbos ?? null]);
      userId = rows[0]!.r_user_id;
    } catch (e: unknown) {
      if (typeof e === 'object' && e !== null && 'code' in e
          && (e as { code: string }).code === '23505') {
        throw new ErroDeUso(
          `${o.email} ja tem o papel ${o.papel} nesta clinica — nada a fazer`);
      }
      throw e;
    }

    // ── Senha de quem ja existia ────────────────────────────────────────────
    let senhaVale = true;
    let sessoesDerrubadas = 0;
    if (jaExistia?.tem_credencial === true) {
      if (o.redefinirSenha) {
        await c.query(
          `UPDATE id.user_credential
              SET password_hash = $2, password_updated_at = clock_timestamp(),
                  failed_attempts = 0, locked_until = NULL
            WHERE user_id = $1`,
          [userId, senhaHash]);
        // Senha trocada derruba sessao aberta: e o mesmo comportamento da troca
        // de senha pelo produto, e o motivo de existir e sempre o mesmo.
        const { rowCount } = await c.query(
          `UPDATE id.session
              SET revoked_at = clock_timestamp(), revoked_reason = 'troca_de_senha'
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId]);
        sessoesDerrubadas = rowCount ?? 0;
      } else {
        senhaVale = false;
      }
    }

    await c.query('COMMIT');

    // Conta suspensa ou desativada continua recebendo vinculo — a funcao nao
    // olha o status —, mas o login recusa. Avisar aqui evita a hora perdida
    // procurando erro de senha no que e estado da conta.
    const impedimento = jaExistia !== undefined
        && (jaExistia.status !== 'ativo' || jaExistia.disabled_at !== null)
      ? `\n  ATENCAO: a conta esta '${jaExistia.status}'` +
        `${jaExistia.disabled_at !== null ? ' e desativada' : ''} e o login vai recusar.\n`
      : '';

    process.stdout.write(
      `\nUsuario pronto.\n\n` +
      `  Nome ......... ${o.nome}\n` +
      `  E-mail ....... ${o.email}\n` +
      `  Papel ........ ${o.papel}\n` +
      `  Clinica ...... ${clinica.nome}\n` +
      `  Id ........... ${userId}\n` +
      `  Cadastro ..... ${jaExistia === undefined ? 'criado agora' : 'ja existia, vinculo acrescentado'}\n` +
      (senhaVale
        ? `  Senha ........ a que voce informou\n`
        : `  Senha ........ MANTIDA a anterior — rode de novo com --redefinir-senha para trocar\n`) +
      (sessoesDerrubadas > 0
        ? `  Sessoes ...... ${sessoesDerrubadas} derrubada(s) pela troca de senha\n` : '') +
      impedimento +
      (autor === null
        ? `\n  Vinculo sem autor: nao havia admin nesta clinica para constar` +
          ` na trilha.\n` : '') +
      `\n`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    process.stderr.write(e instanceof ErroDeUso
      ? `\n${e.message}\n\nUse --ajuda para ver as opcoes.\n`
      : `falhou: ${(e as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}

void main().catch((e: unknown) => {
  process.stderr.write(e instanceof ErroDeUso
    ? `\n${e.message}\n\nUse --ajuda para ver as opcoes.\n`
    : `${e instanceof Error ? e.stack : String(e)}\n`);
  process.exitCode = 1;
});
