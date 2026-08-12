/**
 * Carrega um release da CID-11 (ICD-11 MMS) da API da OMS para `ref.cid11_term`.
 *
 * POR QUE ISTO É UM SCRIPT E NÃO UMA MIGRATION:
 * o catálogo tem dezenas de milhares de entidades e vem de fora. Migration que
 * depende de rede falha no deploy quando a OMS estiver fora do ar, e um deploy
 * que trava por causa de terminologia é um deploy que ninguém faz na sexta.
 *
 * CREDENCIAIS: registro gratuito em https://icd.who.int/icdapi -> "View API
 * access key(s)". Duas variáveis de ambiente:
 *
 *   ICD_CLIENT_ID=...
 *   ICD_CLIENT_SECRET=...
 *
 * Alternativa sem credencial: a OMS publica a própria API como container
 * (`whoicd/icd-api`). Suba localmente e aponte ICD_BASE_URL para ele — o que
 * também é a forma correta de rodar isto em produção, para não depender do
 * servidor da OMS no meio de um atendimento.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/carregar-cid11.ts [--release 2025-01] [--dry-run]
 */
import { Pool } from 'pg';
import {
  entidadesDaLinearizacao, exigeOauth, loadCid11Release, type EntidadeIcd11,
} from '@cadencia/catalogs';

const BASE = process.env['ICD_BASE_URL'] ?? 'https://id.who.int';
const TOKEN_URL = 'https://icdaccessmanagement.who.int/connect/token';

interface Opcoes {
  readonly release: string;
  readonly dryRun: boolean;
}

function lerOpcoes(argv: readonly string[]): Opcoes {
  const i = argv.indexOf('--release');
  return {
    release: i >= 0 ? (argv[i + 1] ?? '2025-01') : '2025-01',
    dryRun: argv.includes('--dry-run'),
  };
}

/**
 * `2025-01` -> `202501`, que é o formato de `competencia` char(6) — o mesmo da
 * CID-10 e do TUSS. Uniformizar aqui evita que `clin.diagnosis.terminology_version`
 * tenha um formato por terminologia.
 */
function competenciaDoRelease(release: string): string {
  const limpo = release.replace(/[^0-9]/g, '');
  if (limpo.length !== 6) {
    throw new Error(`release '${release}' nao vira competencia AAAAMM`);
  }
  return limpo;
}

/**
 * Token só quando o destino exige. Instância local não autentica — ver
 * `icd-endpoint.ts`. Devolver string vazia mantém o resto do script sem `if`.
 */
