### Task 19: funcao `computeReminderInstant` — calcula o instante de envio no fuso da clinica

**Arquivos:**
- Criar `packages/messaging/src/automations/reminder-timing.ts`
- Teste `packages/messaging/src/automations/reminder-timing.test.ts`

**Contexto:** o timing_offset e relativo ao horario local da clinica, nao UTC. Uma consulta as 8h em America/Sao_Paulo (UTC-3) com offset -1440 (24h antes) deve gerar envio as 8h do dia anterior em horario local, ou seja, 11:00 UTC do dia anterior. Esta funcao recebe o `starts_at` (UTC), o `timezone` da clinica e o `timing_offset_minutes`, e devolve o instante UTC de envio.

- [ ] **Passo 1** — escrever o teste unitario.

Criar `packages/messaging/src/automations/reminder-timing.test.ts`:

```ts
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
    // Brasil: horario de verao (se vigente) muda SP para UTC-2
    // Em 2026, Brasil NAO tem horario de verao (abolido em 2019).
    // Mas testamos com fuso que TEM (ex: America/New_York para validar a logica).
    // 2026-03-09 09:00 EDT (UTC-4) = 2026-03-09 13:00 UTC
    const startsAtUtc = '2026-03-09T13:00:00.000Z';
    const timezone = 'America/New_York';
    const offsetMinutes = -1440;

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-03-08 09:00 EST (UTC-5) = 2026-03-08 14:00 UTC
    // Nota: no dia 8/mar NY ainda esta em EST (horario de verao comeca dia 8 as 2h,
    // mas 9h da manha do dia 8 ainda e EST). Na verdade, em 2026 o DST dos EUA
    // comeca em 8/mar as 02:00. Entao:
    // dia 9/mar 09:00 EDT = 13:00 UTC
    // dia 8/mar 09:00 EST = 14:00 UTC (antes do DST)
    expect(result).toBe('2026-03-08T14:00:00.000Z');
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
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timing.test.ts
```

Saida esperada: 5 testes falham (modulo nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timing.test.ts
```

Saida esperada: `FAIL` — cannot find module `./reminder-timing`.

- [ ] **Passo 3** — implementar `computeReminderInstant`.

Criar `packages/messaging/src/automations/reminder-timing.ts`:

```ts
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
  const dt = new Date(instantMs);
  // Formata partes no fuso-alvo
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(dt);

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
  const startsMs = new Date(startsAtUtc).getTime();

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

  return new Date(targetUtcMs).toISOString();
}
```

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timing.test.ts
```

Saida esperada: 5 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/messaging/src/automations/reminder-timing.ts packages/messaging/src/automations/reminder-timing.test.ts
git commit -m "feat(messaging): computeReminderInstant respects clinic timezone

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---