export const meta = {
  name: 'plano-fase5-cadencia',
  description: 'Escreve o plano da Fase 5 em 10 blocos pequenos; cada agente GRAVA seu bloco em arquivo e devolve so os contratos, evitando o limite de saida',
  phases: [
    { title: 'Redacao', detail: '10 blocos pequenos, cada um gravado em arquivo' },
    { title: 'Reconciliacao', detail: 'unificar contratos e ordenar as tarefas' },
  ],
}

const RAIZ = 'C:/Users/Felipe/Downloads/novo projeto'
const DESIGN = RAIZ + '/docs/superpowers/specs/2026-08-03-design-sistema.md'
const DIR = RAIZ + '/docs/superpowers/plans/fase5'

const BASE = [
'# CONTEXTO',
'',
'Voce escreve UM BLOCO do plano de implementacao da **Fase 5 ("A glosa e o SOAP")** do Cadencia — SaaS multi-tenant brasileiro de prontuario e gestao para clinicas medicas.',
'',
'**Fases ja CONSTRUIDAS e verdes:**',
'- **Fase 0 (Fundacao):** kernel, db, withTenantTx, audit (2 canais + selo), authn, authz, catalogs (CID-10 e TUSS versionada por data), 10+1 invariantes CI, restore:drill.',
'- **Fase 1 (O dia):** Hoje, Agenda, Pacientes, motor de prontuario (finalize_encounter com 9 passos, retificar, adendo), Documentos com ICP-Brasil AD-RT, Exportacao ECF.18, Prescricao via Memed, App shell Next.js 15, design system, API Fastify.',
'- **Fase 2 (A conversa e o caixa):** WhatsApp bidirecional, automacoes, recebimento, link de pagamento, conciliacao, recibo.',
'- **Fase 3 (O dinheiro):** Financeiro completo, repasse medico (split_rule, split, repasse_batch), estoque, Desempenho (Explorar + 11 visoes salvas + atribuicao de variacao com compute-variation).',
'- **Fase 4 (Os convenios):** TISS completo — 10 tabelas em `tiss.*` (operadora, contrato, paciente_convenio, encounter_guia_consulta, guia_ajuste, guia_counter, guia_pendencia, lote, lote_number_counter, lote_guia), carga TUSS bimestral (ref.tuss_staging + ref.tuss_load_log), projecao de guia (projectGuiaConsulta), reprojecao pos-amend (reprojectGuiaOnAmend com deteccao de lote enviado), ciclo de vida do lote, serializador XML TISS 4.01.00 (ISO-8859-1 + MD5 proprietario), TissArquivoTransport com StorageAdapter, telas de Convenios (a faturar, lotes, operadoras), API REST com RBAC. 13 migrations (0110-0122), total acumulado 122.',
'',
'## LEIA ANTES DE ESCREVER — obrigatorio',
'',
'1. **Design**: `' + DESIGN + '`. §7.5 TissTransport (fetchDemonstrativo e submitRecursoGlosa) · §8 Faseamento (Fase 5 "sob demanda") · §2.4 resolucao de contradicao guia TISS ("recurso de glosa precisa reproduzir") · §3.9 regra de reprojecao ("recurso de glosa sempre cita a versao usada") · §5.3 mapa de telas (Convenios: a faturar → lotes → retornos e glosas) · §5.5 Desempenho variacao ("glosas nao recuperadas" como fator) · §7 seguranca de provider (timeout nunca gera retry em operacao unsafe — "lote TISS glosado por duplicidade").',
'2. **O codigo REAL das Fases 0-4.** Use Read/Grep para descobrir as assinaturas verdadeiras:',
'   - `packages/db/src/tx.ts` — `withTenantTx(actor, fn, pool?)` e o tipo `Actor`',
'   - `packages/db/migrations/*.sql` — 122 migrations. Schema real incluindo tiss.*',
'   - `packages/tiss/src/` — operadora.ts, contrato.ts, paciente-convenio.ts, project-guia.ts, reproject-guia.ts, create-lote.ts, lote-guias.ts, lote-lifecycle.ts, test-support.ts',
'   - `packages/tiss/src/serializer/` — serialize-lote-consulta.ts, encode-iso8859.ts, compute-tiss-hash.ts, xml-builder.ts',
'   - `packages/tiss/src/transport/` — types.ts (TissTransport, TissSubmissionReceipt), tiss-arquivo.ts, registry.ts (TISS_TRANSPORT_REGISTRY, getTransportIds, getTransportFactory), fake-transport.ts',
'   - `packages/reports/src/compute-variation.ts` — atribuicao de variacao (a Fase 5 adiciona "glosas nao recuperadas")',
'   - `packages/events/src/domain-events.ts` — 11 EVENT_TYPES ate a Fase 4',
'   - `packages/db/privileges.json` — fonte unica de GRANTs',
'   - `apps/web/app/(main)/financeiro/convenios/` — telas de Convenios ja existentes',
'   - `apps/api/src/routes/tiss/` — rotas TISS ja existentes',
'',
'**A PROXIMA MIGRATION LIVRE e a 0123.** Descubra quais numeros o seu bloco usa contando a partir dela e do que os blocos anteriores ao seu ja consumiram (a faixa de migrations do seu bloco esta no enunciado).',
'',
'## REGRAS DE ARQUITETURA (herdadas, valem aqui)',
'',
'Irmao nunca importa irmao; setas so descem (L0 → L1 → L2 → L3). Migrations forward-only, uma transacao por arquivo. Fonte de tempo persistido e o PostgreSQL. CNPJ alfanumerico. `COLLATE "pt-BR-x-icu"` em coluna ordenada para humano. Toda tabela multi-tenant nasce com `tenant_id`, RLS habilitada e **forcada**, ao menos uma policy, e FK composta `(tenant_id, ...)`. Matviews em `rpt` do `rpt_owner` sem GRANT para `app_rw`, expostas por views `security_barrier` em `app_rpt`.',
'',
'**Regras especificas TISS (continuam validas):**',
'- Nenhuma ocorrencia de `now()` ou `current_date` dentro do schema `tiss`.',
'- Terminologia versionada por data do atendimento: `ref.tuss_at(tabela, codigo, data)`.',
'- XML usa ISO-8859-1, NAO UTF-8. Hash MD5 proprietario.',
'- Recurso de glosa sempre cita a `encounter_version_id` usada (§3.9).',
'- Timeout NUNCA gera retry automatico em operacao `unsafe` — gera estado `indeterminado` com reconciliacao (§7).',
'- tiss-soap so existe com credencial real. O test de CI da Fase 4 (registry-invariant.test.ts) deve ser atualizado SOMENTE quando o tiss-soap for registrado.',
'',
'## STACK (mesma)',
'',
'Front: Next.js 15 App Router + React 19 · TanStack Query 5 · React Hook Form 7 · nuqs 2 · Tailwind 4 + tokens CSS · Radix headless. API: Fastify 5 + zod. Back: TypeScript strict, vitest. DB: PostgreSQL 16+ com RLS forcada.',
'',
'## COMO ESCREVER',
'',
'Cada passo e UMA acao de 2 a 5 minutos, no ciclo TDD: teste que falha → rodar e confirmar a falha → implementar o minimo → confirmar que passa → commitar.',
'',
'Formato: `### Task N: nome`, bloco **Arquivos**, passos `- [ ]` com **codigo completo** em todo passo que mexe em codigo, comandos exatos com saida esperada.',
'',
'**PROIBIDO**: "TBD", "TODO", "implementar depois", "igual a Task N" (repita o codigo), passo sem bloco de codigo quando mexe em codigo, referencia a tipo/funcao/rota que nenhuma tarefa definiu.',
'',
'Portugues do Brasil no texto; codigo e identificadores em ingles; comentarios e nomes de teste em portugues. Conventional Commits em ingles.',
'',
'## ENTREGA',
'',
'**Voce NAO devolve o markdown na resposta.** Em vez disso:',
'1. **Grave o markdown das suas tarefas** com Write, no arquivo que o enunciado indica.',
'2. Se grande, grave em partes: Write + Edit.',
'3. Na resposta estruturada, devolva SO os metadados.',
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
    consumidoDasFasesAnteriores: { type: 'array', items: { type: 'string' } },
    preocupacoes: { type: 'array', items: { type: 'string' } },
  },
  required: ['bloco', 'arquivoGravado', 'quantasTarefas', 'defineParaOutrosBlocos'],
}

