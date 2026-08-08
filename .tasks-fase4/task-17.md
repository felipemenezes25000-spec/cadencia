### Task 17: Teste de isolamento — tiss.encounter_guia_consulta (inserir guia, unicidade, RLS)

**Arquivos**

- Criar: `packages/db/test/iso/31-guia-consulta.iso.test.ts`

**Passos**

- [ ] Criar o arquivo de teste `packages/db/test/iso/31-guia-consulta.iso.test.ts` que verifica:
  1. A tabela existe no schema `tiss` com as colunas do design.
  2. O indice unico parcial `ux_guia_live` impede duas guias vivas para o mesmo atendimento.
  3. O UNIQUE `(tenant_id, numero_guia_prestador)` garante unicidade do numero da guia por tenant.
  4. O CHECK `codigo_tabela <> '18'` rejeita a tabela 18.
  5. O CHECK `num_nonnulls(codigo_prestador_na_operadora, cpf_contratado, cnpj_contratado) = 1` exige exatamente um identificador.
  6. Sem coluna de CID (mesmo padrao do teste 18-encounter-billing).
  7. A FK composta para `clin.encounter_version(tenant_id, id)` existe.

```typescript
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient, comoAtor, erroPg } from './harness';
import type { IsoActor } from './harness';
import * as F from './fixtures';

describe('tiss.encounter_guia_consulta — guia de consulta TISS', () => {
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

  it('tabela existe no schema tiss com as colunas do design', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'encounter_guia_consulta'
        ORDER BY ordinal_position`,
    );
    const colunas = rows.map((r) => r.column_name);
    const esperadas = [
      'tenant_id', 'id', 'encounter_id', 'encounter_version_id',
      'operadora_id', 'registro_ans', 'numero_guia_prestador',
      'numero_guia_operadora', 'numero_carteira', 'atendimento_rn',
      'codigo_prestador_na_operadora', 'cpf_contratado', 'cnpj_contratado',
      'cnes', 'conselho_profissional', 'numero_conselho', 'uf_conselho',
      'cbos', 'indicacao_acidente', 'regime_atendimento',
      'saude_ocupacional', 'cobertura_especial', 'data_atendimento',
      'tipo_consulta', 'codigo_tabela', 'codigo_procedimento',
      'valor_procedimento', 'observacao', 'live', 'created_by', 'created_at',
    ];
    for (const col of esperadas) {
      expect(colunas, `falta coluna ${col}`).toContain(col);
    }
  });

  it('NAO tem coluna de CID — item 32 proibe a operadora de exigir CID na guia', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'encounter_guia_consulta'
          AND column_name ~* '(^|_)cid[0-9]*($|_)'`,
    );
    expect(rows).toEqual([]);
  });

  it('ux_guia_live impede duas guias vivas para o mesmo atendimento', async () => {
    const erro = await erroPg(async () => {
      await comoAtor(rw, actorAna, async (c) => {
        // Inserir segunda guia viva para o mesmo encounter_id do seed
        await c.query(
          `INSERT INTO tiss.encounter_guia_consulta
             (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
              registro_ans, numero_guia_prestador, numero_carteira,
              atendimento_rn, codigo_prestador_na_operadora, cnes,
              conselho_profissional, numero_conselho, uf_conselho, cbos,
              indicacao_acidente, regime_atendimento, tipo_consulta,
              data_atendimento, codigo_tabela, codigo_procedimento,
              valor_procedimento, live, created_by)
           VALUES ($1, gen_random_uuid(), $2, $3, $4,
                   '326305', '999', '00998877665544',
                   false, '900123', '2077485',
                   '06', '123456', 'SP', '225125',
                   '9', '01', '1',
                   DATE '2026-08-01', '22', '10101012',
                   250.00, true, $5)`,
          [F.TENANT_A, F.ENCOUNTER_A_JOANA, F.VERSION_A_JOANA_ORIGINAL,
           F.OPERADORA_A, F.USER_A_ANA],
        );
      });
    });
    // 23505 = unique_violation
    expect(erro.code).toBe('23505');
    expect(erro.message).toContain('ux_guia_live');
  });

  it('UNIQUE (tenant_id, numero_guia_prestador) garante unicidade do numero da guia', async () => {
    const erro = await erroPg(async () => {
      await comoAtor(rw, actorAna, async (c) => {
        // Tentar inserir guia com o mesmo numero_guia_prestador do seed ('1')
        // para um encounter diferente (que nao existe — vai falhar no UNIQUE antes do FK)
        await c.query(
          `INSERT INTO tiss.encounter_guia_consulta
             (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
              registro_ans, numero_guia_prestador, numero_carteira,
              atendimento_rn, codigo_prestador_na_operadora, cnes,
              conselho_profissional, numero_conselho, uf_conselho, cbos,
              indicacao_acidente, regime_atendimento, tipo_consulta,
              data_atendimento, codigo_tabela, codigo_procedimento,
              valor_procedimento, created_by)
           VALUES ($1, gen_random_uuid(), gen_random_uuid(), $2, $3,
                   '326305', '1', '00998877665544',
                   false, '900123', '2077485',
                   '06', '123456', 'SP', '225125',
                   '9', '01', '1',
                   DATE '2026-08-01', '22', '10101012',
                   250.00, $4)`,
          [F.TENANT_A, F.VERSION_A_JOANA_ORIGINAL, F.OPERADORA_A, F.USER_A_ANA],
        );
      });
    });
    // 23505 = unique_violation
    expect(erro.code).toBe('23505');
    expect(erro.message).toContain('numero_guia_prestador');
  });

  it('codigo_tabela <> 18 rejeita a tabela 18 (particular)', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'tiss.encounter_guia_consulta'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%codigo_tabela%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.def).toContain("<> '18'");
  });

  it('exige exatamente um identificador de prestador (codigo, cpf ou cnpj)', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'tiss.encounter_guia_consulta'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%num_nonnulls%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.def).toContain('num_nonnulls');
    expect(rows[0]?.def).toContain('1');
  });

  it('FK composta para clin.encounter_version(tenant_id, id) existe', async () => {
    const { rows } = await admin.query<{ conname: string }>(
      `SELECT con.conname
         FROM pg_constraint con
        WHERE con.conrelid = 'tiss.encounter_guia_consulta'::regclass
          AND con.confrelid = 'clin.encounter_version'::regclass
          AND con.contype = 'f'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('valor_procedimento e numeric(12,2), nunca bigint de centavos', async () => {
    const { rows } = await admin.query<{ data_type: string; numeric_precision: number; numeric_scale: number }>(
      `SELECT data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'encounter_guia_consulta'
          AND column_name = 'valor_procedimento'`,
    );
    expect(rows[0]?.data_type).toBe('numeric');
    expect(rows[0]?.numeric_precision).toBe(12);
    expect(rows[0]?.numeric_scale).toBe(2);
  });
});
```

- [ ] Rodar o teste:

```bash
pnpm test:iso -- --testPathPattern='31-guia-consulta'
# Esperado: 7 testes passando
```

---