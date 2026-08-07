import type { TxClient } from '@cadencia/db';
import type { Period, DrillDownResult, DrillDownGroup } from './variation-types';

const VALID_FACTORS = [
  'volume', 'mix_procedimento', 'mix_convenio', 'ticket', 'faltas', 'glosas',
] as const;

type Factor = (typeof VALID_FACTORS)[number];

function isFactor(s: string): s is Factor {
  return (VALID_FACTORS as readonly string[]).includes(s);
}

/**
 * Drill-down de um fator especifico da decomposicao de variacao.
 *
 * O click em "faltas custaram R$ 9.800" abre: "37 atendimentos perdidos,
 * agrupados por profissional, dia da semana e faixa de horario".
 *
 * Para cada fator, a query retorna os agendamentos/lancamentos relevantes
 * do periodo B agrupados por tres eixos: profissional, dia da semana e
 * faixa de horario (manha/tarde/noite).
 */
export async function drillDownFactor(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  factor: string,
  _periodA: Period,
  periodB: Period,
): Promise<DrillDownResult> {
  if (!isFactor(factor)) {
    throw new Error(`fator invalido: ${factor}. Validos: ${VALID_FACTORS.join(', ')}`);
  }

  // Para faltas: agrupamos os agendamentos com status faltou/cancelado no periodo B
  if (factor === 'faltas') {
    return drillDownFaltas(tx, tenantId, clinicId, periodB);
  }

  // Para volume, mix_procedimento, mix_convenio, ticket:
  // agrupamos os lancamentos pagos do periodo B
  return drillDownReceita(tx, tenantId, clinicId, periodB, factor);
}

