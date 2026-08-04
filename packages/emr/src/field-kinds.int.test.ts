import { afterAll, describe, expect, it } from 'vitest';
import { appPool, closePools } from '@cadencia/db';
import { FIELD_KIND_LIST } from './field-kinds';

describe('clin.field_kind × FIELD_KIND_LIST', () => {
  afterAll(async () => { await closePools(); });

  it('o enum do banco e o mapa do TypeScript tem exatamente os mesmos rotulos', async () => {
    const { rows } = await appPool().query<{ label: string }>(
      `SELECT e.enumlabel AS label
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'clin' AND t.typname = 'field_kind'
        ORDER BY e.enumsortorder`,
    );
    expect(rows.map((r) => r.label)).toEqual([...FIELD_KIND_LIST]);
  });
});
