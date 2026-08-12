import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient, catalogPool, closeCatalogPool } from './invariants/catalog';
import { runAllInvariants } from './invariants/index';

/**
 * pnpm db:invariants              — os 9 invariantes de catálogo, só leitura
 * pnpm db:invariants --with-crud  — mais a matriz CRUD cruzada (semeia dois tenants de sonda)
 */
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const comCrud = process.argv.includes('--with-crud');
const api = comCrud ? await apiClient() : undefined;

try {
  const resultados = await runAllInvariants(catalogPool(), api ? { api } : {});

  for (const r of resultados) {
    const rotulo = r.skipped ? 'PULADO' : r.violations.length === 0 ? 'OK' : 'REPROVA';
    console.log(`#${String(r.number).padStart(2, '0')} ${rotulo.padEnd(7)} ${r.name} — ${r.detail}`);
    for (const v of r.violations) {
      console.error(`        ${v}`);
    }
  }

  const reprovados = resultados.filter((r) => r.violations.length > 0);
  if (reprovados.length > 0) {
    console.error(
      `\n${reprovados.length} invariante(s) reprovado(s). Nenhum deles se conserta editando o teste: ` +
        'a correcao e na migration que criou a relacao, o GRANT ou a policy.',
    );
    process.exitCode = 1;
  } else {
    console.log('\ntodos os invariantes da §3.13 verdes');
  }
} finally {
  await api?.end();
  await closeCatalogPool();
}
