import PgBoss from 'pg-boss';
import { closePools } from '@cadencia/db';
import { autoFinalizeStaleDrafts } from './jobs/auto-finalize-drafts';
import { dispatchOutbox } from './jobs/outbox-dispatcher';
import { sendMessage, type SendMessageInput } from './jobs/send-message';
import { reconcilePayments } from './jobs/payment-reconciliation';
import { gerarLinkDePagamento, type GerarLinkInput } from './jobs/gerar-link-de-pagamento';
import { expurgarRetencao } from './jobs/expurgo-retencao';
import { FsStorageAdapter, InMemoryStorageAdapter } from '@cadencia/storage';
import { materializeDailyRollup } from './jobs/daily-rollup';
import { scheduleReminders } from './jobs/reminder-scheduler';
import { selarTrilha, vigiarSelo } from './jobs/audit-seal';
import { reprojetarGuiaTiss } from './jobs/reprojetar-guia-tiss';
import {
  createFakeMessagingProvider, createFakePaymentProvider,
} from '@cadencia/integrations';

const FILA_RASCUNHOS = 'emr.auto-finalize-stale-drafts';
const FILA_OUTBOX = 'outbox.dispatch';
const FILA_ENVIO_MSG = 'messaging.send_message';
const FILA_RECONCILIACAO = 'payments.reconciliation';
// O despachante roteia event_type desconhecido para `outbox.<tipo>`. Este era o
// caso de `create_payment_link`: a fila existia e ninguém escutava.
const FILA_LINK_PAGAMENTO = 'outbox.create_payment_link';
const FILA_ROLLUP = 'fin.daily-rollup';
const FILA_LEMBRETES = 'messaging.schedule-reminders';
const FILA_SELO = 'audit.seal-daily';
const FILA_EXPURGO = 'clin.expurgo-retencao';
// `resolveQueue` roteia ENCOUNTER_AMENDED para cá desde a Fase 4. A fila
// existia, o evento chegava, e ninguém escutava — o mesmo defeito silencioso de
// `create_payment_link` logo acima, repetido.
const FILA_REPROJECAO_TISS = 'tiss.encounter_amended';

const FILAS = [
  FILA_RASCUNHOS,
  FILA_OUTBOX,
  FILA_ENVIO_MSG,
  FILA_RECONCILIACAO,
  FILA_LINK_PAGAMENTO,
  FILA_ROLLUP,
  FILA_LEMBRETES,
  FILA_SELO,
  FILA_EXPURGO,
  FILA_REPROJECAO_TISS,
] as const;