phase('Redacao')

const BLOCOS = [
  { key: '01-demonstrativo-modelo', faixa: 'Task 1 a Task 6', mig: '0123 a 0124', nome: 'Demonstrativo de retorno: modelo de dados',
    prompt: 'Design §7.5 (fetchDemonstrativo retorna xml Uint8Array com kind analise|pagamento) e §5.3 (Convenios: retornos e glosas). O demonstrativo e o retorno que a operadora envia ao prestador apos processar um lote — contem o resultado financeiro de cada guia. `tiss.demonstrativo` (tenant_id, id, operadora_id FK composta, lote_id FK composta nullable — pode vir avulso, protocolo_operadora varchar, kind enum (analise, pagamento), data_processamento date NOT NULL, data_pagamento date nullable — so em pagamento, xml_storage_key text — XML original recebido, total_apresentado_cents bigint, total_processado_cents bigint, total_liberado_cents bigint, total_glosa_cents bigint, imported_at timestamptz DEFAULT clock_timestamp(), imported_by uuid). `tiss.demonstrativo_item` (tenant_id, id, demonstrativo_id FK composta, guia_id FK composta — liga ao encounter_guia_consulta, numero_guia_prestador varchar(20) — para match, valor_apresentado_cents bigint, valor_processado_cents bigint, valor_liberado_cents bigint, valor_glosa_cents bigint, glosa_codigo varchar(4) nullable, glosa_descricao text nullable). RLS em tudo, FK composta, isolation suite. privileges.json com GRANTs para app_rw e jobs. Quando o demonstrativo e importado e vinculado a um lote, atualizar o status do lote para `retornado`.' },
  { key: '02-demonstrativo-parser', faixa: 'Task 7 a Task 12', mig: 'nenhuma', nome: 'Parser de XML de demonstrativo TISS',
    prompt: 'Design §7.5 (fetchDemonstrativo). Funcao pura `parseDemonstrativoXml(xml: Uint8Array): ParsedDemonstrativo` em `packages/tiss/src/demonstrativo/parse-demonstrativo.ts`. Recebe o XML do demonstrativo (ISO-8859-1), decodifica para string, extrai os campos estruturados. Retorna um objeto tipado com cabecalho (protocolo, data processamento, tipo) e array de itens (numero_guia, valores, glosas). Use um parser XML leve (DOMParser nao existe em Node, use um parser SAX/pull ou parse manual por regex para o subset limitado do XSD TISS). O parser deve ser PURO e deterministico — sem I/O, sem side-effects. Funcao `importDemonstrativo(tx, demonstrativoInput, importedBy)` em `packages/tiss/src/demonstrativo/import-demonstrativo.ts` que: (1) chama parseDemonstrativoXml, (2) faz match de cada numero_guia_prestador com tiss.encounter_guia_consulta, (3) insere em tiss.demonstrativo e tiss.demonstrativo_item, (4) marca guias com glosa, (5) atualiza lote.status para retornado se lote_id presente. Teste: XML de amostra com 3 guias (1 paga integral, 1 com glosa parcial, 1 com glosa total) → importar → verificar valores e vinculos.' },
  { key: '03-glosa-modelo', faixa: 'Task 13 a Task 18', mig: '0125 a 0126', nome: 'Glosa e recurso de glosa: modelo de dados',
    prompt: 'Design §3.9 ("recurso de glosa sempre cita a versao usada") e §2.4 ("recurso de glosa precisa reproduzir"). `tiss.glosa` (tenant_id, id, demonstrativo_item_id FK composta, guia_id FK composta, encounter_version_id FK composta — a versao do prontuario que gerou a guia glosada, codigo_glosa varchar(4) NOT NULL — codigo padrao ANS, descricao_glosa text NOT NULL, valor_glosado_cents bigint NOT NULL CHECK > 0, status enum (pendente, aceita, contestada, revertida) DEFAULT pendente, resolved_at timestamptz nullable, resolved_by uuid nullable, created_at timestamptz DEFAULT clock_timestamp()). `tiss.recurso_glosa` (tenant_id, id, operadora_id FK composta, numero_recurso varchar(20) sequencial, status enum (rascunho, pronto, enviado, deferido, indeferido, parcial) DEFAULT rascunho, justificativa_geral text, encounter_version_id FK composta — a versao citada no recurso §3.9, xml_storage_key text nullable, protocolo_operadora varchar nullable, sent_at timestamptz nullable, created_by uuid, created_at timestamptz). `tiss.recurso_glosa_item` (tenant_id, id, recurso_id FK composta, glosa_id FK composta, justificativa_item text NOT NULL — justificativa especifica por glosa, valor_recursado_cents bigint NOT NULL). RLS, FK composta, isolation suite. Quando recurso e deferido, atualizar status das glosas vinculadas para `revertida`. Quando indeferido, atualizar para `aceita`. Quando parcial, marcar individualmente.' },
  { key: '04-recurso-glosa-dominio', faixa: 'Task 19 a Task 24', mig: 'nenhuma', nome: 'Dominio do recurso de glosa: criar, editar, submeter',
    prompt: 'Design §3.9 e §7 (timeout nunca gera retry em unsafe). Funcoes em `packages/tiss/src/recurso-glosa/`: (1) `createRecursoGlosa(tx, input)` — cria recurso em rascunho, vincula glosas selecionadas via recurso_glosa_item com justificativa individual, valida que todas as glosas sao do mesmo tenant e estao em status pendente. (2) `addGlosaToRecurso(tx, recursoId, glosaId, justificativa, valorRecursado)` e `removeGlosaFromRecurso`. (3) `markRecursoReady(tx, recursoId)` — valida que tem pelo menos 1 item, justificativa geral preenchida, transiciona para pronto. (4) `submitRecurso(tx, recursoId, transport)` — serializa XML do recurso, chama `transport.submitRecursoGlosa`, grava protocolo, transiciona para enviado. Se timeout, transiciona para `indeterminado` (adicione ao enum se necessario) com reconciliacao agendada, NUNCA retry automatico. (5) `resolveRecurso(tx, recursoId, resultado: deferido|indeferido|parcial, itensResolvidos)` — atualiza status do recurso e das glosas vinculadas conforme o resultado. Teste TDD completo: criar → adicionar glosas → marcar pronto → submeter (com fake transport) → resolver.' },
  { key: '05-recurso-xml-serializer', faixa: 'Task 25 a Task 30', mig: 'nenhuma', nome: 'Serializador XML de recurso de glosa TISS',
    prompt: 'Design §7.5 (submitRecursoGlosa envia xml Uint8Array). Funcao pura `serializeRecursoGlosa(input: RecursoGlosaInput): Uint8Array` em `packages/tiss/src/serializer/serialize-recurso-glosa.ts`. Reutiliza o pipeline do lote: XmlBuilder, encode-iso8859, compute-tiss-hash (o hash do recurso segue a mesma logica do lote — concatena campos do cabecalho + itens na ordem do XSD). Estrutura XML do recurso de glosa TISS: `<ans:mensagemTISS>` com `<ans:recursoGlosa>` contendo cabecalho (registroANS, numero do lote original, numero da guia), itens do recurso (codigo glosa, justificativa, valor recursado), e hash. Namespace e encoding identicos ao lote. Tipos de entrada: `RecursoGlosaInput` (cabecalho + itens com justificativas + dados do prestador). Teste: serializar recurso de amostra, validar snapshot byte-a-byte, testar acentos em justificativa preservados em ISO-8859-1.' },
  { key: '06-tiss-soap', faixa: 'Task 31 a Task 36', mig: '0127', nome: 'TissSoapTransport: implementacao SOAP condicionada a credencial',
    prompt: 'Design §7.5 ("SOAP depois", "so com credencial de cliente real") e §8 ("credenciais e homologacao pertencem ao prestador, nao a nos"). `TissSoapTransport` em `packages/tiss/src/transport/tiss-soap.ts`: implementa a interface TissTransport com mode = webservice. Os 3 metodos (submitBatch, fetchDemonstrativo, submitRecursoGlosa) fazem chamadas SOAP aos endpoints da operadora. Usar o modulo `node:http` com XML bruto (NAO usar bibliotecas SOAP pesadas — o envelope e simples e fixo por XSD). O WSDL nao e parseado em runtime: os endpoints sao configurados por operadora em `tiss.contrato` (adicionar colunas `soap_endpoint_url text`, `soap_username text`, `soap_password_encrypted text` — migration 0127). O transport verifica que as credenciais existem antes de tentar — se ausentes, retorna erro tipado `SoapNotConfigured`, nao exception. **Timeout e reconciliacao**: se a chamada SOAP falha com timeout, o resultado e `indeterminado` — persiste o estado e agenda reconciliacao, NUNCA retry automatico (§7). **Registry**: atualizar `packages/tiss/src/transport/registry.ts` para registrar `tiss-soap` CONDICIONALMENTE — so se a operadora tem soap_endpoint configurado. Atualizar o teste `registry-invariant.test.ts` para aceitar tiss-soap no registry (remover a restricao da Fase 4). Teste: mock de HTTP respondendo envelope SOAP, verificar parsing do protocolo; timeout → estado indeterminado; credencial ausente → SoapNotConfigured.' },
  { key: '07-retornos-glosas-telas', faixa: 'Task 37 a Task 44', mig: 'nenhuma', nome: 'Telas: Retornos e glosas',
    prompt: 'Design §5.3 (Convenios: a faturar → lotes → retornos e glosas). As telas vivem em `apps/web/app/(main)/financeiro/convenios/retornos/`. **"Retornos"** (`/financeiro/convenios/retornos`): lista de demonstrativos importados com filtros (operadora, periodo, tipo analise/pagamento), totalizadores (apresentado, processado, liberado, glosado), acao "Importar" que abre dialog de upload de XML. **"Glosas"** (sub-aba ou filtro dentro de retornos): lista de glosas agrupadas por guia, com filtros (status, operadora, periodo, valor), selecao multipla para "Criar recurso", badge de valor total glosado pendente. **"Recursos"** (sub-aba): lista de recursos de glosa com status visual (chip), acoes (editar, enviar, ver resultado), expandir mostra itens do recurso com justificativa. **Detalhe do demonstrativo**: painel lateral com itens, valores lado a lado (apresentado vs processado vs liberado vs glosado), destaque para itens com glosa. **Form de recurso**: wizard 2 passos — (1) selecionar glosas e preencher justificativa individual, (2) justificativa geral + revisar + submeter. Atualizar o ConveniosLayout para adicionar sub-aba "Retornos" ao lado de "A faturar", "Lotes", "Operadoras". Atualizar contadores na faixa: adicionar "glosas pendentes" e "recursos rascunho". Navegacao via nuqs.' },
  { key: '08-api-rbac', faixa: 'Task 45 a Task 50', mig: 'nenhuma', nome: 'API Fastify e RBAC para demonstrativo, glosa e recurso',
    prompt: 'Rotas em `apps/api/src/routes/tiss/`: demonstrativos (importar XML — multipart upload, listar com paginacao, detalhe com itens), glosas (listar com filtros, detalhe, aceitar glosa individual — muda status para aceita), recursos (criar, adicionar/remover glosa, marcar pronto, enviar — dispara serializacao + transport, listar, detalhe, resolver com resultado). Contrato Zod em cada rota, OpenAPI. RBAC: novas acoes — `tiss.demonstrativo.import`, `tiss.demonstrativo.read`, `tiss.glosa.read`, `tiss.glosa.manage`, `tiss.recurso.manage`, `tiss.recurso.send`. Perfil `admin_clinico` e `financeiro` tem todas; `recepcao` tem `tiss.demonstrativo.read` e `tiss.glosa.read`. Latencia: importacao de demonstrativo < 3s p95 (parse + insert). `no-store` em tudo. Teste: isolamento multi-tenant nas rotas novas.' },
  { key: '09-desempenho-glosas', faixa: 'Task 51 a Task 55', mig: '0128 a 0129', nome: 'Desempenho: "glosas nao recuperadas" na atribuicao de variacao',
    prompt: 'Design §5.5 (decomposicao: "glosas nao recuperadas -R$2.400"). A matview `rpt.mv_financeiro` (ou outra matview relevante — LEIA o codigo real em packages/db/migrations/0106*) precisa incluir dados de glosa. Migration 0128: adicionar view ou matview que agrega glosas aceitas (status = aceita, valor_glosado_cents) por periodo, operadora, profissional. Migration 0129: criar view security_barrier em app_rpt para expor os dados de glosa ao reports. Em `packages/reports/src/compute-variation.ts`: adicionar "glosas nao recuperadas" como fator na decomposicao de receita — e a diferenca de glosas aceitas entre periodo A e periodo B. Atualizar a funcao de atribuicao para incluir esse fator ao lado de "faltas e cancelamentos", "mix de convenio", "ticket medio". Teste: cenario com glosas aceitas no periodo A e nenhuma no B → variacao positiva; cenario inverso → variacao negativa com fator "glosas nao recuperadas" destacado.' },
  { key: '10-invariantes-dod', faixa: 'Task 56 a Task 60', mig: 'nenhuma', nome: 'Invariantes CI e demonstracao end-to-end Fase 5',
    prompt: 'Design §3.13 e §8. Garantir que os invariantes existentes cobrem as novas tabelas: (a) tiss.demonstrativo, tiss.demonstrativo_item, tiss.glosa, tiss.recurso_glosa, tiss.recurso_glosa_item no escopo de RLS forcada, (b) nenhum now()/current_date no schema tiss (inclui as novas queries), (c) tiss-soap no registry so quando configurado (atualizar invariante). **Demonstracao end-to-end** como teste de integracao: criar tenant → operadora com contrato → paciente com convenio → finalizar encounter → guia projetada → criar lote → enviar lote → importar demonstrativo com glosa parcial → verificar glosa criada → criar recurso de glosa → marcar pronto → submeter recurso (fake transport) → resolver recurso como deferido → verificar glosa revertida e valor recuperado. O gate da Fase 5: typecheck limpo, lint limpo, testes verdes, invariantes CI passando.' },
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
  fasesAnteriores: r.consumidoDasFasesAnteriores || [],
  preocupacoes: r.preocupacoes || [],
}))

