export const FILA_RASCUNHOS = 'emr.auto-finalize-stale-drafts';
export const FILA_OUTBOX = 'outbox.dispatch';
export const FILA_ENVIO_MSG = 'messaging.send_message';
export const FILA_ENVIO_LEMBRETE = 'messaging.send_reminder';
export const FILA_LEMBRETES = 'messaging.schedule-reminders';
export const FILA_SELO = 'audit.seal-daily';
export const FILA_EXPURGO = 'clin.expurgo-retencao';
export const FILA_EMAIL = 'email.send';
export const FILA_CALENDAR_SYNC = 'calendar.sync';

export const FILAS = [
  FILA_RASCUNHOS, FILA_OUTBOX, FILA_ENVIO_MSG, FILA_ENVIO_LEMBRETE,
  FILA_LEMBRETES, FILA_SELO, FILA_EXPURGO, FILA_EMAIL, FILA_CALENDAR_SYNC,
] as const;
