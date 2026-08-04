import { describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { randomBytes } from 'node:crypto';
import {
  newTotpSecret, totpUri, verifyTotpAgainstStep, encryptTotpSecret, decryptTotpSecret,
  TOTP_PERIOD_SECONDS,
} from './totp';

function codigoEm(secretBase32: string, at: Date): string {
  return new TOTP({
    issuer: 'Cadencia', label: 'teste', algorithm: 'SHA1', digits: 6,
    period: TOTP_PERIOD_SECONDS, secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: at.getTime() });
}

describe('TOTP', () => {
  const agora = new Date('2026-08-03T14:00:00.000Z');

  it('aceita o codigo do passo atual', () => {
    const secret = newTotpSecret();
    const r = verifyTotpAgainstStep(secret, codigoEm(secret, agora), agora, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(Math.floor(agora.getTime() / 1000 / TOTP_PERIOD_SECONDS));
  });

  it('aceita o codigo do passo anterior: o celular do medico atrasa alguns segundos', () => {
    const secret = newTotpSecret();
    const trintaSegundosAntes = new Date(agora.getTime() - 30_000);
    const r = verifyTotpAgainstStep(secret, codigoEm(secret, trintaSegundosAntes), agora, null);
    expect(r.ok).toBe(true);
  });

  it('recusa codigo de dois minutos atras', () => {
    const secret = newTotpSecret();
    const doisMinutosAntes = new Date(agora.getTime() - 120_000);
    const r = verifyTotpAgainstStep(secret, codigoEm(secret, doisMinutosAntes), agora, null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('codigo_invalido');
  });

  it('recusa o mesmo codigo usado duas vezes: quem leu por cima do ombro nao entra', () => {
    const secret = newTotpSecret();
    const codigo = codigoEm(secret, agora);
    const primeira = verifyTotpAgainstStep(secret, codigo, agora, null);
    expect(primeira.ok).toBe(true);
    if (!primeira.ok) return;

    const segunda = verifyTotpAgainstStep(secret, codigo, agora, primeira.value);
    expect(segunda.ok).toBe(false);
    if (segunda.ok) return;
    expect(segunda.error).toBe('codigo_reutilizado');
  });

  it('recusa codigo com formato invalido sem lancar excecao', () => {
    const secret = newTotpSecret();
    for (const lixo of ['', '12345', 'abcdef', '1234567']) {
      const r = verifyTotpAgainstStep(secret, lixo, agora, null);
      expect(r.ok).toBe(false);
    }
  });

  it('a URI de cadastro identifica o emissor e a conta', () => {
    const secret = newTotpSecret();
    const uri = totpUri('ana.ribeiro@clinica.com.br', secret);
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=Cadencia');
    expect(uri).toContain('period=30');
  });

  it('o segredo e cifrado antes de ir para o banco e volta identico', () => {
    const key = randomBytes(32);
    const secret = newTotpSecret();
    const blob = encryptTotpSecret(secret, key);
    expect(blob.toString('utf8')).not.toContain(secret);
    expect(decryptTotpSecret(blob, key)).toBe(secret);
  });

  it('segredo cifrado com outra chave nao decifra', () => {
    const blob = encryptTotpSecret(newTotpSecret(), randomBytes(32));
    expect(() => decryptTotpSecret(blob, randomBytes(32))).toThrow();
  });
});
