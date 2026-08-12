// tools/check-route-reachability.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/* ── Routes from Next.js App Router ──────────────────────────────────── */

function coletarRotas(dir: string, base = ''): string[] {
  const rotas: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    const stat = statSync(caminho);
    if (stat.isDirectory()) {
      const segmento = nome.startsWith('(') && nome.endsWith(')') ? '' : nome;
      const proximaBase = segmento === '' ? base : (base ? `${base}/${segmento}` : `/${segmento}`);
      rotas.push(...coletarRotas(caminho, proximaBase));
    } else if (nome === 'page.tsx') {
      rotas.push(base || '/');
    }
  }
  return rotas;
}

/* ── Navigation graph hrefs ──────────────────────────────────────────── */

function normalizarDestino(destino: string): string | null {
  if (!destino.startsWith('/') || destino.startsWith('//')) return null;
  if (destino.startsWith('/v1/') || destino.startsWith('/api/')) return null;
  const pathname = destino.split(/[?#]/, 1)[0] ?? '/';
  return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
}

function extrairDestinos(arquivo: string): Set<string> {
  const conteudo = readFileSync(arquivo, 'utf-8');
  const destinos = new Set<string>();
  const padroes = [
    /href[=:]\s*['"]([^'"]+)['"]/g,
    /router\.(?:push|replace)\(\s*['"]([^'"]+)['"]/g,
    /window\.location\.href\s*=\s*['"]([^'"]+)['"]/g,
  ];

  for (const padrao of padroes) {
    for (const match of conteudo.matchAll(padrao)) {
      const normalizado = normalizarDestino(match[1]!);
      if (normalizado) destinos.add(normalizado);
    }
  }
  return destinos;
}

function coletarArquivosDeCodigo(dir: string): string[] {
  const arquivos: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === '.next') continue;
    const caminho = join(dir, nome);
    const stat = statSync(caminho);
    if (stat.isDirectory()) {
      arquivos.push(...coletarArquivosDeCodigo(caminho));
    } else if (['.ts', '.tsx'].includes(extname(nome)) && !nome.endsWith('.test.ts') && !nome.endsWith('.test.tsx')) {
      arquivos.push(caminho);
    }
  }
  return arquivos;
}

function escaparRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rotaAceitaDestino(rota: string, destino: string): boolean {
  if (!rota.includes('[')) return rota === destino;
  const partes = rota.split('/').filter(Boolean);
  const regex = partes.map((parte) => {
    if (parte.startsWith('[[...') && parte.endsWith(']]')) return '(?:.+)?';
    if (parte.startsWith('[...') && parte.endsWith(']')) return '.+';
    if (parte.startsWith('[') && parte.endsWith(']')) return '[^/]+';
    return escaparRegex(parte);
  }).join('/');
  return new RegExp(`^/${regex}$`).test(destino);
}

/* ── Declared exceptions ─────────────────────────────────────────────── */

const EXCECOES: Record<string, string> = {
  '/': 'Redirect para /hoje',
  '/entrar': 'Login — rota publica, fora da navegacao interna',
  '/agendar/[clinicId]': 'Agendamento online — rota publica para pacientes',
  '/atendimento/[id]': 'Destino parametrico, alcancado a partir da fila do dia',
  '/atendimentos/[id]': 'Workspace clinico parametrico do novo AppShell',
  '/pacientes/[id]': 'Destino parametrico, alcancado a partir da lista de pacientes',
  '/convenios/guias/[id]': 'Destino parametrico, alcancado a partir da lista de guias',
  '/convenios/retornos/[id]': 'Destino parametrico, alcancado a partir da lista de retornos',
  '/convenios/recursos/[id]': 'Destino parametrico, alcancado a partir da lista de recursos',
  '/convenios/recursos/novo': 'Destino contextual, alcancado a partir de glosas selecionadas',
  '/financeiro/repasse/regras': 'Sub-rota contextual, alcancada pela tela de repasse',
  '/agenda/imprimir': 'View de impressao, alcancada por botao no layout de Agenda',
  '/conversas/automacoes': 'Sub-rota, alcancada por aba na tela de Conversas',
  '/conversas/templates': 'Sub-rota, alcancada por aba na tela de Conversas',
  '/desempenho/nps': 'Sub-rota, alcancada por link na pagina de Desempenho',
  '/catalogos/cid10': 'Sub-rota, alcancada por link no hub /catalogos',
  '/catalogos/cid11': 'Sub-rota, alcancada por link no hub /catalogos',
  '/catalogos/tuss': 'Sub-rota, alcancada por link no hub /catalogos',
};

/* ── Verification ─────────────────────────────────────────────────────── */

const WEB_DIR = join(import.meta.dirname, '..', 'apps', 'web');
const APP_DIR = join(WEB_DIR, 'app');
const rotasDoApp = coletarRotas(APP_DIR);
const arquivos = coletarArquivosDeCodigo(WEB_DIR);
const destinosDeclarados = new Set<string>();

for (const arquivo of arquivos) {
  for (const destino of extrairDestinos(arquivo)) destinosDeclarados.add(destino);
}

const orfas = rotasDoApp.filter((rota) => {
  if (EXCECOES[rota]) return false;
  return ![...destinosDeclarados].some((destino) => rotaAceitaDestino(rota, destino));
});

const quebrados = [...destinosDeclarados]
  .filter((destino) => !rotasDoApp.some((rota) => rotaAceitaDestino(rota, destino)))
  .sort();

if (orfas.length > 0 || quebrados.length > 0) {
  if (orfas.length > 0) {
    console.error('Rotas sem caminho de navegacao:\n');
    for (const rota of orfas.sort()) console.error(`  ${rota}`);
  }
  if (quebrados.length > 0) {
    console.error('\nDestinos estaticos sem rota correspondente:\n');
    for (const destino of quebrados) console.error(`  ${destino}`);
  }
  console.error('\nA navegacao precisa ser bidirecionalmente consistente: paginas alcancaveis e links resolviveis.');
  process.exit(1);
}

console.log(`ok: ${rotasDoApp.length} rotas, ${destinosDeclarados.size} destinos estaticos validos, ${Object.keys(EXCECOES).length} excecoes justificadas`);
