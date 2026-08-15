import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export function aes256KeyFromBase64(value: string, nome = 'chave'): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`${nome} tem ${key.length} bytes; AES-256-GCM exige ${KEY_BYTES}`);
  }
  return key;
}

/** AES-256-GCM: [12 bytes IV][16 bytes auth tag][ciphertext]. */
export function sealSecret(value: string, key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) throw new Error('sealSecret: chave AES-256 invalida');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function openSecret(blob: Buffer, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new Error('openSecret: chave AES-256 invalida');
  if (blob.length < IV_BYTES + TAG_BYTES) throw new Error('openSecret: ciphertext truncado');
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