async function obterToken(): Promise<string> {
  if (!exigeOauth(BASE)) return '';
  const id = process.env['ICD_CLIENT_ID'];
  const secret = process.env['ICD_CLIENT_SECRET'];
  if (id === undefined || id === '' || secret === undefined || secret === '') {
    throw new Error(
      'ICD_CLIENT_ID e ICD_CLIENT_SECRET ausentes. Registro gratuito em ' +
      'https://icd.who.int/icdapi (ou suba o container whoicd/icd-api e ' +
      'aponte ICD_BASE_URL para ele).');
  }
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id, client_secret: secret,
      scope: 'icdapi_access', grant_type: 'client_credentials',
    }),
  });
  if (!r.ok) throw new Error(`token recusado pela OMS: ${r.status}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

/**
 * A URI que a OMS devolve nos campos `child` aponta sempre para `id.who.int`,
 * mesmo quando a resposta veio da instância local. Seguir esse endereço cru
 * jogaria a carga inteira de volta no servidor da OMS — exatamente o que subir o
 * container evita. Trocar o host mantém a travessia dentro de casa.
 */
function noEndpointConfigurado(url: string): string {
  try {
    const alvo = new URL(url);
    const base = new URL(BASE);
    alvo.protocol = base.protocol;
    alvo.host = base.host;
    return alvo.toString();
  } catch {
    return url;
  }
}

async function buscar(url: string, token: string): Promise<unknown> {
  const r = await fetch(noEndpointConfigurado(url), {
    headers: {
      ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
      accept: 'application/json',
      'accept-language': 'pt',        // A OMS publica a CID-11 em português.
      'api-version': 'v2',
    },
  });
  if (!r.ok) throw new Error(`${r.status} em ${url}`);
  return r.json();
}

/** Requisições simultâneas contra a API da OMS. */
const CONCORRENCIA = 8;

/**
 * Desce a árvore da linearização a partir de um capítulo.
 *
 * Iterativo com pilha explícita, e não recursivo: a MMS tem mais de 30 mil
 * entidades e alguns ramos passam de 10 níveis. Recursão esbarraria na pilha do
 * Node no meio da carga, deixando o catálogo pela metade.
 *
 * E com CONCORRENCIA LIMITADA. Uma requisição por vez levava horas — a árvore é
 * larga, não profunda, e o gargalo é a latência de ida e volta até Genebra, não
 * o processamento. Oito trabalhadores derrubam isso para minutos.
 *
 * O limite existe: sem teto, a primeira camada dispararia mil requisições de uma
 * vez e a OMS responderia 429 — e o catálogo pela metade é pior que nenhum,
 * porque a busca passa a devolver menos sem nada indicar isso na tela.
 */
async function descer(
  raizes: readonly string[], capitulo: string | null, token: string,
  vistos: Set<string>, acc: EntidadeIcd11[],
): Promise<void> {
  let pilha = [...raizes];

  while (pilha.length > 0) {
    // Fatia do tamanho da concorrência: o resto volta para a pilha junto com os
    // filhos descobertos nesta rodada.
    const lote = pilha.splice(0, CONCORRENCIA).filter((u) => {
      if (vistos.has(u)) return false;   // A MMS tem entidade com mais de um pai.
      vistos.add(u);
      return true;
    });
    if (lote.length === 0) continue;

    const nos = await Promise.all(
      lote.map((url) => buscar(url, token) as Promise<{ child?: unknown }>));

    for (const no of nos) {
      acc.push(...entidadesDaLinearizacao(no, capitulo));
      if (Array.isArray(no.child)) {
        for (const filho of no.child) {
          if (typeof filho === 'string' && !vistos.has(filho)) pilha.push(filho);
        }
      }
    }
  }
}

async function main(): Promise<void> {
  const opts = lerOpcoes(process.argv.slice(2));
  const competencia = competenciaDoRelease(opts.release);
  const token = await obterToken();

  const raiz = await buscar(
    `${BASE}/icd/release/11/${opts.release}/mms`, token) as { child?: unknown };
  const capitulos = Array.isArray(raiz.child)
    ? raiz.child.filter((c): c is string => typeof c === 'string') : [];
  if (capitulos.length === 0) throw new Error('a OMS nao devolveu capitulos');

  const vistos = new Set<string>();
  const linhas: EntidadeIcd11[] = [];
  for (const cap of capitulos) {
    // O rótulo sai do PRÓPRIO capítulo, não da posição na lista. A CID-11 tem
    // 28 capítulos, e os dois últimos são 'V' (funcionalidade) e 'X' (códigos
    // de extensão) — letras. Numerar por posição os gravaria como '27' e '28',
    // dois capítulos que não existem.
    const no = await buscar(cap, token) as { code?: unknown };
    const rotulo = typeof no.code === 'string' && no.code !== '' ? no.code : null;
    await descer([cap], rotulo, token, vistos, linhas);
    process.stdout.write(`  capitulo ${rotulo ?? '?'}: ${linhas.length} termos acumulados\n`);
  }

  if (opts.dryRun) {
    process.stdout.write(`\n[dry-run] ${linhas.length} termos, nada gravado.\n`);
    return;
  }

  const url = process.env['DATABASE_URL_JOBS'] ?? process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_JOBS ausente');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    // Vigência aberta a direita: o próximo release fecha esta com um UPDATE
    // explícito. Fechar aqui, adivinhando quando a OMS publica de novo, deixaria
    // o catálogo sem termo válido no intervalo entre a data chutada e o release
    // seguinte — e a busca voltaria vazia sem nada explicar.
    const n = await loadCid11Release(pool, {
      competencia,
      vigenciaFrom: `${competencia.slice(0, 4)}-${competencia.slice(4, 6)}-01`,
      vigenciaTo: null,
      rows: linhas,
    });
    process.stdout.write(`\nCID-11 ${opts.release}: ${n} termos carregados.\n`);
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`falhou: ${(e as Error).message}\n`);
  process.exitCode = 1;
});
