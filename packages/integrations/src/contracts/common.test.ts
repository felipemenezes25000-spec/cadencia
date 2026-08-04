import { describe, expect, it } from 'vitest';
import { isRetryable, failure, success, asE164, asRfc3339 } from './common';

describe('contrato comum de provedor', () => {
  it('unavailable e a UNICA falha com retry automatico', () => {
    expect(isRetryable(failure({ kind: 'unavailable', retrySafe: true, detail: 'psc fora' }))).toBe(true);
  });

  it('timeout NUNCA gera retry — o estado do parceiro e DESCONHECIDO', () => {
    expect(isRetryable(failure({ kind: 'timeout', retrySafe: false, detail: '3s' }))).toBe(false);
  });

  it('rejected, misconfigured e unsupported tambem nao', () => {
    for (const kind of ['rejected', 'misconfigured', 'unsupported'] as const) {
      const f = kind === 'rejected'
        ? failure({ kind, retrySafe: false, code: 'E1', detail: 'x' })
        : failure({ kind, retrySafe: false, detail: 'x' });
      expect(isRetryable(f), kind).toBe(false);
    }
  });

  it('sucesso carrega a referencia do parceiro', () => {
    const r = success({ ok: 1 }, 'ref-123');
    expect(r).toEqual({ ok: true, value: { ok: 1 }, providerRef: 'ref-123' });
  });

  it('E164 recusa telefone sem o codigo do pais', () => {
    expect(asE164('11987654321')).toBeNull();
    expect(asE164('+5511987654321')).toBe('+5511987654321');
  });

  it('Rfc3339 exige milissegundos e Z — o carimbo do parceiro nunca vem em horario local', () => {
    expect(asRfc3339('2026-08-03T17:30:00Z')).toBeNull();
    expect(asRfc3339('2026-08-03T17:30:00.000Z')).toBe('2026-08-03T17:30:00.000Z');
  });
});
