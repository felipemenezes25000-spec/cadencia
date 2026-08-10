// apps/worker/src/jobs/expurgo-retencao.ts
import { jobsPool } from '@cadencia/db';
import type { StorageAdapter } from '@cadencia/storage';

/**
 * EXPURGO POR RETENCAO (§3.10).
 *
 * `clin.purge_expired` destroi o conteudo dentro do banco e carimba `purged_at`.
 * O que SQL nao alcanca e o armazenamento de objetos: o PDF do exame continua no
 * disco depois que a linha ja diz que sumiu. Este job fecha essa metade.
 *
 * A regra de quem pode ser expurgado NAO mora aqui. A janela de retencao e
 * calculada no banco, a partir de `app.tenant.retencao_anos` com piso legal de
 * 20 anos, e nenhum parametro deste job consegue encurta-la. Se a decisao
 * morasse no worker, um deploy errado apagaria acervo dentro da guarda — e
 * expurgo nao tem desfazer.
 */

export interface ExpurgoInput {
  /** Tenants a processar. Vazio ou ausente = todos. */
  readonly tenantIds?: readonly string[];
  /** Teto por tenant por execucao. O banco recusa acima de 5000. */
  readonly limite?: number;
}

export interface ExpurgoResult {
  readonly tenantsProcessados: number;
  readonly valoresExpurgados: number;
  readonly anexosExpurgados: number;
  readonly objetosApagados: number;
  /** Objetos que o banco marcou como expurgados e o disco nao apagou. */
  readonly falhas: number;
}

interface LinhaDoExpurgo {
  valores_expurgados: string;
  anexos_expurgados: string;
  chaves_de_objeto: string[] | null;
}

export async function expurgarRetencao(
  i: ExpurgoInput,
  storage: StorageAdapter,
): Promise<ExpurgoResult> {
  const pool = jobsPool();
  const limite = i.limite ?? 500;

  const alvos = i.tenantIds !== undefined && i.tenantIds.length > 0
    ? [...i.tenantIds]
    : (await pool.query<{ id: string }>(
        `SELECT id FROM app.tenant ORDER BY id`)).rows.map((r) => r.id);

  let valores = 0;
  let anexos = 0;
  let apagados = 0;
  let falhas = 0;

  for (const tenantId of alvos) {
    // Uma transacao POR TENANT. Uma transacao unica para todos manteria a
    // primeira linha travada ate a ultima terminar, e um erro no meio desfaria
    // expurgos ja concluidos de clinicas que nao tem nada a ver com a falha.
    const { rows } = await pool.query<LinhaDoExpurgo>(
      `SELECT valores_expurgados, anexos_expurgados, chaves_de_objeto
         FROM clin.purge_expired($1, $2)`,
      [tenantId, limite]);

    const r = rows[0];
    if (r === undefined) continue;
    valores += Number(r.valores_expurgados);
    anexos += Number(r.anexos_expurgados);

    // Os objetos sao apagados DEPOIS do commit, e nao antes.
    //
    // Na ordem inversa, uma transacao que rolasse de volta deixaria a linha
    // dizendo "nao expurgado" com o arquivo ja destruido — anexo clinico perdido
    // sem registro de que foi. Nesta ordem, uma falha de disco deixa um objeto
    // orfao: lixo, recuperavel por uma varredura, e invisivel ao usuario porque
    // a rota de download ja recusa anexo com `purged_at`.
    for (const chave of r.chaves_de_objeto ?? []) {
      try {
        await storage.delete(`anexos/${chave}`);
        apagados += 1;
      } catch {
        // Nao relanca: o carimbo ja esta comitado. Estourar aqui faria o job
        // reprocessar para sempre um tenant que ja foi expurgado.
        falhas += 1;
      }
    }
  }

  return {
    tenantsProcessados: alvos.length,
    valoresExpurgados: valores,
    anexosExpurgados: anexos,
    objetosApagados: apagados,
    falhas,
  };
}