const rec = await agent([
  'Voce reconcilia os 10 blocos do plano da Fase 5 do Cadencia, que foram escritos em paralelo e cegos uns aos outros.',
  '',
  'Os arquivos estao em `' + DIR + '/`. **Leia todos** (use Glob e Read).',
  '',
  'Os metadados que cada bloco devolveu:',
  '',
  JSON.stringify(contratos, null, 1).slice(0, 60000),
  '',
  '## Sua tarefa',
  '',
  '1. **Ache as colisoes de contrato.** Nomes divergentes, assinaturas incompativeis, enums conflitantes. Liste cada uma com o vencedor e o motivo.',
  '2. **Ache as colisoes de migration.** Dois blocos usando o mesmo numero. A faixa correta esta no enunciado de cada bloco; quem saiu da faixa cede.',
  '3. **Ache o que foi assumido errado das Fases 0-4.** Compare `consumidoDasFasesAnteriores` com o codigo real (leia os arquivos relevantes). Se algum bloco assumiu assinatura que nao existe, aponte a real.',
  '4. **Ordene as tarefas por dependencia.** Regra: modelo de dados antes de quem consome; parser antes de import; serializer antes de transport; dominio antes de API; API antes de telas; Desempenho antes de invariantes/e2e.',
  '5. **APLIQUE as correcoes** editando os arquivos com Edit. Nao devolva o markdown corrigido na resposta — edite no disco.',
  '',
  'Ao final, grave um arquivo `' + DIR + '/00-CONTRATOS.md` com: a ordem final dos blocos, a tabela de contratos unificados, o mapa de migrations 0123 em diante, e a lista de correcoes aplicadas.',
  '',
  'Na sua resposta, devolva um resumo curto: quantas colisoes achou, quantas corrigiu, e o que ficou pendente.',
].join('\n'), { label: 'reconciliacao', phase: 'Reconciliacao', effort: 'max' })

return { reconciliacao: rec, blocos: ok.length, contratos: contratos }
