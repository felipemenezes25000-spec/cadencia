import type { Client } from 'pg';
import { readRelations, rlsViolations } from './inv01-rls';
import { fkViolations, orphanIdColumns, readForeignKeys } from './inv02-fk';
import { forbiddenGrantViolations, roleViolations } from './inv03-roles';
import { appendOnlyViolations, restrictivePolicyViolations } from './inv04-append-only';
import { diffDeclaredGrants, readDeclaredGrants, readEffectiveGrants } from './inv07-privileges';
import { ddlLintViolations } from './inv08-ddl-lint';
import { auditAliveViolations } from './inv09-audit-alive';
import { crudViolations, readCrudTargets, runCrudMatrix } from './inv10-crud-matrix';
import { CRUD_TENANT_A, CRUD_TENANT_B, seedTwoTenants } from './fixtures';
import type { Queryable } from '../queryable';

export interface InvariantResult {
  number: number;
  name: string;
  skipped: boolean;
  detail: string;
  violations: string[];
}

export interface RunInvariantsOptions {
  /**
   * Conexão do papel `api`. Sem ela o invariante 10 é PULADO: a matriz cruzada
   * semeia dois tenants de sonda, e semear não é coisa que se faz em produção sem
   * quem executa ter pedido.
   */
  api?: Client;
  /** Defasagem máxima da trilha, em minutos (invariante 9). */
  auditMaxLagMinutes?: number;
}

function ok(number: number, name: string, violations: string[]): InvariantResult {
  return {
    number,
    name,
    skipped: false,
    detail: violations.length === 0 ? 'sem violacao' : `${violations.length} violacao(oes)`,
    violations,
  };
}

/**
 * Os 10 invariantes da §3.13 contra QUALQUER banco: o local, o do CI, o staging e o
 * restaurado pelo ensaio da Task 48. Os nove primeiros só leem catálogo — nenhum
 * deles escreve linha nenhuma.
 */
export async function runAllInvariants(
  db: Queryable,
  opts: RunInvariantsOptions = {},
): Promise<InvariantResult[]> {
  const resultados: InvariantResult[] = [];

  resultados.push(ok(1, 'RLS habilitada, forcada e com policy', rlsViolations(await readRelations(db))));
  resultados.push(
    ok(2, 'FK composta e nenhuma coluna *_id orfa', [
      ...fkViolations(await readForeignKeys(db)),
      ...(await orphanIdColumns(db)),
    ]),
  );
  resultados.push(ok(3, 'api sem posse, jobs e rpt_owner com BYPASSRLS', await roleViolations(db)));
  resultados.push(ok(4, 'append-only clinico', await appendOnlyViolations(db)));
  resultados.push(ok(5, 'policy RESTRICTIVE no nucleo clinico', await restrictivePolicyViolations(db)));
  resultados.push(ok(6, 'nenhum GRANT direto na trilha nem em rpt', await forbiddenGrantViolations(db)));
  resultados.push(
    ok(7, 'privilegios afirmados tabela a tabela', diffDeclaredGrants(await readEffectiveGrants(db), readDeclaredGrants())),
  );
  resultados.push(ok(8, 'lint de DDL', await ddlLintViolations(db)));
  resultados.push(
    ok(
      9,
      'trilha viva',
      await auditAliveViolations(
        db,
        opts.auditMaxLagMinutes === undefined ? {} : { maxLagMinutes: opts.auditMaxLagMinutes },
      ),
    ),
  );

  if (!opts.api) {
    resultados.push({
      number: 10,
      name: 'matriz CRUD cruzada',
      skipped: true,
      detail: 'pulado: exige conexao do papel api (rode com --with-crud)',
      violations: [],
    });
    return resultados;
  }

  await seedTwoTenants(db);
  const alvos = await readCrudTargets(db);
  const celulas = await runCrudMatrix(opts.api, alvos, CRUD_TENANT_A, CRUD_TENANT_B);
  const violacoes = crudViolations(celulas);
  resultados.push({
    number: 10,
    name: 'matriz CRUD cruzada',
    skipped: false,
    detail: `${celulas.length} celulas em ${alvos.length} relacoes`,
    violations: violacoes,
  });

  return resultados;
}
