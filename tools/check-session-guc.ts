import { resolve } from 'node:path';
import { findSessionGucViolations } from './session-guc';

const root = resolve(import.meta.dirname, '..');
const violations = findSessionGucViolations(root);

if (violations.length === 0) {
  console.log('lint:session-guc — nenhuma ocorrencia de `SET app.` fora de packages/db/src/tx.ts');
  process.exit(0);
}

console.error(
  'lint:session-guc — `SET app.` so pode existir em packages/db/src/tx.ts.\n' +
    'Escopo de sessao sobrevive a devolucao da conexao ao PgBouncer e vaza o tenant\n' +
    'anterior para a requisicao seguinte. Use withTenantTx.\n',
);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
process.exit(1);
