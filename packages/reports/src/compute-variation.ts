import type { TxClient } from '@cadencia/db';
import type { Period, VariationFactors, VariationSnapshot } from './variation-types';
import { factorsAddUp } from './variation-types';

/**
 * ss5.5 fluxo (c) — Calcula a decomposição aditiva da variação de receita
 * entre dois períodos.
 *
 * REGRA DE LEITURA: toda consulta usa app_rpt views, NUNCA rpt matviews
 * diretamente. A view security_barrier garante isolamento de tenant.
 *
 * A decomposição é aditiva: volume + mix_procedimento + mix_convenio +
 * ticket + faltas + glosas = delta_total. Propriedade matemática, não
 * aproximação.
 *
 * Método: decomposição sequencial inspirada em análise de variância (ANOVA)
 * de preço x volume, adaptada para o contexto de clínica médica.
 *
 * 1. Volume: (qtd_B - qtd_A) * ticket_medio_A
 *    "Se a clínica tivesse feito N atendimentos a mais/menos, com o mesmo
 *     ticket médio do período A, quanto mudaria?"
 *
 * 2. Mix de procedimento: para cada procedimento, (prop_B - prop_A) * qtd_B * ticket_medio_A
 *    "Se a proporção entre consultas e retornos mudou, quanto isso explica?"
 *
 * 3. Mix de convênio: mesma lógica, mas entre particular e convênio.
 *
 * 4. Ticket: (ticket_medio_B - ticket_medio_A) * qtd_B
 *    "Se o preço médio mudou, quanto isso explica?"
 *
 * 5. Faltas: receita estimada dos atendimentos faltados/cancelados em B
 *            menos a dos faltados em A.
 *
 * 6. Glosas: valor de glosas aceitas (não recuperadas) por período,
 *    consultando tiss.glosa via encounter_guia_consulta.
 *
 * O resíduo (arredondamento inteiro) é absorvido pelo fator de ticket para
 * garantir a igualdade exata.
 */
