import { describe, expect, it } from 'vitest';
import { TENANT_SCHEMAS } from './catalog';

describe('catalogo de schemas multi-tenant', () => {
  it('msg pertence ao regime multi-tenant desde a Fase 2', () => {
    expect(TENANT_SCHEMAS).toContain('msg');
  });

  it('fin pertence ao regime multi-tenant desde a Fase 0 (vazio ate a Fase 2)', () => {
    expect(TENANT_SCHEMAS).toContain('fin');
  });

  it('os schemas da Fase 1 continuam presentes', () => {
    for (const s of ['app', 'clin', 'tiss', 'audit', 'sched']) {
      expect(TENANT_SCHEMAS).toContain(s);
    }
  });
});
