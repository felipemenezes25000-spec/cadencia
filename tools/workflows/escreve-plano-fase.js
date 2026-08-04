export const meta = {
  name: 'plano-fase1-cadencia',
  description: 'Escreve o plano da Fase 1 em 15 blocos pequenos; cada agente GRAVA seu bloco em arquivo e devolve so os contratos, evitando o limite de saida',
  phases: [
    { title: 'Redacao', detail: '15 blocos pequenos, cada um gravado em arquivo' },
    { title: 'Reconciliacao', detail: 'unificar contratos e ordenar as tarefas' },
  ],
}

const RAIZ = 'C:/Users/Felipe/Downloads/novo projeto'
const DESIGN = RAIZ + '/docs/superpowers/specs/2026-08-03-design-sistema.md'
const DIR = RAIZ + '/docs/superpowers/plans/fase1'

const BASE = [
'# CONTEXTO',
'',
'Voce escreve UM BLOCO do plano de implementacao da **Fase 1 ("O dia")** do Cadencia — SaaS multi-tenant brasileiro de prontuario e gestao para clinicas medicas. A **Fase 0 esta CONSTRUIDA e verde**: 65 commits, 23 migrations, 433 testes (142 unidade, 214 integracao, 77 isolamento).',
'',
'## LEIA ANTES DE ESCREVER — obrigatorio',
'',
'1. **Design**: `' + DESIGN + '`. §4 motor de prontuario · §5 arquitetura de informacao e os 3 fluxos criticos · §6 linguagem visual e tokens · §7 integracoes · §8 escopo da Fase 1.',
'2. **O codigo REAL da Fase 0.** Use Read/Grep para descobrir as assinaturas verdadeiras. Nao invente nada:',
'   - `packages/db/src/tx.ts` — `withTenantTx(actor, fn, pool?)` e o tipo `Actor` (kinds: user, system, anon)',
'   - `packages/db/migrations/*.sql` — 23 migrations. O schema real de `app.tenant`, `app.clinic`, `app.membership`, `app.professional`, `clin.patient`, `clin.patient_identifier`, `clin.record_share`, `id."user"`, `audit.*`, `ref.*`, e as funcoes `app.current_tenant_id()`, `app.require_tenant_id()`, `app.current_professional_id()`, `app.is_member()`, `app.has_role_in()`, `app.secure_partition()`',
'   - `packages/kernel/src/` — `Result`, erros, `uuidv7`, `Clock`, `Money`, canonicalizacao JCS, validadores CPF/CNPJ/CNS/CRM',
'   - `packages/audit/src/` — canal A, canal B, auditoria de leitura deduplicada',
'   - `packages/authn/`, `packages/authz/`, `packages/catalogs/`',
'   - `packages/db/test/iso/` — o padrao da suite de isolamento, que a Fase 1 estende',
'',
'**A PROXIMA MIGRATION LIVRE e a 0024.** Descubra quais numeros o seu bloco usa contando a partir dela e do que os blocos anteriores ao seu ja consumiram (a faixa de migrations do seu bloco esta no enunciado).',
'',
'## REGRAS DE ARQUITETURA (herdadas da Fase 0, valem aqui)',
'',
'Irmao nunca importa irmao; setas so descem (L0 plataforma → L1 cadastros → L2 operacao → L3 apps). Migrations forward-only, uma transacao por arquivo. Fonte de tempo persistido e o PostgreSQL. CNPJ alfanumerico. `COLLATE "pt-BR-x-icu"` em coluna ordenada para humano. Toda tabela multi-tenant nasce com `tenant_id`, RLS habilitada e **forcada**, ao menos uma policy, e FK sempre composta `(tenant_id, ...)` — a suite `test:iso` descobre tabelas do catalogo e reprova quem esquecer.',
'',
'## STACK DA FASE 1',
'',
'Front: Next.js 15 App Router + React 19 · TanStack Query 5 · React Hook Form 7 · nuqs 2 · Tailwind 4 + tokens CSS proprios · Radix headless · TipTap 3 · dnd-kit 6 · react-virtual 3 · visx 3 · Playwright Chromium + pdf-lib. API: Fastify 5 + fastify-type-provider-zod. Testing Library + axe para componente. TypeScript strict em tudo.',
'',
'## COMO ESCREVER',
'',
'Cada passo e UMA acao de 2 a 5 minutos, no ciclo TDD: teste que falha → rodar e confirmar a falha com a mensagem esperada → implementar o minimo → rodar e confirmar que passa → commitar.',
'',
'Formato: `### Task N: nome`, bloco **Arquivos** (Criar/Modificar/Teste, caminhos exatos), passos `- [ ]` com **codigo completo** em todo passo que mexe em codigo, comandos exatos com saida esperada.',
'',
'**PROIBIDO**: "TBD", "TODO", "implementar depois", "tratamento de erro apropriado", "validar entradas", "cobrir casos de borda", "igual a Task N" (repita o codigo), passo sem bloco de codigo quando mexe em codigo, referencia a tipo/funcao/rota que nenhuma tarefa definiu.',
'',
'Portugues do Brasil no texto; codigo e identificadores em ingles; comentarios e nomes de teste em portugues. Conventional Commits em ingles.',
'',
'## ENTREGA — leia com atencao',
'',
'**Voce NAO devolve o markdown na resposta.** Blocos grandes estouram o limite de saida. Em vez disso:',
'',
'1. **Grave o markdown das suas tarefas** com a ferramenta Write, no arquivo que o enunciado indica.',
'2. Se o conteudo for grande, grave em partes: Write do primeiro trecho, depois Edit/Write acrescentando o resto. Confira ao final que o arquivo esta completo e coerente.',
'3. Na sua resposta estruturada, devolva SO os metadados: contratos que voce define, do que depende, e o que consumiu da Fase 0.',
'',
'Numere as tarefas dentro da faixa que o enunciado te der. A reconciliacao final renumera.',
].join('\n')

