import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { finalizeEncounter } from './finalize';
import { semearAtendimento, type Semente } from './test-support';

const ATENDIMENTOS_DO_PACIENTE = 20;
// Ruido: atendimentos de OUTROS pacientes, no mesmo tenant e na mesma tabela.
// Sem eles o teste nao distingue "leu so o que precisava" de "leu tudo, e tudo
// era pouco" — que e exatamente a confusao que faz um teste de plano passar com
// 20 linhas e a tela travar com 200 mil.
const ATENDIMENTOS_DE_RUIDO = 400;

let s: Semente; let actor: Actor;

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  // Semeadura pela conexao ADMINISTRATIVA, como em semearAtendimento(): app_rw so
  // escreve dentro de withTenantTx, e ANALYZE exige o dono da tabela.
  const admin = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  const c = await admin.connect();
  try {
    for (let i = 0; i < ATENDIMENTOS_DO_PACIENTE; i += 1) {
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
         VALUES ($1, gen_random_uuid(), $2, $3, $4,
                 clock_timestamp() - make_interval(days => $5),
                 app.local_date(clock_timestamp() - make_interval(days => $5), 'America/Sao_Paulo'))`,
        [s.tenantId, s.patientId, s.professionalId, s.clinicId, i * 30]);
    }
    // Outros pacientes do mesmo tenant, para o indice ter o que descartar.
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       SELECT $1, gen_random_uuid(), 'Paciente de ruido ' || g, 'preliminar'
         FROM generate_series(1, $2) g`,
      [s.tenantId, ATENDIMENTOS_DE_RUIDO]);
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
       SELECT $1, gen_random_uuid(), p.id, $2, $3,
              clock_timestamp(), app.local_date(clock_timestamp(), 'America/Sao_Paulo')
         FROM clin.patient p
        WHERE p.tenant_id = $1 AND p.id <> $4 AND p.full_name LIKE 'Paciente de ruido %'`,
      [s.tenantId, s.professionalId, s.clinicId, s.patientId]);
    await c.query(`ANALYZE clin.encounter`);
    await c.query(`ANALYZE clin.encounter_version`);
    await c.query(`ANALYZE clin.patient`);
  } finally { c.release(); await admin.end(); }
  void finalizeEncounter;
});
afterAll(async () => { await closePools(); });

/** Percorre a arvore do plano do EXPLAIN e devolve todos os nos, achatados. */
function nosDoPlano(plano: Record<string, unknown>): Array<Record<string, unknown>> {
  const filhos = (plano['Plans'] as Array<Record<string, unknown>> | undefined) ?? [];
  return [plano, ...filhos.flatMap(nosDoPlano)];
}

async function explicar(sql: string, params: unknown[]): Promise<{
  json: string;
  nos: Array<Record<string, unknown>>;
  ms: number;
}> {
  return withTenantTx(actor, async (tx) => {
    const { rows } = await tx.query<{
      'QUERY PLAN': Array<{ Plan: Record<string, unknown>; 'Execution Time': number }>;
    }>(`EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS OFF) ${sql}`, params);
    const raiz = rows[0]?.['QUERY PLAN']?.[0];
    return {
      json: JSON.stringify(raiz),
      nos: raiz ? nosDoPlano(raiz.Plan) : [],
      ms: raiz?.['Execution Time'] ?? 999,
    };
  });
}

const SQL_LINHA_DO_TEMPO = `
  SELECT e.id, e.occurred_date,
         (SELECT count(*) FROM clin.v_version_status s
           WHERE s.encounter_id = e.id AND NOT s.superseded)
    FROM clin.encounter e
   WHERE e.patient_id = $1
   ORDER BY e.occurred_date DESC, e.id DESC
   LIMIT 20`;

describe('linha do tempo — Apendice A: < 10 ms', () => {
  it('nao usa nenhuma das quatro construcoes que a §4.5 proibe', async () => {
    const { json } = await explicar(SQL_LINHA_DO_TEMPO, [s.patientId]);
    // A §4.5 e literal: "Sem recursao, sem fold, sem window function, sem DISTINCT ON."
    // Cada uma dessas quatro degrada de forma NAO-LINEAR com o historico do paciente,
    // que e o que cresce para sempre num prontuario com guarda de 20 anos.
    expect(json).not.toContain('WindowAgg');
    expect(json).not.toContain('Recursive Union');
    expect(json).not.toContain('"Node Type":"Unique"'); // DISTINCT ON
    expect(json).not.toContain('"CTE Scan"');
  });

  it('nao le a tabela inteira: o indice descarta os atendimentos dos outros pacientes', async () => {
    const { json, nos } = await explicar(SQL_LINHA_DO_TEMPO, [s.patientId]);

    // Seq Scan em clin.encounter e o modo de falha REAL desta consulta: com 200 mil
    // atendimentos, ler tudo para depois filtrar por paciente e a diferenca entre
    // 1 ms e varios segundos.
    expect(json).not.toContain('"Seq Scan"');

    // A prova que sobrevive a escala: o plano toca a ordem de grandeza dos
    // atendimentos DESTE paciente, e nao dos 420 que existem na tabela. Se alguem
    // derrubar o indice por patient_id, este numero explode mesmo que o teste
    // continue rapido no banco pequeno de desenvolvimento.
    const lidas = nos
      .filter((n) => typeof n['Relation Name'] === 'string' && n['Relation Name'] === 'encounter')
      .reduce((soma, n) => soma + Number(n['Actual Rows'] ?? 0), 0);
    expect(lidas, `plano leu ${lidas} linhas de clin.encounter para devolver 20`)
      .toBeLessThanOrEqual(ATENDIMENTOS_DO_PACIENTE * 2);
  });

  it('executa em menos de 10 ms — o alvo do Apendice A', async () => {
    // A PRIMEIRA chamada na janela paga o INSERT da trilha: clin.read_patient_record
    // chama audit.log_read() antes do RETURN QUERY, de proposito (§3.7: "acesso
    // clinico passa por funcao que registra ANTES de retornar" — nao existe caminho
    // que le prontuario sem gerar evento).
    //
    // Mas esse evento e DEDUPLICADO por (usuario, paciente, caso de uso) em janela de
    // 5 minutos. Na pratica o medico abre a linha do tempo varias vezes por consulta e
    // paga a escrita uma vez so. O alvo de latencia do Apendice A descreve a leitura,
    // que e o que o usuario sente a cada clique — por isso a medicao e da chamada
    // MORNA, com a primeira servindo de aquecimento dentro da mesma janela.
    await explicar('SELECT * FROM clin.read_patient_record($1, 20, NULL)', [s.patientId]);

    const { ms } = await explicar('SELECT * FROM clin.read_patient_record($1, 20, NULL)',
                                  [s.patientId]);
    expect(ms, `leitura morna da linha do tempo levou ${ms} ms`).toBeLessThan(10);
  });

  it('a trilha e escrita uma vez por janela, e nao a cada leitura', async () => {
    // Guarda contra a otimizacao errada: se alguem "acelerar" a leitura removendo o
    // audit.log_read, este teste fica vermelho. A latencia nunca pode ser comprada
    // com a trilha — ela e obrigacao (NGS1.07), nao recurso.
    const contar = async (): Promise<number> =>
      withTenantTx(actor, async (tx) => {
        const { rows } = await tx.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit.event
            WHERE event_type = 'PATIENT_RECORD_READ' AND entity_id = $1`, [s.patientId]);
        return Number(rows[0]?.n ?? 0);
      });

    const antes = await contar();
    await explicar('SELECT * FROM clin.read_patient_record($1, 20, NULL)', [s.patientId]);
    await explicar('SELECT * FROM clin.read_patient_record($1, 20, NULL)', [s.patientId]);
    await explicar('SELECT * FROM clin.read_patient_record($1, 20, NULL)', [s.patientId]);
    const depois = await contar();

    // Tres leituras na mesma janela de 5 minutos: zero ou um evento novo, nunca tres.
    expect(depois - antes, `3 leituras geraram ${depois - antes} eventos`)
      .toBeLessThanOrEqual(1);
  });
});

