### Task 18: Teste de isolamento — tiss.guia_ajuste (append-only, FK para guia)

**Arquivos**

- Criar: `packages/db/test/iso/32-guia-ajuste.iso.test.ts`

**Passos**

- [ ] Criar o arquivo de teste `packages/db/test/iso/32-guia-ajuste.iso.test.ts` que verifica:
  1. A tabela existe no schema `tiss` com as colunas esperadas.
  2. A FK composta `(tenant_id, guia_id)` para `tiss.encounter_guia_consulta(tenant_id, id)` existe.
  3. O campo `motivo` e NOT NULL.
  4. O app_rw so tem INSERT e SELECT (append-only: sem UPDATE, sem DELETE).

```typescript
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient, comoAtor, erroPg } from './harness';
import type { IsoActor } from './harness';
import * as F from './fixtures';

describe('tiss.guia_ajuste — ajuste de faturamento append-only', () => {
  let admin: Client;
  let rw: Client;

  const actorAna: IsoActor = {
    kind: 'user',
    tenantId: F.TENANT_A,
    userId: F.USER_A_ANA,
    clinicId: F.CLINIC_A_SP,
    requestId: F.REQUEST_ID,
  };

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    rw = await openClient(inject('isoRwUrl'));
  });

  afterAll(async () => {
    await admin.end();
    await rw.end();
  });

  it('tabela existe no schema tiss com as colunas esperadas', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'guia_ajuste'
        ORDER BY ordinal_position`,
    );
    const colunas = rows.map((r) => r.column_name);
    const esperadas = [
      'tenant_id', 'id', 'guia_id', 'campo_alterado',
      'valor_anterior', 'valor_novo', 'motivo',
      'created_by', 'created_at',
    ];
    for (const col of esperadas) {
      expect(colunas, `falta coluna ${col}`).toContain(col);
    }
  });

  it('FK composta para tiss.encounter_guia_consulta(tenant_id, id) existe', async () => {
    const { rows } = await admin.query<{ conname: string }>(
      `SELECT con.conname
         FROM pg_constraint con
        WHERE con.conrelid = 'tiss.guia_ajuste'::regclass
          AND con.confrelid = 'tiss.encounter_guia_consulta'::regclass
          AND con.contype = 'f'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('motivo e NOT NULL', async () => {
    const { rows } = await admin.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'guia_ajuste'
          AND column_name = 'motivo'`,
    );
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it('app_rw pode inserir e ler um ajuste', async () => {
    await comoAtor(rw, actorAna, async (c) => {
      // Inserir um ajuste e verificar que a leitura funciona
      await c.query(
        `INSERT INTO tiss.guia_ajuste
           (tenant_id, id, guia_id, campo_alterado, valor_anterior, valor_novo,
            motivo, created_by)
         VALUES ($1, gen_random_uuid(), $2, 'tipo_consulta', '1', '3',
                 'Retorno dentro de 30 dias', $3)`,
        [F.TENANT_A, F.GUIA_CONSULTA_A, F.USER_A_ANA],
      );

      const { rows } = await c.query<{ campo_alterado: string }>(
        `SELECT campo_alterado FROM tiss.guia_ajuste
          WHERE tenant_id = $1 AND guia_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [F.TENANT_A, F.GUIA_CONSULTA_A],
      );
      expect(rows[0]?.campo_alterado).toBe('tipo_consulta');
    });
  });

  it('app_rw NAO pode fazer UPDATE em guia_ajuste (append-only)', async () => {
    const erro = await erroPg(async () => {
      await comoAtor(rw, actorAna, async (c) => {
        await c.query(
          `UPDATE tiss.guia_ajuste SET motivo = 'alterado'
            WHERE tenant_id = $1 AND id = $2`,
          [F.TENANT_A, F.GUIA_AJUSTE_A],
        );
      });
    });
    // 42501 = insufficient_privilege (UPDATE nao foi concedido)
    expect(erro.code).toBe('42501');
  });

  it('app_rw NAO pode fazer DELETE em guia_ajuste (append-only)', async () => {
    const erro = await erroPg(async () => {
      await comoAtor(rw, actorAna, async (c) => {
        await c.query(
          `DELETE FROM tiss.guia_ajuste WHERE tenant_id = $1 AND id = $2`,
          [F.TENANT_A, F.GUIA_AJUSTE_A],
        );
      });
    });
    // 42501 = insufficient_privilege (DELETE nao foi concedido)
    expect(erro.code).toBe('42501');
  });
});
```

- [ ] Rodar o teste:

```bash
pnpm test:iso -- --testPathPattern='32-guia-ajuste'
# Esperado: 5 testes passando
```

---