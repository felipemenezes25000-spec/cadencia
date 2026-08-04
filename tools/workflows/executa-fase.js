export const meta = {
  name: 'executa-fase1-cadencia',
  description: 'Executa as 79 tarefas da Fase 1 (O dia) em sequencia, SO implementacao: um agente por tarefa. Verificacao pela suite de testes de cada tarefa. Para no primeiro BLOCKED.',
  phases: [
    { title: 'Execucao', detail: 'uma tarefa por vez, so implementacao' },
    { title: 'Relatorio', detail: 'consolidar o que aconteceu' },
  ],
}

const RAIZ = 'C:/Users/Felipe/Downloads/novo projeto'

// Fase 1 — retomada na 21. As tarefas 1 a 20 ja estao commitadas e verdes; a 20
// foi desbloqueada com as migrations 0038 (version_id ambiguo em finalize_encounter)
// e 0039 (excecao append-only da ai_assistance declarada por COMMENT).
// Numeradas ate 79 sem lacuna, ja ordenadas por dependencia
// no proprio plano. Sequencial: cada uma commita e a seguinte enxerga o resultado.
const TAREFAS = []
for (let n = 37; n <= 79; n++) TAREFAS.push(String(n))

const CONTEXTO = [
'# PROJETO CADENCIA — Fase 1 ("O dia")',
'',
'Cadencia e um SaaS multi-tenant brasileiro de prontuario eletronico e gestao para clinicas medicas. Voce trabalha na **Fase 1**, a primeira com telas e a primeira vendavel sozinha: ao fim dela uma clinica particular de 1 a 5 medicos substitui papel, planilha e agenda de parede, emite receita e atestado assinados digitalmente, e atende pedido judicial de prontuario integral com um comando.',
'',
'**Diretorio:** `' + RAIZ + '` · **Branch:** `fase-0-fundacao`',
'',
'## A Fase 0 esta CONSTRUIDA e verde',
'',
'65 commits, 23 migrations, 433 testes passando (142 unidade, 214 integracao, 77 isolamento). Ela entregou:',
'',
'- **Isolamento multi-tenant** por RLS `FORCE` com verificacao de vinculo, FK sempre composta `(tenant_id, id)`, e a suite `test:iso` que descobre tabelas do catalogo e reprova quem esquecer',
'- **`withTenantTx(actor, fn, pool?)`** em `packages/db/src/tx.ts` — o UNICO lugar do sistema que abre transacao, e o unico autorizado a gravar as GUCs de contexto (`app.tenant_id` e companhia). O comando `pnpm lint:session-guc` reprova qualquer atribuicao dessas GUCs fora desse arquivo. (Esta frase evita de proposito escrever o comando SQL literal: o lint varre o repositorio inteiro por texto, e ate um prompt que o cita seria reprovado — o que ja aconteceu uma vez.)',
'- **`kernel`**: `Result`, erros de dominio, `uuidv7`, `Clock`, `Money` em centavos, canonicalizacao JCS (`canonicalHash`, `CANONICAL_VERSION = jcs-1`), validadores CPF/CNPJ/CNS/CRM',
'- **Trilha de auditoria**: `audit.event` particionada e append-only por trigger, canal A (dentro da transacao), canal B (fora dela, sobrevive ao rollback), leitura deduplicada, selo diario',
'- **authn/authz**: Argon2id, sessao opaca, TOTP, CSRF, catalogo de acoes com negacao por padrao',
'- **catalogs**: CID-10 e TUSS versionados por data de vigencia, com `daterange` e `EXCLUDE USING gist`',
'- **CI**: 10 invariantes de banco (`pnpm db:invariants`), `pnpm arch:check`, `pnpm restore:drill`',
'',
'**Leia o codigo real antes de consumir qualquer coisa da Fase 0.** As assinaturas verdadeiras estao nas migrations e nos pacotes, nao na sua memoria.',
'',
'## Comandos que existem',
'',
'`pnpm test` · `pnpm test:int` · `pnpm test:iso` · `pnpm typecheck` · `pnpm db:up` · `pnpm db:migrate` · `pnpm db:new` · `pnpm db:reset` · `pnpm db:invariants` · `pnpm arch:check` · `pnpm lint:session-guc` · `pnpm lint:terminology-clock` · `pnpm authz:seed` · `pnpm prepush`',
'',
'## Regras de arquitetura vinculantes',
'',
'1. **Irmao nunca importa irmao.** L0 plataforma (`kernel db audit authn authz storage jobs outbox integrations events`) → L1 cadastros (`identity tenancy people patients catalogs`) → L2 operacao (`scheduling emr documents prescriptions billing payments tiss messaging inventory reports export retention`) → L3 apps. Setas so descem. `pnpm arch:check` reprova.',
'2. **Migrations forward-only**, uma transacao por arquivo, sem `CREATE INDEX CONCURRENTLY`. A Fase 1 usa da **0024** em diante.',
'3. **Toda tabela multi-tenant** nasce com `tenant_id`, RLS habilitada e **forcada**, ao menos uma policy, e FK composta. A `test:iso` descobre do catalogo e reprova quem esquecer. Tabela clinica com `patient_id` ou `version_id` precisa tambem de policy `RESTRICTIVE`.',
'4. **Fonte de tempo persistido e o PostgreSQL** (`clock_timestamp()`). `performance.now()` para medicao; `Date.now()` so em `packages/kernel/src/clock.ts` e `uuid.ts`.',
'5. **Data do evento** usa `app.local_date()` (criada na Task 1 desta fase), nunca `occurred_at::date` — o lint reprova.',
'6. **Registro clinico finalizado e imutavel por REVOKE**, nao por convencao. Correcao cria versao nova; o verbo "Excluir" nao existe para registro finalizado.',
'7. **CNPJ alfanumerico**; `COLLATE "pt-BR-x-icu"` em coluna ordenada para humano.',
'',
'## Convencoes',
'',
'Conventional Commits em **ingles**. Codigo e identificadores em ingles; comentarios e nomes de teste em **portugues**. Voce esta no **Windows** — prefira o Bash tool.',
'',
'## Referencias no disco',
'',
'- Plano da Fase 1: `' + RAIZ + '/docs/superpowers/plans/2026-08-03-fase1-o-dia-plano.md`',
'- Design (a fonte da verdade): `' + RAIZ + '/docs/superpowers/specs/2026-08-03-design-sistema.md`',
'- Sua tarefa isolada: `' + RAIZ + '/.tasks-fase1/task-<N>.md`',
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
'## Duas divergencias JA CONHECIDAS entre o plano e o repositorio',
'',
'**1. Numeracao de migration.** O plano foi escrito quando a ultima migration era a 0023, e desde entao correcoes acrescentaram arquivos. **Nunca use o numero que a sua tarefa cita.** Rode `ls packages/db/migrations/` e use o proximo livre de verdade. Numero colidido nao produz erro claro: produz um banco que aplica na ordem errada em outra maquina.',
'',
'**2. Alvo de performance e sobre LATENCIA, nao sobre a forma do plano.** Se a tarefa mandar asserir a ausencia de um no especifico do EXPLAIN (por exemplo `Sort`) e voce medir que o alvo de tempo passa com folga mas o no aparece mesmo assim, **nao force o plano**. Verifique se o no e consequencia da RLS — que nao e negociavel — e assira o que sobrevive a escala: ausencia de `Seq Scan`, e numero de linhas lidas proporcional ao filtro e nao ao tamanho da tabela. Um teste de plano que passa com 20 linhas e nao diz nada sobre 200 mil e pior que nenhum, porque da falsa seguranca. Se precisar, semeie ruido para a afirmacao ter conteudo.',
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
  const arquivoTarefa = RAIZ + '/.tasks-fase1/task-' + N + '.md'

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
