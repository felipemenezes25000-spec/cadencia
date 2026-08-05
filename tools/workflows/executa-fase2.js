export const meta = {
  name: 'executa-fase2-cadencia',
  description: 'Executa as 60 tarefas da Fase 2 (A conversa e o caixa) em sequencia, SO implementacao: um agente por tarefa. Para no primeiro BLOCKED.',
  phases: [
    { title: 'Execucao', detail: 'uma tarefa por vez, so implementacao' },
    { title: 'Relatorio', detail: 'consolidar o que aconteceu' },
  ],
}

const RAIZ = 'C:/Users/Felipe/Downloads/novo projeto'

const TAREFAS = []
for (let n = 1; n <= 60; n++) TAREFAS.push(String(n))

const CONTEXTO = [
'# PROJETO CADENCIA — Fase 2 ("A conversa e o caixa")',
'',
'Cadencia e um SaaS multi-tenant brasileiro de prontuario eletronico e gestao para clinicas medicas. Voce trabalha na **Fase 2**: WhatsApp bidirecional com numero proprio da clinica (confirmacao, lembrete, pos-consulta, NPS) + financeiro basico (recebimento no atendimento, link de pagamento, conciliacao basica, recibo).',
'',
'**Diretorio:** `' + RAIZ + '` · **Branch:** `fase-0-fundacao`',
'',
'## As Fases 0 e 1 estao CONSTRUIDAS e verdes',
'',
'67 migrations, 737 testes passando (188 unidade, 355 integracao, 194 isolamento). Entregam:',
'',
'- **Isolamento multi-tenant** por RLS FORCE com FK composta, suite test:iso',
'- **withTenantTx(actor, fn, pool?)** — unico lugar que abre transacao',
'- **kernel**: Result, erros, uuidv7, Clock, Money em centavos, isoFromMs, canonicalizacao JCS, validadores CPF/CNPJ/CNS/CRM',
'- **Trilha de auditoria**: audit.event particionada e append-only, canais A e B, selo diario',
'- **authn/authz**: Argon2id, sessao opaca, TOTP, CSRF, catalogo de acoes',
'- **Motor de prontuario completo**: catalogo, rascunho, finalize_encounter com cadeia de hash, retificacao, adendo',
'- **Agenda**: agendamento, encaixe, bloqueio, recorrencia, lista de espera, contadores ao vivo, check-in',
'- **Pacientes**: cadastro minimo viavel, busca, divida de dados, campos TISS',
'- **Assinatura digital ICP-Brasil** via PSC (AD-RT + LTV), SignatureProvider + fake',
'- **Documentos e exportacao ECF.18**: atestado, pedido de exame, rendering em blocos',
'- **Prescricao via Memed**: PrescriptionProvider + fake',
'- **API Fastify 5** com RBAC, preambulo de transacao, OpenAPI via Zod',
'- **Worker**: pg-boss + Chromium + despachante',
'- **App shell Next.js 15**: tokens CSS, design system, telas Hoje/Agenda/Pacientes/Atendimento',
'',
'**Leia o codigo real antes de consumir qualquer coisa das Fases 0/1.** As assinaturas verdadeiras estao nas migrations e nos pacotes, nao na sua memoria.',
'',
'## Comandos que existem',
'',
'`pnpm test` · `pnpm test:int` · `pnpm test:iso` · `pnpm typecheck` · `pnpm db:up` · `pnpm db:migrate` · `pnpm db:new` · `pnpm db:reset` · `pnpm db:invariants` · `pnpm arch:check` · `pnpm lint:session-guc` · `pnpm lint:terminology-clock` · `pnpm authz:seed` · `pnpm prepush`',
'',
'## Regras de arquitetura vinculantes',
'',
'1. **Irmao nunca importa irmao.** L0 plataforma (`kernel db audit authn authz storage jobs outbox integrations events`) → L1 cadastros (`identity tenancy people patients catalogs`) → L2 operacao (`scheduling emr documents prescriptions billing payments tiss messaging inventory reports export retention`) → L3 apps. Setas so descem. `pnpm arch:check` reprova.',
'2. **Comunicacao entre irmaos L2 e ASSINCRONA** via `packages/events` (L0). Composicao sincrona e de L3 (API/worker).',
'3. **Migrations forward-only**, uma transacao por arquivo, sem `CREATE INDEX CONCURRENTLY`. A Fase 2 usa da **0068** em diante.',
'4. **Toda tabela multi-tenant** nasce com `tenant_id`, RLS habilitada e **forcada**, ao menos uma policy, e FK composta. A `test:iso` reprova.',
'5. **Fonte de tempo persistido e o PostgreSQL** (`clock_timestamp()`). `Date.now()` so em `packages/kernel/src/clock.ts` e `uuid.ts`. Use `isoFromMs(systemClock.nowMs())` em codigo de aplicacao.',
'6. **Chamada a parceiro sai so do worker**, disparada pelo outbox. Excecao unica: handshake sincrono do prescritor.',
'7. **Timeout em operacao unsafe NUNCA gera retry automatico.** Persiste estado indeterminado e agenda reconciliacao.',
'8. **CNPJ alfanumerico**; `COLLATE "pt-BR-x-icu"` em coluna ordenada para humano.',
'',
'## Convencoes',
'',
'Conventional Commits em **ingles**. Codigo e identificadores em ingles; comentarios e nomes de teste em **portugues**. Voce esta no **Windows** — prefira o Bash tool.',
'',
'## Referencias no disco',
'',
'- Plano da Fase 2: `' + RAIZ + '/docs/superpowers/plans/2026-08-04-fase2-a-conversa-e-o-caixa-plano.md`',
'- Contratos reconciliados: `' + RAIZ + '/docs/superpowers/plans/fase2/00-CONTRATOS.md`',
'- Design (a fonte da verdade): `' + RAIZ + '/docs/superpowers/specs/2026-08-03-design-sistema.md`',
'- Sua tarefa isolada: `' + RAIZ + '/.tasks-fase2/task-<N>.md`',
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
    motivoDoBloqueio: { type: 'string', description: 'Preencher SOMENTE se BLOCKED ou NEEDS_CONTEXT' },
  },
  required: ['status', 'resumo', 'testes', 'arquivos'],
}

