import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenantTx, jobsPool, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

function erroDominio(kind: string, status: number): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind });
}

/**
 * AGENDAMENTO ONLINE — as únicas rotas sem sessão do produto.
 *
 * Elas não usam `rota()`, que exige autenticação por definição. Usam ator
 * `anon`, e por isso toda a lógica mora em `sched.horarios_livres` e
 * `sched.agendar_online`: funções SECURITY DEFINER que devolvem exatamente o que
 * pode ser público. Consultar tabela direto daqui seria abrir a agenda inteira e
 * confiar em cada SELECT futuro não vazar nada.
 *
 * O tenant vem da UNIDADE, e não do cliente: quem chama informa o `clinicId`, e
 * o banco descobre a qual tenant ele pertence. Aceitar tenant do cliente numa
 * rota aberta seria deixar o público escolher de quem quer ler.
 */
export async function publicoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /** Descobre o tenant da unidade. Roda fora de RLS, e por isso só devolve o id. */
  async function tenantDaUnidade(clinicId: string): Promise<string> {
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM app.clinic WHERE id = $1`, [clinicId]);
    const t = rows[0]?.tenant_id;
    if (t === undefined) erroDominio('unidade_nao_encontrada', 404);
    return t;
  }

  r.get('/v1/publico/horarios', {
    schema: {
      querystring: z.object({
        clinicId: z.string().uuid(),
        dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        procedureId: z.string().uuid(),
        professionalId: z.string().uuid().optional(),
      }),
      response: {
        200: z.object({
          /**
           * Fuso DA CLÍNICA. Os horários saem como instante, e sem isto a
           * página pública só podia formatar no fuso do aparelho de quem abriu
           * — o paciente em viagem, ou com o celular em outro fuso, via um
           * horário que não existe na agenda e marcava achando que era outro.
           * Não é dado sensível: a página já mostra a agenda desta unidade.
           */
          timezone: z.string(),
          itens: z.array(z.object({
            professionalId: z.string().uuid(),
            professionalNome: z.string(),
            inicio: z.string(),
            fim: z.string(),
          })),
        }),
      },
    },
  }, async (req) => {
    const q = req.query as {
      clinicId: string; dia: string; procedureId: string; professionalId?: string };
    const tenantId = await tenantDaUnidade(q.clinicId);
    const actor: Actor = { kind: 'anon', tenantId, requestId: uuidv7() };

    const { rows, timezone } = await withTenantTx(actor, async (tx) => {
      const { rows: livres } = await tx.query<{
        professional_id: string; professional_nome: string;
        inicio: string; fim: string;
      }>(
        `SELECT professional_id, professional_nome,
                to_char(inicio, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS inicio,
                to_char(fim,    'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS fim
           FROM sched.horarios_livres($1, $2::date, $3, $4)`,
        [q.clinicId, q.dia, q.procedureId, q.professionalId ?? null]);
      const { rows: tz } = await tx.query<{ timezone: string }>(
        `SELECT timezone FROM app.clinic WHERE id = $1`, [q.clinicId]);
      return { rows: livres, timezone: tz[0]?.timezone ?? 'America/Sao_Paulo' };
    });

    // Sai NOME e HORARIO, e mais nada. Contagem de consultas, telefone da
    // clinica ou qualquer coisa do paciente que ja esta marcado nao entra numa
    // pagina aberta — "das 14h as 15h esta ocupado" ja e agenda alheia.
    return {
      timezone,
      itens: rows.map((x) => ({
        professionalId: x.professional_id,
        professionalNome: x.professional_nome,
        inicio: x.inicio,
        fim: x.fim,
      })),
    };
  });

  r.post('/v1/publico/agendamentos', {
    schema: {
      body: z.object({
        clinicId: z.string().uuid(),
        professionalId: z.string().uuid(),
        procedureId: z.string().uuid(),
        // `{ offset: true }`: o horario que o cliente devolve e o MESMO que
        // `/v1/publico/horarios` entregou, e essa rota emite com deslocamento
        // (`-03:00`), nao com `Z`. Sem isto a API recusa a propria resposta.
        inicio: z.string().datetime({ offset: true }),
        nome: z.string().trim().min(2).max(120),
        telefone: z.string().trim().min(8).max(20),
      }),
      response: { 201: z.object({ appointmentId: z.string().uuid() }) },
    },
  }, async (req, reply) => {
    const b = req.body as {
      clinicId: string; professionalId: string; procedureId: string;
      inicio: string; nome: string; telefone: string };
    const tenantId = await tenantDaUnidade(b.clinicId);
    const actor: Actor = { kind: 'anon', tenantId, requestId: uuidv7() };

    const id = await withTenantTx(actor, async (tx) => {
      try {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT sched.agendar_online($1,$2,$3,$4::timestamptz,$5,$6) AS id`,
          [b.clinicId, b.professionalId, b.procedureId, b.inicio,
           b.nome, b.telefone]);
        return rows[0]?.id ?? '';
      } catch (e) {
        const code = (e as { code?: string }).code;
        // 23P01 = exclusion_violation. Duas pessoas na mesma vaga e o caso
        // NORMAL de agendamento online, e quem perde precisa saber: consulta
        // fantasma seria pior que recusa.
        if (code === '23P01') erroDominio('horario_ja_ocupado', 409);
        if (code === '22023') erroDominio('dados_invalidos', 400);
        if (code === 'P0002') erroDominio('nao_encontrado', 404);
        throw e;
      }
    });

    void reply.code(201);
    return { appointmentId: id };
  });

  /**
   * O que a clinica oferece para marcacao online.
   *
   * Sai NOME e DURACAO, e mais nada. Preco fica fora: valor de procedimento e
   * negociado por convenio e por contrato, e publicar a tabela particular numa
   * pagina aberta entrega a politica comercial da clinica para o concorrente da
   * rua de baixo.
   */
  r.get('/v1/publico/procedimentos', {
    schema: {
      querystring: z.object({ clinicId: z.string().uuid() }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            procedureId: z.string().uuid(),
            nome: z.string(),
            duracaoMin: z.number().int(),
          })),
        }),
      },
    },
  }, async (req) => {
    const q = req.query as { clinicId: string };
    const tenantId = await tenantDaUnidade(q.clinicId);
    const actor: Actor = { kind: 'anon', tenantId, requestId: uuidv7() };

    const rows = await withTenantTx(actor, async (tx) => {
      const { rows: itens } = await tx.query<{
        id: string; nome: string; duracao_min: number;
      }>(
        // Por FUNCAO, como as outras duas rotas publicas. Consulta direta aqui
        // roda como `app_rw`, cuja politica exige vinculo — e ator anonimo nao
        // tem. Devolvia lista vazia, que e a arquitetura funcionando.
        `SELECT procedure_id AS id, nome, duracao_min
           FROM sched.procedimentos_publicos($1)`, [q.clinicId]);
      return itens;
    });

    return {
      itens: rows.map((x) => ({
        procedureId: x.id, nome: x.nome, duracaoMin: x.duracao_min,
      })),
    };
  });
}
