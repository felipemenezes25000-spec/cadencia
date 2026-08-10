import { err, ok, type Result } from '@cadencia/kernel';
import type { Queryable, TransactionalDb } from './cid10';

/**
 * CID-11 (ICD-11 MMS). Irma da CID-10, nao substituta.
 *
 * As duas convivem: a CID-11 entra na vigilancia epidemiologica em 01/01/2027
 * (Nota Tecnica 91/2024 do Ministerio da Saude), enquanto o faturamento de
 * convenio continua em CID-10 pelo tempo que o padrao TISS pedir
 * `dm_diagnosticoCID10` — que e o que a versao 4.03.00 pede.
 */

export interface EntidadeIcd11 {
  /** URI da FUNDACAO. Estavel entre releases; o codigo nao e. */
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
 * Resolve o codigo PELA DATA DO EVENTO — mesma regra da CID-10.
 *
 * Nao existe versao sem data e nao existe default para hoje: resolver pelo
 * relogio de quem executa devolve a descricao de HOJE para um atendimento de
 * dois anos atras, e o prontuario passa a dizer algo que o medico nao escreveu.
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

/** O que a API da OMS devolve por entidade. So o que consumimos aparece aqui. */
interface RespostaOms {
  readonly '@id'?: unknown;
  readonly code?: unknown;
  readonly title?: unknown;
  readonly classKind?: unknown;
}

/**
 * A URI da FUNDACAO a partir da URI do release.
 *
 * A OMS devolve `.../icd/release/11/2025-01/mms/1435254666`, que muda a cada
 * publicacao. A identidade que sobrevive e `.../icd/entity/1435254666`. Guardar
 * a URI do release faria o sistema perder o rastro da entidade no release
 * seguinte — exatamente o que a coluna `uri` existe para impedir.
 */
function uriDaFundacao(idDoRelease: string): string {
  const ultimo = idDoRelease.split('/').filter((p) => p !== '').pop() ?? '';
  return `http://id.who.int/icd/entity/${ultimo}`;
}

/**
 * O texto que vai para o prontuario, sem a marcacao que a OMS embute.
 *
 * A API devolve o termo indexado envolto em tags. Gravar cru poria lixo no meio
 * de um documento assinado.
 */
function textoLimpo(bruto: string): string {
  return bruto.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Converte a resposta da OMS nas entidades que viram linhas do catalogo.
 *
 * Devolve lista, e nao um objeto, porque a entidade pode ser descartada: capitulo
 * e bloco AGRUPAM mas nao codificam. Deixar entrar poria "Capitulo 01" na lista
 * de escolha do medico, ao lado de diagnosticos de verdade.
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
  // Descricao vazia no prontuario e pior que codigo ausente: o documento fica
  // com um diagnostico que nao diz nada.
  if (descricao === '') return [];

  const id = typeof r['@id'] === 'string' ? r['@id'] : '';
  return [{ uri: uriDaFundacao(id), codigo, descricao, capitulo }];
}

/**
 * Carga de um release inteiro, em UMA transacao, numa unica conexao.
 *
 * Roda com o papel `jobs`. Se qualquer codigo sobrepuser vigencia existente, o
 * EXCLUDE derruba a carga inteira (SQLSTATE 23P01) — que e o comportamento
 * desejado: meia carga e pior que nenhuma, porque a busca passaria a devolver um
 * catalogo pela metade sem nada indicar isso na tela.
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
