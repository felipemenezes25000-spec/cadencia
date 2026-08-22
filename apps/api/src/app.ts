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
import { inventoryRoutes } from './routes/inventory';
import { reportRoutes } from './routes/reports';
import { tenancyRoutes } from './routes/tenancy';
import { notificationRoutes } from './routes/notifications';
import { channelRoutes } from './routes/channels';
import { drugRoutes } from './routes/drugs';
import { documentTemplateRoutes } from './routes/documento-templates';
import { teleconsultaRoutes } from './routes/teleconsultas';
import { calendarRoutes } from './routes/calendar';
import { lgpdRoutes } from './routes/lgpd';
import { susRoutes } from './routes/sus';

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
    openapi: { info: { title: 'Cadência PEC Público API', version: '1.0.0' } },
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
        campos: erro.validation.map((v) => ({ path: (v.instancePath ?? '').replace(/^\//, ''), mensagem: v.message ?? '' })),
      });
    }
    const status = typeof (erro as { statusCode?: number }).statusCode === 'number'
      ? (erro as { statusCode: number }).statusCode : 500;
    const dominio = (erro as { dominio?: string }).dominio;
    if (typeof dominio === 'string') {
      const extra = (erro as { extra?: Record<string, unknown> }).extra ?? {};
      return reply.code(status).send({ erro: dominio, ...extra });
    }
    if (status >= 500) req.log.error({ err: erro }, 'erro_nao_tratado');
    return reply.code(status).send({ erro: status === 500 ? 'interno' : 'requisicao_invalida', requestId: req.id });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ erro: 'nao_encontrado' }));
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/v1/whoami', async (req, reply) => {
    const r = await comTransacao(req, reply, async (_tx, ctx) => ({
      kind: ctx.actor.kind, tenantId: ctx.actor.tenantId, userId: ctx.actor.userId, clinicId: ctx.actor.clinicId,
    }));
    if (r === undefined) return reply;
    return r;
  });

  await app.register(sessaoRoutes);
  await app.register(catalogoRoutes);
  await app.register(listaDeEsperaRoutes);
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
  await app.register(inventoryRoutes);
  await app.register(reportRoutes);
  await app.register(tenancyRoutes);
  await app.register(notificationRoutes);
  await app.register(channelRoutes);
  await app.register(drugRoutes);
  await app.register(documentTemplateRoutes);
  await app.register(teleconsultaRoutes);
  await app.register(calendarRoutes);
  await app.register(lgpdRoutes);
  await app.register(susRoutes);

  app.withTypeProvider<ZodTypeProvider>().get('/v1/echo', {
    schema: { querystring: z.object({ n: z.coerce.number().int() }), response: { 200: z.object({ n: z.number() }) } },
  }, async (req) => ({ n: req.query.n }));
  return app;
}
