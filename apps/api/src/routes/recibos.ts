import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function reciboRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/receipts', {
    schema: {
      querystring: z.object({
        de: Data.optional(),
        ate: Data.optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            receiptId: z.string().uuid(),
            receiptNumber: z.number().int(),
            emitidoEm: z.string(),
            valorCents: z.number().int(),
            descricao: z.string(),
            patientNome: z.string().nullable(),
            metodo: z.string(),
            // O TIPO alem do nome: o nome e livre ("Cartao Cielo 2x") e serve
            // para ler; o tipo e fechado e serve para a tela escolher icone e
            // agrupar. Devolver so o nome obrigaria o front a adivinhar por
            // substring, que quebra no dia em que a clinica renomeia o metodo.
            metodoKind: z.enum(['dinheiro', 'cartao_credito', 'cartao_debito',
                                'pix', 'link', 'convenio']),
          })),
        }),
      },
    },
  }, rota('payment.read', async (tx, ctx, req) => {
    const q = req.query as { de?: string; ate?: string; limit?: number };

    const { rows } = await tx.query<{
      id: string; receipt_number: string; issued_at: Date;
      amount_cents: string; description: string;
      patient_nome: string | null; metodo: string; metodo_kind: string;
    }>(
      // O recorte por periodo usa app.local_date() e nao issued_at::date: a data
      // de um recibo e a do fuso da UNIDADE que emitiu (§10 item 10). Um recibo
      // emitido 22h em Manaus cairia no dia seguinte se derivasse do timestamptz.
      `SELECT rc.id, rc.receipt_number, rc.issued_at,
              e.amount_cents, e.description,
              p.full_name AS patient_nome, pm.name AS metodo, pm.kind::text AS metodo_kind
         FROM fin.receipt rc
         JOIN fin.entry e   ON (e.tenant_id, e.id) = (rc.tenant_id, rc.entry_id)
         JOIN fin.payment_method pm
                            ON (pm.tenant_id, pm.id) = (e.tenant_id, e.payment_method_id)
         JOIN app.clinic c  ON (c.tenant_id, c.id) = (e.tenant_id, e.clinic_id)
         LEFT JOIN clin.patient p
                            ON (p.tenant_id, p.id) = (e.tenant_id, e.patient_id)
        WHERE e.clinic_id = $1
          AND ($2::date IS NULL OR app.local_date(rc.issued_at, c.timezone) >= $2::date)
          AND ($3::date IS NULL OR app.local_date(rc.issued_at, c.timezone) <= $3::date)
        ORDER BY rc.receipt_number DESC
        LIMIT $4`,
      [ctx.actor.clinicId, q.de ?? null, q.ate ?? null, q.limit ?? 100]);

    return {
      itens: rows.map((x) => ({
        receiptId: x.id,
        receiptNumber: Number(x.receipt_number),
        emitidoEm: x.issued_at.toISOString(),
        valorCents: Number(x.amount_cents),
        descricao: x.description,
        patientNome: x.patient_nome,
        metodo: x.metodo,
        metodoKind: x.metodo_kind as 'dinheiro',
      })),
    };
  }));
}
