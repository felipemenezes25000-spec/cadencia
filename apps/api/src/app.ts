import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import {
  serializerCompiler, validatorCompiler, type ZodTypeProvider, jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { comTransacao } from './context';
import { sessaoRoutes } from './routes/sessao';
import { catalogoRoutes } from './routes/catalogos';
import { listaDeEsperaRoutes } from './routes/lista-espera';
import { reciboRoutes } from './routes/recibos';
import { financeiroPainelRoutes } from './routes/financeiro-painel';
import { desempenhoRoutes } from './routes/desempenho';
import { auditoriaRoutes } from './routes/auditoria';
import { configuracaoRoutes } from './routes/configuracoes';
import { acoesPendentesRoutes } from './routes/acoes-pendentes';
import { painelRoutes } from './routes/painel';
import { procedimentoRoutes } from './routes/procedimentos';
import { patientRoutes } from './routes/patients';
import { scheduleRoutes } from './routes/schedule';
import { encounterRoutes } from './routes/encounters';
import { prontuarioConfigRoutes } from './routes/prontuario-config';
import { documentoPdfRoutes } from './routes/documento-pdf';
import { anexoRoutes } from './routes/anexos';
import { compartilhamentoRoutes } from './routes/compartilhamento';
import { bloqueioRoutes } from './routes/bloqueios';
import { recorrenciaRoutes } from './routes/recorrencias';
import { npsRoutes } from './routes/nps';
import { transcricaoRoutes } from './routes/transcricao';
import { publicoRoutes } from './routes/publico';
import { clinicalArtifactRoutes } from './routes/clinical-artifacts';
import { messagingRoutes } from './routes/messaging';
import { messagingWebhookRoutes } from './routes/messaging-webhook';
import { paymentRoutes } from './routes/payments';
import { paymentWebhookRoutes } from './routes/payments-webhook';
import { repasseRoutes } from './routes/repasse';
import { financeSettingsRoutes } from './routes/finance-settings';
import { financeOperationsRoutes } from './routes/finance-operations';
import { inventoryRoutes } from './routes/inventory';
import { reportRoutes } from './routes/reports';
import { operadoraRoutes } from './routes/tiss/operadoras';
import { guiaRoutes } from './routes/tiss/guias';
import { guiaSadtRoutes } from './routes/tiss/guias-sadt';
import { loteRoutes } from './routes/tiss/lotes';
import { convenioPacienteRoutes } from './routes/tiss/convenios-paciente';
import { demonstrativoRoutes } from './routes/tiss/demonstrativos';
import { glosaRoutes } from './routes/tiss/glosas';
import { recursoRoutes } from './routes/tiss/recursos';

/**
 * Nível de log. Estava `false` fixo, o que significa API muda em produção: um
 * 500 devolve requestId ao usuário e não deixa nenhuma linha para procurar por
 * esse id. Teste continua silencioso por padrão — barulho em suíte verde faz
 * ninguém ler a saída quando ela fica vermelha.
 */
const NIVEL_DE_LOG = process.env['LOG_LEVEL']
  ?? (process.env['NODE_ENV'] === 'test' ? 'silent' : 'info');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: NIVEL_DE_LOG === 'silent' ? false : { level: NIVEL_DE_LOG },
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(swagger, {
    openapi: { info: { title: 'Cadência API', version: '1.0.0' } },
    transform: jsonSchemaTransform,
  });
  app.get('/openapi.json', async () => app.swagger());

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    return payload;
  });

  app.setErrorHandler((erro, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(erro)) {
      return reply.code(400).send({
        erro: 'validacao',
        campos: erro.validation.map((v) => ({
          path: (v.instancePath ?? '').replace(/^\//, ''),
          mensagem: v.message ?? '',
        })),
      });
    }
    const status = typeof (erro as { statusCode?: number }).statusCode === 'number'
      ? (erro as { statusCode: number }).statusCode : 500;
    const dominio = (erro as { dominio?: string }).dominio;
    if (typeof dominio === 'string') {
      const extra = (erro as { extra?: Record<string, unknown> }).extra ?? {};
      return reply.code(status).send({ erro: dominio, ...extra });
    }
    // Erro sem domínio é erro que ninguém previu. O corpo continua opaco — a
    // mensagem do Postgres não vai para o cliente —, mas ele PRECISA existir no
    // log do servidor: 500 silencioso vira "quebrou terça-feira" sem nada para
    // olhar, e o requestId devolvido ao usuário não encontra par nenhum.
    if (status >= 500) req.log.error({ err: erro }, 'erro_nao_tratado');
    return reply.code(status).send({
      erro: status === 500 ? 'interno' : 'requisicao_invalida',
      requestId: req.id,
    });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ erro: 'nao_encontrado' }));

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/v1/whoami', async (req, reply) => {
    const r = await comTransacao(req, reply, async (_tx, ctx) => ({
      kind: ctx.actor.kind, tenantId: ctx.actor.tenantId,
      userId: ctx.actor.userId, clinicId: ctx.actor.clinicId,
    }));
    if (r === undefined) return reply;
    return r;
  });

  await app.register(sessaoRoutes);
  await app.register(catalogoRoutes);
  await app.register(listaDeEsperaRoutes);
  await app.register(reciboRoutes);
  await app.register(financeiroPainelRoutes);
  await app.register(desempenhoRoutes);
  await app.register(auditoriaRoutes);
  await app.register(configuracaoRoutes);
  await app.register(acoesPendentesRoutes);
  await app.register(painelRoutes);
  await app.register(procedimentoRoutes);
  await app.register(patientRoutes);
  await app.register(scheduleRoutes);
  await app.register(encounterRoutes);
  await app.register(prontuarioConfigRoutes);
  await app.register(documentoPdfRoutes);
  await app.register(anexoRoutes);
  await app.register(compartilhamentoRoutes);
  await app.register(bloqueioRoutes);
  await app.register(recorrenciaRoutes);
  await app.register(npsRoutes);
  await app.register(transcricaoRoutes);
  await app.register(publicoRoutes);
  await app.register(clinicalArtifactRoutes);
  await app.register(messagingRoutes);
  await app.register(messagingWebhookRoutes);
  await app.register(paymentRoutes);
  await app.register(paymentWebhookRoutes);
  await app.register(repasseRoutes);
  await app.register(financeSettingsRoutes);
  await app.register(financeOperationsRoutes);
  await app.register(inventoryRoutes);
  await app.register(reportRoutes);
  await app.register(operadoraRoutes);
  await app.register(guiaRoutes);
  await app.register(guiaSadtRoutes);
  await app.register(loteRoutes);
  await app.register(convenioPacienteRoutes);
  await app.register(demonstrativoRoutes);
  await app.register(glosaRoutes);
  await app.register(recursoRoutes);

  app.withTypeProvider<ZodTypeProvider>().get('/v1/echo', {
    schema: {
      querystring: z.object({ n: z.coerce.number().int() }),
      response: { 200: z.object({ n: z.number() }) },
    },
  }, async (req) => ({ n: req.query.n }));

  return app;
}
