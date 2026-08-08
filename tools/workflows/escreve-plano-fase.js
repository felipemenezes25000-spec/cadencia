export const meta = {
  name: 'plano-fase4-cadencia',
  description: 'Escreve o plano da Fase 4 em 11 blocos pequenos; cada agente GRAVA seu bloco em arquivo e devolve so os contratos, evitando o limite de saida',
  phases: [
    { title: 'Redacao', detail: '11 blocos pequenos, cada um gravado em arquivo' },
    { title: 'Reconciliacao', detail: 'unificar contratos e ordenar as tarefas' },
  ],
}

const RAIZ = 'C:/Users/Felipe/Downloads/novo projeto'
const DESIGN = RAIZ + '/docs/superpowers/specs/2026-08-03-design-sistema.md'
const DIR = RAIZ + '/docs/superpowers/plans/fase4'

const BASE = [
'# CONTEXTO',
'',
'Voce escreve UM BLOCO do plano de implementacao da **Fase 4 ("Os convenios")** do Cadencia — SaaS multi-tenant brasileiro de prontuario e gestao para clinicas medicas.',
'',
'**Fases ja CONSTRUIDAS e verdes:**',
'- **Fase 0 (Fundacao):** kernel, db, withTenantTx, audit (2 canais + selo), authn (sessao opaca, Argon2id, TOTP), authz (catalogo de acoes), identity/tenancy/people/patients/catalogs (CID-10 e TUSS versionada por data), pipeline com 10+1 invariantes CI, restore:drill.',
'- **Fase 1 (O dia):** Hoje, Agenda (encaixe, lista de espera, recorrencia materializada), Pacientes (cadastro minimo viavel com divida de dados), motor de prontuario (secoes x campos, finalize_encounter, retificar, adendo, linha do tempo), Documentos com assinatura ICP-Brasil AD-RT, Exportacao ECF.18, Prescricao via Memed, App shell Next.js 15, design system, API Fastify.',
'- **Fase 2 (A conversa e o caixa):** WhatsApp bidirecional, confirmacao/lembrete/pos-consulta, NPS, recebimento no atendimento, link de pagamento, conciliacao basica, recibo.',
'- **Fase 3 (O dinheiro):** Financeiro completo (a receber/a pagar, fluxo de caixa, extrato, categorias, centro de custo, contas bancarias), repasse medico (split_rule, split, repasse_batch), estoque (supplier, product, stock_movement, stock_alert), Desempenho (Explorar + 11 visoes salvas + atribuicao de variacao). 24 migrations (0086-0109), total acumulado ate 0109.',
'',
'## LEIA ANTES DE ESCREVER — obrigatorio',
'',
'1. **Design**: `' + DESIGN + '`. §3.9 TISS e terminologia versionada · §7.5 TissTransport · §8 Faseamento (Fase 4). Leia tambem: §2.2 DAG de modulos (tiss e L2) · §3.1 papeis (jobs carrega TUSS) · §3.7 auditoria (selo considera lote TISS) · §3.13 invariantes CI (tiss no RLS forcado, proibido now()/current_date em tiss) · §4.3 passo 7 finalize_encounter (projeta guia se convenio) · §5.2 navegacao (Convenios) · §5.3 mapa de telas.',
'2. **O codigo REAL das Fases 0-3.** Use Read/Grep para descobrir as assinaturas verdadeiras:',
'   - `packages/db/src/tx.ts` — `withTenantTx(actor, fn, pool?)` e o tipo `Actor`',
'   - `packages/db/migrations/*.sql` — 109 migrations. Schema real de `app.*`, `clin.*`, `fin.*`, `sched.*`, `inv.*`, `ref.*`, `rpt.*`, `audit.*`, `id.*`, `tiss` (schema vazio criado em 0002)',
'   - `packages/kernel/src/` — `Result`, erros, `uuidv7`, `Clock`, `Money`, canonicalizacao JCS',
'   - `packages/audit/src/` — canal A, canal B, selo',
'   - `packages/authn/`, `packages/authz/`, `packages/catalogs/`',
'   - `packages/scheduling/`, `packages/emr/`, `packages/documents/`, `packages/prescriptions/`',
'   - `packages/payments/src/` — record-payment, split, repasse',
'   - `packages/inventory/src/` — stock-alert-job',
'   - `packages/reports/src/` — compute-variation, visoes salvas',
'   - `packages/tiss/src/index.ts` — stub vazio (`export {}`) pronto para receber o codigo',
'   - `clin.encounter_billing` (migration 0042) — JA captura os ~14 campos da guia TISS desde a Fase 1',
'   - `ref.tuss_term` — tabela GLOBAL, daterange + EXCLUDE USING gist, funcao `ref.tuss_at()`',
'   - `packages/db/privileges.json` — fonte unica de GRANTs',
'   - `packages/db/test/iso/` — suite de isolamento que a Fase 4 estende',
'',
'**A PROXIMA MIGRATION LIVRE e a 0110.** Descubra quais numeros o seu bloco usa contando a partir dela e do que os blocos anteriores ao seu ja consumiram (a faixa de migrations do seu bloco esta no enunciado).',
'',
'## REGRAS DE ARQUITETURA (herdadas, valem aqui)',
'',
'Irmao nunca importa irmao; setas so descem (L0 plataforma → L1 cadastros → L2 operacao → L3 apps). Migrations forward-only, uma transacao por arquivo. Fonte de tempo persistido e o PostgreSQL. CNPJ alfanumerico. `COLLATE "pt-BR-x-icu"` em coluna ordenada para humano. Toda tabela multi-tenant nasce com `tenant_id`, RLS habilitada e **forcada**, ao menos uma policy, e FK sempre composta `(tenant_id, ...)` — a suite `test:iso` descobre tabelas do catalogo e reprova quem esquecer.',
'',
'**Regras especificas TISS:**',
'- Nenhuma ocorrencia de `now()` ou `current_date` dentro do schema `tiss` — invariante de CI.',
'- Terminologia versionada por data do atendimento: usar `ref.tuss_at(tabela, codigo, data)`, NUNCA current_date.',
'- Guia e projecao do atendimento, NAO formulario separado — dados vem de encounter_billing + encounter_version.',
'- XML usa ISO-8859-1, NAO UTF-8. Hash MD5 proprietario embutido no XML.',
'- `codigo_tabela` CHECK `<> \'18\'` (tabela 18 e particular, nao entra em guia).',
'- Sem coluna CID na guia: item 32 do padrao proibe operadora de exigir CID.',
'- `occurred_date` (fuso da clinica) e a data do atendimento, nunca `occurred_at::date`.',
'- tiss-soap NAO existe ate haver credencial real. Teste garante que registry so conhece tiss-arquivo.',
'',
'## STACK (mesma da Fase 1, sem novidades)',
'',
'Front: Next.js 15 App Router + React 19 · TanStack Query 5 · React Hook Form 7 · nuqs 2 · Tailwind 4 + tokens CSS proprios · Radix headless. API: Fastify 5 + fastify-type-provider-zod. Back: TypeScript strict, vitest, Playwright. DB: PostgreSQL 16+ com RLS forcada.',
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
'3. Na sua resposta estruturada, devolva SO os metadados: contratos que voce define, do que depende, e o que consumiu das Fases 0-3.',
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
  { key: '01-operadora-contrato', faixa: 'Task 1 a Task 7', mig: '0110 a 0112', nome: 'Operadora, contrato e vinculo paciente-convenio',
    prompt: 'Design §3.9 e §5.3. `tiss.operadora` (registro ANS, CNPJ, nome, contato, ativa, dados de acesso ao portal) — e o cadastro da operadora de plano de saude por tenant. `tiss.contrato` (vinculo operadora x prestador: codigo do prestador na operadora, tipo de acomodacao, abrangencia, vigencia, tabela de precos acordada — que pode divergir da TUSS). `tiss.paciente_convenio` (vinculo paciente x operadora: numero da carteira, validade, plano, titular/dependente) — quem tem mais de um convenio tem mais de uma linha. RLS em tudo, FK composta, isolation suite. O campo `codigo_prestador_na_operadora` de `encounter_guia_consulta` vem daqui. CRUD no `packages/tiss` com validacao Zod. privileges.json com GRANTs para app_rw e jobs.' },
  { key: '02-tuss-carga', faixa: 'Task 8 a Task 12', mig: '0113', nome: 'Infraestrutura de carga TUSS bimestral',
    prompt: 'Design §3.9 (carga bimestral). A tabela `ref.tuss_term` JA EXISTE (leia a migration original e a funcao `ref.tuss_at`). O que falta e a infraestrutura de carga: `ref.tuss_staging` (tabela temporaria com mesma estrutura), job que faz staging → validacao → swap por particao logica (TRUNCATE staging + INSERT INTO tuss_term com ON CONFLICT para termos novos/atualizados, marcando `acao`), NUNCA UPDATE em massa com a tabela sendo lida. Audit trail da carga (quantos termos inseridos, atualizados, desativados, competencia carregada). O job roda como papel `jobs` (BYPASSRLS). Teste: carregar ~100 termos de amostra, verificar que tuss_at retorna o correto por data, verificar que carga duplicada e idempotente.' },
  { key: '03-guia-modelo', faixa: 'Task 13 a Task 20', mig: '0114 a 0116', nome: 'Tabelas da guia: encounter_guia_consulta, guia_ajuste e contador',
    prompt: 'Design §3.9 DDL LITERAL da guia. `tiss.encounter_guia_consulta` com o DDL EXATO do design (copie coluna a coluna, constraints, indices, FKs). `tiss.guia_ajuste` (tenant_id, id, guia_id FK composta, campo_alterado, valor_anterior, valor_novo, motivo text NOT NULL, created_by, created_at — append-only, auditavel). `tiss.guia_counter` (tenant_id PK, next_value bigint NOT NULL DEFAULT 1) com funcao `tiss.next_guia_number(p_tenant_id)` que faz INSERT ON CONFLICT DO UPDATE SET next_value = guia_counter.next_value + 1 RETURNING next_value — auto-provisiona na primeira guia de cada tenant. RLS em tudo (guia_counter precisa de policy para app_rw). FK de guia para encounter_version e composta. Indices: o unico parcial `ux_guia_live` do design. Isolation suite. privileges.json. Teste: inserir guia, verificar unicidade de numero_guia_prestador por tenant, verificar que counter auto-provisiona.' },
  { key: '04-guia-projecao', faixa: 'Task 21 a Task 27', mig: '0117', nome: 'Projecao da guia a partir do atendimento finalizado',
    prompt: 'Design §4.3 passo 7 e §3.9. A funcao `projectGuiaConsulta(tx, encounterId, encounterVersionId)` em `packages/tiss/src/project-guia.ts`. Ela le `clin.encounter_billing` (que JA captura os ~14 campos TISS desde a Fase 1 — LEIA a migration 0042 para ver as colunas reais), busca o `tiss.paciente_convenio` do paciente e o `tiss.contrato` do prestador, chama `tiss.next_guia_number()`, e insere em `tiss.encounter_guia_consulta`. A `data_atendimento` e `encounter.occurred_date` (fuso da clinica, NUNCA occurred_at::date). Usar `ref.tuss_at(tabela, codigo, data_atendimento)` para validar que o procedimento existe na TUSS vigente. Se o atendimento nao tem convenio (particular), NAO projeta guia — retorna Result.ok com flag `skipped: true`. Se dados obrigatorios faltam (carteira, CNES, conselho), retorna Result.err com lista de campos ausentes — a finalizacao NAO falha, mas a guia fica pendente em "a faturar" com status `incompleta`. Migration 0117: ALTER de `clin.finalize_encounter` ou hook para chamar a projecao (prefira evento no outbox com handler sincrono na mesma tx, para nao acoplar tiss dentro de emr). Teste TDD completo: encounter com convenio → guia projetada; sem convenio → skip; dados incompletos → guia incompleta.' },
  { key: '05-reprojecao-amend', faixa: 'Task 28 a Task 32', mig: '0118', nome: 'Reprojecao da guia apos retificacao ou adendo',
    prompt: 'Design §3.9 regra de reprojecao. Quando o prontuario e retificado ou recebe adendo (`encounter_version.kind` in (retificacao, adendo)), a guia pode precisar ser reprojetada. **Regra**: se a guia pertence a um lote NAO enviado (ou nenhum lote), marcar `live=false` na guia antiga e projetar nova guia da nova versao — a divergencia nao existe porque o lote ainda nao saiu. Se a guia pertence a um lote JA enviado, NAO reprojetar automaticamente: criar pendencia em `tiss.guia_pendencia` (tenant_id, id, guia_id, encounter_version_id, tipo = \'reprojecao_pos_envio\', resolved_at NULL) que aparece no painel "Precisa de voce" e no dashboard de Convenios. O operador decide: cancelar a guia no lote e reapresentar, ou manter. `tiss.guia_pendencia` com RLS, FK composta. Migration 0118. Handler que escuta evento `ENCOUNTER_AMENDED` (ja existe no outbox da Fase 1). Teste: amend sem lote → reprojeta; amend com lote enviado → pendencia criada.' },
  { key: '06-lote', faixa: 'Task 33 a Task 40', mig: '0119 a 0121', nome: 'Lote TISS: modelo, ciclo de vida e selecao de guias',
    prompt: 'Design §3.9 e §7.5. `tiss.lote` (tenant_id, id, operadora_id FK composta, numero_lote varchar(12) NOT NULL sequencial por operadora, status enum (rascunho, pronto, enviado, retornado, cancelado), tiss_version varchar(5) — versao do LOTE acordada pela operadora, guia_count int, total_value_cents bigint, xml_storage_key text, xml_hash_md5 char(32), protocolo_operadora varchar, sent_at timestamptz, created_by, created_at). `tiss.lote_guia` (many-to-many com ordem: tenant_id, lote_id, guia_id, sequencial_item smallint). RLS, FK composta, isolation. Lifecycle: criar lote rascunho → adicionar guias (so guias live=true, nao inclusa em outro lote nao-cancelado, da mesma operadora) → marcar pronto (valida completude) → gerar XML e enviar (status=enviado, grava protocolo) → receber retorno (status=retornado). Cancelamento so se nao enviado. Funcao `tiss.next_lote_number(tenant_id, operadora_id)` auto-provisionante. Teste completo do ciclo.' },
  { key: '07-xml-serializer', faixa: 'Task 41 a Task 48', mig: 'nenhuma', nome: 'Serializador XML TISS puro e deterministico',
    prompt: 'Design §7.5 e §3.9. O serializador vive em `packages/tiss/src/serializer/` e e uma funcao PURA: recebe dados tipados, devolve `Uint8Array` em ISO-8859-1. ZERO side-effect, ZERO I/O. Estrutura: `serialize-lote-consulta.ts` (monta o XML do lote de guias de consulta no padrao TISS 4.01.00 ou versao do lote), `encode-iso8859.ts` (converte string JS UTF-16 para ISO-8859-1 byte array — caracteres fora do range viram `?` com warning, nunca silencio), `compute-tiss-hash.ts` (o hash MD5 proprietario: concatena campos especificos do cabecalho + guias na ordem do XSD, faz MD5, embute em `<ans:hash>`). O XML NAO e construido por concatenacao de string — use um builder tipado que garante escape de entidades XML e fechamento de tags. Namespace `ans` com `xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"`. Encoding declaration: `<?xml version="1.0" encoding="ISO-8859-1"?>`. Teste: serializar um lote de amostra e validar byte a byte contra snapshot esperado. Teste com xmllint --schema contra XSD da ANS (coloque XSD de amostra em `packages/tiss/test/fixtures/`). Teste que caracteres acentuados sao preservados em ISO-8859-1 (e, a, c, o, u).' },
  { key: '08-tiss-transport', faixa: 'Task 49 a Task 53', mig: 'nenhuma', nome: 'TissTransport interface e implementacao arquivo',
    prompt: 'Design §7.5 DDL LITERAL do TissTransport. A interface `TissTransport` e a uniao `TissSubmissionReceipt` vivem em `packages/tiss/src/transport/types.ts` — copie a interface EXATA do design. `TissArquivoTransport` em `packages/tiss/src/transport/tiss-arquivo.ts`: recebe o XML (Uint8Array), grava em storage (abstrato por `StorageAdapter` — implementacao local com fs para dev, S3-compatible para prod), gera nome de arquivo segundo convencao ANS (CNPJ_ANO_MES_SEQ.xml), computa SHA-256 do arquivo, devolve receipt com `kind: \'arquivo\'` + `instructions` (texto que a secretaria ve: "Acesse o portal [operadora], menu Importar Lote, selecione o arquivo [nome]"). O registry de transports (`packages/tiss/src/transport/registry.ts`) so conhece `tiss-arquivo` — teste CI que o registry NAO exporta nem registra `tiss-soap`. Teste: mock do StorageAdapter, verificar que submitBatch grava e retorna receipt correto. Fake transport para testes de integracao.' },
  { key: '09-convenios-telas', faixa: 'Task 54 a Task 61', mig: 'nenhuma', nome: 'Telas: Convenios (a faturar, lotes, operadoras)',
    prompt: 'Design §5.2 e §5.3. As telas vivem em `apps/web/app/(main)/financeiro/convenios/`. **"A faturar"** (`/financeiro/convenios`): fila de guias pendentes de inclusao em lote, com filtros (operadora, periodo, status: completa/incompleta), selecao multipla para "Criar lote" em batch, badge com contagem de incompletas (dados faltando). **"Lotes"** (`/financeiro/convenios/lotes`): lista de lotes por operadora com status visual (chip colorido), acoes (abrir, enviar, cancelar, baixar XML), expandir mostra guias do lote com valor e sequencial. **"Operadoras"** (`/financeiro/convenios/operadoras`): CRUD de operadoras e contratos, vinculo paciente-convenio acessivel tambem por `/pacientes/{id}`. Detalhe da guia: painel lateral com os campos projetados, historico de ajustes (guia_ajuste), botao "Ajustar" abre form com campo_alterado + motivo obrigatorio. Navegacao: "Convenios" no menu Financeiro, sub-abas "A faturar" / "Lotes" / "Operadoras". Todo filtro via query string (nuqs). Contadores na faixa: guias a faturar, lotes rascunho, lotes enviados, pendencias. Componentes reutilizam o design system da Fase 1.' },
  { key: '10-api-rbac', faixa: 'Task 62 a Task 67', mig: 'nenhuma', nome: 'API Fastify e RBAC para TISS',
    prompt: 'Design §2.1 e §2.3. Rotas em `apps/api/src/routes/tiss/`: operadoras (CRUD), convenios do paciente (CRUD vinculado a paciente), guias (listar pendentes, detalhe, ajustar), lotes (criar, adicionar guias, remover guia, marcar pronto, enviar — que dispara serializacao + transport, listar, detalhe, cancelar, baixar XML). Contrato Zod em cada rota, gerando OpenAPI. RBAC: novas acoes em `packages/authz/src/actions.ts` — `tiss:operadora:manage`, `tiss:guia:read`, `tiss:guia:adjust`, `tiss:lote:manage`, `tiss:lote:send`. Perfil `admin_clinico` tem todas; `medico` tem `tiss:guia:read`; `recepcionista` tem `tiss:guia:read` e `tiss:lote:manage` (quem monta lote e a secretaria, nao o medico). `app.current_actor_kind()` = user para tudo. Latencia: listagens < 50ms p95, envio de lote < 2s p95. `no-store` em toda resposta com dado TISS (contem dados de saude). Teste: rota nunca vaza outro tenant (padrao test:iso).' },
  { key: '11-invariantes-dod', faixa: 'Task 68 a Task 72', mig: 'nenhuma', nome: 'Invariantes CI e demonstracao end-to-end',
    prompt: 'Design §3.13. Novos invariantes no pipeline CI: (a) nenhuma ocorrencia de `now()` ou `current_date` dentro de arquivos do schema `tiss` (grep nos .sql de migration e no codigo TS que gera queries para tiss.*), (b) `tiss.*` no escopo da invariante 1 (RLS forcada), (c) teste XSD: serializar um lote de amostra e validar com xmllint contra o XSD TISS 4.01.00. **Demonstracao end-to-end** como teste de integracao: criar tenant → operadora → contrato → paciente com convenio → agendar → atender → finalizar encounter (dispara projecao de guia) → verificar guia criada → criar lote rascunho → adicionar guia → marcar pronto → serializar XML → validar XML → enviar via arquivo transport → verificar receipt. Tudo em uma transacao de teste. O gate da Fase 4: `node tools/workflows/executa-fase.js` com as 72 tarefas, typecheck limpo, lint limpo, testes verdes, invariantes CI passando.' },
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
  'Voce reconcilia os 11 blocos do plano da Fase 4 do Cadencia, que foram escritos em paralelo e cegos uns aos outros.',
  '',
  'Os arquivos estao em `' + DIR + '/`. **Leia todos** (use Glob e Read).',
  '',
  'Os metadados que cada bloco devolveu:',
  '',
  JSON.stringify(contratos, null, 1).slice(0, 60000),
  '',
  '## Sua tarefa',
  '',
  '1. **Ache as colisoes de contrato.** Se o bloco 9 chama `projectGuia(encounterId)` e o bloco 4 define `projectGuiaConsulta(tx, encounterId, versionId)`, isso e uma colisao. Liste cada uma com o nome vencedor e o motivo.',
  '2. **Ache as colisoes de migration.** Dois blocos usando o mesmo numero. A faixa correta esta no enunciado de cada bloco; quem saiu da faixa cede.',
  '3. **Ache o que foi assumido errado das Fases 0-3.** Compare `consumidoDasFasesAnteriores` com o codigo real (leia os arquivos relevantes). Se algum bloco assumiu assinatura que nao existe, aponte a real.',
  '4. **Ordene as tarefas por dependencia**, e diga a ordem final dos arquivos. Regra: modelo de dados antes de quem consome; serializer antes de transport; projecao antes de reprojecao; API depois dos backends; telas depois da API; invariantes e e2e por ultimo.',
  '5. **APLIQUE as correcoes** editando os arquivos com Edit. Nao devolva o markdown corrigido na resposta — edite no disco.',
  '',
  'Ao final, grave um arquivo `' + DIR + '/00-CONTRATOS.md` com: a ordem final dos blocos, a tabela de contratos unificados (nome, assinatura, arquivo, quem define, quem consome), o mapa de migrations 0110 em diante, e a lista de correcoes que voce aplicou.',
  '',
  'Na sua resposta, devolva um resumo curto: quantas colisoes achou, quantas corrigiu, e o que ficou pendente.',
].join('\n'), { label: 'reconciliacao', phase: 'Reconciliacao', effort: 'max' })

return { reconciliacao: rec, blocos: ok.length, contratos: contratos }
