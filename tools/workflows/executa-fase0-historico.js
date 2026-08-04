export const meta = {
  name: 'executa-fase0-cadencia',
  description: 'Executa as tarefas restantes da Fase 0 em sequencia, SO implementacao: um agente por tarefa, sem revisor. Verificacao pela suite de testes de cada tarefa. Para no primeiro BLOCKED.',
  phases: [
    { title: 'Execucao', detail: 'uma tarefa por vez, so implementacao' },
    { title: 'Relatorio', detail: 'consolidar o que aconteceu' },
  ],
}

const RAIZ = 'C:/Users/Felipe/Downloads/novo projeto'

// Ordem exata do plano. 36B e 39B existem e ficam onde estao.
// As tarefas 3 a 21 ja foram implementadas e revisadas em execucoes anteriores.
// Desta aqui em diante, por decisao do dono do produto, roda SO a implementacao:
// sem revisor de conformidade e sem revisor de qualidade. A verificacao que resta
// e a suite de testes de cada tarefa, que tem contagem esperada declarada no plano.
const TAREFAS = []
for (let n = 22; n <= 36; n++) TAREFAS.push(String(n))
TAREFAS.push('36B')
TAREFAS.push('37', '38', '39')
TAREFAS.push('39B')
for (let n = 40; n <= 48; n++) TAREFAS.push(String(n))

const CONTEXTO = [
'# PROJETO CADENCIA — contexto permanente',
'',
'Cadencia e um SaaS multi-tenant brasileiro de prontuario eletronico e gestao para clinicas medicas. Voce trabalha na **Fase 0 (Fundacao)**: a fase que constroi tudo que e impossivel de retrofitar depois — isolamento entre clinicas por Row-Level Security, persistencia clinica append-only, trilha de auditoria imutavel e canonicalizacao de documentos assinados. A Fase 0 nao tem nenhuma tela, de proposito.',
'',
'**Diretorio de trabalho:** `' + RAIZ + '` · **Branch:** `fase-0-fundacao`',
'',
'## O que ja existe e funciona',
'',
'- **Task 1** — monorepo pnpm, 27 pacotes em `packages/` e 3 apps em `apps/`, todos `@cadencia/<nome>`. TypeScript 5.9 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, `moduleResolution: Bundler`, `noEmit: true`, `allowImportingTsExtensions: true`. Vitest 4.',
'- **Task 2** — PostgreSQL 18 em `127.0.0.1:5433`, container `cadencia-db`, cluster em UTC, autenticacao `trust` (so desenvolvimento), com `pgcrypto`, `btree_gist`, `btree_gin`, `pg_trgm`, `unaccent`, `citext` e `pg_stat_statements`. O `.env` ja existe.',
'- **Task 3** — harness de migration em `packages/db`: `runMigrations()` forward-only com checksum e advisory lock, mais os comandos `pnpm db:new <slug>` e `pnpm db:migrate`. Migrations moram em `packages/db/migrations/`, no formato `NNNN_snake_case.sql`, e o diretorio esta VAZIO — a 0001 e escrita na Task 4.',
'',
'## Comandos que existem hoje',
'',
'`pnpm test` (unidade, nao toca banco) · `pnpm test:int` (integracao contra o Postgres local; arquivos `*.int.test.ts`; `fileParallelism: false`) · `pnpm typecheck` · `pnpm db:up` · `pnpm db:down` · `pnpm db:reset` · `pnpm db:new` · `pnpm db:migrate`',
'',
'Comandos que ainda NAO existem e sao criados por tarefas futuras: `pnpm test:iso`, `pnpm authz:seed`, `pnpm arch:check`, `pnpm db:invariants`, `pnpm db:privileges`, `pnpm lint:session-guc`, `pnpm lint:terminology-clock`, `pnpm restore:drill`, `pnpm prepush`. Nao invoque um comando que a sua tarefa nao criou.',
'',
'## Regras de arquitetura vinculantes',
'',
'1. **Irmao nunca importa irmao.** As camadas sao L0 plataforma (`kernel db audit authn authz storage jobs outbox integrations events`) → L1 cadastros (`identity tenancy people patients catalogs`) → L2 operacao → L3 apps. Setas so descem. Em particular `packages/db` **nao** importa `packages/kernel`: os dois sao L0.',
'2. **Migrations sao forward-only.** Nunca edite uma migration ja aplicada — o harness recusa por checksum. Crie a proxima.',
'3. **Uma transacao por arquivo de migration.** Nada de `CREATE INDEX CONCURRENTLY`.',
'4. **Fonte de tempo persistido e sempre o PostgreSQL** (`clock_timestamp()`). Em codigo, `performance.now()` para medicao; `Date.now()` so dentro de `packages/kernel/src/clock.ts` e `uuid.ts`.',
'5. **CNPJ e alfanumerico** (`^[A-Z0-9]{12}[0-9]{2}$`), nunca coluna numerica.',
'6. **Locale do cluster e `C.UTF-8`**, deliberadamente. Ordenacao alfabetica de portugues exige `COLLATE "pt-BR-x-icu"` explicito na coluna. A busca nao e afetada porque passa por `unaccent(lower(...))`.',
'',
'## Convencoes',
'',
'Conventional Commits, mensagem em **ingles**. Codigo, identificadores e nomes de arquivo em ingles; comentarios e nomes de teste em **portugues**. Voce esta no **Windows** — prefira o Bash tool para comandos POSIX.',
'',
'## Referencias no disco',
'',
'- Plano completo: `' + RAIZ + '/docs/superpowers/plans/2026-08-03-fase0-fundacao-plano.md`',
'- Documento de design: `' + RAIZ + '/docs/superpowers/specs/2026-08-03-design-sistema.md`',
'- Cada tarefa isolada: `' + RAIZ + '/.tasks/task-<N>.md`',
].join('\n')

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
    resumo: { type: 'string', description: 'O que foi implementado, em 3-6 linhas' },
    testes: { type: 'string', description: 'Comandos rodados e numeros REAIS de testes passando' },
    commit: { type: 'string', description: 'SHA curto do commit, ou vazio se nao commitou' },
    arquivos: { type: 'array', items: { type: 'string' } },
    preocupacoes: { type: 'array', items: { type: 'string' } },
    motivoDoBloqueio: { type: 'string', description: 'Preencher SOMENTE se BLOCKED ou NEEDS_CONTEXT: o que travou, o que tentou, que ajuda precisa' },
  },
  required: ['status', 'resumo', 'testes', 'arquivos'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    veredito: { type: 'string', enum: ['aprovado', 'precisa-correcao'] },
    verificacoesFeitas: { type: 'array', items: { type: 'string' }, description: 'Comandos que voce REALMENTE rodou e o que observou' },
    problemas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          gravidade: { type: 'string', enum: ['critico', 'importante', 'menor'] },
          onde: { type: 'string', description: 'arquivo:linha' },
          problema: { type: 'string' },
          correcao: { type: 'string', description: 'A correcao pronta, nao a orientacao' },
        },
        required: ['gravidade', 'onde', 'problema', 'correcao'],
      },
    },
    observacoes: { type: 'array', items: { type: 'string' }, description: 'Nao bloqueantes, registrados para o relatorio' },
  },
  required: ['veredito', 'problemas'],
}

