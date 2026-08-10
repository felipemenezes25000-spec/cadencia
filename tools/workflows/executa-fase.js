export const meta = {
  name: 'executa-fase5-cadencia',
  description: 'Executa as 60 tarefas da Fase 5 (A glosa e o SOAP) em sequencia, SO implementacao: um agente por tarefa. Para no primeiro BLOCKED.',
  phases: [
    { title: 'Execucao', detail: 'uma tarefa por vez, so implementacao' },
    { title: 'Relatorio', detail: 'consolidar o que aconteceu' },
  ],
}

const RAIZ = 'C:/Users/Felipe/Downloads/novo projeto'

const TAREFAS = []
for (let n = 1; n <= 60; n++) TAREFAS.push(String(n))

const CONTEXTO = [
'# PROJETO CADENCIA — Fase 5 ("A glosa e o SOAP")',
'',
'Cadencia e um SaaS multi-tenant brasileiro de prontuario eletronico e gestao para clinicas medicas. Voce trabalha na **Fase 5**, que entrega: demonstrativo de retorno, recurso de glosa, serializador XML de recurso, transporte SOAP condicionado a credencial real, telas de retornos/glosas, integracao com Desempenho ("glosas nao recuperadas").',
'',
'**Diretorio:** `' + RAIZ + '` · **Branch:** `fase-0-fundacao`',
'',
'## As Fases 0, 1, 2, 3 e 4 estao CONSTRUIDAS e verdes',
'',
'- **Fase 0** (Fundacao): 48 tarefas, 23 migrations, kernel/db/audit/authn/authz/catalogs/isolamento',
'- **Fase 1** ("O dia"): 79 tarefas, 44 migrations (0024-0067), prontuario/agenda/pacientes/assinatura/documentos/prescricao/app shell/design system/API',
'- **Fase 2** ("A conversa e o caixa"): 60 tarefas, 18 migrations (0068-0085), WhatsApp bidirecional, automacoes, financeiro basico',
'- **Fase 3** ("O dinheiro"): 74 tarefas, 24 migrations (0086-0109), financeiro completo, repasse medico, estoque, Desempenho',
'- **Fase 4** ("Os convenios"): 72 tarefas, 13 migrations (0110-0122), TISS completo — operadora, contrato, paciente_convenio, guia como projecao, lote, XML serializer ISO-8859-1, TissArquivoTransport, telas Convenios, API REST com RBAC',
'',
'Total: 122 migrations aplicadas, ~1400 testes passando.',
'',
'**Construcoes da Fase 4 que a Fase 5 CONSOME:**',
'- `tiss.operadora`, `tiss.contrato`, `tiss.paciente_convenio` — cadastros base',
'- `tiss.encounter_guia_consulta` com `numero_guia_prestador` e `live` — para match com demonstrativo',
'- `tiss.lote` com lifecycle (rascunho → pronto → enviado → retornado) e `receiveLoteReturn`',
'- `tiss.lote_guia` — juncao lote-guia',
'- `packages/tiss/src/serializer/` — XmlBuilder, encode-iso8859, compute-tiss-hash (reutilizaveis)',
'- `packages/tiss/src/transport/` — TissTransport interface, TissArquivoTransport, registry, fake-transport',
'- `packages/reports/src/compute-variation.ts` — atribuicao de variacao (adicionar "glosas nao recuperadas")',
'- `packages/events/src/domain-events.ts` — 11 EVENT_TYPES',
'- `apps/web/app/(main)/financeiro/convenios/` — ConveniosLayout com sub-abas',
'- `apps/api/src/routes/tiss/` — rotas TISS existentes',
'',
'**Leia o codigo real antes de consumir qualquer coisa das fases anteriores.** As assinaturas verdadeiras estao nas migrations e nos pacotes.',
'',
'## Comandos que existem',
'',
'`pnpm test` · `pnpm test:int` · `pnpm test:iso` · `pnpm typecheck` · `pnpm db:up` · `pnpm db:migrate` · `pnpm db:new` · `pnpm db:reset` · `pnpm db:invariants` · `pnpm db:privileges` · `pnpm arch:check` · `pnpm lint:session-guc` · `pnpm lint:terminology-clock` · `pnpm authz:seed` · `pnpm prepush`',
'',
'## Regras de arquitetura vinculantes',
'',
'1. **Irmao nunca importa irmao.** L0 → L1 → L2 → L3. Setas so descem.',
'2. **Comunicacao entre irmaos L2 e assincrona** via `packages/events`.',
'3. **Migrations forward-only**, uma transacao por arquivo.',
'4. **Toda tabela multi-tenant** com `tenant_id`, RLS habilitada e **forcada**, policy, FK composta.',
'5. **Fonte de tempo persistido e o PostgreSQL** (`clock_timestamp()`).',
'6. **Data do evento** usa `app.local_date()`, nunca `occurred_at::date`.',
'7. **CNPJ alfanumerico**; `COLLATE "pt-BR-x-icu"` em coluna ordenada para humano.',
'8. **Matviews** em `rpt` do `rpt_owner`, sem GRANT para `app_rw`, expostas por views security_barrier em `app_rpt`.',
'9. **`reports` NAO le matview diretamente** — sempre via app_rpt.',
'10. **Chamada a parceiro sai so do worker**, via outbox.',
'',
'## Regras especificas TISS',
'',
'11. **Nenhuma ocorrencia de `now()` ou `current_date` dentro do schema `tiss`**.',
'12. **Terminologia versionada** por data do atendimento: `ref.tuss_at(tabela, codigo, data)`.',
'13. **XML usa ISO-8859-1**. Hash MD5 proprietario.',
'14. **Recurso de glosa sempre cita a `encounter_version_id`** usada.',
'15. **Timeout NUNCA gera retry automatico** em operacao `unsafe` — estado `indeterminado` com reconciliacao.',
'16. **tiss-soap** so com credencial real. Registry condicional.',
'',
'## Convencoes',
'',
'Conventional Commits em **ingles**. Codigo e identificadores em ingles; comentarios e nomes de teste em **portugues**. Voce esta no **Windows** — prefira o Bash tool.',
'',
'## Referencias no disco',
'',
'- Plano da Fase 5: `' + RAIZ + '/docs/superpowers/plans/2026-08-08-fase5-a-glosa-e-o-soap-plano.md`',
'- Design: `' + RAIZ + '/docs/superpowers/specs/2026-08-03-design-sistema.md`',
'- Sua tarefa isolada: `' + RAIZ + '/.tasks-fase5/task-<N>.md`',
'- Contratos reconciliados: `' + RAIZ + '/docs/superpowers/plans/fase5/00-CONTRATOS.md`',
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
'Siga **TDD**, na ordem que a tarefa manda: escrever o teste que falha → rodar e confirmar a falha → implementar o minimo → confirmar que passa → commitar.',
'',
'Implemente **exatamente** o que a tarefa especifica. Nao construa alem (YAGNI). Se o texto da tarefa e o estado real do repositorio divergirem, prefira o estado real e registre a divergencia em `preocupacoes`.',
'',
'## Divergencias CONHECIDAS entre plano e repositorio',
'',
'**1. Numeracao de migration.** Rode `ls packages/db/migrations/` e use o proximo livre de verdade.',
'',
'**2. Nomes de colunas podem divergir.** O plano pode usar nomes diferentes dos que a Fase 4 realmente criou. LEIA as migrations reais antes de consumir tabelas existentes.',
'',
'**3. O registry de transports da Fase 4 so conhece tiss-arquivo.** A task 36 da Fase 5 e que adiciona tiss-soap ao registry condicionalmente. Antes dela, o registry so tem tiss-arquivo.',
'',
'**4. Authz usa dot-notation** (ex: `tiss.demonstrativo.read`), NAO dois-pontos. Verifique em `packages/authz/src/actions.ts`.',
'',
'**5. Matviews pertencem a rpt_owner** e sao expostas por views security_barrier em app_rpt. O pacote reports le SOMENTE de app_rpt, nunca de rpt diretamente.',
'',
'Antes de reportar, auto-revise: implementei tudo? os testes verificam comportamento? `git status --short` esta limpo?',
'',
'## Quando parar',
'',
'Use **BLOCKED** quando nao conseguir completar, e **NEEDS_CONTEXT** quando faltar informacao. Preencha `motivoDoBloqueio` com precisao.',
'',
'**Nao improvise** diante de ambiguidade real. Reporte numeros REAIS de teste.',
].join('\n')

phase('Execucao')

const historico = []
let paradaPorBloqueio = null

for (let i = 0; i < TAREFAS.length; i++) {
  const N = TAREFAS[i]
  const arquivoTarefa = RAIZ + '/.tasks-fase5/task-' + N + '.md'

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
    '**Leia esse arquivo primeiro, inteiro, com a ferramenta Read.** Nao invente nada que nao esteja la.',
    '',
    'Antes de escrever codigo, rode `git log --oneline -5` e olhe o estado real do repositorio.',
    '',
    '**Se a tarefa ja estiver implementada**, confirme rodando os testes e reporte `DONE` com os numeros reais.',
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
  'Escreva um relatorio em **portugues do Brasil**, denso e honesto. Estrutura:',
  '',
  '## O que foi construido',
  'Agrupado por bloco funcional. O que o sistema sabe fazer agora que nao sabia antes.',
  '',
  '## Numeros',
  'Tarefas concluidas, commits, testes rodando, problemas encontrados.',
  '',
  '## Onde parou e por que',
  'Se houve bloqueio: o que travou, opcoes para o humano. Se completou, diga.',
  '',
  '## O que fica pendente',
  'Preocupacoes registradas e divergencias plano x repositorio.',
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
