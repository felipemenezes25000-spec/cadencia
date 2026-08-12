import { err, ok, type Result } from '@cadencia/kernel';
import type { Queryable, TransactionalDb } from './cid10';

/**
 * CID-11 (ICD-11 MMS). Irmã da CID-10, não substituta.
 *
 * As duas convivem: a CID-11 entra na vigilância epidemiológica em 01/01/2027
 * (Nota Técnica 91/2024 do Ministério da Saúde), enquanto o faturamento de
 * convênio continua em CID-10 pelo tempo que o padrão TISS pedir
 * `dm_diagnosticoCID10` — que é o que a versão 4.03.00 pede.
 */

export interface EntidadeIcd11 {
  /** URI da FUNDAÇÃO. Estável entre releases; o código não é. */
  readonly uri: string;
  readonly codigo: string;
  readonly descricao: string;
  readonly capitulo: string | null;
}

export interface ResolvedCid11 {
  readonly system: 'CID11';
  readonly code: string;
  readonly display: string;
  readonly uri: string;
  readonly terminologyVersion: string;
}

export type Cid11Failure = 'codigo_inexistente_na_data';

/**
 * Resolve o código PELA DATA DO EVENTO — mesma regra da CID-10.
 *
 * Não existe versão sem data e não existe default para hoje: resolver pelo
 * relógio de quem executa devolve a descrição de HOJE para um atendimento de
 * dois anos atrás, e o prontuário passa a dizer algo que o médico não escreveu.
 */
export async function resolveCid11At(
  db: Queryable, codigo: string, eventDate: string,
): Promise<Result<ResolvedCid11, Cid11Failure>> {
  const { rows } = await db.query(
    `SELECT uri, codigo, descricao, competencia
       FROM ref.cid11_term
      WHERE codigo = $1 AND vigencia @> $2::date`,
    [codigo, eventDate],
  );
  const row = rows[0];
  if (!row) return err('codigo_inexistente_na_data');
  return ok({
    system: 'CID11',
    code: row.codigo as string,
    display: row.descricao as string,
    uri: row.uri as string,
    terminologyVersion: row.competencia as string,
  });
}

/** O que a API da OMS devolve por entidade. Só o que consumimos aparece aqui. */
interface RespostaOms {
  readonly '@id'?: unknown;
  readonly code?: unknown;
  readonly title?: unknown;
  readonly classKind?: unknown;
}

/**
 * A URI da FUNDAÇÃO a partir da URI do release.
 *
 * A OMS devolve `.../icd/release/11/2025-01/mms/1435254666`, que muda a cada
 * publicação. A identidade que sobrevive é `.../icd/entity/1435254666`. Guardar
 * a URI do release faria o sistema perder o rastro da entidade no release
 * seguinte — exatamente o que a coluna `uri` existe para impedir.
 */
function uriDaFundacao(idDoRelease: string): string {
  const ultimo = idDoRelease.split('/').filter((p) => p !== '').pop() ?? '';
  return `http://id.who.int/icd/entity/${ultimo}`;
}

/**
 * O texto que vai para o prontuário, sem a marcação que a OMS embute.
 *
 * A API devolve o termo indexado envolto em tags. Gravar cru poria lixo no meio
 * de um documento assinado.
 */
function textoLimpo(bruto: string): string {
  return bruto.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Converte a resposta da OMS nas entidades que viram linhas do catálogo.
 *
 * Devolve lista, e não um objeto, porque a entidade pode ser descartada: capítulo
 * e bloco AGRUPAM mas não codificam. Deixar entrar poria "Capítulo 01" na lista
 * de escolha do médico, ao lado de diagnósticos de verdade.
 */
export function entidadesDaLinearizacao(
  resposta: unknown, capitulo: string | null,
): EntidadeIcd11[] {
  const r = resposta as RespostaOms;
  const codigo = typeof r.code === 'string' ? r.code.trim() : '';
  if (codigo === '') return [];

  const titulo = r.title as { '@value'?: unknown } | undefined;
  const bruto = typeof titulo?.['@value'] === 'string' ? titulo['@value'] : '';
  const descricao = textoLimpo(bruto);
  // Descrição vazia no prontuário é pior que código ausente: o documento fica
  // com um diagnóstico que não diz nada.
  if (descricao === '') return [];

  const id = typeof r['@id'] === 'string' ? r['@id'] : '';
  return [{ uri: uriDaFundacao(id), codigo, descricao, capitulo }];
}

/**
 * Carga de um release inteiro, em UMA transação, numa única conexão.
 *
 * Roda com o papel `jobs`. Se qualquer código sobrepuser vigência existente, o
 * EXCLUDE derruba a carga inteira (SQLSTATE 23P01) — que é o comportamento
 * desejado: meia carga é pior que nenhuma, porque a busca passaria a devolver um
 * catálogo pela metade sem nada indicar isso na tela.
 */
export async function loadCid11Release(
  db: TransactionalDb,
  input: {
    readonly competencia: string;
    readonly vigenciaFrom: string;
    readonly vigenciaTo: string | null;
    readonly rows: readonly EntidadeIcd11[];
  },
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const r of input.rows) {
      await client.query(
        `INSERT INTO ref.cid11_term (uri, codigo, descricao, capitulo, vigencia, competencia)
         VALUES ($1, $2, $3, $4, daterange($5::date, $6::date, '[)'), $7)`,
        [r.uri, r.codigo, r.descricao, r.capitulo,
         input.vigenciaFrom, input.vigenciaTo, input.competencia],
      );
    }
    await client.query('COMMIT');
    return input.rows.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
