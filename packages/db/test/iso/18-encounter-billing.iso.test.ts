import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient } from './harness';

/**
 * §3.9 e §8 — os ~14 campos da guia de consulta TISS, capturados NO ATENDIMENTO
 * desde a Fase 1. Sao leituras de catalogo puras, entao usam o cliente
 * administrativo direto, no mesmo espirito das suites 15, 16 e 17: nao ha linha
 * para isolar nem preambulo a aplicar. O isolamento da tabela e exercitado pela
 * suite 04, que descobre as tabelas multi-tenant do catalogo.
 */
const CAMPOS = [
  'registro_ans',
  'numero_carteira',
  'atendimento_rn',
  'cnes',
  'conselho_profissional',
  'numero_conselho',
  'uf_conselho',
  'cbos',
  'indicacao_acidente',
  'regime_atendimento',
  'tipo_consulta',
  'data_atendimento',
  'codigo_tabela',
  'codigo_procedimento',
  'valor_centavos',
];

describe('clin.encounter_billing — os ~14 campos da guia de consulta', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });

  afterAll(async () => {
    await admin.end();
  });

  it('captura todos os campos da guia desde a Fase 1', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='encounter_billing'`,
    );
    const presentes = new Set(rows.map((r) => r.column_name));
    for (const campo of CAMPOS) expect(presentes.has(campo), `falta ${campo}`).toBe(true);
  });

  it('NAO tem coluna de CID — item 32 proibe a operadora de exigir CID na guia', async () => {
    // O padrao delimita `cid` por inicio/fim de nome ou por underscore, em vez de
    // procurar a substring solta: `indicacao_acidente` contem "cid" no meio de
    // "acidente" e e campo legitimo da guia. O que nao pode existir e uma COLUNA
    // de CID — cid, cid10, cid_principal, codigo_cid.
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='encounter_billing'
          AND column_name ~* '(^|_)cid[0-9]*($|_)'`,
    );
    expect(rows).toEqual([]);

    // O padrao acima nao pode ser desdentado: se ele nao pegasse nem um nome de
    // coluna de CID, o teste passaria a toa em qualquer tabela.
    const { rows: pega } = await admin.query<{ nome: string }>(
      `SELECT nome FROM unnest(ARRAY['cid','cid10','cid_principal','codigo_cid','CID10']) AS nome
        WHERE nome ~* '(^|_)cid[0-9]*($|_)'`,
    );
    expect(pega.map((r) => r.nome)).toEqual(['cid', 'cid10', 'cid_principal', 'codigo_cid', 'CID10']);
  });

  it('cnes e NOT NULL e sem default — 9999999 vira lote glosado', async () => {
    const { rows } = await admin.query<{ is_nullable: string; column_default: string | null }>(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='encounter_billing' AND column_name='cnes'`,
    );
    expect(rows[0]).toEqual({ is_nullable: 'NO', column_default: null });
  });

  it('codigo_tabela nunca e 18 — tabela 18 e a de terminologia, nao de procedimento', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='clin.encounter_billing'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%codigo_tabela%'`,
    );
    expect(rows[0]?.def).toContain("<> '18'");
  });

  it('valor e bigint em CENTAVOS, nunca numeric com casas decimais soltas', async () => {
    const { rows } = await admin.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='encounter_billing' AND column_name='valor_centavos'`,
    );
    expect(rows[0]?.data_type).toBe('bigint');
  });
});
