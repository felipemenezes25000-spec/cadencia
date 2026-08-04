import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, needsRehash } from './password';

describe('hash de senha com Argon2id', () => {
  it('aceita a senha correta e recusa a errada', async () => {
    const hash = await hashPassword('Consultorio#2026');
    await expect(verifyPassword(hash, 'Consultorio#2026')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'consultorio#2026')).resolves.toBe(false);
    await expect(verifyPassword(hash, '')).resolves.toBe(false);
  });

  it('grava um hash Argon2id parametrizado e nunca a senha em claro', async () => {
    const hash = await hashPassword('Consultorio#2026');
    expect(hash).not.toContain('Consultorio');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  });

  it('duas gravacoes da mesma senha produzem hashes diferentes (salt por linha)', async () => {
    const a = await hashPassword('Consultorio#2026');
    const b = await hashPassword('Consultorio#2026');
    expect(a).not.toEqual(b);
    await expect(verifyPassword(a, 'Consultorio#2026')).resolves.toBe(true);
    await expect(verifyPassword(b, 'Consultorio#2026')).resolves.toBe(true);
  });

  it('senha com acento digitada em teclado que compoe o acento (NFD) continua autenticando', async () => {
    // Caso real: a recepcionista cadastra "Recepcao@2026" com acento no Windows (NFC)
    // e entra pelo macOS, onde o navegador entrega a forma decomposta (NFD).
    const nfc = 'Recep\u00e7\u00e3o@2026';
    const nfd = 'Recepc\u0327a\u0303o@2026';
    expect(nfc).not.toEqual(nfd);
    const hash = await hashPassword(nfc);
    await expect(verifyPassword(hash, nfd)).resolves.toBe(true);
  });

  it('hash corrompido no banco falha fechado, sem lancar excecao', async () => {
    await expect(verifyPassword('$2y$10$hashDeOutroSistema', 'Consultorio#2026')).resolves.toBe(false);
    await expect(verifyPassword('', 'Consultorio#2026')).resolves.toBe(false);
  });

  it('hash de outro algoritmo ou de parametros antigos e marcado para rehash no proximo login', async () => {
    expect(needsRehash('$2y$10$hashDeOutroSistema')).toBe(true);
    expect(needsRehash('$argon2id$v=19$m=4096,t=3,p=1$abc$def')).toBe(true);
    expect(needsRehash(await hashPassword('Consultorio#2026'))).toBe(false);
  });
});
