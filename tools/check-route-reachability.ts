// tools/check-route-reachability.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* ── Routes from Next.js App Router ──────────────────────────────────── */

function coletarRotas(dir: string, base = ''): string[] {
  const rotas: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    const stat = statSync(caminho);
    if (stat.isDirectory()) {
      const segmento = nome.startsWith('(') && nome.endsWith(')') ? '' : nome;
      rotas.push(...coletarRotas(caminho, base ? `${base}/${segmento}` : `/${segmento}`));
    } else if (nome === 'page.tsx') {
      rotas.push(base || '/');
    }
  }
  return rotas;
}

/* ── Navigation graph hrefs ──────────────────────────────────────────── */

function extrairHrefs(arquivo: string): Set<string> {
  const conteudo = readFileSync(arquivo, 'utf-8');
  const hrefs = new Set<string>();
  // Match both object-property syntax (href: '/path') and JSX-prop syntax (href="/path")
  for (const match of conteudo.matchAll(/href[=:]\s*['"]([^'"]+)['"]/g)) {
    hrefs.add(match[1]!);
  }
  return hrefs;
}

/* ── Declared exceptions ─────────────────────────────────────────────── */

const EXCECOES: Record<string, string> = {
  '/': 'Redirect para /hoje',
  '/entrar': 'Login — rota publica, fora da navegacao interna',
  '/agendar/[clinicId]': 'Agendamento online — rota publica para pacientes',
  '/atendimento/[id]': 'Destino parametrico, alcancado a partir da fila do dia',
  '/pacientes/[id]': 'Destino parametrico, alcancado a partir da lista de pacientes',
  '/convenios/guias/[id]': 'Destino parametrico, alcancado a partir da lista de guias',
  '/convenios/retornos/[id]': 'Destino parametrico, alcancado a partir da lista de retornos',
  '/convenios/recursos/[id]': 'Destino parametrico, alcancado a partir da lista de recursos',
  '/convenios/recursos/novo': 'Destino parametrico, alcancado por botao na lista de recursos',
  '/financeiro/repasse/regras': 'Sub-rota, alcancada por botao na tela de repasse',
  '/financeiro/cadastros': 'Sub-rota, alcancada por botao na tela de financeiro',
  '/agenda/imprimir': 'View de impressao, alcancada por botao no layout de Agenda',
  '/agenda/lista-espera': 'Sub-rota, alcancada por botao na tela de Agenda',
  '/configuracoes/auditoria': 'Sub-rota, alcancada por menu na tela de Configuracoes',
  '/configuracoes/prontuario': 'Sub-rota, alcancada por menu na tela de Configuracoes',
  '/conversas/automacoes': 'Sub-rota, alcancada por aba na tela de Conversas',
  '/conversas/templates': 'Sub-rota, alcancada por aba na tela de Conversas',
  '/desempenho/nps': 'Sub-rota, alcancada por link na pagina de Desempenho',
  '/catalogos/cid10': 'Sub-rota, alcancada por link no hub /catalogos',
  '/catalogos/cid11': 'Sub-rota, alcancada por link no hub /catalogos',
  '/catalogos/tuss': 'Sub-rota, alcancada por link no hub /catalogos',
};

/* ── Verification ─────────────────────────────────────────────────────── */

const APP_DIR = join(import.meta.dirname, '..', 'apps', 'web', 'app');
const NAV_TS = join(import.meta.dirname, '..', 'apps', 'web', 'src', 'ui', 'nav.ts');
const TELAS_DIR = join(import.meta.dirname, '..', 'apps', 'web', 'src', 'telas');

const hrefsAlcancaveis = extrairHrefs(NAV_TS);

function coletarLayouts(dir: string): string[] {
  const layouts: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    const stat = statSync(caminho);
    if (stat.isDirectory()) {
      layouts.push(...coletarLayouts(caminho));
    } else if (nome === 'layout.tsx') {
      layouts.push(caminho);
    }
  }
  return layouts;
}

for (const layout of coletarLayouts(APP_DIR)) {
  for (const href of extrairHrefs(layout)) {
    hrefsAlcancaveis.add(href);
  }
}

// Also scan sub-navigation layout components in src/telas/
for (const nome of readdirSync(TELAS_DIR)) {
  if (nome.endsWith('Layout.tsx') && !nome.endsWith('.test.tsx')) {
    for (const href of extrairHrefs(join(TELAS_DIR, nome))) {
      hrefsAlcancaveis.add(href);
    }
  }
}

const rotasDoApp = coletarRotas(APP_DIR);
const orfas: string[] = [];

for (const rota of rotasDoApp) {
  if (EXCECOES[rota]) continue;
  if (hrefsAlcancaveis.has(rota)) continue;
  orfas.push(rota);
}

if (orfas.length > 0) {
  console.error('Rotas sem caminho de navegacao:\n');
  for (const rota of orfas.sort()) {
    console.error(`  ${rota}`);
  }
  console.error('\nCada rota precisa ser alcancavel a partir da sidebar, sub-navegacao ou command palette.');
  console.error('Se a rota nao precisa de caminho (publica, parametrica), declare em EXCECOES com justificativa.');
  process.exit(1);
}

console.log(`ok: ${rotasDoApp.length} rotas, todas alcancaveis (${Object.keys(EXCECOES).length} excecoes declaradas)`);