const META_SCHEMA = {
  type: 'object',
  properties: {
    bloco: { type: 'string' },
    arquivoGravado: { type: 'string' },
    quantasTarefas: { type: 'number' },
    migrationsUsadas: { type: 'array', items: { type: 'string' } },
    defineParaOutrosBlocos: {
      type: 'array',
      items: {
        type: 'object',
        properties: { nome: { type: 'string' }, arquivo: { type: 'string' }, assinatura: { type: 'string' } },
        required: ['nome', 'arquivo', 'assinatura'],
      },
    },
    dependeDe: { type: 'array', items: { type: 'string' } },
    consumidoDaFase0: { type: 'array', items: { type: 'string' } },
    preocupacoes: { type: 'array', items: { type: 'string' } },
  },
  required: ['bloco', 'arquivoGravado', 'quantasTarefas', 'defineParaOutrosBlocos'],
}

phase('Redacao')

const BLOCOS = [
  { key: '01-prontuario-modelo', faixa: 'Task 1 a Task 6', mig: '0024 a 0026', nome: 'Prontuario: catalogo de templates, secoes e campos',
    prompt: 'Design §4.1 e §4.2. `ref.record_template` global e versionado; `clin.record_section`, `clin.record_field` (append-only com `generation`), `clin.record_layout_item` (ordem e visibilidade POR PROFISSIONAL). Os 14 tipos de campo da §4.2 com o slot de cada um (`value_text`, `value_num`, `value_bool`, `value_date`, `value_ref_code`, `value_json`) e para o que promovem. A evolucao de definicao: mudar tipo ou opcoes ARQUIVA e cria `generation + 1`; mudar so o rotulo e permitido porque `label_snapshot` protege o passado. Unicidade por indice parcial `WHERE archived_at IS NULL` — sem isso o gesto mais comum da tela "Secoes do prontuario" (mudar Peso de texto para numerico) falha com 23505.' },
  { key: '02-prontuario-rascunho', faixa: 'Task 7 a Task 11', mig: '0027 a 0028', nome: 'Prontuario: rascunho mutavel e autosave',
    prompt: 'Design §4.4. `clin.encounter_draft` MUTAVEL com revisao otimista (o autosave append-only multiplicaria as escritas por ~100 e comeria a latencia de digitacao, que e o diferencial vendavel). Politica do rascunho orfao: parado 7 dias vira versao `kind=original` com `incompleto = true`, com evento de auditoria e notificacao — 3 a 8% dos atendimentos nunca sao finalizados e contem queixa, HMA e exame fisico; nenhum conteudo clinico pode ficar fora do regime imutavel. O job de auto-finalizacao roda no papel `jobs`.' },
  { key: '03-prontuario-finalizar', faixa: 'Task 12 a Task 17', mig: '0029 a 0031', nome: 'Prontuario: finalize_encounter e a selagem',
    prompt: 'Design §4.3, o passo mais critico da fase. `clin.encounter` e `clin.encounter_version`; a funcao `clin.finalize_encounter(...)` SECURITY DEFINER com os 9 passos EXATOS da §4.3, em uma transacao. O `content_hash` cobre patient_id, professional_id, clinic_id, occurred_at, occurred_date, todos os valores de campo, os codigos materializados e o ai_assistance — e NAO cobre live, head_version_id, version_count. Usa a canonicalizacao JCS do kernel. `author_professional_id = app.current_professional_id()` (quem escreveu, nao quem foi agendado: o plantonista que cobre o titular nao pode ser gravado como o titular). Imutabilidade por REVOKE, nao por convencao. `audit.log` no fim.' },
  { key: '04-prontuario-versoes', faixa: 'Task 18 a Task 23', mig: '0032 a 0034', nome: 'Prontuario: primeira classe, retificacao, adendo e linha do tempo',
    prompt: 'Design §4.3 passos 5-6, §4.5 e §4.6. As tabelas de primeira classe: `encounter_field_value` (EAV, particionada por finalized_at, com label_snapshot/display_snapshot/terminology_version/field_generation e `ordinal` na chave para multipla escolha), `clin.diagnosis` (CID), `clin.observation` (numericos, inclusive os componentes de campo composto: PA vira PA_SIS + PA_DIA), `clin.encounter_finding` (categoricos), `clin.procedure`, e `clin.ai_assistance` (§4.6 com o DDL literal, incluindo output_hash na serializacao canonica, entrada recuperavel e patient_refused). Retificacao/adendo/transferencia/anulacao: cada um cria versao com o `kind` certo e marca `live=false` nas filhas superadas. A view `clin.v_version_status` e a regra de que o registro vigente e o CONJUNTO de versoes nao superadas — o cenario que isso evita: v2 e adendo com hemograma que chegou depois, e ler so o ponteiro faz o hemograma sumir da tela. Linha do tempo com alvo < 10ms e o indice que a serve.' },
  { key: '05-agenda-nucleo', faixa: 'Task 24 a Task 29', mig: '0035 a 0037', nome: 'Agenda: agendamento, encaixe e recorrencia',
    prompt: 'Design §5.3 (mapa da Agenda). `sched.appointment` no pacote `packages/scheduling`, com FK composta, paciente/profissional/clinica/procedimento/convenio, inicio e fim no fuso da CLINICA (nao do tenant: rede SP+Manaus e caso real), status agendado/confirmado/aguardando/atendido/faltou/cancelado. **Encaixe** (overbooking deliberado em slot ocupado) — inegociavel no Brasil. Bloqueio de horario e ausencia. **Recorrencia materializada** com horizonte de 120 dias, nao regra calculada em runtime. `sched.procedure` com cor, duracao e valor proprios, que dirigem a renderizacao dos slots.' },
  { key: '06-agenda-fila', faixa: 'Task 30 a Task 34', mig: '0038 a 0039', nome: 'Agenda: lista de espera, sala de espera e os contadores do dia',
    prompt: 'Design §5.3 (Hoje e Agenda). Lista de espera com chamada para vaga liberada. A fila do dia e os contadores ao vivo (agendados/confirmados/aguardando/atendidos/faltas) — **consulta viva sobre indice parcial, NUNCA matview**: contador defasado e lido como "travou", que e a queixa que o produto existe para resolver. O painel "Precisa de voce": confirmacoes sem resposta, prescricoes nao assinadas, resultados chegados, rascunhos de ontem, guias a faturar. Check-in que promove o cadastro preliminar.' },
  { key: '07-pacientes', faixa: 'Task 35 a Task 40', mig: '0040 a 0041', nome: 'Pacientes: cadastro minimo viavel, busca e campos TISS',
    prompt: 'Design §5.5 fluxo (a). A regra **paciente minimo viavel**: nome + um canal bastam para agendar; `cadastro_status = preliminar`; CPF, nascimento e convenio viram divida de dados, cobrada no check-in (momento certo, com a pessoa na frente) e BLOQUEANTE na finalizacao do atendimento e no faturamento de convenio. Justificativa a registrar no plano: dado exigido na hora errada e dado falso, e dado falso contamina o grafico etario e o disparo de aniversariantes para sempre — e por isso que recepcionista digita 000.000.000-00. Estenda `clin.patient` e `clin.patient_identifier` que a Fase 0 JA criou (leia o schema real, nao recrie). Busca usando o `search_name` e `search_digits` ja existentes, com ordenacao `COLLATE "pt-BR-x-icu"`. E os ~14 campos da guia de consulta TISS capturados no atendimento desde ja, com o modulo tiss ainda inexistente: registroANS, numeroCarteira, atendimentoRN, CNES, conselho/numero/UF/CBOS, indicacaoAcidente, regimeAtendimento, tipoConsulta, dataAtendimento, tabela+codigo+valor.' },
  { key: '08-assinatura', faixa: 'Task 41 a Task 45', mig: '0042 a 0043', nome: 'Assinatura digital ICP-Brasil via PSC em nuvem',
    prompt: 'Design §7 e restricao 4. Interface `SignatureProvider` em `packages/integrations`, com implementacao contra PSC em nuvem (envia o HASH, recebe PKCS#7 — nunca toca na chave privada do medico, o que remove um passivo enorme) e uma implementacao fake para teste. Formato **AD-RT** com carimbo de tempo de ACT credenciada e material LTV arquivado (AD-RB nao existe no tipo: com guarda de 20 anos, a falha aparece no acervo inteiro de uma vez e nao tem correcao retroativa). A assinatura cobre o objeto canonico serializado pela canonicalizacao JCS do kernel, com `canonicalVersion` e `serializer_version` gravados. Validacao de cadeia e revogacao via LCR/OCSP no servidor. Fila de pendencias: se o PSC nao responde, o fluxo NAO trava — a pendencia vai para "Precisa de voce".' },
  { key: '09-documentos-export', faixa: 'Task 46 a Task 51', mig: '0044 a 0045', nome: 'Documentos, atestados e exportacao integral ECF.18',
    prompt: 'Design §7 e restricao 9. `packages/documents`: atestado, pedido de exame, relatorio e declaracao — cada um nato-digital, assinado pelo SignatureProvider, com PDF gerado (Playwright Chromium + pdf-lib) trazendo CNPJ e CNES em toda pagina. **Exportacao integral do prontuario (ECF.18)**: um unico comando; CPF do paciente e CNPJ/CNES em toda pagina; ordenacao pela data do EVENTO, nao do registro; numeracao x/y carimbada por ultimo; anexos junto e referenciados; recibo indissociavel com os ~11 campos; registros inativos aparecem TACHADOS. Sai em PDF/A-2b marcado (PDF/UA) — e documento que vai para tribunal e para fiscalizacao. Renderizacao em blocos com merge em streaming: prontuario de 20 anos com 500 anexos estoura memoria de outro jeito. Alvo p95 < 60s.' },
  { key: '10-prescricao', faixa: 'Task 52 a Task 55', mig: '0046', nome: 'Prescricao via Memed atras de interface propria',
    prompt: 'Design §7 e restricao 5. Interface `PrescriptionProvider` propria, com adaptador Memed e um fake para teste. As armadilhas REAIS a tratar no codigo e a documentar no plano: nao existe criar prescricao via API (so o modulo JS dentro da nossa tela — isso mata backend headless e app nativo puro); o retorno vem por EVENTO JS, nao webhook; o token do medico e DINAMICO e cachear como fixo e o bug classico; "documentos estruturados" (CID, categoria) nao vem ligado por padrao. **Persistimos do NOSSO lado id, link digital, codigo de desbloqueio e URL do PDF de cada prescricao, desde a primeira** — e o que impede virar refem do parceiro e o que permite migrar para Mevo depois. O modulo do parceiro carrega em BACKGROUND quando o atendimento abre, e a prescricao e painel ao lado, nao destino.' },
  { key: '11-app-shell', faixa: 'Task 56 a Task 60', mig: 'nenhuma', nome: 'App shell Next.js 15 e os tokens visuais',
    prompt: 'Design §6.1 a §6.3 e §5.2. Scaffold do `apps/web` com Next.js 15 App Router, React 19, Tailwind 4, TanStack Query 5, nuqs. SSR so para a casca; telas quentes sao cliente. Copie os tokens CSS LITERAIS da §6.2 (paleta OKLCH, tema claro e escuro) — **use --ambar-500: oklch(52% 0.140 75)**, que e o valor corrigido, e nao o antigo de L=72% que reprovava em contraste. Tipografia da §6.3: IBM Plex Sans para UI, Mono para codigos (CID, TUSS, guia, valores em coluna), Serif so no PDF; numeros SEMPRE tabulares em coluna. Escala de espaco, raio, elevacao e movimento (§6.4/6.5). A barra de navegacao da §5.2 na ordem cronologica do dia: Hoje, Agenda, Conversas, Pacientes, Financeiro, Desempenho — com os itens de fases futuras visiveis mas desabilitados de forma honesta.' },
  { key: '12-design-system', faixa: 'Task 61 a Task 66', mig: 'nenhuma', nome: 'Componentes centrais e acessibilidade',
    prompt: 'Design §6.4 e §6.6. Cada componente com anatomia, estados e o que NUNCA fazer: Botao (3 variantes; estado de carregamento NAO troca o rotulo por spinner — mantem o texto e adiciona barra de 2px na base, porque trocar o rotulo faz o usuario perder o lugar); Campo (rotulo sempre visivel, placeholder nao e rotulo; erro nunca so por cor, com aria-describedby); **Combobox de busca de paciente** (o componente mais importante do produto: debounce 120ms, nome social em destaque, "+ Criar" sempre na ultima linha, aria-activedescendant, alvo primeira tecla → primeiro resultado < 120ms p75); linha da agenda (barra de status de 3px na borda = FORMA para daltonicos; encaixe com hachura diagonal, nao outra cor); bloco de secao do prontuario (sem card: titulo, regua de 1px, conteudo; secao vazia colapsa em 24px — e o que permite 14 secoes sem virar acordeao infinito); **componente de versao retificada** (tachado com text-decoration-color danger, justificativa visivel, recolhido por padrao — e o verbo "Excluir" NAO existe no vocabulario do produto para registro finalizado); chip de status (cor + glifo, nunca cor sozinha); painel lateral compositor (420px, translateX 140ms, escurece 8% SEM blur porque o medico consulta o texto atras enquanto prescreve); faixa de contadores (cada numero e um button que filtra). Acessibilidade §6.6 verificada com axe: WCAG 2.2 AA, foco visivel com anel duplo, alvo 24px, prefers-reduced-motion zera duracoes.' },
  { key: '13-telas-hoje-agenda', faixa: 'Task 67 a Task 72', mig: 'nenhuma', nome: 'Telas: Hoje e Agenda',
    prompt: 'Design §5.3 e §5.5 fluxo (a). Tela **Hoje** (`/hoje`): faixa de contadores ao vivo onde cada numero filtra a fila, fila do dia com as acoes (check-in, abrir atendimento, reagendar, cobrar, mensagem) e os sinais (cadastro preliminar, a receber, 1a vez, teleconsulta), painel "Precisa de voce", aniversariantes, nota do dia. Tela **Agenda** (`/agenda`): visoes Dia/Semana/Mes/Por profissional/Por sala; **compositor inline no slot, nunca modal de pagina cheia**; lista de espera como painel lateral fixo com arrastar para o vao; bloqueios listrados; arraste com transform puro, alvo 60fps travado. O fluxo critico (a) implementado e medido por teste de interacao: 1 clique e ~26 teclas para agendar paciente novo com ele na linha, contra ~20 cliques e 2 trocas de contexto do lider. Todo filtro vira query string, para um link colado no WhatsApp da equipe abrir a mesma tela.' },
  { key: '14-telas-paciente-atendimento', faixa: 'Task 73 a Task 78', mig: 'nenhuma', nome: 'Telas: Pacientes e Atendimento',
    prompt: 'Design §5.3, §5.4 e §5.5 fluxo (b). `/pacientes` com facetas (as abas do lider viram filtros salvos) e `/pacientes/{id}` com cabecalho, Perfil (as 3 abas viram uma pagina com blocos progressivos e barra de "N dados pendentes"), aba **Atendimentos** (o que a RECEPCAO ve no lugar do Prontuario) e aba **Prontuario [P]**. A separacao Paciente x Prontuario espelha a policy RESTRICTIVE: a aba Prontuario simplesmente **NAO EXISTE** na navegacao da recepcao — botao cinza com cadeado comunica "seu produto esta quebrado" ou "pague mais". Implemente o **terceiro estado** da §5.4: RLS so sabe devolver conjunto vazio, e "nao existe" != "existe e voce nao tem acesso"; sem distinguir, o plantonista busca o CPF, recebe "nao encontrado", cria cadastro novo e prescreve sem ver a alergia. Funcao SECURITY DEFINER estreita responde apenas sim/nao sobre existencia, e a UI mostra "Paciente existe. Prontuario nao compartilhado com voce." com Solicitar acesso e **Quebra-vidro assistencial** (justificativa obrigatoria, prazo, evento de auditoria, notificacao ao responsavel). Tela **Atendimento** (`/atendimento/{id}`, foco sem barra global): editor TipTap com `#CID` inline, `/modelo`, `@valor anterior`, cronometro, Ctrl+R prescrever ao lado, Ctrl+Enter finaliza. Fluxo (b) com teste de interacao.' },
  { key: '15-api-rbac', faixa: 'Task 79 a Task 84', mig: 'nenhuma', nome: 'API Fastify, preambulo de transacao e RBAC',
    prompt: 'Design §2.1 e §2.3. No `apps/api`: o preambulo que monta o `Actor` a partir da sessao opaca da Fase 0 e abre transacao com o `withTenantTx` REAL (leia a assinatura em packages/db/src/tx.ts) — o `kind` certo por tipo de rota. Rotas com contrato Zod gerando OpenAPI para agenda, pacientes, atendimento (abrir rascunho, autosave, finalizar/retificar/adendar, linha do tempo), documentos, prescricao e exportacao. RBAC avaliado na borda usando o catalogo de acoes da Fase 0, conversando com o RLS **sem duplicar regra**: o RLS decide o que a linha permite, o authz o que a rota permite. Perfil administrativo nunca alcanca rota clinica. Alvos de latencia do Apendice A instrumentados. Nenhuma resposta com dado pessoal e cacheavel (`no-store` por hook global, testado). O `apps/worker` para o que sai da transacao: mensagens, PDF pesado, auto-finalizacao de rascunho de 7 dias. Teste obrigatorio: uma rota nunca vaza outro tenant, reusando o padrao da suite test:iso.' },
]