const REGRAS_IMPL = [
'## Como trabalhar',
'',
'Siga **TDD**, na ordem que a tarefa manda: escrever o teste que falha → rodar e confirmar a falha com a mensagem esperada → implementar o minimo → rodar e confirmar que passa → commitar.',
'',
'Implemente **exatamente** o que a tarefa especifica. Nao construa alem (YAGNI). Se o texto da tarefa e o estado real do repositorio divergirem, prefira o estado real e registre a divergencia em `preocupacoes`.',
'',
'## Divergencias JA CONHECIDAS entre o plano e o repositorio',
'',
'**1. Numeracao de migration.** O plano foi escrito quando a ultima migration era a 0067, e desde entao correcoes podem ter acrescentado arquivos. **Nunca use o numero que a sua tarefa cita.** Rode `ls packages/db/migrations/` e use o proximo livre de verdade.',
'',
'**2. Tabelas fantasma e colunas erradas.** O arquivo `00-CONTRATOS.md` lista correcoes que a reconciliacao identificou (ex: `msg.outbox_event` -> `app.outbox`, `fin.payment` -> `fin.entry`, `channel_kind` -> `channel`). Se a sua tarefa referencia uma tabela ou coluna que nao existe, consulte esse arquivo.',
'',
'**3. Alvo de performance e sobre LATENCIA, nao sobre a forma do plano.** Se a tarefa mandar asserir a ausencia de um no especifico do EXPLAIN e voce medir que o alvo de tempo passa com folga, verifique se o no e consequencia da RLS e assira o que sobrevive a escala.',
'',
'Antes de reportar, auto-revise: implementei tudo? os testes verificam comportamento observavel? os nomes dizem o que a coisa faz? `git status --short` esta limpo?',
'',
'## Quando parar',
'',
'Use **BLOCKED** quando nao conseguir completar, e **NEEDS_CONTEXT** quando faltar informacao. Preencha `motivoDoBloqueio` com precisao. Nao improvise diante de ambiguidade real.',
'',
'Reporte numeros REAIS de teste. Se um teste falhou, diga que falhou.',
].join('\n')

phase('Execucao')

const historico = []
let paradaPorBloqueio = null

for (let i = 0; i < TAREFAS.length; i++) {
  const N = TAREFAS[i]
  const arquivoTarefa = RAIZ + '/.tasks-fase2/task-' + N + '.md'

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
    '**Se a tarefa ja estiver implementada** (o codigo existe, os testes dela passam e ha commit correspondente), nao refaca nem reescreva nada. Confirme rodando os testes, reporte `DONE` com os numeros reais e o SHA do commit existente.',
    '',
    '**Consulte `' + RAIZ + '/docs/superpowers/plans/fase2/00-CONTRATOS.md`** se a tarefa referenciar tabela, coluna ou tipo que nao existe — a reconciliacao documenta as correcoes necessarias.',
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
  'Voce e o relator de uma execucao automatizada do plano da Fase 2 do Cadencia.',
  '',
  'Abaixo esta o historico das tarefas executadas e, se houver, o ponto de parada.',
  '',
  'Escreva um relatorio em **portugues do Brasil**, denso e honesto. Estrutura:',
  '',
  '## O que foi construido',
  'Agrupado por bloco funcional.',
  '',
  '## Numeros',
  'Tarefas concluidas, commits, testes rodando.',
  '',
  '## Onde parou e por que',
  'Se houve bloqueio: o que travou, o que foi tentado, e qual decisao o humano precisa tomar.',
  '',
  '## O que fica pendente',
  'Preocupacoes registradas e divergencias entre plano e estado real.',
  '',
  'Nao invente nada que nao esteja no historico.',
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
