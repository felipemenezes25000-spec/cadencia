/**
 * Grafo de modulos do Cadencia (§2.2). Tres regras mecanicas:
 *   1. Setas so descem — nenhum import ascendente.
 *   2. Irmao nunca importa irmao, nem pelo index.ts. Sem excecao.
 *   3. Composicao entre irmaos e responsabilidade de L3.
 *
 * L0 tem tres faixas, e a diferenca entre elas ja esta escrita no plano da Fase 0:
 *   base   = kernel, events            -> nao importam pacote nenhum
 *   infra  = db, audit                 -> TAMBEM nao importam pacote nenhum, nem o kernel
 *   serv   = authn, authz, storage, jobs, outbox, integrations -> importam base e infra
 *
 * `packages/db` importar `packages/kernel` e violacao: sao irmaos em L0, e e por isso
 * que a Fase 0 constroi o banco antes do kernel e que withTenantTx relanca o erro cru
 * do PostgreSQL em vez de traduzir para erro de dominio.
 */
const BASE = 'kernel|events';
const INFRA = 'db|audit';
const SERV = 'authn|authz|storage|jobs|outbox|integrations';
const L1 = 'identity|tenancy|people|patients|catalogs';
const L2 =
  'scheduling|emr|documents|prescriptions|billing|payments|tiss|messaging|inventory|reports|export|retention';
const L3 = 'web|api|worker';

/** Proibe irmao importar irmao usando a retrorreferencia $1 do grupo casado em `from`. */
function siblings(nome, grupo) {
  return {
    name: `irmao-nao-importa-irmao-${nome}`,
    severity: 'error',
    comment:
      'Irmao nunca importa irmao — nem o index.ts. Composicao entre irmaos e responsabilidade de L3.',
    from: { path: `^packages/(${grupo})/` },
    to: { path: `^packages/(${grupo})/`, pathNot: '^packages/$1/' },
  };
}

/** Proibe import ascendente de uma faixa para outra. */
function upward(nome, de, para) {
  return {
    name: `setas-so-descem-${nome}`,
    severity: 'error',
    comment: 'Import ascendente: a camada de baixo nao pode conhecer a de cima.',
    from: { path: `^packages/(${de})/` },
    to: { path: `^packages/(${para})/` },
  };
}

module.exports = {
  forbidden: [
    {
      name: 'sem-ciclo',
      severity: 'error',
      comment: 'Ciclo de dependencia: o grafo de modulos e um DAG estrito.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'sem-import-nao-resolvido',
      severity: 'error',
      comment: 'Import que nao resolve para arquivo nem para pacote instalado.',
      from: {},
      to: { couldNotResolve: true },
    },

    {
      name: 'folha-nao-importa-pacote',
      severity: 'error',
      comment: 'kernel e events sao folhas do grafo: zero dependencia de pacote do repositorio.',
      from: { path: `^packages/(${BASE})/` },
      to: { path: '^packages/', pathNot: '^packages/$1/' },
    },
    {
      name: 'db-e-audit-nao-importam-irmao',
      severity: 'error',
      comment:
        'db e audit nao importam pacote nenhum, nem o kernel: sao irmaos em L0 e a §2.2 nao abre excecao. ' +
        'Result, uuidv7 e a traducao de erro entram na borda, em L3.',
      from: { path: `^packages/(${INFRA})/` },
      to: { path: '^packages/', pathNot: '^packages/$1/' },
    },

    siblings('L0', SERV),
    siblings('L1', L1),
    siblings('L2', L2),
    {
      name: 'irmao-nao-importa-irmao-L3',
      severity: 'error',
      comment: 'web, api e worker sao processos separados: falam por HTTP, nao por import.',
      from: { path: `^apps/(${L3})/` },
      to: { path: `^apps/(${L3})/`, pathNot: '^apps/$1/' },
    },

    upward('L0-para-L1-L2', `${BASE}|${INFRA}|${SERV}`, `${L1}|${L2}`),
    upward('L1-para-L2', L1, L2),
    {
      name: 'setas-so-descem-nada-importa-apps',
      severity: 'error',
      comment: 'Nenhum pacote importa app: L3 e o topo e so ele compoe.',
      from: { path: '^packages/' },
      to: { path: `^apps/(${L3})/` },
    },

    {
      name: 'web-nao-fala-com-banco',
      severity: 'error',
      comment: 'So api e worker abrem conexao: web nao recebe DATABASE_URL por task role (§2.1).',
      from: { path: '^apps/web/' },
      to: { path: '^packages/(db|jobs|outbox)/' },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|\\.next|\\.turbo)/|\\.test\\.ts$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