const REGRAS_IMPL = [
'## Como trabalhar',
'',
'Siga **TDD**, na ordem que a tarefa manda: escrever o teste que falha → rodar e confirmar a falha com a mensagem esperada → implementar o minimo → rodar e confirmar que passa → commitar.',
'',
'Implemente **exatamente** o que a tarefa especifica. Nao construa alem (YAGNI). Se o texto da tarefa e o estado real do repositorio divergirem, prefira o estado real e registre a divergencia em `preocupacoes`.',
'',
'Antes de reportar, auto-revise com olhos frescos: implementei tudo? os testes verificam comportamento observavel e nao so mock? os nomes dizem o que a coisa faz? `git status --short` esta limpo? Corrija o que achar.',
'',
'## Quando parar',
'',
'E sempre aceitavel dizer "isto e dificil demais" ou "falta contexto". Trabalho ruim e pior que nenhum trabalho, e voce nao sera penalizado por escalar. Use **BLOCKED** quando nao conseguir completar, e **NEEDS_CONTEXT** quando faltar informacao que ninguem te deu. Em ambos, preencha `motivoDoBloqueio` com precisao: o que travou, o que voce tentou, e que ajuda resolveria. Um humano vai ler isso e decidir.',
'',
'**Nao improvise** diante de ambiguidade real, e **nao invente** SQL, assinatura ou nome que a tarefa nao deu. Nao mexa em nada fora do escopo da sua tarefa — em particular, nunca edite uma migration ja aplicada nem altere arquivos de tarefas anteriores sem que a sua peca.',
'',
'Reporte numeros REAIS de teste. Se um teste falhou, diga que falhou.',
].join('\n')

phase('Execucao')

const historico = []
let paradaPorBloqueio = null