async function drillDownFaltas(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  period: Period,
): Promise<DrillDownResult> {
  // Por profissional
  const byProfResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT coalesce(pr.user_id::text, a.professional_id::text) AS label,
            count(*)::text AS count,
            coalesce(sum(p.valor_centavos), 0)::text AS amount_cents
       FROM sched.appointment a
       LEFT JOIN sched.procedure p ON p.tenant_id = a.tenant_id AND p.id = a.procedure_id
       LEFT JOIN app.professional pr ON pr.tenant_id = a.tenant_id AND pr.id = a.professional_id
      WHERE a.tenant_id = $1
        AND a.clinic_id = $2
        AND a.status IN ('faltou', 'cancelado')
        AND a.appointment_date >= $3::date
        AND a.appointment_date <= $4::date
      GROUP BY coalesce(pr.user_id::text, a.professional_id::text)
      ORDER BY sum(p.valor_centavos) DESC NULLS LAST`,
    [tenantId, clinicId, period.start, period.end],
  );

  // Por dia da semana
  const byDowResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT to_char(a.appointment_date, 'Dy') AS label,
            count(*)::text AS count,
            coalesce(sum(p.valor_centavos), 0)::text AS amount_cents
       FROM sched.appointment a
       LEFT JOIN sched.procedure p ON p.tenant_id = a.tenant_id AND p.id = a.procedure_id
      WHERE a.tenant_id = $1
        AND a.clinic_id = $2
        AND a.status IN ('faltou', 'cancelado')
        AND a.appointment_date >= $3::date
        AND a.appointment_date <= $4::date
      GROUP BY to_char(a.appointment_date, 'Dy'), extract(isodow FROM a.appointment_date)
      ORDER BY extract(isodow FROM a.appointment_date)`,
    [tenantId, clinicId, period.start, period.end],
  );

  // Por faixa de horario
  const byTimeResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT CASE
              WHEN extract(hour FROM a.starts_at AT TIME ZONE 'America/Sao_Paulo') < 12
                THEN 'manha'
              WHEN extract(hour FROM a.starts_at AT TIME ZONE 'America/Sao_Paulo') < 18
                THEN 'tarde'
              ELSE 'noite'
            END AS label,
            count(*)::text AS count,
            coalesce(sum(p.valor_centavos), 0)::text AS amount_cents
       FROM sched.appointment a
       LEFT JOIN sched.procedure p ON p.tenant_id = a.tenant_id AND p.id = a.procedure_id
      WHERE a.tenant_id = $1
        AND a.clinic_id = $2
        AND a.status IN ('faltou', 'cancelado')
        AND a.appointment_date >= $3::date
        AND a.appointment_date <= $4::date
      GROUP BY CASE
              WHEN extract(hour FROM a.starts_at AT TIME ZONE 'America/Sao_Paulo') < 12
                THEN 'manha'
              WHEN extract(hour FROM a.starts_at AT TIME ZONE 'America/Sao_Paulo') < 18
                THEN 'tarde'
              ELSE 'noite'
            END
      ORDER BY min(extract(hour FROM a.starts_at AT TIME ZONE 'America/Sao_Paulo'))`,
    [tenantId, clinicId, period.start, period.end],
  );

  return {
    factor: 'faltas',
    byProfessional: mapRows(byProfResult.rows),
    byDayOfWeek: mapRows(byDowResult.rows),
    byTimeSlot: mapRows(byTimeResult.rows),
  };
}

async function drillDownReceita(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  period: Period,
  _factor: Factor,
): Promise<DrillDownResult> {
  // Por profissional
  const byProfResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT e.professional_id::text AS label,
            count(*)::text AS count,
            coalesce(sum(e.amount_cents), 0)::text AS amount_cents
       FROM fin.entry e
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
      GROUP BY e.professional_id
      ORDER BY sum(e.amount_cents) DESC`,
    [tenantId, clinicId, period.start, period.end],
  );

  // Por dia da semana (usa paid_at)
  const byDowResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT to_char(e.paid_at AT TIME ZONE 'America/Sao_Paulo', 'Dy') AS label,
            count(*)::text AS count,
            coalesce(sum(e.amount_cents), 0)::text AS amount_cents
       FROM fin.entry e
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
      GROUP BY to_char(e.paid_at AT TIME ZONE 'America/Sao_Paulo', 'Dy'),
               extract(isodow FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo')
      ORDER BY extract(isodow FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo')`,
    [tenantId, clinicId, period.start, period.end],
  );

  // Por faixa de horario
  const byTimeResult = await tx.query<{
    label: string; count: string; amount_cents: string;
  }>(
    `SELECT CASE
              WHEN extract(hour FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo') < 12
                THEN 'manha'
              WHEN extract(hour FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo') < 18
                THEN 'tarde'
              ELSE 'noite'
            END AS label,
            count(*)::text AS count,
            coalesce(sum(e.amount_cents), 0)::text AS amount_cents
       FROM fin.entry e
      WHERE e.tenant_id = $1
        AND e.clinic_id = $2
        AND e.kind = 'receita'
        AND e.status = 'pago'
        AND e.paid_at >= ($3::date)::timestamptz
        AND e.paid_at <  ($4::date + 1)::timestamptz
      GROUP BY CASE
              WHEN extract(hour FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo') < 12
                THEN 'manha'
              WHEN extract(hour FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo') < 18
                THEN 'tarde'
              ELSE 'noite'
            END
      ORDER BY min(extract(hour FROM e.paid_at AT TIME ZONE 'America/Sao_Paulo'))`,
    [tenantId, clinicId, period.start, period.end],
  );

  return {
    factor: _factor,
    byProfessional: mapRows(byProfResult.rows),
    byDayOfWeek: mapRows(byDowResult.rows),
    byTimeSlot: mapRows(byTimeResult.rows),
  };
}

function mapRows(
  rows: readonly { label: string; count: string; amount_cents: string }[],
): DrillDownGroup[] {
  return rows.map((r) => ({
    label: r.label,
    count: Number(r.count),
    amount_cents: Number(r.amount_cents),
  }));
}
