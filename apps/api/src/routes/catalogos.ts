import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

/**
 * §3.9 e decisão irreversível 11 — terminologia versionada POR DATA DO EVENTO.
 *
 * `data` é obrigatória nas duas rotas, e essa é a decisão de design inteira.
 * Deixá-la opcional com default de `current_date` daria uma API mais confortável
 * e um bug que só aparece meses depois: o atendimento de março faturado em julho
 * levaria a descrição de julho, e o lote volta glosado sem que ninguém entenda
 * por que. As funções `ref.cid10_at` e `ref.tuss_at` do banco também não têm
 * versão sem data — esta rota só mantém a mesma regra na borda HTTP.
 */

const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;

const DataDoEvento = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');

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
            // A competência é a VERSÃO da terminologia. `clin.diagnosis` exige
            // terminology_version para responder "qual CID valia quando este
            // diagnóstico foi feito"; sem ela vindo daqui, quem monta o payload
            // inventaria a versão — e versão inventada é pior que ausente numa
            // perícia.
            competencia: z.string(),
          })),
        }),
      },
    },
  }, rota('catalog.read', async (tx, _ctx, req) => {
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
   * Rota SEPARADA da `/v1/catalogos/cid`, e não um parâmetro `sistema` nela,
   * porque as duas terminologias têm forma diferente: a CID-11 carrega a URI da
   * fundação (identidade estável entre releases) e o capítulo é TEXTO — a CID-11
   * tem os capítulos V e X, que são letras. Espremer as duas na mesma resposta
   * obrigaria a converter capítulo para texto no CID-10 também, quebrando quem
   * já consome aquela rota, para acomodar um catálogo que só vale a partir de
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
            // A URI acompanha o resultado para que quem grava o diagnóstico
            // possa guardar a identidade estável, e não só o código — que a OMS
            // pode recodificar no release seguinte.
            uri: z.string(),
            competencia: z.string(),
          })),
        }),
      },
    },
  }, rota('catalog.read', async (tx, _ctx, req) => {
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
      },
    },
  }, rota('catalog.read', async (tx, _ctx, req) => {
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
