import { isoFromMs } from '@cadencia/kernel';

/**
 * Calcula o instante UTC de envio de lembrete/automacao.
 *
 * O timing_offset_minutes e RELATIVO ao horario LOCAL da clinica, NAO ao UTC.
 * Motivo: consulta as 8h em America/Sao_Paulo com offset -1440 deve disparar
 * as 8h do dia anterior no fuso local, ou seja 11:00 UTC — e nao as 5:00 UTC
 * que e o que daria se subtraisse 1440 min do instante UTC puro.
 *
 * Algoritmo:
 * 1. Converte starts_at UTC para horario local da clinica.
 * 2. Aplica o offset em minutos no horario local.
 * 3. Converte de volta para UTC.
 *
 * Usa Intl.DateTimeFormat para obter o offset real do fuso naquele instante,
 * respeitando horario de verao onde aplicavel.
 */

/**
 * Retorna o offset UTC em minutos para um dado instante e timezone.
 * Positivo = leste de Greenwich (ex: +180 para UTC+3).
 * Negativo = oeste (ex: -180 para UTC-3).
 */
function utcOffsetMinutesAt(instantMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(instantMs);

  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  // Reconstroi o instante "como se fosse UTC" a partir das partes locais
  const localAsUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'),
  );

  // A diferenca e o offset: local - UTC
  return Math.round((localAsUtc - instantMs) / 60_000);
}

export function computeReminderInstant(
  startsAtUtc: string,
  timezone: string,
  offsetMinutes: number,
): string {
  const startsMs = Date.parse(startsAtUtc);

  // 1. Offset UTC do fuso no instante da consulta
  const tzOffsetAtStart = utcOffsetMinutesAt(startsMs, timezone);

  // 2. Horario local da consulta em ms (como se fosse UTC)
  const localMs = startsMs + tzOffsetAtStart * 60_000;

  // 3. Aplica o offset da automacao no horario local
  const targetLocalMs = localMs + offsetMinutes * 60_000;

  // 4. Descobre o offset UTC no instante-alvo (pode diferir por DST)
  //    Para isso, precisamos de uma estimativa do instante UTC-alvo
  const estimatedUtcMs = targetLocalMs - tzOffsetAtStart * 60_000;
  const tzOffsetAtTarget = utcOffsetMinutesAt(estimatedUtcMs, timezone);

  // 5. Converte de volta para UTC usando o offset correto
  const targetUtcMs = targetLocalMs - tzOffsetAtTarget * 60_000;

  return isoFromMs(targetUtcMs);
}
