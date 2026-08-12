// apps/api/src/routes/tiss/guias-sadt.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind });
}

/**
 * Guia SP/SADT — serviço profissional e serviço auxiliar de diagnóstico.
 *
 * POR QUE ESTA NÃO É PROJETADA COMO A DE CONSULTA:
 * a guia de consulta nasce sozinha ao finalizar o atendimento, porque tudo que
 * ela precisa já está em `clin.encounter_billing` — houve uma consulta, ela é
 * faturada. SP/SADT é ATO DELIBERADO: o médico decide pedir hemograma. Não há
 * como derivar do atendimento quais exames ele quis, e inventar exame em guia de
 * convênio é fraude, não conveniência.
 *
 * O que dá para reaproveitar do billing (carteira, CNES, conselho, CBO) é
 * reaproveitado: são dados do MESMO atendimento, e pedir de novo na tela faria
 * a recepção redigitar — que é como nasce divergência entre duas guias do mesmo
 * paciente no mesmo dia.
 */

const Procedimento = z.object({
  codigoTabela: z.string().length(2),
  codigoProcedimento: z.string().min(1).max(10),
  descricao: z.string().trim().min(1).max(100),
  quantidade: z.number().int().min(1).max(999),
  valorCentavos: z.number().int().min(0),
  /** Ausente = data do atendimento. Exame pode ser executado noutro dia. */
  dataExecucao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** 1.00 é o neutro; 0.50 é a redução de segundo procedimento na mesma via. */
  reducaoAcrescimo: z.number().min(0.01).max(9.99).optional(),
});

interface LinhaBilling {
  registro_ans: string | null;
  numero_carteira: string | null;
  atendimento_rn: boolean;
  cnes: string;
  cnpj_contratado: string | null;
  cpf_contratado: string | null;
  codigo_prestador_na_operadora: string | null;
  conselho_profissional: string;
  numero_conselho: string;
  uf_conselho: string;
  cbos: string;
  indicacao_acidente: string;
  regime_atendimento: string;
  data_atendimento: string;
}