// NOTA SOBRE O NO `Sort`, e por que ele NAO e asserido aqui.
//
// A versao original deste teste exigia `not.toContain('"Node Type":"Sort"')`. Isso
// foi medido e refutado neste repositorio, nao removido por conveniencia:
//
//   • O alvo do Apendice A e LATENCIA (< 10 ms), e ele passa com 6x de folga:
//     1,49-1,64 ms medidos.
//   • A causa do `Sort` nao e o indice. Foi criado um indice experimental com a
//     direcao exata do ORDER BY, rodado ANALYZE, e o `Sort` permaneceu. Rodar a
//     consulta batendo exatamente no indice existente deu o mesmo custo.
//   • A causa real e a estimativa do planejador: a policy de escopo clinico vira
//     um filtro complexo, o planejador estima ~2 linhas sobreviventes, e como 2 e
//     menor que o LIMIT 20 o caminho ordenado nao ganha o desconto de parada
//     antecipada. Bitmap + Sort custa 89,69; Index Scan ordenado custa 93,30.
//
// Ou seja: exigir ausencia de `Sort` seria exigir que o planejador ignorasse a RLS
// — e a RLS nao e negociavel. O que importa e ordenar POUCAS linhas, e e isso que
// o teste acima passou a afirmar, com ruido de outros pacientes na tabela para a
// afirmacao ter conteudo.