const resultados = await parallel(BLOCOS.map((b) => () =>
  agent([
    BASE, '', '---', '',
    '# SEU BLOCO: ' + b.nome,
    '',
    'Numere as tarefas em **' + b.faixa + '**. Migrations do seu bloco: **' + b.mig + '**.',
    '',
    '**GRAVE o markdown das suas tarefas em:** `' + DIR + '/' + b.key + '.md`',
    '',
    'O arquivo deve conter SO as tarefas (comecando direto em `### Task N:`), sem cabecalho de plano e sem secao de contexto — a montagem final cuida disso.',
    '',
    '## O que o seu bloco cobre',
    '',
    b.prompt,
  ].join('\n'), { label: 'bloco:' + b.key, phase: 'Redacao', schema: META_SCHEMA, effort: 'high' })
))

const ok = resultados.filter(Boolean)
log(ok.length + '/' + BLOCOS.length + ' blocos gravados · ' + ok.reduce((n, r) => n + (r.quantasTarefas || 0), 0) + ' tarefas')

phase('Reconciliacao')

const contratos = ok.map((r) => ({
  bloco: r.bloco,
  arquivo: r.arquivoGravado,
  tarefas: r.quantasTarefas,
  migrations: r.migrationsUsadas || [],
  define: r.defineParaOutrosBlocos,
  depende: r.dependeDe || [],
  fase0: r.consumidoDaFase0 || [],
  preocupacoes: r.preocupacoes || [],
}))

