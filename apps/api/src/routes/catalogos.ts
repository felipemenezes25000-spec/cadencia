import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';
import type { TxClient } from '@cadencia/db';

/**
 * §3.9 e decisao irreversivel 11 — terminologia versionada POR DATA DO EVENTO.
 *
 * `data` e obrigatoria nas duas rotas, e essa e a decisao de design inteira.
 * Deixa-la opcional com default de `current_date` daria uma API mais confortavel
 * e um bug que so aparece meses depois: o atendimento de marco faturado em julho
 * levaria a descricao de julho, e o lote volta glosado sem que ninguem entenda
 * por que. As funcoes `ref.cid10_at` e `ref.tuss_at` do banco tambem nao tem
 * versao sem data — esta rota so mantem a mesma regra na borda HTTP.
 */

const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;

const DataDoEvento = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');
const CatalogoIndisponivel = z.object({
  erro: z.literal('catalogo_nao_carregado'),
  catalogo: z.enum(['CID10', 'CID11', 'TUSS']),
});

const TABELAS = {
  CID10: 'ref.cid10_term',
  CID11: 'ref.cid11_term',
  TUSS: 'ref.tuss_term',
} as const;

/**
 * Tabela vazia não é uma busca sem resultado: é uma dependência operacional
 * ausente. Responder 503 permite que o frontend explique o bloqueio em vez de
 * afirmar, incorretamente, que nenhum diagnóstico existe.
 */
async function exigirCatalogo(
  tx: TxClient,
  catalogo: keyof typeof TABELAS,
  reply: { code(status: number): { send(body: unknown): unknown } },
): Promise<boolean> {
  const tabela = TABELAS[catalogo];
  const { rows } = await tx.query<{ carregado: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${tabela} LIMIT 1) AS carregado`);
  if (rows[0]?.carregado) return true;
  void reply.code(503).send({ erro: 'catalogo_nao_carregado', catalogo });
  return false;
}

export async function catalogoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/catalogos/cid', {
    schema: {
      querystring: z.object({
        termo: z.string().min(2),
        data: DataDoEvento,
        limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            codigo: z.string(),
            descricao: z.string(),
            capitulo: z.number().int().nullable(),
            // A competencia e a VERSAO da terminologia. `clin.diagnosis` exige
            // terminology_version para responder "qual CID valia quando este
            // diagnostico foi feito"; sem ela vindo daqui, quem monta o payload
            // inventaria a versao — e versao inventada e pior que ausente numa
            // pericia.
            competencia: z.string(),
          })),
        }),
        503: CatalogoIndisponivel,
      },
    },
  }, rota('catalog.read', async (tx, _ctx, req, reply) => {
    if (!await exigirCatalogo(tx, 'CID10', reply)) return;
    const q = req.query as { termo: string; data: string; limit?: number };
    const { rows } = await tx.query<{
      codigo: string; descricao: string; capitulo: number | null; competencia: string;
    }>(
      `SELECT codigo, descricao, capitulo, competencia
         FROM ref.cid10_term
        WHERE vigencia @> $2::date
          AND (codigo ILIKE $1 || '%' OR descricao ILIKE '%' || $1 || '%')
        -- Casamento pelo codigo vem primeiro: quem digita "J45" quer o J45, nao
        -- as dezenas de descricoes que por acaso contem "J45" no meio.
        ORDER BY (codigo ILIKE $1 || '%') DESC, codigo
        LIMIT $3`,
      [q.termo, q.data, q.limit ?? LIMITE_PADRAO]);
    return { itens: rows };
  }));

  /**
   * Busca na CID-11.
   *
   * Rota SEPARADA da `/v1/catalogos/cid`, e nao um parametro `sistema` nela,
   * porque as duas terminologias tem forma diferente: a CID-11 carrega a URI da
   * fundacao (identidade estavel entre releases) e o capitulo e TEXTO — a CID-11
   * tem os capitulos V e X, que sao letras. Espremer as duas na mesma resposta
   * obrigaria a converter capitulo para texto no CID-10 tambem, quebrando quem
   * ja consome aquela rota, para acomodar um catalogo que so vale a partir de
   * 2027.
   */
  r.get('/v1/catalogos/cid11', {
    schema: {
      querystring: z.object({
        termo: z.string().min(2),
        data: DataDoEvento,
        limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            codigo: z.string(),
            descricao: z.string(),
            capitulo: z.string().nullable(),
            // A URI acompanha o resultado para que quem grava o diagnostico
            // possa guardar a identidade estavel, e nao so o codigo — que a OMS
            // pode recodificar no release seguinte.
            uri: z.string(),
            competencia: z.string(),
          })),
        }),
        503: CatalogoIndisponivel,
      },
    },
  }, rota('catalog.read', async (tx, _ctx, req, reply) => {
    if (!await exigirCatalogo(tx, 'CID11', reply)) return;
    const q = req.query as { termo: string; data: string; limit?: number };
    const { rows } = await tx.query<{
      codigo: string; descricao: string; capitulo: string | null;
      uri: string; competencia: string;
    }>(
      `SELECT codigo, descricao, capitulo, uri, competencia
         FROM ref.cid11_term
        WHERE vigencia @> $2::date
          AND (codigo ILIKE $1 || '%' OR descricao ILIKE '%' || $1 || '%')
        ORDER BY (codigo ILIKE $1 || '%') DESC, codigo
        LIMIT $3`,
      [q.termo, q.data, q.limit ?? LIMITE_PADRAO]);
    return { itens: rows };
  }));

  r.get('/v1/catalogos/tuss', {
    schema: {
      querystring: z.object({
        tabela: z.coerce.number().int().min(1).max(999),
        termo: z.string().min(2),
        data: DataDoEvento,
        limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            tabela: z.number().int(),
            codigo: z.string(),
            termo: z.string(),
          })),
        }),
        503: CatalogoIndisponivel,
      },
    },
  }, rota('catalog.read', async (tx, _ctx, req, reply) => {
    if (!await exigirCatalogo(tx, 'TUSS', reply)) return;
    const q = req.query as { tabela: number; termo: string; data: string; limit?: number };
    const { rows } = await tx.query<{ tabela: number; codigo: string; termo: string }>(
      `SELECT tabela, codigo, termo
         FROM ref.tuss_term
        WHERE tabela = $1 AND vigencia @> $3::date
          AND (codigo ILIKE $2 || '%' OR termo ILIKE '%' || $2 || '%')
        ORDER BY (codigo ILIKE $2 || '%') DESC, codigo
        LIMIT $4`,
      [q.tabela, q.termo, q.data, q.limit ?? LIMITE_PADRAO]);
    return { itens: rows };
  }));
}
