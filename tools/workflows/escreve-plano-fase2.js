export const meta = {
  name: 'plano-fase2-cadencia',
  description: 'Escreve o plano da Fase 2 ("A conversa e o caixa") em 10 blocos paralelos; cada agente GRAVA seu bloco em arquivo e devolve so os contratos',
  phases: [
    { title: 'Redacao', detail: '10 blocos, cada um gravado em arquivo' },
    { title: 'Reconciliacao', detail: 'unificar contratos e ordenar as tarefas' },
  ],
}

const RAIZ = 'C:/Users/Felipe/Downloads/novo projeto'
const DESIGN = RAIZ + '/docs/superpowers/specs/2026-08-03-design-sistema.md'
const PLANO_F1 = RAIZ + '/docs/superpowers/plans/2026-08-03-fase1-o-dia-plano.md'
const DIR = RAIZ + '/docs/superpowers/plans/fase2'

const BASE = [
'# CONTEXTO',
'',
'Voce escreve UM BLOCO do plano de implementacao da **Fase 2 ("A conversa e o caixa")** do Cadencia — SaaS multi-tenant brasileiro de prontuario e gestao para clinicas medicas.',
'',
'## O que ja esta construido',
'',
'**Fase 0 (fundacao) e Fase 1 ("O dia") estao CONSTRUIDAS e verdes:** 67 migrations, ~550 testes (188 unidade, 355 integracao, 194 isolamento). Entregam:',
'',
'- **Isolamento multi-tenant** por RLS `FORCE` com FK sempre composta `(tenant_id, id)`, suite `test:iso` que descobre tabelas do catalogo e reprova quem esquecer',
'- **`withTenantTx(actor, fn, pool?)`** em `packages/db/src/tx.ts` — o unico lugar que abre transacao e grava GUCs de contexto',
'- **`kernel`**: `Result`, erros, `uuidv7`, `Clock`, `Money` em centavos, `isoFromMs`, canonicalizacao JCS, validadores CPF/CNPJ/CNS/CRM',
'- **Trilha de auditoria**: `audit.event` particionada e append-only, canais A e B, selo diario',
'- **authn/authz**: Argon2id, sessao opaca, TOTP, CSRF, catalogo de acoes com negacao por padrao',
'- **Catalogs**: CID-10 e TUSS versionados por data de vigencia',
'- **Motor de prontuario completo**: catalogo de secoes e campos, rascunho mutavel com revisao otimista, `finalize_encounter` SECURITY DEFINER com cadeia de hash, retificacao, adendo, leitura versionada',
'- **Agenda**: agendamento, encaixe, bloqueio, recorrencia materializada (120 dias), lista de espera, fila do dia, contadores ao vivo, check-in',
'- **Pacientes**: cadastro minimo viavel, busca, divida de dados cobrada no check-in, campos TISS',
'- **Assinatura digital ICP-Brasil** via PSC em nuvem (AD-RT + LTV), com `SignatureProvider` e fake',
'- **Documentos e exportacao ECF.18**: atestado, pedido de exame, relatorio; exportacao integral em PDF/A-2b com rendering em blocos',
'- **Prescricao via Memed**: `PrescriptionProvider` com adaptador e fake',
'- **API Fastify 5** com RBAC, preambulo de transacao, OpenAPI via Zod',
'- **Worker**: pg-boss + Chromium + despachante',
'- **App shell Next.js 15**: tokens CSS, design system com 7 componentes centrais, telas Hoje/Agenda/Pacientes/Atendimento',
'',
'## LEIA ANTES DE ESCREVER — obrigatorio',
'',
'1. **Design**: `' + DESIGN + '`. Leia:',
'   - §7.3 MessagingProvider (linhas ~1293-1310) — contrato de integracao de mensageria',
'   - §7.4 PaymentProvider (linhas ~1312-1326) — contrato de integracao de pagamento',
'   - §5.3 (mapa de navegacao, secoes CONVERSAS e FINANCEIRO)',
'   - §3.7 (rollup financeiro, `fin.daily_rollup`)',
'   - §7.1 (regras de integracao: outbox, timeout, idempotencia, reconciliacao)',
'   - §8 (escopo da Fase 2)',
'   - §9 (riscos: WhatsApp/Meta e adquirencia)',
'   - Apendice A (alvo: entrega de lembrete dentro da janela 99,5%)',
'',
'2. **O codigo REAL das Fases 0 e 1.** Use Read/Grep para descobrir as assinaturas verdadeiras:',
'   - `packages/db/migrations/*.sql` — 67 migrations. Schemas existentes: `app`, `clin`, `fin` (vazio), `tiss`, `ref`, `id`, `audit`, `rpt`, `sched`',
'   - `packages/db/src/tx.ts` — `withTenantTx` e o tipo `Actor`',
'   - `packages/kernel/src/` — Result, erros, uuidv7, Clock, Money, isoFromMs',
'   - `packages/integrations/src/` — contratos e fakes de SignatureProvider e PrescriptionProvider (use o mesmo padrao)',
'   - `packages/scheduling/src/` — o padrao de pacote L2',
'   - `packages/emr/src/` — o padrao de pacote L2 com funcoes SECURITY DEFINER',
'   - `packages/outbox/src/` — STUB (`export {}`), precisa ser construido',
'   - `packages/events/src/` — STUB (`export {}`), precisa ser construido',
'   - `packages/messaging/src/` — STUB, precisa ser construido',
'   - `packages/payments/src/` — STUB, precisa ser construido',
'   - `packages/billing/src/` — STUB, precisa ser construido (uso minimo nesta fase)',
'   - `packages/jobs/src/` — padrao do pg-boss existente',
'   - `apps/api/src/routes/` — padrao de rota Fastify',
'   - `apps/web/src/telas/` — padrao de tela Next.js',
'   - `apps/worker/` — padrao do worker',
'',
'3. **Plano da Fase 1** (ultimas secoes): `' + PLANO_F1 + '` — a secao "O que a Fase 1 deixa pronto para a Fase 2" e a demonstracao de ponta a ponta.',
'',
'**A PROXIMA MIGRATION LIVRE e a 0068.** Rode `ls packages/db/migrations/` e confirme. Descubra quais numeros o seu bloco usa contando a partir dela e do que os blocos anteriores ao seu ja consumiram.',
'',
'## REGRAS DE ARQUITETURA (herdadas, valem aqui)',
'',
'1. **Irmao nunca importa irmao.** L0 plataforma (`kernel db audit authn authz storage jobs outbox integrations events`) → L1 cadastros (`identity tenancy people patients catalogs`) → L2 operacao (`scheduling emr documents prescriptions billing payments tiss messaging inventory reports export retention`) → L3 apps. `pnpm arch:check` reprova.',
'2. **Comunicacao entre irmaos L2 e ASSINCRONA** via `packages/events` (L0). Nunca sincrona. Quem precisa de dado de outro irmao recebe por argumento de L3 (a rota de API ou o worker).',
'3. **Migrations forward-only**, uma transacao por arquivo. Sem `CREATE INDEX CONCURRENTLY`.',
'4. **Fonte de tempo persistido e o PostgreSQL** (`clock_timestamp()`). `Date.now()` so em `packages/kernel/src/clock.ts` e `uuid.ts`. Use `isoFromMs(systemClock.nowMs())` em codigo de aplicacao.',
'5. **Toda tabela multi-tenant** nasce com `tenant_id`, RLS habilitada e **forcada**, ao menos uma policy, e FK composta. A `test:iso` reprova quem esquecer.',
'6. **CNPJ alfanumerico**; `COLLATE "pt-BR-x-icu"` em coluna ordenada para humano.',
'7. **Chamada a parceiro sai so do worker**, disparada pelo outbox. Excecao unica e documentada: handshake sincrono da sessao do prescritor.',
'8. **Timeout em operacao `unsafe` NUNCA gera retry automatico.** Persiste estado `indeterminado` e agenda reconciliacao — o job consulta o parceiro e so reenvia se confirmado que nao teve efeito.',
'',
'## STACK',
'',
'TypeScript 5.9 strict. PostgreSQL 18. Fastify 5. Next.js 15 App Router + React 19. Vitest. Zod v4 (z.record() precisa de 2 argumentos). TanStack Query 5. pg-boss 10. Tailwind 4 com tokens CSS proprios. Radix headless.',
'',
'## COMO ESCREVER',
'',
'Cada passo e UMA acao de 2 a 5 minutos, no ciclo TDD: teste que falha → rodar e confirmar a falha → implementar o minimo → rodar e confirmar que passa → commitar.',
'',
'Formato: `### Task N: nome`, bloco **Arquivos** (Criar/Modificar/Teste, caminhos exatos), passos `- [ ]` com **codigo completo** em todo passo que mexe em codigo, comandos exatos com saida esperada.',
'',
'**PROIBIDO**: "TBD", "TODO", "implementar depois", "tratamento de erro apropriado", "cobrir casos de borda", "igual a Task N" (repita o codigo), passo sem bloco de codigo quando mexe em codigo, referencia a tipo/funcao/rota que nenhuma tarefa definiu.',
'',
'Portugues do Brasil no texto; codigo e identificadores em ingles; comentarios e nomes de teste em portugues. Conventional Commits em ingles.',
'',
'## ENTREGA',
'',
'**Voce NAO devolve o markdown na resposta.** Em vez disso:',
'',
'1. **Grave o markdown das suas tarefas** com Write, no arquivo que o enunciado indica.',
'2. Se o conteudo for grande, grave em partes.',
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
  { key: '01-events-outbox', faixa: 'Task 1 a Task 5', mig: '0068 a 0069', nome: 'Eventos tipados e outbox transacional',
    prompt: 'Design §7.1 e linhas ~38-48 (worker + outbox). Construa os dois pacotes STUB:\n\n**`packages/events`** (L0): contratos de eventos de dominio tipados. Cada evento e um objeto imutavel com `type`, `tenantId`, `aggregateId`, `occurredAt`, `payload`. Definir os tipos de evento que a Fase 2 precisa: `APPOINTMENT_CONFIRMED`, `APPOINTMENT_REMINDER_DUE`, `ENCOUNTER_FINALIZED` (para pos-consulta), `PAYMENT_RECEIVED`, `PAYMENT_LINK_CREATED`, `INBOUND_MESSAGE_RECEIVED`. O pacote exporta SO tipos e constantes — sem comportamento, sem dependencias.\n\n**`packages/outbox`** (L0): tabela `app.outbox` com `id`, `tenant_id`, `event_type`, `aggregate_id`, `payload jsonb`, `created_at`, `dispatched_at`, `attempts`, `last_error`. RLS habilitada e forcada. Funcao `app.enqueue_outbox(event_type, aggregate_id, payload)` chamada DENTRO da transacao de dominio — sem job fantasma. O despachante no worker le eventos nao despachados, processa via handler registrado, e marca `dispatched_at`. Retry com backoff exponencial, max 5 tentativas, dead-letter apos isso. O pg-boss ja existe em `packages/jobs` — use-o para agendar o polling do outbox.\n\nEste bloco e FUNDACAO: messaging e payments dependem dele.' },

  { key: '02-messaging-modelo', faixa: 'Task 6 a Task 11', mig: '0070 a 0072', nome: 'Mensageria: modelo de dados e dominio',
    prompt: 'Design §7.3 e §5.3 (secao CONVERSAS). Crie o schema `msg` e construa `packages/messaging`:\n\n**Tabelas:**\n- `msg.channel_identity`: canal da clinica (WhatsApp, SMS, email), com `provider_ref` (WABA ID), `phone_number` E.164, `status` (provisioning/active/suspended/blocked), `quality_rating`. RLS por tenant. A clinica e DONA do WABA — bloqueio e dela, nao nosso.\n- `msg.conversation`: conversa com paciente, keyed por NOSSO `id` (nao o do parceiro). `channel_identity_id`, `patient_id` (nullable — pode ser numero desconhecido), `external_ref` (id do parceiro), `status` (active/archived), `last_message_at`. Indice para busca.\n- `msg.message`: mensagem individual. `conversation_id`, `direction` (inbound/outbound), `channel` (whatsapp/sms/email), `body_text`, `body_media_key` (storage ref), `template_key` (se veio de template), `status` (queued/sent/delivered/read/failed), `external_id`, `sent_at`, `delivered_at`, `read_at`. Append-only para inbound.\n- `msg.inbound_event`: payload CRUS do webhook, append-only, gravado ANTES de parsear — parser bugado nao perde mensagem de paciente.\n- `msg.template`: templates de mensagem aprovados pela Meta. `channel` (whatsapp), `name`, `language`, `category`, `status` (pending/approved/rejected), `body_template`, `header_template`, `footer_template`, `variables jsonb`.\n- `msg.automation_rule`: regras de automacao. `trigger` (appointment_created/appointment_reminder/encounter_finalized/nps_due), `template_id`, `timing_offset_minutes` (e.g., -1440 para 24h antes), `active`, `channel`.\n\nTodas com `tenant_id`, RLS FORCE, policies. Domain logic em `packages/messaging/src/`: `sendMessage`, `receiveInbound`, `resolveConversation` (acha ou cria conversa por numero).\n\n**IMPORTANTE:** `msg.conversation.patient_id` pode ser NULL (numero desconhecido). A vinculacao paciente-numero acontece em `resolveConversation` por lookup em telefone do paciente — mas nunca automatica para numero novo (privacidade).' },

  { key: '03-whatsapp-provider', faixa: 'Task 12 a Task 17', mig: '0073', nome: 'WhatsApp Cloud API: contrato e adaptador',
    prompt: 'Design §7.3 (MessagingProvider) e §7.1 (regras de integracao). Implemente em `packages/integrations`:\n\n**Contrato `MessagingProvider`** (no padrao de SignatureProvider/PrescriptionProvider ja existentes — leia `packages/integrations/src/contracts/signature.ts` para o padrao):\n```\ninterface MessagingProvider {\n  channel: "whatsapp" | "sms" | "email";\n  supportsInbound: boolean;\n  registerChannelIdentity(ctx, i: { tenantId, phone: E164, wabaRef? }): Promise<ProviderResult<{ providerRef }>>;\n  send(ctx, i: { channelIdentityRef, to: E164, body: OutboundBody, conversationId, idempotencyKey }): Promise<ProviderResult<{ externalId, sentAt? }>>;\n  sendTemplate(ctx, i: { channelIdentityRef, to: E164, templateName, language, variables, conversationId, idempotencyKey }): Promise<ProviderResult<{ externalId }>>;\n  verifyWebhook(headers, body): { valid: boolean; challenge?: string };\n  parseInbound(rawPayload): InboundMessage[];\n  fetchMedia(ctx, i: { mediaId }): Promise<ProviderResult<{ bytes: Buffer; contentType: string }>>;\n}\n```\n\n**Adaptador WhatsApp Cloud API:** usa a Cloud API v21+ da Meta. O send passa pelo outbox (nunca chamada direta da API). `verifyWebhook` valida a assinatura HMAC-SHA256 com o app secret. `parseInbound` extrai mensagens de texto, imagem, audio, documento, e status updates (sent/delivered/read). Onboarding WABA: a clinica registra o numero proprio; nos so armazenamos o `wabaId` e o `phoneNumberId`.\n\n**Fake `MessagingProviderFake`:** grava chamadas em array, permite inspecionar, simula webhook de resposta. Segue o padrao de `SignatureFake` e `PrescriptionFake`.\n\n**Teste de conformidade:** no padrao de `conformance.test.ts` existente — o fake deve passar nos mesmos testes que validam o contrato.' },

  { key: '04-automacoes', faixa: 'Task 18 a Task 23', mig: '0074 a 0075', nome: 'Automacoes: confirmacao, lembrete, pos-consulta e NPS',
    prompt: 'Design §5.3 (CONVERSAS > Modelos/Automacoes) e Apendice A (lembrete 99,5%). Construa em `packages/messaging/src/automations/`:\n\n**1. Confirmacao de agendamento:** quando `APPOINTMENT_CREATED` chega via evento, se existe `automation_rule` com trigger `appointment_created` ativa para o tenant, enfileira via outbox. O template pergunta "Confirma?" com botoes Sim/Nao. Resposta "Sim" atualiza `sched.appointment.status` para `confirmado` via evento (o messaging NAO importa scheduling — a composicao e pelo worker/L3). Resposta "Nao" muda para `cancelado` e libera o slot para a lista de espera.\n\n**2. Lembrete:** `automation_rule` com trigger `appointment_reminder` e `timing_offset_minutes = -1440` (24h antes) e `-120` (2h antes). Job pg-boss agendado: calcula `appointment.start_at + offset`, cria job com `startAfter`. **Fallback SMS** se WhatsApp falhar (design §9 risco WhatsApp/Meta) — o provider de SMS e outro adaptador do MessagingProvider.\n\n**3. Pos-consulta:** trigger `encounter_finalized`. Template de acompanhamento enviado 24h apos finalizacao. Configura intervalo na `automation_rule`.\n\n**4. NPS:** trigger `nps_due`. Job periodico (ex: 7 dias apos atendimento). Template com escala 0-10. Resposta parseada e gravada em `msg.nps_response` (tenant_id, patient_id, appointment_id, score, comment, received_at).\n\n**Regra critica: timing_offset e relativo ao fuso da CLINICA, nao UTC.** Use `app.local_date()` e o fuso da clinica para calcular o momento exato.\n\n**Teste obrigatorio:** lembrete de 24h para consulta as 8h no fuso da clinica (America/Sao_Paulo) deve ser enviado as 8h do dia anterior, nao as 5h UTC.' },

  { key: '05-pagamentos-modelo', faixa: 'Task 24 a Task 29', mig: '0076 a 0078', nome: 'Pagamentos: modelo de dados e recebimento no atendimento',
    prompt: 'Design §3.7 (rollup financeiro) e §7.4 (PaymentProvider). Construa em `packages/payments`:\n\n**Tabelas no schema `fin`** (ja existe, esta vazio):\n- `fin.entry_kind`: enum type `receita | despesa`\n- `fin.category`: categorias de lancamento (consulta, retorno, procedimento, taxa, etc.). `tenant_id`, RLS.\n- `fin.payment_method`: metodos de pagamento do tenant. `kind` (dinheiro/cartao_credito/cartao_debito/pix/link/convenio), `name`, `provider_ref` (para cartao/pix — ref do PSP), `active`. RLS.\n- `fin.entry`: lancamento financeiro. `tenant_id`, `id`, `kind` (receita/despesa), `category_id`, `patient_id` (nullable), `appointment_id` (nullable), `professional_id`, `clinic_id`, `description`, `amount_cents` (bigint, Money do kernel), `payment_method_id`, `paid_at` (nullable — so quando recebido de fato), `due_date`, `status` (pendente/pago/cancelado/estornado), `external_ref`, `idempotency_key`. RLS, policies.\n- `fin.receipt`: recibo emitido. `entry_id`, `receipt_number` (sequencial por tenant), `issued_at`, `pdf_storage_key`. RLS.\n- `fin.daily_rollup`: EXATAMENTE como no design §3.7 — duas bases (competencia e caixa), sentinel UUID para category_id nullable, PK composta. Materializado por job noturno. Detector de divergencia obrigatorio.\n\nDomain logic: `recordPayment(tx, i)` — registra pagamento no atendimento (cash, card, pix). Gera recibo automaticamente. `cancelPayment`, `refundPayment`. Recibo usa `packages/documents` para gerar PDF (via L3, NAO importa documents diretamente — injete como fizemos em `exportRecord`).\n\n**Dinheiro em centavos com `Money` do kernel.** Nunca `numeric` — a decisao irreversivel diz centavos.' },

  { key: '06-payment-link-conciliacao', faixa: 'Task 30 a Task 35', mig: '0079 a 0080', nome: 'Link de pagamento e conciliacao basica',
    prompt: 'Design §7.4 (PaymentProvider) e §7.1 (reconciliacao). Construa:\n\n**Contrato `PaymentProvider`** em `packages/integrations` (padrao de SignatureProvider):\n```\ninterface PaymentProvider {\n  createPaymentLink(ctx, i: { amount: Money; description; expiresAt?; idempotencyKey }): Promise<ProviderResult<{ linkId; url; expiresAt }>>;\n  getPayment(ctx, i: { externalRef }): Promise<ProviderResult<PaymentSnapshot>>;\n  refund(ctx, i: { externalRef; amount: Money; idempotencyKey }): Promise<ProviderResult<{ refundId }>>;\n  verifyWebhook(headers, body): { valid: boolean };\n  fetchSettlements(ctx, i: { from: string; to: string }): Promise<ProviderResult<Settlement[]>>;\n}\n```\n\n**Fake `PaymentProviderFake`** no padrao existente.\n\n**`fin.payment_link`:** `tenant_id`, `entry_id`, `provider_link_id`, `url`, `status` (pending/paid/expired/cancelled), `paid_at`, `amount_cents`. RLS.\n\n**Link de pagamento:** `createPaymentLink` via outbox. Webhook de confirmacao atualiza `fin.payment_link.status` e marca `fin.entry.paid_at`. Link aparece na agenda (acao "cobrar" na fila do dia — design §5.3).\n\n**Conciliacao basica:** job noturno `fetchSettlements` busca liquidacoes do PSP, compara com `fin.entry` por `external_ref`. Registra divergencias em `fin.reconciliation_log`. A taxa REAL vem do PSP — nunca calculamos por conta propria (design §7.4).\n\n**`fin.daily_rollup` materialization:** job noturno que recalcula o rollup do dia anterior. Detector de divergencia: compara rollup com SUM real dos entries e alerta se diferir.\n\n**Teste obrigatorio:** pagamento via link com webhook de confirmacao atualiza entry, rollup e reconciliation_log corretamente.' },

  { key: '07-api-worker', faixa: 'Task 36 a Task 42', mig: 'nenhuma', nome: 'API Fastify e worker: rotas e jobs de mensageria e pagamentos',
    prompt: 'Siga o padrao de `apps/api/src/routes/` (leia encounters.ts, patients.ts, schedule.ts) e `apps/worker/`.\n\n**Rotas de mensageria:**\n- `GET /v1/conversations` — lista conversas do tenant, paginada, com filtros (status, patient_id). RBAC: `messaging.conversation.read`.\n- `GET /v1/conversations/:id/messages` — mensagens de uma conversa, paginada. RBAC: `messaging.message.read`. **NUNCA conteudo clinico no contexto** — so agendamentos e pendencias.\n- `POST /v1/conversations/:id/messages` — enviar mensagem. RBAC: `messaging.message.write`. Enfileira via outbox.\n- `GET /v1/messaging/templates` — lista templates. RBAC: `messaging.template.read`.\n- `POST /v1/messaging/templates` — criar/editar template. RBAC: `messaging.template.write`.\n- `GET/PUT /v1/messaging/automations` — regras de automacao. RBAC: `messaging.automation.write`.\n- `POST /v1/messaging/webhook/:channel` — webhook de parceiro (WhatsApp). Sem authn de sessao — valida assinatura do parceiro.\n\n**Rotas de pagamentos:**\n- `POST /v1/payments` — registrar pagamento no atendimento. RBAC: `payment.write`.\n- `GET /v1/payments` — listar pagamentos, filtros por data/status/paciente. RBAC: `payment.read`.\n- `POST /v1/payments/:id/refund` — estorno. RBAC: `payment.refund`.\n- `POST /v1/payment-links` — criar link de pagamento. RBAC: `payment.link.write`.\n- `GET /v1/receipts/:id/pdf` — download do recibo. RBAC: `payment.read`.\n- `POST /v1/payments/webhook` — webhook do PSP. Valida assinatura.\n\n**Worker jobs:**\n- Despachante de outbox (polling a cada 5s)\n- Envio de mensagens (consome outbox de tipo messaging)\n- Processamento de webhook inbound (parse + gravar em msg.message)\n- Reconciliacao noturna (fetchSettlements)\n- Materialization do daily_rollup\n- Lembretes agendados (poll automation_rules + agendar jobs)\n\n**Acoes de RBAC:** registrar no catalogo de acoes (`packages/authz/src/actions.ts`) as novas acoes: messaging.*, payment.*. Recepcao pode ver conversas e registrar pagamento; profissional pode ver conversas; admin pode configurar automacoes e templates.\n\nTeste obrigatorio: rota de webhook nao aceita tenant_id como parametro (padrao test:iso).' },

  { key: '08-telas-conversas', faixa: 'Task 43 a Task 48', mig: 'nenhuma', nome: 'Telas: Conversas',
    prompt: 'Design §5.3 (CONVERSAS). Construa em `apps/web/src/telas/`:\n\n**`/conversas` — Caixa de entrada:**\n- Lista de conversas ordenada por `last_message_at` DESC. Cada linha: avatar (iniciais), nome do paciente (ou numero se desconhecido), preview da ultima mensagem, horario, badge de nao-lidas, chip de status.\n- Filtros: todas, nao-lidas, por canal (WhatsApp). Filtros na query string (padrao nuqs).\n- Clique abre a conversa no painel direito (split view 40/60).\n\n**Painel de conversa:**\n- Thread de mensagens com bolhas (outbound a direita, inbound a esquerda). Timestamp por mensagem. Status de entrega (enviado/entregue/lido) com icones discretos.\n- Input de mensagem na base. Enter envia, Shift+Enter quebra linha. Botao de template (abre seletor).\n- **Painel de contexto** lateral direito (320px): proximo agendamento, pendencias (cadastro, pagamento), historico de agendamentos. **NUNCA conteudo clinico** — o painel de contexto mostra dados administrativos, nao prontuario.\n\n**Acoes rapidas de Hoje/Agenda:**\n- Na fila do dia (`/hoje`) e na agenda, botao "Mensagem" na linha do agendamento. Abre compositor inline com template de confirmacao pre-selecionado e numero do paciente pre-preenchido. Um clique para enviar.\n\n**Templates e Automacoes (admin):**\n- `/conversas/automacoes` — lista de regras de automacao com toggle ativo/inativo. Editar timing, template, canal.\n- `/conversas/templates` — lista de templates com status de aprovacao (Meta). Criar novo, editar, ver status.\n\n**Componentes:** use os tokens e componentes do design system da Fase 1. Combobox de busca de paciente ja existe — reusar. Painel lateral compositor (420px, translateX 140ms) ja existe — reusar.\n\nTeste obrigatorio: conversa com numero desconhecido mostra "Numero desconhecido" e opcao de vincular a paciente.' },

  { key: '09-telas-financeiro', faixa: 'Task 49 a Task 54', mig: 'nenhuma', nome: 'Telas: Financeiro basico',
    prompt: 'Design §5.3 (FINANCEIRO). Construa em `apps/web/src/telas/`:\n\n**Pagamento no atendimento:**\n- Na tela de atendimento (`/atendimento/{id}`), botao "Cobrar" no cabecalho (ou atalho `Ctrl+$`). Abre painel lateral com: valor do procedimento (pre-preenchido da `sched.procedure`), metodo de pagamento (dinheiro/cartao/pix/link), campo de valor (editavel), botao "Registrar". Ao confirmar, grava `fin.entry` com `paid_at = now()` para pagamento presencial, ou cria link de pagamento para "link".\n- Acao "Cobrar [$]" tambem na fila do dia (`/hoje`) — abre o mesmo painel.\n\n**Recibos:**\n- Apos registrar pagamento, oferece "Imprimir recibo" que abre o PDF em nova aba. O recibo contem: nome da clinica, CNPJ, CNES, nome do paciente, CPF (se houver), descricao do servico, valor, metodo, data, numero sequencial.\n- Tela `/financeiro/recibos` com lista de recibos emitidos, filtro por data e paciente.\n\n**Dashboard financeiro basico (`/financeiro`):**\n- **Caixa do dia:** total recebido hoje, por metodo de pagamento. Usa `fin.daily_rollup` com basis `caixa`.\n- **Receitas do mes:** grafico de barras com os ultimos 30 dias (visx). Total do mes, media diaria.\n- **A receber:** lista de `fin.entry` com `status = pendente`, ordenada por `due_date`. Total pendente.\n- **Alvo do design:** painel financeiro do mes (rollup) < 1 ms (Apendice A).\n\n**Link de pagamento:**\n- Na lista de pagamentos pendentes, acao "Enviar link". Cria o link via PaymentProvider e envia pelo WhatsApp (se o paciente tem conversa ativa) ou copia para clipboard.\n- Status do link visivel: pendente/pago/expirado.\n\nTeste obrigatorio: registrar pagamento no atendimento atualiza o caixa do dia em tempo real (revalidacao TanStack Query).' },

  { key: '10-integracao-gate', faixa: 'Task 55 a Task 60', mig: 'nenhuma', nome: 'Integracao, gate de qualidade e demonstracao',
    prompt: 'Este bloco conecta tudo e define os gates de qualidade da Fase 2.\n\n**Integracoes com fluxos existentes:**\n- **Hoje:** adicionar badge de mensagens nao-lidas no contador. Acao "Mensagem" na fila do dia. Badge de pagamento pendente.\n- **Agenda:** acao "Confirmar" envia template de confirmacao (via messaging). Status de confirmacao visivel no slot. Acao "Cobrar".\n- **Pacientes:** aba "Conversas" no perfil do paciente com historico de mensagens. Aba "Financeiro" com lancamentos do paciente.\n- **Navegacao:** habilitar "Conversas" e "Financeiro" na barra (estavam desabilitados na Fase 1).\n\n**Definition-of-done gates (adaptar `pnpm prepush`):**\n1. `pnpm typecheck` — 0 erros\n2. `pnpm arch:check` — 0 violacoes (messaging nao importa scheduling, payments nao importa messaging, etc.)\n3. `pnpm lint:terminology-clock` — 0 violacoes\n4. `pnpm lint:session-guc` — 0 violacoes\n5. `pnpm test` — todos os testes de unidade passam\n6. `pnpm test:int` — todos os testes de integracao passam (incluindo novos de messaging e payments)\n7. `pnpm test:iso` — todos os testes de isolamento passam (novas tabelas msg.* e fin.* verificadas)\n8. `pnpm db:invariants` — todos verdes\n9. `pnpm db:privileges` — novas relacoes declaradas\n10. `pnpm prepush` — pass\n\n**Demonstracao de ponta a ponta (com provedores fake):**\n1. Agendar paciente → automacao envia confirmacao WhatsApp → resposta "Sim" confirma\n2. Lembrete 24h antes chega no horario certo (fuso da clinica)\n3. Check-in → cobrar no atendimento (PIX) → recibo emitido\n4. Finalizar atendimento → pos-consulta enviada 24h depois\n5. Dashboard financeiro mostra o recebimento\n6. Link de pagamento enviado → webhook confirma → entry atualizado\n7. Reconciliacao noturna roda sem divergencia\n8. Conversas: receber mensagem de numero desconhecido, vincular a paciente, responder\n\n**Fatos que precisam ser verdadeiros (testes que provam que a protecao pega violacao proposital):**\n- Mensagem de paciente com webhook invalido e REJEITADA (assinatura HMAC)\n- Timeout no WhatsApp NAO reenvia automaticamente — vai para fila de retry manual\n- Recepcao ve conversas mas NAO ve conteudo clinico no contexto\n- Pagamento duplicado por idempotency_key e recusado\n- Rollup divergente do SUM real gera alerta\n- Numero bloqueado pela Meta mostra "canal suspenso" e nao descarta historico\n- Lembrete para consulta as 8h em SP sai as 8h do dia anterior em SP, nao em UTC\n- test:iso reprova tabela msg.* ou fin.* sem RLS',
  },
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
  fases: r.consumidoDasFasesAnteriores || [],
  preocupacoes: r.preocupacoes || [],
}))