const rec = await agent([
  'Voce reconcilia os 15 blocos do plano da Fase 1 do Cadencia, que foram escritos em paralelo e cegos uns aos outros.',
  '',
  'Os arquivos estao em `' + DIR + '/`. **Leia todos** (use Glob e Read).',
  '',
  'Os metadados que cada bloco devolveu:',
  '',
  JSON.stringify(contratos, null, 1).slice(0, 60000),
  '',
  '## Sua tarefa',
  '',
  '1. **Ache as colisoes de contrato.** Se o bloco 13 chama `finalizeEncounter(encounterId)` e o bloco 3 define `finalize_encounter(p_encounter_id, p_kind, ...)`, isso e uma colisao. Liste cada uma com o nome vencedor e o motivo.',
  '2. **Ache as colisoes de migration.** Dois blocos usando o mesmo numero. A faixa correta esta no enunciado de cada bloco; quem saiu da faixa cede.',
  '3. **Ache o que foi assumido errado da Fase 0.** Compare `consumidoDaFase0` com o codigo real (leia `packages/db/src/tx.ts` e as migrations). Se algum bloco assumiu assinatura que nao existe, aponte a real.',
  '4. **Ordene as tarefas por dependencia**, e diga a ordem final dos arquivos. Regra: modelo de dados antes de quem consome; app shell e design system antes das telas; API depois dos backends. Uma tarefa nunca depende de outra posterior.',
  '5. **APLIQUE as correcoes** editando os arquivos com Edit. Nao devolva o markdown corrigido na resposta — edite no disco.',
  '',
  'Ao final, grave um arquivo `' + DIR + '/00-CONTRATOS.md` com: a ordem final dos blocos, a tabela de contratos unificados (nome, assinatura, arquivo, quem define, quem consome), o mapa de migrations 0024 em diante, e a lista de correcoes que voce aplicou.',
  '',
  'Na sua resposta, devolva um resumo curto: quantas colisoes achou, quantas corrigiu, e o que ficou pendente.',
].join('\n'), { label: 'reconciliacao', phase: 'Reconciliacao', effort: 'max' })

return { reconciliacao: rec, blocos: ok.length, contratos: contratos }
