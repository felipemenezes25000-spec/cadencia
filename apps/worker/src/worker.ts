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
// caso de `create_payment_link`: a fila existia e ninguem escutava.
const FILA_LINK_PAGAMENTO = 'outbox.create_payment_link';
const FILA_ROLLUP = 'fin.daily-rollup';
const FILA_LEMBRETES = 'messaging.schedule-reminders';
const FILA_SELO = 'audit.seal-daily';
const FILA_EXPURGO = 'clin.expurgo-retencao';
// `resolveQueue` roteia ENCOUNTER_AMENDED para ca desde a Fase 4. A fila
// existia, o evento chegava, e ninguem escutava — o mesmo defeito silencioso de
// `create_payment_link` logo acima, repetido.
const FILA_REPROJECAO_TISS = 'tiss.encounter_amended';

export async function startWorker(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL_JOBS ?? '',
    schema: 'pgboss',
  });
  await boss.start();

  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  const messaging = usarFakes ? createFakeMessagingProvider() : (() => {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais');
  })();
  const payment = usarFakes ? createFakePaymentProvider() : (() => {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais');
  })();

  // -- Job existente: auto-finalizacao ------------------------------------------
  await boss.work(FILA_RASCUNHOS, async () => {
    const r = await autoFinalizeStaleDrafts({ limiteDias: 7 });
    process.stdout.write(
      `[worker] auto-finalize: ${r.finalizados}/${r.examinados} (falhas: ${r.falhas})\n`);
  });

  // -- Expurgo por retencao (§3.10) ---------------------------------------------
  //
  // Uma vez por dia, de madrugada. A JANELA e calculada no banco: nenhum
  // parametro daqui consegue encurtar a guarda legal de 20 anos.
  const armazenamento = process.env['STORAGE_DRIVER'] === 'memory'
    ? new InMemoryStorageAdapter()
    : new FsStorageAdapter(process.env['STORAGE_DIR'] ?? './.armazenamento');

  await boss.work(FILA_EXPURGO, async () => {
    const r = await expurgarRetencao({}, armazenamento);
    process.stdout.write(
      `[worker] expurgo: ${r.valoresExpurgados} valores, ${r.anexosExpurgados} anexos, `
      + `${r.objetosApagados} objetos apagados, ${r.falhas} falhas
`);
    // Objeto orfao e lixo recuperavel, mas silencio sobre ele vira disco cheio
    // de dado que a lei manda destruir. O alarme e o log, e ele e alto.
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

  // -- Geracao de link de pagamento (consome outbox) ---------------------------
  await boss.work(FILA_LINK_PAGAMENTO, async (jobs) => {
    for (const job of jobs) {
      const d = job.data as GerarLinkInput;
      const r = await gerarLinkDePagamento(d, payment);
      process.stdout.write(`[worker] link-pagamento: ${d.entryId} -> ${r.status}
`);
      // Provedor fora do ar e transitorio: relancar devolve o job a fila para
      // nova tentativa. Lancamento inexistente e terminal e sai em silencio —
      // retentar para sempre so enche o log.
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

  // -- Reprojecao da guia TISS apos retificacao/adendo --------------------------
  //
  // Sem este consumidor a correcao feita no prontuario nao chegava na cobranca:
  // a guia seguia para a operadora com o CID e o valor de antes da retificacao.
  await boss.work(FILA_REPROJECAO_TISS, async (jobs) => {
    for (const job of jobs) {
      const d = job.data as { tenantId: string; aggregateId: string };
      const r = await reprojetarGuiaTiss(
        { tenantId: d.tenantId, aggregateId: d.aggregateId });
      process.stdout.write(
        `[worker] reprojecao-tiss: ${d.aggregateId} -> ${r.status}\n`);
      // Falha de projecao e transitoria o bastante para valer nova tentativa
      // (dado de referencia TUSS carregando, por exemplo). Atendimento sem
      // versao e terminal: nao ha o que reprojetar.
      if (r.status === 'falhou') throw new Error(r.detalhe);
    }
  });

  // -- Reconciliacao noturna ----------------------------------------------------
  await boss.work(FILA_RECONCILIACAO, async () => {
    const r = await reconcilePayments(payment);
    process.stdout.write(
      `[worker] reconciliation: ${r.tenantsProcessed} tenants, `
      + `${r.settlementsFound} settlements, ${r.divergences} divergencias\n`);
  });

  // -- Materializacao do daily_rollup -------------------------------------------
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

  // -- Selo diario da trilha ----------------------------------------------------
  //
  // A trilha e append-only, mas so o selo a torna PROVA: sem ele, quem tem
  // acesso ao banco poderia reescrever o passado sem deixar vestigio. O vigia
  // roda junto e transforma AUSENCIA de execucao em alarme — §9 classifica
  // "selo falha em silencio" como risco que pode matar o produto, justamente
  // porque job que para nao faz barulho sozinho.
  await boss.work(FILA_SELO, async () => {
    const r = await selarTrilha();
    process.stdout.write(
      `[worker] selo ${r.dia}: ${r.tenantsSelados} selados, `
      + `${r.jaSelados} ja selados, ${r.adiados} adiados, ${r.falhas} falhas
`);

    if (r.falhas > 0) {
      // Sai por stderr de proposito: falha de selo tem que aparecer no canal de
      // erro do processo, nao diluida no log de sucesso.
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
  await boss.schedule(FILA_RECONCILIACAO, '0 4 * * *');    // 4h da manha
  await boss.schedule(FILA_ROLLUP, '30 3 * * *');          // 3h30 da manha
  await boss.schedule(FILA_LEMBRETES, '* * * * *');        // a cada minuto
  // 2h30: depois da meia-noite de qualquer fuso brasileiro, e ANTES do rollup
  // das 3h30 — selar o dia antes de derivar numero dele mantem a ordem
  // "primeiro prova, depois relatorio".
  await boss.schedule(FILA_SELO, '30 2 * * *');
  // 4h10: depois do selo da trilha (2h30) e da reconciliacao (4h). Expurgo
  // rodando antes do selo deixaria a destruicao fora do dia selado.
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
