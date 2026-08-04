import { describe, expect, it } from 'vitest';
import { fixedClock, measure, measureAsync, systemClock } from './clock';
import { createUuidV7, timestampMsFromUuidV7 } from './uuid';

const INSTANTE = 1767225600000; // 2026-01-01T00:00:00.000Z

describe('Clock', () => {
  it('mede duracao pelo relogio monotonico: ajuste de NTP para tras no meio da medicao nao produz latencia negativa', () => {
    const clock = fixedClock(INSTANTE);
    const medido = measure(clock, () => {
      clock.stepWallClock(-5000); // servidor sincroniza e volta 5 segundos
      clock.advance(12);
      return 'atendimento finalizado';
    });
    expect(medido.durationMs).toBe(12);
    expect(medido.value).toBe('atendimento finalizado');
  });

  it('mede tambem operacao assincrona', async () => {
    const clock = fixedClock(INSTANTE);
    const medido = await measureAsync(clock, async () => {
      clock.advance(250);
      return 42;
    });
    expect(medido.durationMs).toBe(250);
    expect(medido.value).toBe(42);
  });

  it('o UNICO uso do Clock que chega ao banco e o componente temporal do UUIDv7: o carimbo de tempo persistido vem do Postgres', () => {
    const clock = fixedClock(INSTANTE);
    const next = createUuidV7();
    expect(timestampMsFromUuidV7(next(clock.nowMs()))).toBe(INSTANTE);
  });

  it('fixedClock e deterministico e avanca os dois relogios junto', () => {
    const clock = fixedClock(INSTANTE);
    expect(clock.nowMs()).toBe(INSTANTE);
    expect(clock.monotonicMs()).toBe(0);
    clock.advance(1500);
    expect(clock.nowMs()).toBe(INSTANTE + 1500);
    expect(clock.monotonicMs()).toBe(1500);
  });

  it('systemClock.monotonicMs avanca de verdade e NAO e o relogio de parede: e ele que mede latencia', () => {
    const monoAntes = systemClock.monotonicMs();
    const wallAntes = systemClock.nowMs();

    let voltas = 0;
    while (systemClock.monotonicMs() - monoAntes < 2) voltas += 1;
    const monoDepois = systemClock.monotonicMs();

    expect(voltas).toBeGreaterThan(0);
    expect(monoDepois - monoAntes).toBeGreaterThanOrEqual(2);   // avanca de verdade
    // performance.now() conta a partir do inicio do processo; Date.now() conta a partir
    // de 1970. Se alguem trocar monotonicMs por Date.now(), esta linha quebra na hora.
    expect(monoDepois).toBeLessThan(wallAntes);
  });
});