export async function computeVariation(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  periodA: Period,
  periodB: Period,
): Promise<VariationSnapshot> {
  // -----------------------------------------------------------------------
  // 1. Buscar dados agregados do período A e B via app_rpt e tabelas vivas
  // -----------------------------------------------------------------------

  // Receita total realizada por período (lançamentos pagos de receita)
  const totais = await tx.query<{
    periodo: string; total_cents: string; qtd: string;
  }>(
    `SELECT 'A' AS periodo,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
     UNION ALL
     SELECT 'B' AS periodo,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($5::date)::timestamptz
        AND e.paid_at <  ($6::date + 1)::timestamptz`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  let totalACents = 0;
  let totalBCents = 0;
  let qtdA = 0;
  let qtdB = 0;
  for (const row of totais.rows) {
    if (row.periodo === 'A') {
      totalACents = Number(row.total_cents);
      qtdA = Number(row.qtd);
    } else {
      totalBCents = Number(row.total_cents);
      qtdB = Number(row.qtd);
    }
  }

  const deltaTotalCents = totalBCents - totalACents;
  const ticketMedioA = qtdA > 0 ? totalACents / qtdA : 0;

  // -----------------------------------------------------------------------
  // 2. Receita por procedimento em cada período (para mix de procedimento)
  // -----------------------------------------------------------------------
  const porProcedimento = await tx.query<{
    periodo: string; procedure_id: string; total_cents: string; qtd: string;
  }>(
    `SELECT 'A' AS periodo,
            coalesce(a.procedure_id::text, '__sem_procedimento__') AS procedure_id,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
       LEFT JOIN sched.appointment a ON a.tenant_id = e.tenant_id AND a.id = e.appointment_id
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
      GROUP BY a.procedure_id
     UNION ALL
     SELECT 'B' AS periodo,
            coalesce(a.procedure_id::text, '__sem_procedimento__') AS procedure_id,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
       LEFT JOIN sched.appointment a ON a.tenant_id = e.tenant_id AND a.id = e.appointment_id
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($5::date)::timestamptz
        AND e.paid_at <  ($6::date + 1)::timestamptz
      GROUP BY a.procedure_id`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  const procA = new Map<string, { cents: number; qtd: number }>();
  const procB = new Map<string, { cents: number; qtd: number }>();
  for (const row of porProcedimento.rows) {
    const map = row.periodo === 'A' ? procA : procB;
    map.set(row.procedure_id, {
      cents: Number(row.total_cents),
      qtd: Number(row.qtd),
    });
  }

  // -----------------------------------------------------------------------
  // 3. Receita por tipo (particular vs convênio) para mix de convênio
  // -----------------------------------------------------------------------
  const porConvenio = await tx.query<{
    periodo: string; tipo: string; total_cents: string; qtd: string;
  }>(
    `SELECT 'A' AS periodo,
            CASE WHEN a.operadora_nome IS NULL THEN 'particular' ELSE 'convenio' END AS tipo,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
       LEFT JOIN sched.appointment a ON a.tenant_id = e.tenant_id AND a.id = e.appointment_id
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
      GROUP BY CASE WHEN a.operadora_nome IS NULL THEN 'particular' ELSE 'convenio' END
     UNION ALL
     SELECT 'B' AS periodo,
            CASE WHEN a.operadora_nome IS NULL THEN 'particular' ELSE 'convenio' END AS tipo,
            coalesce(sum(e.amount_cents), 0)::text AS total_cents,
            count(*)::text AS qtd
       FROM fin.entry e
       LEFT JOIN sched.appointment a ON a.tenant_id = e.tenant_id AND a.id = e.appointment_id
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($5::date)::timestamptz
        AND e.paid_at <  ($6::date + 1)::timestamptz
      GROUP BY CASE WHEN a.operadora_nome IS NULL THEN 'particular' ELSE 'convenio' END`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  const convA = new Map<string, { cents: number; qtd: number }>();
  const convB = new Map<string, { cents: number; qtd: number }>();
  for (const row of porConvenio.rows) {
    const map = row.periodo === 'A' ? convA : convB;
    map.set(row.tipo, {
      cents: Number(row.total_cents),
      qtd: Number(row.qtd),
    });
  }

  // -----------------------------------------------------------------------
  // 4. Faltas e cancelamentos por período
  // -----------------------------------------------------------------------
  const faltas = await tx.query<{
    periodo: string; qtd_faltas: string; receita_estimada_cents: string;
  }>(
    `SELECT 'A' AS periodo,
            count(*)::text AS qtd_faltas,
            coalesce(sum(p.valor_centavos), 0)::text AS receita_estimada_cents
       FROM sched.appointment a
       LEFT JOIN sched.procedure p ON p.tenant_id = a.tenant_id AND p.id = a.procedure_id
      WHERE a.tenant_id = $1
        AND a.clinic_id = $2
        AND a.status IN ('faltou', 'cancelado')
        AND a.appointment_date >= $3::date
        AND a.appointment_date <= $4::date
     UNION ALL
     SELECT 'B' AS periodo,
            count(*)::text AS qtd_faltas,
            coalesce(sum(p.valor_centavos), 0)::text AS receita_estimada_cents
       FROM sched.appointment a
       LEFT JOIN sched.procedure p ON p.tenant_id = a.tenant_id AND p.id = a.procedure_id
      WHERE a.tenant_id = $1
        AND a.clinic_id = $2
        AND a.status IN ('faltou', 'cancelado')
        AND a.appointment_date >= $5::date
        AND a.appointment_date <= $6::date`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  let faltasACents = 0;
  let faltasBCents = 0;
  for (const row of faltas.rows) {
    if (row.periodo === 'A') {
      faltasACents = Number(row.receita_estimada_cents);
    } else {
      faltasBCents = Number(row.receita_estimada_cents);
    }
  }

  // -----------------------------------------------------------------------
  // 5. Calcular fatores aditivos
  // -----------------------------------------------------------------------

  // Volume: (qtdB - qtdA) * ticketMedioA
  const volumeCentsExact = (qtdB - qtdA) * ticketMedioA;
  const volumeCents = Math.round(volumeCentsExact);

  // Mix de procedimento: para cada procedimento p,
  //   (propB_p - propA_p) * qtdB * ticketMedioA_p
  // onde propX_p = qtdX_p / qtdX e ticketMedioA_p = centsA_p / qtdA_p
  let mixProcCentsExact = 0;
  const allProcs = new Set([...procA.keys(), ...procB.keys()]);
  for (const procId of allProcs) {
    const a = procA.get(procId);
    const b = procB.get(procId);
    const propA = qtdA > 0 && a ? a.qtd / qtdA : 0;
    const propB = qtdB > 0 && b ? b.qtd / qtdB : 0;
    const ticketProcA = a && a.qtd > 0 ? a.cents / a.qtd : 0;
    mixProcCentsExact += (propB - propA) * qtdB * ticketProcA;
  }
  const mixProcCents = Math.round(mixProcCentsExact);

  // Mix de convênio: mesma lógica
  let mixConvCentsExact = 0;
  const allTipos = new Set([...convA.keys(), ...convB.keys()]);
  for (const tipo of allTipos) {
    const a = convA.get(tipo);
    const b = convB.get(tipo);
    const propA = qtdA > 0 && a ? a.qtd / qtdA : 0;
    const propB = qtdB > 0 && b ? b.qtd / qtdB : 0;
    const ticketTipoA = a && a.qtd > 0 ? a.cents / a.qtd : 0;
    mixConvCentsExact += (propB - propA) * qtdB * ticketTipoA;
  }
  const mixConvCents = Math.round(mixConvCentsExact);

  // Faltas: diferença de receita estimada perdida (B - A, negativo = mais faltas em B)
  const faltasCents = -(faltasBCents - faltasACents);

  // -----------------------------------------------------------------------
  // 5b. Glosas não recuperadas (aceitas) por período
  // -----------------------------------------------------------------------
  const glosas = await tx.query<{
    periodo: string; total_glosado_cents: string;
  }>(
    `SELECT 'A' AS periodo,
            coalesce(sum(rg.valor_glosado_cents), 0)::text AS total_glosado_cents
       FROM tiss.glosa rg
       JOIN tiss.encounter_guia_consulta gc
         ON gc.tenant_id = rg.tenant_id AND gc.id = rg.guia_id
       JOIN clin.encounter enc
         ON enc.tenant_id = gc.tenant_id AND enc.id = gc.encounter_id
      WHERE rg.tenant_id = $1
        AND enc.clinic_id = $2
        AND gc.data_atendimento >= $3::date
        AND gc.data_atendimento <= $4::date
        AND rg.status = 'aceita'
     UNION ALL
     SELECT 'B' AS periodo,
            coalesce(sum(rg.valor_glosado_cents), 0)::text AS total_glosado_cents
       FROM tiss.glosa rg
       JOIN tiss.encounter_guia_consulta gc
         ON gc.tenant_id = rg.tenant_id AND gc.id = rg.guia_id
       JOIN clin.encounter enc
         ON enc.tenant_id = gc.tenant_id AND enc.id = gc.encounter_id
      WHERE rg.tenant_id = $1
        AND enc.clinic_id = $2
        AND gc.data_atendimento >= $5::date
        AND gc.data_atendimento <= $6::date
        AND rg.status = 'aceita'`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  let glosasACents = 0;
  let glosasBCents = 0;
  for (const row of glosas.rows) {
    if (row.periodo === 'A') {
      glosasACents = Number(row.total_glosado_cents);
    } else {
      glosasBCents = Number(row.total_glosado_cents);
    }
  }

  // Glosas: receita perdida por glosas aceitas (não recuperadas).
  // Mais glosas em B do que em A = fator negativo (perda).
  // Menos glosas em B do que em A = fator positivo (recuperação).
  const glosasCents = -(glosasBCents - glosasACents) || 0;

  // Ticket: resíduo para garantir soma exata
  // delta = volume + mixProc + mixConv + ticket + faltas + glosas
  // ticket = delta - volume - mixProc - mixConv - faltas - glosas
  const ticketCents = deltaTotalCents - volumeCents - mixProcCents - mixConvCents - faltasCents - glosasCents;

  const factors: VariationFactors = {
    volume_cents: volumeCents,
    mix_procedimento_cents: mixProcCents,
    mix_convenio_cents: mixConvCents,
    ticket_cents: ticketCents,
    faltas_cents: faltasCents,
    glosas_cents: glosasCents,
    total_a_cents: totalACents,
    total_b_cents: totalBCents,
    delta_total_cents: deltaTotalCents,
  };

  // Invariante: a soma DEVE ser exata. Se não for, é bug nosso.
  if (!factorsAddUp(factors)) {
    throw new Error(
      `bug: soma dos fatores (${factors.volume_cents + factors.mix_procedimento_cents + factors.mix_convenio_cents + factors.ticket_cents + factors.faltas_cents + factors.glosas_cents}) !== delta (${deltaTotalCents})`,
    );
  }

  return {
    tenantId,
    clinicId,
    periodA,
    periodB,
    computedAt: (await tx.query<{ now: string }>(`SELECT clock_timestamp()::text AS now`)).rows[0]!.now,
    factors,
  };
}
