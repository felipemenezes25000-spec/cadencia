/**
 * O Clock existe para DUAS coisas, e nada mais:
 *   1. medir duracao (latencia, timeout, backoff);
 *   2. alimentar o componente temporal do UUIDv7.
 *
 * A fonte de tempo PERSISTIDO e sempre o Postgres — `clock_timestamp()`, com o
 * cluster em UTC e NTP (convencoes universais da secao 3 da spec). Nenhum valor
 * gravado em coluna timestamptz sai daqui. Relogio de aplicacao deriva entre
 * processos; o do banco e unico, e a ordem dos fatos do prontuario depende disso.
 */
export interface Clock {
  /** Epoch em milissegundos. Para o UUIDv7 e para carimbo de log. */
  nowMs(): number;
  /** Relogio monotonico, imune a ajuste de NTP. NUNCA persistir. */
  monotonicMs(): number;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  monotonicMs: () => performance.now(),
};

export interface TestClock extends Clock {
  /** Passagem normal do tempo: move os dois relogios. */
  advance(ms: number): void;
  /** Ajuste de NTP: move SO o relogio de parede, e pode ir para tras. */
  stepWallClock(ms: number): void;
}

export function fixedClock(startMs: number): TestClock {
  let wall = startMs;
  let monotonic = 0;
  return {
    nowMs: () => wall,
    monotonicMs: () => monotonic,
    advance: (ms: number) => { wall += ms; monotonic += ms; },
    stepWallClock: (ms: number) => { wall += ms; },
  };
}

export interface Measured<T> {
  readonly value: T;
  readonly durationMs: number;
}

export function measure<T>(clock: Clock, fn: () => T): Measured<T> {
  const start = clock.monotonicMs();
  const value = fn();
  return { value, durationMs: clock.monotonicMs() - start };
}

export async function measureAsync<T>(clock: Clock, fn: () => Promise<T>): Promise<Measured<T>> {
  const start = clock.monotonicMs();
  const value = await fn();
  return { value, durationMs: clock.monotonicMs() - start };
}
