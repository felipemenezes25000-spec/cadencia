import { createHash } from 'node:crypto';
import { ValidationError } from './errors';

/**
 * Serializacao canonica JCS (RFC 8785) + pre-normalizacao Unicode NFC.
 *
 * ESTA VERSAO NUNCA MUDA. O content_hash de clin.encounter_version e a
 * assinatura ICP-Brasil cobrem exatamente estes bytes, e o acervo tem guarda
 * de 20 anos. Se um dia for preciso outro comportamento, cria-se 'jcs-2' e o
 * verificador de 'jcs-1' permanece no repositorio para sempre.
 */
export const CANONICAL_VERSION = 'jcs-1';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ValidationError('canonical.numero_nao_finito', 'NaN e Infinity nao existem em JSON');
  }
  // RFC 8785: formato Number::toString do ECMAScript. -0 serializa como 0.
  if (Object.is(value, -0)) return '0';
  return String(value);
}

function serializeString(value: string): string {
  let out = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    switch (code) {
      case 0x08: out += '\\b'; break;
      case 0x09: out += '\\t'; break;
      case 0x0a: out += '\\n'; break;
      case 0x0c: out += '\\f'; break;
      case 0x0d: out += '\\r'; break;
      case 0x22: out += '\\"'; break;
      case 0x5c: out += '\\\\'; break;
      default:
        // Escape minimo: fora dos controles, o caractere sai literal em UTF-8.
        out += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : value[index];
    }
  }
  return `${out}"`;
}

function serialize(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return serializeNumber(value);
  if (typeof value === 'string') return serializeString(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;

  if (typeof value === 'object') {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ValidationError('canonical.tipo_nao_serializavel', 'so objeto simples entra na serializacao canonica');
    }
    const entries: [string, JsonValue][] = [];
    const seen = new Set<string>();
    for (const [rawKey, rawValue] of Object.entries(value)) {
      if (rawValue === undefined) {
        throw new ValidationError('canonical.valor_indefinido', 'campo undefined sumiria do hash em silencio', { key: rawKey });
      }
      const key = rawKey.normalize('NFC');
      if (seen.has(key)) {
        throw new ValidationError('canonical.chave_duplicada', 'duas chaves viram a mesma apos normalizacao NFC', { key });
      }
      seen.add(key);
      entries.push([key, rawValue]);
    }
    // RFC 8785: ordem por unidade de codigo UTF-16 da chave ja normalizada.
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `{${entries.map(([key, item]) => `${serializeString(key)}:${serialize(item)}`).join(',')}}`;
  }

  throw new ValidationError('canonical.tipo_nao_serializavel', 'valor nao e representavel em JSON');
}

export function canonicalize(value: JsonValue): string {
  return serialize(value);
}

export function canonicalBytes(value: JsonValue): Buffer {
  return Buffer.from(canonicalize(value), 'utf8');
}

/** SHA-256 dos bytes canonicos: 32 bytes, o mesmo que vai em content_hash bytea. */
export function canonicalHash(value: JsonValue): Buffer {
  return createHash('sha256').update(canonicalBytes(value)).digest();
}

export function canonicalHashHex(value: JsonValue): string {
  return canonicalHash(value).toString('hex');
}
