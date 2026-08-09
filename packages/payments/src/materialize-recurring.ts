import { uuidv7 } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export interface MaterializeResult {
  readonly generated: number;
  readonly skipped: number;
}

interface TemplateRow {
  id: string;
  description: string;
  kind: string;
  category_id: string | null;
  amount_cents: string;
  clinic_id: string;
  bank_account_id: string | null;
  cost_center_id: string | null;
  supplier_id: string | null;
  frequency: string;
  day_of_month: number | null;
  next_due_date: string;
  ends_at: string | null;
  created_by: string | null;
}

/**
 * Materializa entries a partir de templates recorrentes ativos cujo
 * next_due_date <= hoje + 30 dias. Roda como `jobs` (BYPASSRLS), sem
 * withTenantTx. Idempotencia garantida por idempotency_key unico
 * (template_id + due_date). Avanca next_due_date conforme a frequencia.
 *
 * REGRA: ends_at < next_due_date => template nao gera mais. Template
 * inativo (active=false) e ignorado.
 */
export async function materializeRecurringEntries(
  tx: TxClient,
  tenantId: string,
): Promise<MaterializeResult> {
  // Obtem "agora" do Postgres, nao do relogio local
  const dbNow = (await tx.query<{ now: string }>(`SELECT current_date::text AS now`)).rows[0]!.now;

  // Busca templates ativos com next_due_date no horizonte de 30 dias
  const { rows: templates } = await tx.query<TemplateRow>(
    `SELECT id::text, description, kind::text, category_id::text,
            amount_cents::text, clinic_id::text,
            bank_account_id::text, cost_center_id::text,
            supplier_id::text, frequency::text,
            day_of_month, next_due_date::text,
            ends_at::text, created_by::text
       FROM fin.recurring_template
      WHERE tenant_id = $1
        AND active = true
        AND next_due_date <= (current_date + interval '30 days')
        AND (ends_at IS NULL OR ends_at >= next_due_date)`,
    [tenantId]);

  let generated = 0;
  let skipped = 0;

  for (const tpl of templates) {
    let currentDue = tpl.next_due_date;

    // Gera entries para todas as datas pendentes ate hoje + 30 dias
    while (true) {
      const dueDateObj = new Date(currentDue + 'T12:00:00Z');
      const horizonObj = parseDateMidday(dbNow);
      horizonObj.setUTCDate(horizonObj.getUTCDate() + 30);
      horizonObj.setUTCHours(23, 59, 59, 999);

      if (dueDateObj.getTime() > horizonObj.getTime()) break;

      // Verifica ends_at
      if (tpl.ends_at !== null) {
        const endsAtObj = new Date(tpl.ends_at + 'T23:59:59Z');
        if (dueDateObj.getTime() > endsAtObj.getTime()) break;
      }

      // Idempotency key: garante que o mesmo template+data nao gera duplicata
      const idempotencyKey = `recurring-${tpl.id}-${currentDue}`;

      // Tenta inserir; se a key ja existe, pula (ON CONFLICT DO NOTHING)
      const entryId = uuidv7();
      const { rowCount } = await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id, status,
            due_date, idempotency_key, supplier_id,
            bank_account_id, cost_center_id,
            recurring_template_id, created_by)
         SELECT $1, $2, $3::fin.entry_kind, $4,
                -- professional_id: usa o created_by do template como fallback.
                -- O job nao tem profissional; usa o primeiro profissional da clinica.
                (SELECT p.id FROM app.professional p
                  WHERE p.tenant_id = $1
                  LIMIT 1),
                $5, $6, $7,
                -- payment_method_id: usa o primeiro metodo ativo do tenant
                (SELECT pm.id FROM fin.payment_method pm
                  WHERE pm.tenant_id = $1 AND pm.active = true
                  LIMIT 1),
                'pendente', $8::date, $9, $10, $11, $12, $13, $14
          WHERE NOT EXISTS (
            SELECT 1 FROM fin.entry e2
             WHERE e2.tenant_id = $1 AND e2.idempotency_key = $9
          )`,
        [tenantId, entryId, tpl.kind, tpl.category_id,
         tpl.clinic_id, tpl.description, Number(tpl.amount_cents),
         currentDue, idempotencyKey, tpl.supplier_id,
         tpl.bank_account_id, tpl.cost_center_id, tpl.id,
         tpl.created_by]);

      if ((rowCount ?? 0) > 0) {
        generated++;
      } else {
        skipped++;
      }

      // Avanca para o proximo vencimento
      currentDue = advanceDueDate(currentDue, tpl.frequency, tpl.day_of_month);
    }

    // Atualiza next_due_date do template para o proximo vencimento nao materializado
    let nextDue = tpl.next_due_date;
    const horizonCheck = parseDateMidday(dbNow);
    horizonCheck.setUTCDate(horizonCheck.getUTCDate() + 30);

    while (true) {
      const checkObj = new Date(nextDue + 'T12:00:00Z');
      if (checkObj.getTime() > horizonCheck.getTime()) break;
      if (tpl.ends_at !== null) {
        const endsAtCheck = new Date(tpl.ends_at + 'T23:59:59Z');
        if (checkObj.getTime() > endsAtCheck.getTime()) break;
      }
      nextDue = advanceDueDate(nextDue, tpl.frequency, tpl.day_of_month);
    }

    if (nextDue !== tpl.next_due_date) {
      await tx.query(
        `UPDATE fin.recurring_template
            SET next_due_date = $2::date
          WHERE tenant_id = $1 AND id = $3`,
        [tenantId, nextDue, tpl.id]);
    }
  }

  return { generated, skipped };
}

/**
 * Avanca a data de vencimento conforme a frequencia.
 * Para monthly, respeita day_of_month quando informado.
 */
function advanceDueDate(
  currentDue: string,
  frequency: string,
  dayOfMonth: number | null,
): string {
  const d = new Date(currentDue + 'T12:00:00Z');

  switch (frequency) {
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'biweekly':
      d.setUTCDate(d.getUTCDate() + 14);
      break;
    case 'monthly': {
      d.setUTCMonth(d.getUTCMonth() + 1);
      if (dayOfMonth !== null) {
        // Ajusta para o dia correto; se o mes nao tem esse dia, usa o ultimo
        const targetDay = Math.min(dayOfMonth, daysInMonth(d.getUTCFullYear(), d.getUTCMonth()));
        d.setUTCDate(targetDay);
      }
      break;
    }
    case 'yearly':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }

  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function parseDateMidday(iso: string): Date {
  return new Date(iso + 'T12:00:00Z');
}
