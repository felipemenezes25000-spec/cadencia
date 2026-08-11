import { err, ok, type Result } from '@cadencia/kernel';

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

/**
 * Um pool capaz de RESERVAR uma conexao. BEGIN/INSERT/COMMIT por `Pool.query`
 * nao caem necessariamente na mesma conexao: a carga deixaria de ser atomica e
 * o ROLLBACK rodaria numa conexao sem transacao aberta.
 */
export interface TransactionalDb {
  connect(): Promise<{
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
    release(): void;
  }>;
}

export interface ResolvedTerm {
  system: 'CID10';
  code: string;
  display: string;
  terminologyVersion: string;   // competencia da publicacao consultada
}

export type Cid10Failure = 'codigo_inexistente_na_data';

/**
 * Resolve o codigo PELA DATA DO EVENTO. `eventDate` e obrigatorio e vem no
 * formato AAAA-MM-DD: e a `occurred_date` do atendimento, ja no fuso da clinica.
 * NAO existe default para hoje -- resolver pelo relogio de quem executa e o erro
 * que so aparece meses depois, num lote rejeitado pela operadora (§10 item 11).
 */
export async function resolveCid10At(
  db: Queryable, codigo: string, eventDate: string,
): Promise<Result<ResolvedTerm, Cid10Failure>> {
  const { rows } = await db.query(
    `SELECT codigo, descricao, competencia
       FROM ref.cid10_term
      WHERE codigo = $1 AND vigencia @> $2::date`,
    [codigo, eventDate],
  );
  const row = rows[0];
  if (!row) return err('codigo_inexistente_na_data');
  return ok({
    system: 'CID10',
    code: row.codigo as string,
    display: row.descricao as string,
    terminologyVersion: row.competencia as string,
  });
}

export function parseCid10Csv(
  csv: string,
): Array<{ codigo: string; descricao: string; capitulo: number | null }> {
  const linhas = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhas.length === 0) return [];

  const limpar = (valor: string | undefined): string =>
    (valor ?? '').replace(/^\uFEFF/, '').replace(/^"|"$/g, '').trim();
  const cabecalho = linhas[0]!.split(';').map((campo) => limpar(campo).toUpperCase());
  const indiceCodigo = cabecalho.findIndex((campo) => campo === 'CODIGO' || campo === 'SUBCAT');
  const indiceDescricao = cabecalho.findIndex((campo) => campo === 'DESCRICAO');
  const indiceCapitulo = cabecalho.findIndex((campo) => campo === 'CAPITULO');
  if (indiceCodigo < 0 || indiceDescricao < 0) {
    throw new Error('CSV da CID-10 sem as colunas CODIGO/SUBCAT e DESCRICAO');
  }

  return linhas.slice(1).flatMap((linha) => {
    const campos = linha.split(';');
    const codigoBruto = limpar(campos[indiceCodigo]).toUpperCase();
    const semPontuacao = codigoBruto.replace(/[^A-Z0-9]/g, '');
    const codigo = semPontuacao.length === 4
      ? `${semPontuacao.slice(0, 3)}.${semPontuacao.slice(3)}`
      : semPontuacao;
    const descricao = limpar(campos[indiceDescricao]);
    if (codigo === '' || descricao === '') return [];

    const capituloBruto = indiceCapitulo >= 0 ? limpar(campos[indiceCapitulo]) : '';
    const capitulo = /^\d+$/.test(capituloBruto) ? Number(capituloBruto) : null;
    return [{ codigo, descricao, capitulo }];
  });
}

/**
 * Carga de uma competencia inteira, em UMA transacao, numa unica conexao.
 * Roda com o papel `jobs`. Se qualquer codigo sobrepuser vigencia existente, o
 * EXCLUDE derruba a carga inteira (SQLSTATE 23P01) -- que e o comportamento
 * desejado: meia carga e pior que nenhuma.
 */
export async function loadCid10Competencia(
  db: TransactionalDb,
  input: {
    competencia: string;
    vigenciaFrom: string;
    vigenciaTo: string | null;
    rows: ReadonlyArray<{ codigo: string; descricao: string; capitulo: number | null }>;
  },
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const r of input.rows) {
      await client.query(
        `INSERT INTO ref.cid10_term (codigo, descricao, capitulo, vigencia, competencia)
         VALUES ($1, $2, $3, daterange($4::date, $5::date, '[)'), $6)`,
        [r.codigo, r.descricao, r.capitulo, input.vigenciaFrom, input.vigenciaTo, input.competencia],
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
