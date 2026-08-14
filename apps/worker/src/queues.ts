export const FILA_RASCUNHOS = 'emr.auto-finalize-stale-drafts';
export const FILA_OUTBOX = 'outbox.dispatch';
export const FILA_ENVIO_MSG = 'messaging.send_message';
export const FILA_RECONCILIACAO = 'payments.reconciliation';
export const FILA_LINK_PAGAMENTO = 'outbox.create_payment_link';
export const FILA_ROLLUP = 'fin.daily-rollup';
export const FILA_LEMBRETES = 'messaging.schedule-reminders';
export const FILA_SELO = 'audit.seal-daily';
export const FILA_EXPURGO = 'clin.expurgo-retencao';
export const FILA_REPROJECAO_TISS = 'tiss.encounter_amended';
export const FILA_EMAIL = 'email.send';
export const FILA_CALENDAR_SYNC = 'calendar.sync';
export const FILA_TRIAL_EXPIRACAO = 'billing.trial-expiration';
export const FILA_FATURA_GERACAO = 'billing.invoice-generation';

export const FILAS = [
  FILA_RASCUNHOS, FILA_OUTBOX, FILA_ENVIO_MSG, FILA_RECONCILIACAO,
  FILA_LINK_PAGAMENTO, FILA_ROLLUP, FILA_LEMBRETES, FILA_SELO,
  FILA_EXPURGO, FILA_REPROJECAO_TISS, FILA_EMAIL, FILA_CALENDAR_SYNC,
  FILA_TRIAL_EXPIRACAO, FILA_FATURA_GERACAO,
] as const;
