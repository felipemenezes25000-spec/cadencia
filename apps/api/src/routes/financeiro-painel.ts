import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

/**
 * O painel financeiro — as tres leituras agregadas que as telas de Financeiro
 * pedem e que nenhuma rota servia.
 *
 * Regra que atravessa as tres: **caixa e o que foi PAGO**. Pendente e promessa,
 * e misturar os dois no mesmo total e como a gestora descobre no dia 30 que o
 * saldo que ela viu o mes inteiro contava dinheiro que nunca entrou. Por isso
 * `paid_at IS NOT NULL AND status = 'pago'` no caixa, e `status = 'pendente'`
 * no a-receber — nunca os dois na mesma soma.
 *
 * Toda derivacao de DATA usa o fuso da clinica via app.local_date(), nunca
 * `timestamptz::date` (§10 item 10): um recebimento das 22h em Manaus cairia no
 * dia seguinte e o fechamento do dia não bateria com o extrato.
 */

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const LancamentoSchema = z.object({
  id: z.string().uuid(),
  descricao: z.string(),
  amountCents: z.number().int(),
  kind: z.enum(['receita', 'despesa']),
  method: z.string(),
  paidAt: z.string(),
  categoryName: z.string(),
});

export async function financeiroPainelRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── Caixa ────────────────────────────────────────────────────────────────
  r.get('/v1/financeiro/caixa', {
    schema: {
      querystring: z.object({
        de: Data.optional(), ate: Data.optional(),
        contaId: z.string().uuid().optional(),
      }),
      response: {
        200: z.object({
          lancamentos: z.array(LancamentoSchema),
          totalReceita: z.number().int(),
          totalDespesa: z.number().int(),
          saldo: z.number().int(),
          contas: z.array(z.object({ id: z.string().uuid(), nome: z.string() })),
        }),
      },
    },
  }, rota('payment.read', async (tx, ctx, req) => {
    const q = req.query as { de?: string; ate?: string; contaId?: string };

    const { rows } = await tx.query<{
      id: string; description: string; amount_cents: string;
      kind: 'receita' | 'despesa'; metodo: string; paid_at: Date;
      categoria: string | null;
    }>(
      `SELECT e.id, e.description, e.amount_cents, e.kind,
              pm.name AS metodo, e.paid_at, c.name AS categoria
         FROM fin.entry e
         JOIN fin.payment_method pm
                       ON (pm.tenant_id, pm.id) = (e.tenant_id, e.payment_method_id)
         JOIN app.clinic cl ON (cl.tenant_id, cl.id) = (e.tenant_id, e.clinic_id)
         LEFT JOIN fin.category c ON (c.tenant_id, c.id) = (e.tenant_id, e.category_id)
        WHERE e.clinic_id = $1
          AND e.status = 'pago' AND e.paid_at IS NOT NULL
          AND ($2::date IS NULL OR app.local_date(e.paid_at, cl.timezone) >= $2::date)
          AND ($3::date IS NULL OR app.local_date(e.paid_at, cl.timezone) <= $3::date)
          AND ($4::uuid IS NULL OR e.bank_account_id = $4::uuid)
        ORDER BY e.paid_at DESC
        LIMIT 500`,
      [ctx.actor.clinicId, q.de ?? null, q.ate ?? null, q.contaId ?? null]);

    const lancamentos = rows.map((x) => ({
      id: x.id,
      descricao: x.description,
      amountCents: Number(x.amount_cents),
      kind: x.kind,
      method: x.metodo,
      paidAt: x.paid_at.toISOString(),
      categoryName: x.categoria ?? 'Sem categoria',
    }));

    /**
     * Os totais somam no BANCO, sobre o periodo inteiro.
     *
     * A consulta de cima tem `LIMIT 500` — necessario, a lista e paginada na
     * tela. Somar `lançamentos` em JS somava só essas 500 linhas: a partir da
     * 501a, o saldo do caixa passava a mostrar menos dinheiro do que existe, e
     * nada na tela indicava recorte. Numa clinica movimentada isso acontece
     * dentro de um mes, e o erro cresce em silencio conforme o volume.
     */
    const { rows: totais } = await tx.query<{
      total_receita: string; total_despesa: string;
    }>(
      `SELECT
         COALESCE(SUM(e.amount_cents) FILTER (WHERE e.kind = 'receita'), 0)::text
           AS total_receita,
         COALESCE(SUM(e.amount_cents) FILTER (WHERE e.kind = 'despesa'), 0)::text
           AS total_despesa
         FROM fin.entry e
         JOIN app.clinic cl ON (cl.tenant_id, cl.id) = (e.tenant_id, e.clinic_id)
        WHERE e.clinic_id = $1
          AND e.status = 'pago' AND e.paid_at IS NOT NULL
          AND ($2::date IS NULL OR app.local_date(e.paid_at, cl.timezone) >= $2::date)
          AND ($3::date IS NULL OR app.local_date(e.paid_at, cl.timezone) <= $3::date)
          AND ($4::uuid IS NULL OR e.bank_account_id = $4::uuid)`,
      [ctx.actor.clinicId, q.de ?? null, q.ate ?? null, q.contaId ?? null]);

    const totalReceita = Number(totais[0]!.total_receita);
    const totalDespesa = Number(totais[0]!.total_despesa);

    const { rows: contas } = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM fin.bank_account WHERE active ORDER BY name`);

    return {
      lancamentos, totalReceita, totalDespesa,
      saldo: totalReceita - totalDespesa,
      contas: contas.map((c) => ({ id: c.id, nome: c.name })),
    };
  }));

  // ── A receber ────────────────────────────────────────────────────────────
  r.get('/v1/financeiro/a-receber', {
    schema: {
      // `patientId` existe para a aba Financeiro da FICHA DO PACIENTE. Sem o
      // filtro, aquela aba pedia a lista da clinica inteira e mostrava, sob o
      // nome de um paciente, os recebiveis de todos os outros — cada linha com
      // valor, vencimento e descricao de terceiros.
      querystring: z.object({ patientId: z.string().uuid().optional() }),
      response: {
        200: z.object({
          total: z.number().int(),
          entradas: z.array(z.object({
            id: z.string().uuid(),
            patientName: z.string(),
            description: z.string(),
            amountCents: z.number().int(),
            dueDate: z.string(),
            daysPastDue: z.number().int(),
            categoryName: z.string(),
          })),
        }),
      },
    },
  }, rota('payment.read', async (tx, ctx, req) => {
    const q = req.query as { patientId?: string };
    const { rows } = await tx.query<{
      id: string; paciente: string | null; description: string;
      amount_cents: string; due_date: string; atraso: string; categoria: string | null;
    }>(
      // O atraso sai do BANCO, contra a data local da clinica. Calcular no
      // cliente daria um numero diferente conforme o fuso do navegador de quem
      // abriu a tela — e cobranca errada por um dia gera reclamacao.
      `SELECT e.id, p.full_name AS paciente, e.description, e.amount_cents,
              e.due_date::text AS due_date,
              GREATEST(0, app.local_date(clock_timestamp(), cl.timezone) - e.due_date)
                AS atraso,
              c.name AS categoria
         FROM fin.entry e
         JOIN app.clinic cl ON (cl.tenant_id, cl.id) = (e.tenant_id, e.clinic_id)
         LEFT JOIN clin.patient p ON (p.tenant_id, p.id) = (e.tenant_id, e.patient_id)
         LEFT JOIN fin.category c ON (c.tenant_id, c.id) = (e.tenant_id, e.category_id)
        WHERE e.clinic_id = $1 AND e.kind = 'receita' AND e.status = 'pendente'
          AND ($2::uuid IS NULL OR e.patient_id = $2::uuid)
        ORDER BY e.due_date NULLS LAST`,
      [ctx.actor.clinicId, q.patientId ?? null]);

    const entradas = rows.map((x) => ({
      id: x.id,
      patientName: x.paciente ?? 'Sem paciente vinculado',
      description: x.description,
      amountCents: Number(x.amount_cents),
      dueDate: x.due_date,
      daysPastDue: Number(x.atraso),
      categoryName: x.categoria ?? 'Sem categoria',
    }));

    return { total: entradas.reduce((a, e) => a + e.amountCents, 0), entradas };
  }));

  // ── Visao geral ──────────────────────────────────────────────────────────
  r.get('/v1/financeiro/visao', {
    schema: {
      response: {
        200: z.object({
          receitaVsDespesa: z.array(z.object({
            mes: z.string(), receita: z.number().int(), despesa: z.number().int() })),
          saldoProjetado: z.array(z.object({
            dia: z.string(), saldo: z.number().int() })),
          topCategorias: z.array(z.object({
            nome: z.string(), total: z.number().int(), percentual: z.number() })),
          alertas: z.array(z.object({
            tipo: z.string(), mensagem: z.string(),
            severidade: z.enum(['danger', 'warn', 'ok']) })),
          resumoMes: z.object({
            receitaTotal: z.number().int(), despesaTotal: z.number().int(),
            saldo: z.number().int(), pendente: z.number().int() }),
        }),
      },
    },
  }, rota('report.read', async (tx, ctx) => {
    const clinicId = ctx.actor.clinicId;

    // Seis meses de receita contra despesa, agrupados pelo mes LOCAL da clinica.
    const { rows: serie } = await tx.query<{
      mes: string; receita: string; despesa: string }>(
      `SELECT to_char(date_trunc('month',
                app.local_date(e.paid_at, cl.timezone)), 'YYYY-MM') AS mes,
              sum(e.amount_cents) FILTER (WHERE e.kind = 'receita') AS receita,
              sum(e.amount_cents) FILTER (WHERE e.kind = 'despesa') AS despesa
         FROM fin.entry e
         JOIN app.clinic cl ON (cl.tenant_id, cl.id) = (e.tenant_id, e.clinic_id)
        WHERE e.clinic_id = $1 AND e.status = 'pago' AND e.paid_at IS NOT NULL
          AND e.paid_at >= clock_timestamp() - interval '6 months'
        GROUP BY 1 ORDER BY 1`,
      [clinicId]);

    const { rows: porDia } = await tx.query<{ dia: string; saldo: string }>(
      `SELECT app.local_date(e.paid_at, cl.timezone)::text AS dia,
              sum(CASE WHEN e.kind = 'receita' THEN e.amount_cents
                       ELSE -e.amount_cents END) AS saldo
         FROM fin.entry e
         JOIN app.clinic cl ON (cl.tenant_id, cl.id) = (e.tenant_id, e.clinic_id)
        WHERE e.clinic_id = $1 AND e.status = 'pago' AND e.paid_at IS NOT NULL
          AND e.paid_at >= clock_timestamp() - interval '30 days'
        GROUP BY 1 ORDER BY 1`,
      [clinicId]);

    const { rows: cats } = await tx.query<{ nome: string; total: string }>(
      `SELECT coalesce(c.name, 'Sem categoria') AS nome, sum(e.amount_cents) AS total
         FROM fin.entry e
         LEFT JOIN fin.category c ON (c.tenant_id, c.id) = (e.tenant_id, e.category_id)
        WHERE e.clinic_id = $1 AND e.kind = 'receita'
          AND e.status = 'pago' AND e.paid_at IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      [clinicId]);

    const { rows: resumo } = await tx.query<{
      receita: string; despesa: string; pendente: string; vencidos: string }>(
      `SELECT coalesce(sum(e.amount_cents)
                FILTER (WHERE e.kind = 'receita' AND e.status = 'pago'), 0) AS receita,
              coalesce(sum(e.amount_cents)
                FILTER (WHERE e.kind = 'despesa' AND e.status = 'pago'), 0) AS despesa,
              coalesce(sum(e.amount_cents)
                FILTER (WHERE e.kind = 'receita' AND e.status = 'pendente'), 0) AS pendente,
              count(*) FILTER (
                WHERE e.kind = 'receita' AND e.status = 'pendente'
                  AND e.due_date < app.local_date(clock_timestamp(), cl.timezone)
              ) AS vencidos
         FROM fin.entry e
         JOIN app.clinic cl ON (cl.tenant_id, cl.id) = (e.tenant_id, e.clinic_id)
        WHERE e.clinic_id = $1
          -- Janela móvel de 30 dias, e não mês de calendário. Mês corrente daria
          -- um saldo que despenca todo dia 1º e se recupera ao longo do mês,
          -- porque aluguel e folha entram inteiros no começo e a receita entra
          -- diluída: no dia 5 a clínica "está no vermelho" todo mês, e o número
          -- deixa de informar. A janela móvel compara sempre 30 dias com 30.
          AND (e.paid_at IS NULL
               OR e.paid_at >= clock_timestamp() - interval '30 days')`,
      [clinicId]);

    const linha = resumo[0] ?? { receita: '0', despesa: '0', pendente: '0', vencidos: '0' };
    const receitaTotal = Number(linha.receita);
    const despesaTotal = Number(linha.despesa);
    const pendente = Number(linha.pendente);
    const vencidos = Number(linha.vencidos);

    const somaCats = cats.reduce((a, c) => a + Number(c.total), 0);

    const alertas: Array<{ tipo: string; mensagem: string; severidade: 'danger' | 'warn' | 'ok' }> = [];
    if (vencidos > 0) {
      alertas.push({
        tipo: 'a_receber_vencido',
        mensagem: `${vencidos} recebimento${vencidos > 1 ? 's' : ''} vencido${vencidos > 1 ? 's' : ''}`,
        severidade: 'danger',
      });
    }
    if (receitaTotal - despesaTotal < 0) {
      alertas.push({
        tipo: 'saldo_negativo',
        mensagem: 'As despesas pagas superam as receitas no periodo',
        severidade: 'warn',
      });
    }
    if (alertas.length === 0) {
      alertas.push({ tipo: 'em_dia', mensagem: 'Nada vencido por aqui', severidade: 'ok' });
    }

    return {
      receitaVsDespesa: serie.map((x) => ({
        mes: x.mes, receita: Number(x.receita ?? 0), despesa: Number(x.despesa ?? 0) })),
      saldoProjetado: porDia.map((x) => ({ dia: x.dia, saldo: Number(x.saldo) })),
      topCategorias: cats.map((x) => ({
        nome: x.nome,
        total: Number(x.total),
        percentual: somaCats === 0 ? 0
          : Math.round((Number(x.total) / somaCats) * 1000) / 10,
      })),
      alertas,
      resumoMes: {
        receitaTotal, despesaTotal, saldo: receitaTotal - despesaTotal, pendente },
    };
  }));
}
