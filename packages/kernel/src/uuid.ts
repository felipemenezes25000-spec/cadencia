import { randomBytes } from 'node:crypto';
import { ValidationError } from './errors';

/** UUIDv7 (RFC 9562): 48 bits de epoch em ms, 12 bits de contador, 62 bits aleatórios. */
export type UuidV7 = string & { readonly __brand: 'UuidV7' };

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_COUNTER = 0xfff;

/**
 * Cada gerador tem contador próprio. O contador ocupa os 12 bits de rand_a e
 * garante ordem dentro do mesmo milissegundo; quando estoura, o gerador avança
 * 1 ms artificial. Relógio que anda para trás nunca regride o identificador.
 */
export function createUuidV7(): (nowMs?: number) => UuidV7 {
  let lastMs = -1;
  let counter = 0;

  return function next(nowMs: number = Date.now()): UuidV7 {
    let ms = Math.floor(nowMs);
    if (ms > lastMs) {
      lastMs = ms;
      counter = 0;
    } else {
      counter += 1;
      if (counter > MAX_COUNTER) {
        lastMs += 1;
        counter = 0;
      }
      ms = lastMs;
    }

    const bytes = randomBytes(16);
    bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
    bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
    bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
    bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
    bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
    bytes[5] = ms & 0xff;
    bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);   // versão 7 + contador alto
    bytes[7] = counter & 0xff;                     // contador baixo
    bytes[8] = 0x80 | (bytes[8]! & 0x3f);          // variante RFC 4122/9562

    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as UuidV7;
  };
}

/** Gerador padrão do processo. */
export const uuidv7 = createUuidV7();

export function isUuidV7(value: string): value is UuidV7 {
  return UUID_V7_PATTERN.test(value);
}

export function timestampMsFromUuidV7(value: string): number {
  if (!isUuidV7(value)) {
    throw new ValidationError('uuid.v7.invalido', 'identificador não é um UUIDv7', { length: value.length });
  }
  return Number.parseInt(value.replace(/-/g, '').slice(0, 12), 16);
}
