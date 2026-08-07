import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import {
  serializerCompiler, validatorCompiler, type ZodTypeProvider, jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { comTransacao } from './context';
import { patientRoutes } from './routes/patients';
import { scheduleRoutes } from './routes/schedule';
import { encounterRoutes } from './routes/encounters';
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

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
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

  await app.register(patientRoutes);
  await app.register(scheduleRoutes);
  await app.register(encounterRoutes);
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

  app.withTypeProvider<ZodTypeProvider>().get('/v1/echo', {
    schema: {
      querystring: z.object({ n: z.coerce.number().int() }),
      response: { 200: z.object({ n: z.number() }) },
    },
  }, async (req) => ({ n: req.query.n }));

  return app;
}
