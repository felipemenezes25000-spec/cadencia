import { describe, expect, it } from 'vitest';
import { computeReminderInstant } from './reminder-timing';

describe('computeReminderInstant', () => {
  it('lembrete 24h antes: consulta as 8h em SP sai as 8h do dia anterior em SP', () => {
    // 2026-10-07 08:00 em America/Sao_Paulo = 2026-10-07 11:00 UTC
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = -1440; // 24h antes

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-10-06 08:00 em America/Sao_Paulo = 2026-10-06 11:00 UTC
    expect(result).toBe('2026-10-06T11:00:00.000Z');
  });

  it('lembrete 2h antes: consulta as 8h em SP sai as 6h do mesmo dia em SP', () => {
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = -120; // 2h antes

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-10-07 06:00 em America/Sao_Paulo = 2026-10-07 09:00 UTC
    expect(result).toBe('2026-10-07T09:00:00.000Z');
  });

  it('respeita horario de verao: consulta em novembro quando SP esta em UTC-2', () => {
    // Brasil: horário de verão (se vigente) muda SP para UTC-2
    // Em 2026, Brasil NÃO tem horário de verão (abolido em 2019).
    // Mas testamos com fuso que TEM (ex: America/New_York para validar a lógica).
    // 2026-03-09 09:00 EDT (UTC-4) = 2026-03-09 13:00 UTC
    const startsAtUtc = '2026-03-09T13:00:00.000Z';
    const timezone = 'America/New_York';
    const offsetMinutes = -1440;

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // Em 2026, DST dos EUA começa em 8/mar as 02:00 AM.
    // Então dia 8/mar as 09:00 JÁ é EDT (UTC-4), não EST.
    // dia 9/mar 09:00 EDT = 13:00 UTC
    // dia 8/mar 09:00 EDT = 13:00 UTC (DST já entrou as 02:00)
    expect(result).toBe('2026-03-08T13:00:00.000Z');
  });

  it('pos-consulta 24h depois: offset positivo funciona', () => {
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = 1440; // 24h depois

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-10-08 08:00 em SP = 2026-10-08 11:00 UTC
    expect(result).toBe('2026-10-08T11:00:00.000Z');
  });

  it('offset zero retorna o mesmo instante da consulta', () => {
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = 0;

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    expect(result).toBe('2026-10-07T11:00:00.000Z');
  });
});