const rec = await agent([
  'Voce reconcilia os 10 blocos do plano da Fase 2 do Cadencia, que foram escritos em paralelo e cegos uns aos outros.',
  '',
  'Os arquivos estao em `' + DIR + '/`. **Leia todos** (use Glob e Read).',
  '',
  'Os metadados que cada bloco devolveu:',
  '',
  JSON.stringify(contratos, null, 1).slice(0, 60000),
  '',
  '## Sua tarefa',
  '',
  '1. **Ache as colisoes de contrato.** Se um bloco chama uma funcao com assinatura X e outro define com assinatura Y, isso e uma colisao. Liste cada uma com o nome vencedor e o motivo.',
  '2. **Ache as colisoes de migration.** Dois blocos usando o mesmo numero. A faixa correta esta no enunciado de cada bloco; quem saiu da faixa cede.',
  '3. **Ache o que foi assumido errado das Fases 0/1.** Compare `consumidoDasFasesAnteriores` com o codigo real (leia `packages/db/src/tx.ts`, as migrations, e os pacotes existentes). Se algum bloco assumiu assinatura que nao existe, aponte a real.',
  '4. **Verifique a regra de camadas.** messaging nao importa scheduling/payments; payments nao importa messaging; ambos nao importam emr/documents. Composicao e por L3 (API/worker).',
  '5. **Ordene as tarefas por dependencia**, e diga a ordem final dos arquivos. Regra: outbox/events antes de tudo; modelo de dados antes de quem consome; provider antes de automacoes; backend antes de API; API antes de telas.',
  '6. **APLIQUE as correcoes** editando os arquivos com Edit. Nao devolva o markdown corrigido na resposta — edite no disco.',
  '',
  'Ao final, grave um arquivo `' + DIR + '/00-CONTRATOS.md` com: a ordem final dos blocos, a tabela de contratos unificados, o mapa de migrations 0068 em diante, e a lista de correcoes que voce aplicou.',
  '',
  'Na sua resposta, devolva um resumo curto: quantas colisoes achou, quantas corrigiu, e o que ficou pendente.',
].join('\n'), { label: 'reconciliacao', phase: 'Reconciliacao', effort: 'max' })

return { reconciliacao: rec, blocos: ok.length, contratos: contratos }
