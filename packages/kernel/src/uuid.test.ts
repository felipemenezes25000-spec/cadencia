import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { createUuidV7, isUuidV7, timestampMsFromUuidV7, uuidv7 } from './uuid';

const INSTANTE = 1767225600000; // 2026-01-01T00:00:00.000Z

describe('UUIDv7', () => {
  it('gera identificador no formato da RFC 9562, com versao 7 e variante RFC', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isUuidV7(id)).toBe(true);
  });

  it('carrega o instante da geracao nos 48 bits iniciais', () => {
    const next = createUuidV7();
    expect(timestampMsFromUuidV7(next(INSTANTE))).toBe(INSTANTE);
  });

  it('e monotonico dentro do mesmo milissegundo: 10 mil chaves geradas no mesmo instante saem em ordem crescente', () => {
    const next = createUuidV7();
    const ids: string[] = [];
    for (let i = 0; i < 10_000; i += 1) ids.push(next(INSTANTE));
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ordena lexicograficamente na mesma ordem do tempo: ordenar por id e ordenar por criacao', () => {
    const next = createUuidV7();
    const antes = next(INSTANTE);
    const depois = next(INSTANTE + 1000);
    expect(depois > antes).toBe(true);
    expect(timestampMsFromUuidV7(depois) - timestampMsFromUuidV7(antes)).toBe(1000);
  });

  it('continua crescente quando o relogio da maquina anda para tras (ajuste de NTP)', () => {
    const next = createUuidV7();
    const antes = next(INSTANTE);
    const depois = next(INSTANTE - 5000);
    expect(depois > antes).toBe(true);
    expect(timestampMsFromUuidV7(depois)).toBe(INSTANTE);
  });

  it('recusa string que nao e UUIDv7 — um UUIDv4, por exemplo — sem ecoar o valor recebido', () => {
    const uuidV4 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    expect(isUuidV7(uuidV4)).toBe(false);
    expect(() => timestampMsFromUuidV7(uuidV4)).toThrow(ValidationError);
    try {
      timestampMsFromUuidV7(uuidV4);
    } catch (error) {
      expect(JSON.stringify((error as ValidationError).toJSON())).not.toContain('9b1deb4d');
    }
  });
});
