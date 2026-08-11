/** Status persistidos pela API de agenda. */
export type AppointmentStatus =
  | 'agendado'
  | 'confirmado'
  | 'aguardando'
  | 'atendendo'
  | 'atendido'
  | 'faltou'
  | 'cancelado';

export type AppointmentPrimaryActionId =
  | 'confirmar'
  | 'checkin'
  | 'abrir_atendimento'
  | 'ver_atendimento'
  | 'reagendar'
  | 'ver_detalhes';
