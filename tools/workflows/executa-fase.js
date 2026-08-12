export const meta = {
  name: 'executa-fase3-cadencia',
  description: 'Executa as 75 tarefas da Fase 3 (O dinheiro) em sequencia, SO implementacao: um agente por tarefa. Para no primeiro BLOCKED.',
  phases: [
    { title: 'Execucao', detail: 'uma tarefa por vez, so implementacao' },
    { title: 'Relatorio', detail: 'consolidar o que aconteceu' },
  ],
}

const RAIZ = 'C:/Users/Felipe/Downloads/novo projeto'

// Fase 3 — comecando da Task 1. 75 tarefas, sem lacuna.
// Sequencial: cada uma commita e a seguinte enxerga o resultado.
const TAREFAS = []
for (let n = 1; n <= 75; n++) TAREFAS.push(String(n))

const CONTEXTO = [
'# PROJETO CADENCIA — Fase 3 ("O dinheiro")',
'',
'Cadencia e um SaaS multi-tenant brasileiro de prontuario eletronico e gestao para clinicas medicas. Voce trabalha na **Fase 3**, que entrega o financeiro completo (a receber/a pagar, fluxo de caixa, extrato, contas bancarias, centro de custo), repasse medico, estoque e Desempenho (Explorar + 11 visoes salvas + atribuicao de variacao).',
'',
'**Diretorio:** `' + RAIZ + '` · **Branch:** `fase-0-fundacao`',
'',
'## As Fases 0, 1 e 2 estao CONSTRUIDAS e verdes',
'',
'- **Fase 0** (Fundacao): 48 tarefas, 23 migrations, kernel/db/audit/authn/authz/catalogs/isolamento',
'- **Fase 1** ("O dia"): 79 tarefas, 44 migrations (0024-0067), prontuario/agenda/pacientes/assinatura/documentos/prescricao/app shell/design system/API',
'- **Fase 2** ("A conversa e o caixa"): 60 tarefas, 18 migrations (0068-0085), WhatsApp bidirecional, automacoes, financeiro basico',
'',
'Total: 85 migrations aplicadas, ~900 testes passando. O financeiro basico da Fase 2 inclui: fin.entry, fin.category, fin.payment_method, fin.receipt, fin.daily_rollup, fin.payment_link, fin.reconciliation_log, fin.webhook_event. Domain: recordPayment, cancelPayment, refundPayment, createPaymentLink, processPaymentWebhook, reconcileSettlements.',
'',
'**Leia o codigo real antes de consumir qualquer coisa das fases anteriores.** As assinaturas verdadeiras estao nas migrations e nos pacotes, nao na sua memoria.',
'',
'## Comandos que existem',
'',
'`pnpm test` · `pnpm test:int` · `pnpm test:iso` · `pnpm typecheck` · `pnpm db:up` · `pnpm db:migrate` · `pnpm db:new` · `pnpm db:reset` · `pnpm db:invariants` · `pnpm db:privileges` · `pnpm arch:check` · `pnpm lint:session-guc` · `pnpm lint:terminology-clock` · `pnpm authz:seed` · `pnpm prepush`',
'',
'## Regras de arquitetura vinculantes',
'',
'1. **Irmao nunca importa irmao.** L0 plataforma → L1 cadastros → L2 operacao → L3 apps. Setas so descem. `pnpm arch:check` reprova.',
'2. **Comunicacao entre irmaos L2 e assincrona** via `packages/events`. Composicao sincrona e de L3.',
'3. **Migrations forward-only**, uma transacao por arquivo, sem `CREATE INDEX CONCURRENTLY`.',
'4. **Toda tabela multi-tenant** nasce com `tenant_id`, RLS habilitada e **forcada**, ao menos uma policy, e FK composta. A `test:iso` descobre do catalogo e reprova quem esquecer.',
'5. **Fonte de tempo persistido e o PostgreSQL** (`clock_timestamp()`). `Date.now()` so em `clock.ts` e `uuid.ts`.',
'6. **Data do evento** usa `app.local_date()`, nunca `occurred_at::date` — o lint reprova.',
'7. **CNPJ alfanumerico**; `COLLATE "pt-BR-x-icu"` em coluna ordenada para humano.',
'8. **Matviews** em `rpt`, propriedade de `rpt_owner`, SEM GRANT para `app_rw`. Expostas por views `security_barrier` em `app_rpt` com predicado de tenant e papel.',
'9. **`reports` NAO le matview diretamente** — sempre via app_rpt.',
'10. **Chamada a parceiro sai so do worker**, via outbox.',
'',
'## Convencoes',
'',
'Conventional Commits em **ingles**. Codigo e identificadores em ingles; comentarios e nomes de teste em **portugues**. Voce esta no **Windows** — prefira o Bash tool.',
'',
'## Referencias no disco',
'',
'- Plano da Fase 3: `' + RAIZ + '/docs/superpowers/plans/2026-08-07-fase3-o-dinheiro-plano.md`',
'- Design (a fonte da verdade): `' + RAIZ + '/docs/superpowers/specs/2026-08-03-design-sistema.md`',
'- Sua tarefa isolada: `' + RAIZ + '/.tasks-fase3/task-<N>.md`',
'- Contratos reconciliados: `' + RAIZ + '/docs/superpowers/plans/fase3/00-CONTRATOS.md`',
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

const REGRAS_IMPL = [
'## Como trabalhar',
'',
'Siga **TDD**, na ordem que a tarefa manda: escrever o teste que falha → rodar e confirmar a falha com a mensagem esperada → implementar o minimo → rodar e confirmar que passa → commitar.',
'',
'Implemente **exatamente** o que a tarefa especifica. Nao construa alem (YAGNI). Se o texto da tarefa e o estado real do repositorio divergirem, prefira o estado real e registre a divergencia em `preocupacoes`.',
'',
'## Divergencias CONHECIDAS entre plano e repositorio',
'',
'**1. Numeracao de migration.** O plano foi escrito com a faixa 0086-0106, mas tarefas anteriores podem ter acrescentado migrations extras. **Nunca use o numero que a sua tarefa cita.** Rode `ls packages/db/migrations/` e use o proximo livre de verdade.',
'',
'**2. Alvo de performance e sobre LATENCIA, nao sobre a forma do plano.** Se a tarefa mandar asserir a ausencia de um no especifico do EXPLAIN e voce medir que o alvo de tempo passa com folga mas o no aparece mesmo assim, verifique se e consequencia da RLS e assira o que sobrevive a escala.',
'',
'**3. O schema fin ja tem tabelas da Fase 2.** Nao recrie fin.entry, fin.category, fin.payment_method, fin.receipt, fin.daily_rollup etc. Use ALTER TABLE para expandir.',
'',
'Antes de reportar, auto-revise: implementei tudo? os testes verificam comportamento? os nomes dizem o que faz? `git status --short` esta limpo?',
'',
'## Quando parar',
'',
'E sempre aceitavel dizer "isto e dificil demais" ou "falta contexto". Use **BLOCKED** quando nao conseguir completar, e **NEEDS_CONTEXT** quando faltar informacao. Preencha `motivoDoBloqueio` com precisao.',
'',
'**Nao improvise** diante de ambiguidade real, e **nao invente** SQL, assinatura ou nome que a tarefa nao deu. Nao mexa em nada fora do escopo da sua tarefa.',
'',
'Reporte numeros REAIS de teste. Se um teste falhou, diga que falhou.',
].join('\n')

phase('Execucao')

const historico = []
let paradaPorBloqueio = null

for (let i = 0; i < TAREFAS.length; i++) {
  const N = TAREFAS[i]
  const arquivoTarefa = RAIZ + '/.tasks-fase3/task-' + N + '.md'

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
    '**Se a tarefa ja estiver implementada** (o codigo existe, os testes dela passam e ha commit correspondente), nao refaca nem reescreva nada. Confirme rodando os testes que a tarefa manda rodar, reporte `DONE` com os numeros reais e o SHA do commit existente, e registre em `preocupacoes` que a encontrou pronta.',
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
  'Escreva um relatorio em **portugues do Brasil**, denso e honesto, para o dono do produto ler. Estrutura:',
  '',
  '## O que foi construido',
  'Agrupado por bloco funcional, nao tarefa a tarefa. O que o sistema sabe fazer agora que nao sabia antes.',
  '',
  '## Numeros',
  'Tarefas concluidas, commits, testes rodando, problemas encontrados.',
  '',
  '## Onde parou e por que',
  'Se houve bloqueio: o que travou, o que foi tentado, e qual decisao o humano precisa tomar. Seja preciso e ofereca opcoes. Se nao houve, diga que a execucao completou.',
  '',
  '## O que fica pendente',
  'Preocupacoes registradas pelos implementadores e divergencias entre plano e repositorio.',
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
