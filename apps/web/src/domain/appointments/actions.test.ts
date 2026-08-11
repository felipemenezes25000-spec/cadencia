import { describe, expect, it } from 'vitest';
import { getPrimaryAction } from './actions';
import type { AppointmentStatus } from './types';

describe('getPrimaryAction', () => {
  const cases: readonly [AppointmentStatus, string][] = [
    ['scheduled', 'Confirmar'],
    ['confirmation_pending', 'Enviar lembrete'],
    ['confirmed', 'Check-in'],
    ['waiting', 'Chamar'],
    ['called', 'Iniciar atendimento'],
    ['in_progress', 'Continuar'],
    ['closing', 'Finalizar'],
    ['completed', 'Ver atendimento'],
    ['no_show', 'Reagendar'],
    ['blocked', 'Resolver pendência'],
  ];

  it.each(cases)('%s possui uma unica acao primaria: %s', (status, label) => {
    expect(getPrimaryAction(status).label).toBe(label);
  });
});
