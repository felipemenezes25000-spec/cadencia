import { describe, expect, it } from 'vitest';
import { TENANT_SCHEMAS } from './catalog';

describe('catalogo de schemas multi-tenant', () => {
  it('inv pertence ao regime multi-tenant desde a Fase 3', () => {
    expect(TENANT_SCHEMAS).toContain('inv');
  });

  it('rpt NAO pertence — matviews usam isolamento por view security_barrier, nao RLS', () => {
    expect(TENANT_SCHEMAS).not.toContain('rpt');
  });

  it('msg pertence ao regime multi-tenant desde a Fase 2', () => {
    expect(TENANT_SCHEMAS).toContain('msg');
  });

  it('fin pertence ao regime multi-tenant desde a Fase 0 (vazio ate a Fase 2)', () => {
    expect(TENANT_SCHEMAS).toContain('fin');
  });

  it('os schemas das Fases 0 e 1 continuam presentes', () => {
    for (const s of ['app', 'clin', 'tiss', 'audit', 'sched']) {
      expect(TENANT_SCHEMAS).toContain(s);
    }
  });

  it('a lista tem exatamente 8 schemas na Fase 3', () => {
    expect(TENANT_SCHEMAS).toHaveLength(8);
  });
});
