import { describe, expect, it } from 'vitest';
import { getPrimaryAction } from './actions';
import type { AppointmentStatus } from './types';

describe('getPrimaryAction', () => {
  const cases: readonly [AppointmentStatus, string][] = [
    ['agendado', 'Confirmar'],
    ['confirmado', 'Fazer check-in'],
    ['aguardando', 'Iniciar'],
    ['atendendo', 'Continuar'],
    ['atendido', 'Ver atendimento'],
    ['faltou', 'Reagendar'],
    ['cancelado', 'Ver detalhes'],
  ];

  it.each(cases)('%s possui uma unica acao primaria: %s', (status, label) => {
    expect(getPrimaryAction(status).label).toBe(label);
  });
});