export async function startWorker(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL_JOBS ?? '',
    schema: 'pgboss',
  });
  await boss.start();

  // pg-boss 10 nao cria mais filas implicitamente em work()/schedule(). Como
  // schedule.name referencia queue.name, agendar antes deste bootstrap derruba
  // o worker no boot com FK schedule_name_fkey. createQueue e idempotente, entao
  // o mesmo caminho serve tanto ao primeiro deploy quanto aos reinicios.
  for (const fila of FILAS) await boss.createQueue(fila);

  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  const messaging = usarFakes ? createFakeMessagingProvider() : (() => {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais');
  })();
  const payment = usarFakes ? createFakePaymentProvider() : (() => {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais');
  })();

  // -- Job existente: auto-finalização ------------------------------------------
  await boss.work(FILA_RASCUNHOS, async () => {
    const r = await autoFinalizeStaleDrafts({ limiteDias: 7 });
    process.stdout.write(
      `[worker] auto-finalize: ${r.finalizados}/${r.examinados} (falhas: ${r.falhas})\n`);
  });

  // -- Expurgo por retenção (§3.10) ---------------------------------------------
  //
  // Uma vez por dia, de madrugada. A JANELA é calculada no banco: nenhum
  // parâmetro daqui consegue encurtar a guarda legal de 20 anos.
  const armazenamento = process.env['STORAGE_DRIVER'] === 'memory'
    ? new InMemoryStorageAdapter()
    : new FsStorageAdapter(process.env['STORAGE_DIR'] ?? './.armazenamento');

  await boss.work(FILA_EXPURGO, async () => {
    const r = await expurgarRetencao({}, armazenamento);
    process.stdout.write(
      `[worker] expurgo: ${r.valoresExpurgados} valores, ${r.anexosExpurgados} anexos, `
      + `${r.objetosApagados} objetos apagados, ${r.falhas} falhas
`);
    // Objeto órfão é lixo recuperável, mas silêncio sobre ele vira disco cheio
    // de dado que a lei manda destruir. O alarme é o log, e ele é alto.
    if (r.falhas > 0) {
      process.stderr.write(
        `[worker] EXPURGO INCOMPLETO: ${r.falhas} objetos permanecem no armazenamento
`);
    }
  });

  // -- Despachante de outbox (polling a cada 5s) --------------------------------
  await boss.work(FILA_OUTBOX, async () => {
    const r = await dispatchOutbox(boss);
    if (r.dispatched > 0 || r.errors > 0) {
      process.stdout.write(
        `[worker] outbox: ${r.dispatched} despachados, ${r.errors} erros\n`);
    }
  });

  // -- Geração de link de pagamento (consome outbox) ---------------------------
  await boss.work(FILA_LINK_PAGAMENTO, async (jobs) => {
    for (const job of jobs) {
      const d = job.data as GerarLinkInput;
      const r = await gerarLinkDePagamento(d, payment);
      process.stdout.write(`[worker] link-pagamento: ${d.entryId} -> ${r.status}
`);
      // Provedor fora do ar é transitório: relançar devolve o job à fila para
      // nova tentativa. Lançamento inexistente é terminal e sai em silêncio —
      // retentar para sempre só enche o log.
      if (r.status === 'provedor_indisponivel') throw new Error(r.detalhe);
    }
  });

  // -- Envio de mensagens (consome outbox de tipo messaging) --------------------
  await boss.work(FILA_ENVIO_MSG, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as SendMessageInput & { tenantId: string };
      const r = await sendMessage(data, messaging);
      process.stdout.write(
        `[worker] send-message: ${r.messageId} -> ${r.status}\n`);
    }
  });

  // -- Reprojeção da guia TISS após retificação/adendo --------------------------
  //
  // Sem este consumidor a correção feita no prontuário não chegava na cobrança:
  // a guia seguia para a operadora com o CID e o valor de antes da retificação.
  await boss.work(FILA_REPROJECAO_TISS, async (jobs) => {
    for (const job of jobs) {
      const d = job.data as { tenantId: string; aggregateId: string };
      const r = await reprojetarGuiaTiss(
        { tenantId: d.tenantId, aggregateId: d.aggregateId });
      process.stdout.write(
        `[worker] reprojecao-tiss: ${d.aggregateId} -> ${r.status}\n`);
      // Falha de projeção é transitória o bastante para valer nova tentativa
      // (dado de referência TUSS carregando, por exemplo). Atendimento sem
      // versão é terminal: não há o que reprojetar.
      if (r.status === 'falhou') throw new Error(r.detalhe);
    }
  });

  // -- Reconciliação noturna ----------------------------------------------------
  await boss.work(FILA_RECONCILIACAO, async () => {
    const r = await reconcilePayments(payment);
    process.stdout.write(
      `[worker] reconciliation: ${r.tenantsProcessed} tenants, `
      + `${r.settlementsFound} settlements, ${r.divergences} divergencias\n`);
  });

  // -- Materialização do daily_rollup -------------------------------------------
  await boss.work(FILA_ROLLUP, async () => {
    const r = await materializeDailyRollup();
    process.stdout.write(
      `[worker] daily-rollup: ${r.rowsUpserted} linhas, ${r.tenantsProcessed} tenants\n`);
  });

  // -- Agendamento de lembretes -------------------------------------------------
  await boss.work(FILA_LEMBRETES, async () => {
    const r = await scheduleReminders(boss);
    process.stdout.write(
      `[worker] reminders: ${r.scheduled} agendados, ${r.skipped} pulados\n`);
  });

  // -- Selo diário da trilha ----------------------------------------------------
  //
  // A trilha é append-only, mas só o selo a torna PROVA: sem ele, quem tem
  // acesso ao banco poderia reescrever o passado sem deixar vestígio. O vigia
  // roda junto e transforma AUSÊNCIA de execução em alarme — §9 classifica
  // "selo falha em silêncio" como risco que pode matar o produto, justamente
  // porque job que para não faz barulho sozinho.
  await boss.work(FILA_SELO, async () => {
    const r = await selarTrilha();
    process.stdout.write(
      `[worker] selo ${r.dia}: ${r.tenantsSelados} selados, `
      + `${r.jaSelados} ja selados, ${r.adiados} adiados, ${r.falhas} falhas
`);

    if (r.falhas > 0) {
      // Sai por stderr de propósito: falha de selo tem que aparecer no canal de
      // erro do processo, não diluída no log de sucesso.
      process.stderr.write(
        `[worker] SELO COM FALHA em ${r.falhas} tenant(s): `
        + `${r.detalhes.filter((d) => d.outcome !== 'sucesso')
             .map((d) => `${d.tenantId}=${d.outcome}`).join(', ')}
`);
    }

    const vigia = await vigiarSelo();
    if (vigia.atrasado) {
      process.stderr.write(
        `[worker] VIGIA DO SELO: ${vigia.status} — ultima execucao `
        + `${vigia.ultimaExecucao ?? 'nunca'}
`);
    }
  });

  // -- Schedules ----------------------------------------------------------------
  await boss.schedule(FILA_RASCUNHOS, '0 3 * * *');
  await boss.schedule(FILA_OUTBOX, '*/5 * * * * *');       // cada 5 segundos
  await boss.schedule(FILA_RECONCILIACAO, '0 4 * * *');    // 4h da manhã
  await boss.schedule(FILA_ROLLUP, '30 3 * * *');          // 3h30 da manhã
  await boss.schedule(FILA_LEMBRETES, '* * * * *');        // a cada minuto
  // 2h30: depois da meia-noite de qualquer fuso brasileiro, e ANTES do rollup
  // das 3h30 — selar o dia antes de derivar número dele mantém a ordem
  // "primeiro prova, depois relatório".
  await boss.schedule(FILA_SELO, '30 2 * * *');
  // 4h10: depois do selo da trilha (2h30) e da reconciliação (4h). Expurgo
  // rodando antes do selo deixaria a destruição fora do dia selado.
  await boss.schedule(FILA_EXPURGO, '10 4 * * *');

  return boss;
}

async function main(): Promise<void> {
  const boss = await startWorker();
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void (async () => { await boss.stop(); await closePools(); process.exit(0); })();
    });
  }
}

if (process.env.NODE_ENV !== 'test') void main();