for (let i = 0; i < TAREFAS.length; i++) {
  const N = TAREFAS[i]
  const arquivoTarefa = RAIZ + '/.tasks/task-' + N + '.md'

  const promptImpl = [
    CONTEXTO,
    '',
    '---',
    '',
    '# SUA TAREFA: Task ' + N,
    '',
    'O texto integral esta em:',
    '`' + arquivoTarefa + '`',
    '',
    '**Leia esse arquivo primeiro, inteiro, com a ferramenta Read.** Ele contem os passos, o codigo completo e os comandos exatos. Nao invente nada que nao esteja la.',
    '',
    'Antes de escrever codigo, rode `git log --oneline -5` e olhe o estado real do repositorio: as tarefas anteriores ja rodaram e o que elas criaram existe.',
    '',
    '**Se a tarefa ja estiver implementada** (o codigo existe, os testes dela passam e ha commit correspondente), nao refaca nem reescreva nada. Confirme rodando os testes que a tarefa manda rodar, reporte `DONE` com os numeros reais e o SHA do commit existente, e registre em `preocupacoes` que a encontrou pronta. As revisoes seguintes trabalham sobre o que ja esta commitado.',
    '',
    REGRAS_IMPL,
  ].join('\n')

  let impl = await agent(promptImpl, {
    label: 'task' + N + ':impl', phase: 'Execucao', schema: IMPL_SCHEMA, effort: 'high',
  })

  if (!impl) {
    paradaPorBloqueio = { tarefa: N, etapa: 'implementacao', motivo: 'o agente implementador nao retornou resultado' }
    break
  }

  if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
    paradaPorBloqueio = { tarefa: N, etapa: 'implementacao', status: impl.status, motivo: impl.motivoDoBloqueio || impl.resumo, detalhe: impl }
    break
  }

  if (paradaPorBloqueio) break

  // NENHUMA revisao roda por tarefa: decisao explicita do dono do produto, para
  // ganhar velocidade. A unica verificacao e a suite de testes que a propria tarefa
  // manda rodar, com contagem esperada. Uma varredura de qualidade sobre o diff
  // inteiro fica para o fim da fase, e passa a ser a unica revisao do projeto.

  historico.push({
    tarefa: N,
    status: impl.status,
    resumo: impl.resumo,
    testes: impl.testes,
    commit: impl.commit,
    preocupacoes: impl.preocupacoes || [],
  })

  log('Task ' + N + ' concluida (' + (i + 1) + '/' + TAREFAS.length + ') · commit ' + (impl.commit || '?'))
}

phase('Relatorio')

const resumo = await agent([
  'Voce e o relator de uma execucao automatizada de plano de implementacao do projeto Cadencia (SaaS de prontuario eletronico).',
  '',
  'Abaixo esta o historico das tarefas executadas e, se houver, o ponto onde a execucao parou.',
  '',
  'Escreva um relatorio em **portugues do Brasil**, denso e honesto, para o dono do produto ler. Estrutura:',
  '',
  '## O que foi construido',
  'Agrupado por bloco funcional, nao tarefa a tarefa. O que o sistema sabe fazer agora que nao sabia antes.',
  '',
  '## Numeros',
  'Tarefas concluidas, commits, testes rodando, problemas encontrados e corrigidos pelas revisoes.',
  '',
  '## Os achados que mais importaram',
  'De 3 a 6 problemas que as revisoes pegaram e que teriam custado caro depois. Explique o problema e por que importava, em linguagem que um nao-especialista entenda.',
  '',
  '## Onde parou e por que',
  'Se houve bloqueio: o que travou, o que foi tentado, e qual decisao o humano precisa tomar. Seja preciso e ofereca opcoes. Se nao houve, diga que a execucao completou.',
  '',
  '## Para a varredura de qualidade',
  'A revisao de qualidade por tarefa foi deliberadamente adiada e vira uma varredura unica sobre o diff inteiro. Consolide aqui, agrupadas por tema e sem repetir, todas as `observacoes` que os revisores de conformidade registraram ao longo do caminho — e diga quais parecem mais urgentes. Esta secao e a pauta dessa varredura.',
  '',
  '## O que fica pendente',
  'Preocupacoes registradas pelos implementadores e qualquer divergencia entre o plano e o estado real do repositorio que tenha sido notada.',
  '',
  'Nao invente nada que nao esteja no historico. Se um numero nao aparece, nao chute.',
  '',
  '## HISTORICO',
  JSON.stringify(historico, null, 1).slice(0, 200000),
  '',
  '## PARADA',
  paradaPorBloqueio ? JSON.stringify(paradaPorBloqueio, null, 1).slice(0, 40000) : 'Nenhuma. A execucao percorreu todas as tarefas da lista.',
].join('\n'), { label: 'relatorio', phase: 'Relatorio', effort: 'high' })

return {
  relatorio: resumo,
  tarefasConcluidas: historico.length,
  totalPrevisto: TAREFAS.length,
  parada: paradaPorBloqueio,
  historico: historico,
}