export async function guiaSadtRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/tiss/guias-sadt', {
    schema: {
      body: z.object({
        encounterId: z.string().uuid(),
        /** '1' eletivo, '2' urgência/emergência. */
        caraterAtendimento: z.enum(['1', '2']),
        /** `dm_tipoAtendimento`: {01,02,03,04,08,09,10,13,23} — não tem 05. */
        tipoAtendimento: z.enum(['01', '02', '03', '04', '08', '09', '10', '13', '23']),
        indicacaoClinica: z.string().trim().max(500).optional(),
        observacao: z.string().trim().max(500).optional(),
        procedimentos: z.array(Procedimento).min(1).max(50),
      }),
      response: {
        201: z.object({
          guiaId: z.string().uuid(),
          numeroGuiaPrestador: z.string(),
          valorTotalCentavos: z.number().int(),
        }),
      },
    },
  }, rota('tiss.guia.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      encounterId: string; caraterAtendimento: '1' | '2'; tipoAtendimento: string;
      indicacaoClinica?: string; observacao?: string;
      procedimentos: z.infer<typeof Procedimento>[] };

    // A guia se prende a VERSÃO do atendimento, não só ao atendimento: se o
    // registro for retificado depois, dá para saber sobre qual texto clínico
    // esta guia foi emitida.
    const { rows: enc } = await tx.query<{ head_version_id: string | null; status: string }>(
      `SELECT head_version_id::text, status::text FROM clin.encounter WHERE id = $1`,
      [b.encounterId]);
    const atendimento = enc[0];
    if (atendimento === undefined) erroDominio('atendimento_nao_encontrado', 404);
    if (atendimento.head_version_id === null) {
      // Sem versão selada não há o que a guia referencie. Emitir agora produziria
      // uma cobrança que aponta para um rascunho que ainda pode mudar.
      erroDominio('atendimento_sem_versao_finalizada', 422);
    }

    const { rows: bill } = await tx.query<LinhaBilling>(
      `SELECT registro_ans, numero_carteira, atendimento_rn, cnes,
              cnpj_contratado, cpf_contratado, codigo_prestador_na_operadora,
              conselho_profissional, numero_conselho, uf_conselho, cbos,
              indicacao_acidente, regime_atendimento,
              data_atendimento::text AS data_atendimento
         FROM clin.encounter_billing WHERE encounter_id = $1`,
      [b.encounterId]);
    const billing = bill[0];
    if (billing === undefined) erroDominio('atendimento_sem_dados_de_faturamento', 422);
    if (billing.registro_ans === null) {
      // Particular não tem guia: não há operadora para receber.
      erroDominio('atendimento_particular_nao_gera_guia', 422);
    }

    const { rows: op } = await tx.query<{ id: string }>(
      `SELECT id FROM tiss.operadora WHERE registro_ans = $1 AND active LIMIT 1`,
      [billing.registro_ans]);
    const operadora = op[0];
    if (operadora === undefined) erroDominio('operadora_nao_cadastrada', 422);

    // Mesma sequência da guia de consulta (`tiss.next_guia_number`), por tenant:
    // o número da guia é único no universo do prestador, atravessando os dois
    // tipos. Duas sequências independentes gerariam o mesmo número para uma
    // consulta e uma SP/SADT, e a operadora recusaria a segunda.
    const { rows: num } = await tx.query<{ next_guia_number: string }>(
      `SELECT tiss.next_guia_number($1)`, [ctx.actor.tenantId]);
    const numeroGuia = String(num[0]!.next_guia_number);

    const guiaId = uuidv7();
    await tx.query(
      `INSERT INTO tiss.encounter_guia_sadt (
         id, encounter_id, encounter_version_id, operadora_id, registro_ans,
         numero_guia_prestador, numero_carteira, atendimento_rn,
         sol_codigo_prestador, sol_cpf_contratado, sol_cnpj_contratado,
         sol_nome_contratado, sol_conselho_profissional, sol_numero_conselho,
         sol_uf_conselho, sol_cbos, data_solicitacao, carater_atendimento,
         indicacao_clinica, exe_codigo_prestador, exe_cpf_contratado,
         exe_cnpj_contratado, exe_cnes, tipo_atendimento, indicacao_acidente,
         regime_atendimento, observacao, created_by)
       VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8,
         $9, $10, $11,
         -- Nome da unidade ATIVA da sessao. Nao existe app.current_clinic_id();
         -- o id vem do ator, que e quem sabe em qual unidade o usuario esta.
         (SELECT nome FROM app.clinic WHERE id = $24),
         $12, $13,
         $14, $15, $16::date, $17,
         $18,
         -- Solicitante e executante sao o MESMO prestador quando a clinica faz o
         -- proprio exame, que e o caso comum. Quando o exame for terceirizado, o
         -- executante muda — e ai a guia sai do laboratorio, nao daqui.
         $9, $10,
         $11, $19, $20, $21,
         $22, $23, app.current_user_id())`,
      [guiaId, b.encounterId, atendimento.head_version_id, operadora.id,
       billing.registro_ans, numeroGuia, billing.numero_carteira,
       billing.atendimento_rn, billing.codigo_prestador_na_operadora,
       billing.cpf_contratado, billing.cnpj_contratado,
       billing.conselho_profissional, billing.numero_conselho,
       billing.uf_conselho, billing.cbos, billing.data_atendimento,
       b.caraterAtendimento, b.indicacaoClinica ?? null, billing.cnes,
       b.tipoAtendimento, billing.indicacao_acidente, billing.regime_atendimento,
       b.observacao ?? null, ctx.actor.clinicId]);

    let total = 0;
    for (const [i, p] of b.procedimentos.entries()) {
      const fator = p.reducaoAcrescimo ?? 1;
      // Total DERIVADO, e a tabela não tem coluna para ele: guardar abriria
      // espaço para divergir dos próprios itens, que é a glosa mais boba.
      total += Math.round(p.valorCentavos * p.quantidade * fator);
      await tx.query(
        `INSERT INTO tiss.encounter_guia_sadt_item (
           guia_id, sequencial_item, data_execucao, codigo_tabela,
           codigo_procedimento, descricao_procedimento, quantidade_executada,
           reducao_acrescimo, valor_unitario)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)`,
        [guiaId, i + 1, p.dataExecucao ?? billing.data_atendimento,
         p.codigoTabela, p.codigoProcedimento, p.descricao, p.quantidade,
         fator, (p.valorCentavos / 100).toFixed(2)]);
    }

    void reply.code(201);
    return { guiaId, numeroGuiaPrestador: numeroGuia, valorTotalCentavos: total };
  }));

  r.get('/v1/atendimentos/:id/guias-sadt', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            guiaId: z.string().uuid(),
            numeroGuiaPrestador: z.string(),
            tipoAtendimento: z.string(),
            criadoEm: z.string(),
            valorTotalCentavos: z.number().int(),
            procedimentos: z.array(z.object({
              codigoProcedimento: z.string(),
              descricao: z.string(),
              quantidade: z.number().int(),
            })),
          })),
        }),
      },
    },
  }, rota('tiss.guia.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rows } = await tx.query<{
      id: string; numero_guia_prestador: string; tipo_atendimento: string;
      criado_em: string; total: string; procedimentos: unknown;
    }>(
      `SELECT g.id, g.numero_guia_prestador, g.tipo_atendimento,
              to_char(g.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS criado_em,
              coalesce(sum(round(i.valor_unitario * i.quantidade_executada
                                 * i.reducao_acrescimo, 2)), 0)::text AS total,
              coalesce(jsonb_agg(jsonb_build_object(
                'codigoProcedimento', i.codigo_procedimento,
                'descricao', i.descricao_procedimento,
                'quantidade', i.quantidade_executada
              ) ORDER BY i.sequencial_item) FILTER (WHERE i.guia_id IS NOT NULL),
              '[]'::jsonb) AS procedimentos
         FROM tiss.encounter_guia_sadt g
         LEFT JOIN tiss.encounter_guia_sadt_item i
                ON (i.tenant_id, i.guia_id) = (g.tenant_id, g.id)
        WHERE g.encounter_id = $1 AND g.live
        GROUP BY g.id, g.numero_guia_prestador, g.tipo_atendimento, g.created_at
        ORDER BY g.created_at`,
      [p.id]);

    return {
      itens: rows.map((x) => ({
        guiaId: x.id,
        numeroGuiaPrestador: x.numero_guia_prestador,
        tipoAtendimento: x.tipo_atendimento,
        criadoEm: x.criado_em,
        valorTotalCentavos: Math.round(Number(x.total) * 100),
        procedimentos: x.procedimentos as {
          codigoProcedimento: string; descricao: string; quantidade: number }[],
      })),
    };
  }));
}
