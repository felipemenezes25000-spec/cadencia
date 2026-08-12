/**
 * pnpm restore:drill — restaura o snapshot automático mais recente numa VPC ISOLADA,
 * roda verify-restore e os 10 invariantes, grava o relatório e destrói a instância.
 *
 * A VPC isolada não é zelo: restaurar ao lado da produção coloca um endpoint quase
 * idêntico ao lado do verdadeiro, e o erro de digitação escreve no banco vivo.
 *
 * O relógio aqui MEDE (performance.now) e carimba um relatório operacional. Nada
 * disto vira dado de domínio: o carimbo persistido vem sempre do PostgreSQL.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DeleteDBInstanceCommand,
  DescribeDBInstancesCommand,
  DescribeDBSnapshotsCommand,
  RDSClient,
  RestoreDBInstanceFromDBSnapshotCommand,
  waitUntilDBInstanceAvailable,
} from '@aws-sdk/client-rds';
import { Client } from 'pg';
import { runAllInvariants, type InvariantResult } from '../packages/db/src/invariants/index';
import { verifyRestore, type CheckResult } from '../packages/db/src/verify-restore';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

const REGION = process.env.AWS_REGION ?? 'sa-east-1';
const SOURCE_INSTANCE = requireEnv('DRILL_SOURCE_DB_INSTANCE');
const SUBNET_GROUP = requireEnv('DRILL_SUBNET_GROUP');
const SECURITY_GROUP = requireEnv('DRILL_SECURITY_GROUP');
const DB_USER = requireEnv('DRILL_DB_USER');
const DB_PASSWORD = requireEnv('DRILL_DB_PASSWORD');
const RTO_BUDGET_MINUTES = Number(process.env.DRILL_RTO_BUDGET_MINUTES ?? '120');
const RPO_BUDGET_MINUTES = Number(process.env.DRILL_RPO_BUDGET_MINUTES ?? '15');

const rds = new RDSClient({ region: REGION });
const stamp = new Date().toISOString().slice(0, 10);
const target = `cadencia-restore-drill-${stamp}`;

async function latestSnapshot(): Promise<string> {
  const { DBSnapshots = [] } = await rds.send(
    new DescribeDBSnapshotsCommand({ DBInstanceIdentifier: SOURCE_INSTANCE, SnapshotType: 'automated' }),
  );
  const maisNovo = DBSnapshots.filter((s) => s.Status === 'available').sort(
    (a, b) => (b.SnapshotCreateTime?.getTime() ?? 0) - (a.SnapshotCreateTime?.getTime() ?? 0),
  )[0];
  if (!maisNovo?.DBSnapshotIdentifier) {
    throw new Error(`nenhum snapshot disponivel para ${SOURCE_INSTANCE}`);
  }
  return maisNovo.DBSnapshotIdentifier;
}

async function restore(snapshotId: string): Promise<string> {
  await rds.send(
    new RestoreDBInstanceFromDBSnapshotCommand({
      DBInstanceIdentifier: target,
      DBSnapshotIdentifier: snapshotId,
      DBSubnetGroupName: SUBNET_GROUP,
      VpcSecurityGroupIds: [SECURITY_GROUP],
      PubliclyAccessible: false,
      MultiAZ: false,
      DeletionProtection: false,
      Tags: [
        { Key: 'cadencia:purpose', Value: 'restore-drill' },
        { Key: 'cadencia:ephemeral', Value: 'true' },
      ],
    }),
  );

  await waitUntilDBInstanceAvailable(
    { client: rds, maxWaitTime: RTO_BUDGET_MINUTES * 60 },
    { DBInstanceIdentifier: target },
  );

  const { DBInstances = [] } = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: target }));
  const endpoint = DBInstances[0]?.Endpoint;
  if (!endpoint?.Address) throw new Error('instancia restaurada sem endpoint');
  return `postgres://${DB_USER}:${encodeURIComponent(DB_PASSWORD)}@${endpoint.Address}:${endpoint.Port ?? 5432}/cadencia`;
}

async function destroy(): Promise<void> {
  await rds
    .send(
      new DeleteDBInstanceCommand({
        DBInstanceIdentifier: target,
        SkipFinalSnapshot: true,
        DeleteAutomatedBackups: true,
      }),
    )
    .catch((error: Error) => console.error(`falha ao destruir ${target}: ${error.message}`));
}

async function main(): Promise<void> {
  const inicio = performance.now();
  let checks: CheckResult[] = [];
  let invariantes: InvariantResult[] = [];
  let erro: string | undefined;

  try {
    const snapshotId = await latestSnapshot();
    console.log(`snapshot: ${snapshotId} -> instancia ${target} (VPC isolada, sem acesso publico)`);
    const url = await restore(snapshotId);

    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
    await client.connect();
    try {
      checks = await verifyRestore(client, { rpoMinutes: RPO_BUDGET_MINUTES });
      // Restauração que devolve os bytes e perde FORCE ROW LEVEL SECURITY só se
      // descobre errada no dia em que o backup for usado de verdade.
      invariantes = await runAllInvariants(client, { auditMaxLagMinutes: RPO_BUDGET_MINUTES });
    } finally {
      await client.end();
    }
  } catch (e) {
    erro = (e as Error).message;
  } finally {
    await destroy();
  }

  const minutos = Math.round((performance.now() - inicio) / 60_000);
  const rtoOk = minutos <= RTO_BUDGET_MINUTES;
  const checksReprovados = checks.filter((c) => !c.ok && !c.skipped);
  const invariantesReprovados = invariantes.filter((i) => i.violations.length > 0);

  const relatorio = {
    executadoEm: new Date().toISOString(),
    instancia: target,
    rtoMinutos: minutos,
    rtoOrcamentoMinutos: RTO_BUDGET_MINUTES,
    rtoOk,
    erro: erro ?? null,
    checks,
    invariantes,
  };

  mkdirSync(join(process.cwd(), '.artifacts'), { recursive: true });
  writeFileSync(
    join(process.cwd(), '.artifacts', `restore-drill-${stamp}.json`),
    `${JSON.stringify(relatorio, null, 2)}\n`,
  );
  console.log(JSON.stringify(relatorio, null, 2));

  if (erro || !rtoOk || checksReprovados.length > 0 || invariantesReprovados.length > 0) {
    console.error(
      `ENSAIO REPROVADO — ${erro ?? ''} ${checksReprovados.map((c) => `${c.name}: ${c.detail}`).join(' · ')} ` +
        `${invariantesReprovados.map((i) => `#${i.number} ${i.name}`).join(' · ')}`.trim(),
    );
    process.exitCode = 1;
  } else {
    console.log(`ENSAIO APROVADO em ${minutos} min`);
  }
}

await main();
