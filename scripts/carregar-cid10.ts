/**
 * Carrega o CSV oficial de subcategorias da CID-10 publicado pelo DATASUS.
 *
 * Fonte: https://www2.datasus.gov.br/cid10/V2008/download.htm
 * Arquivo esperado depois de extrair CID10CSV.ZIP:
 *   CID-10-SUBCATEGORIAS.CSV
 *
 * O arquivo oficial usa Windows-1252 e ponto-e-vírgula. A carga é transacional:
 * uma linha inválida ou uma vigência sobreposta desfaz a competência inteira.
 *
 * Uso:
 *   pnpm cid10:load -- --arquivo /dados/CID-10-SUBCATEGORIAS.CSV
 *
 * Opções:
 *   --competencia 200801
 *   --vigencia-de 2008-01-01
 *   --vigencia-ate AAAA-MM-DD
 *   --dry-run
 */
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { loadCid10Competencia, parseCid10Csv } from '@cadencia/catalogs';

interface Opcoes {
  readonly arquivo: string;
  readonly competencia: string;
  readonly vigenciaDe: string;
  readonly vigenciaAte: string | null;
  readonly dryRun: boolean;
}

function valorDepois(argv: readonly string[], chave: string): string | undefined {
  const indice = argv.indexOf(chave);
  return indice >= 0 ? argv[indice + 1] : undefined;
}

function lerOpcoes(argv: readonly string[]): Opcoes {
  const arquivo = valorDepois(argv, '--arquivo') ?? process.env['CID10_CSV_PATH'];
  if (!arquivo) throw new Error('--arquivo ou CID10_CSV_PATH é obrigatório');
  const competencia = valorDepois(argv, '--competencia') ?? '200801';
  const vigenciaDe = valorDepois(argv, '--vigencia-de') ?? '2008-01-01';
  const vigenciaAte = valorDepois(argv, '--vigencia-ate') ?? null;
  if (!/^\d{6}$/.test(competencia)) throw new Error('--competencia deve usar AAAAMM');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenciaDe)) throw new Error('--vigencia-de deve usar AAAA-MM-DD');
  if (vigenciaAte !== null && !/^\d{4}-\d{2}-\d{2}$/.test(vigenciaAte)) {
    throw new Error('--vigencia-ate deve usar AAAA-MM-DD');
  }
  return { arquivo, competencia, vigenciaDe, vigenciaAte, dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const opcoes = lerOpcoes(process.argv.slice(2));
  const bytes = await readFile(opcoes.arquivo);
  const csv = new TextDecoder('windows-1252').decode(bytes);
  const linhas = parseCid10Csv(csv);

  // O arquivo oficial possui milhares de subcategorias. Este gate impede que
  // uma planilha parcial seja promovida sem querer a fonte clínica completa.
  if (linhas.length < 10_000) {
    throw new Error(`arquivo incompleto: somente ${linhas.length} termos válidos (mínimo 10000)`);
  }
  process.stdout.write(`CID-10 ${opcoes.competencia}: ${linhas.length} termos validados.\n`);
  if (opcoes.dryRun) {
    process.stdout.write('[dry-run] nada gravado.\n');
    return;
  }

  const url = process.env['DATABASE_URL_JOBS'] ?? process.env['DATABASE_URL_ADMIN'];
  if (!url) throw new Error('DATABASE_URL_JOBS ou DATABASE_URL_ADMIN ausente');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const existente = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM ref.cid10_term WHERE competencia = $1`,
      [opcoes.competencia]);
    if ((existente.rows[0]?.total ?? 0) > 0) {
      process.stdout.write(`CID-10 ${opcoes.competencia} já carregada; nenhuma alteração.\n`);
      return;
    }
    const total = await loadCid10Competencia(pool, {
      competencia: opcoes.competencia,
      vigenciaFrom: opcoes.vigenciaDe,
      vigenciaTo: opcoes.vigenciaAte,
      rows: linhas,
    });
    process.stdout.write(`CID-10 ${opcoes.competencia}: ${total} termos carregados.\n`);
  } finally {
    await pool.end();
  }
}

main().catch((erro: unknown) => {
  process.stderr.write(`falhou: ${(erro as Error).message}\n`);
  process.exitCode = 1;
});
