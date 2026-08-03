# DOSSIÊ: CONSTRUIR UM PEP + AGENDA + PRESCRIÇÃO + FINANCEIRO NO BRASIL
*Consolidado de 5 pesquisas • base agosto/2026*

---

## 1. INVENTÁRIO DE FEATURES (referência: iClinic/Afya)

Legenda: **[E]** essencial (sem isso não vende) · **[I]** importante (upsell / retenção) · **[A]** avançado (fase 2-3)

### Cadastro de Paciente
- **[E]** 4 campos obrigatórios apenas: nome, data de nascimento, sexo, 1 telefone. CPF opcional-mas-configurável-como-obrigatório
- **[E]** Convênio do paciente (operadora, carteirinha, validade, carência)
- **[E]** Observação privada (só o profissional) × observação pública (toda a clínica) — dois campos, dois níveis de visibilidade
- **[E]** Log de alterações do cadastro
- **[I]** Foto do paciente, tags/marcações, marcação de óbito, campo "indicação" (de onde veio)

### Agenda
- **[E]** Visão dia e semana (o líder não tem visão mês — não é bloqueador)
- **[E]** Procedimentos com cor, duração e valor próprios → dirigem a renderização dos slots
- **[E]** Status: agendado / confirmado / aguardando atendimento (sala de espera) / atendido / faltou
- **[E]** **Encaixe** (overbooking em slot ocupado) — inegociável no Brasil
- **[E]** **Lista de espera** com chamada para vaga liberada
- **[E]** Bloqueio de horário, agendamento sem cadastro prévio (recepção), configuração de expediente/almoço/dias
- **[I]** Recorrência, reagendar por drag, imprimir agenda, sincronizar Google/Apple Calendar
- **[I]** Alerta de carência de convênio na marcação
- **[A]** Agendamento online público (widget no site do médico / perfil em marketplace)

### Prontuário
- **[E]** **Motor de campos configurável**: Seções × Campos, drag-and-drop. O iClinic tem 14 tipos: texto longo, texto curto, numérico, IMC, booleano, lista única, múltipla escolha, data, busca em tabela, orçamento, DPP/IG, curva de crescimento, prescrição de óculos, odontograma. É isso que atende 50+ especialidades com um produto só.
- **[E]** Sessão de atendimento com início/fim, cronômetro, e **imutabilidade após encerrar** (correção = adendo)
- **[E]** Diagnóstico/CID-10 — **modele como entidade de primeira classe, não como campo genérico** (ver §6)
- **[E]** Anexos (arquivos, imagens) e anexo de prontuário antigo migrado
- **[E]** Modelos de documentos, atestado, solicitação de exames
- **[I]** Compartilhamento de prontuário com granularidade dois eixos: paciente × profissional
- **[I]** Histórico de valores em tabela/gráfico; comparação de imagens lado a lado
- **[A]** Widgets clínicos especializados (odontograma, curva de crescimento, óculos, vacinas)
- **[A]** IA: transcrição de consulta com diarização; resumo do histórico

### Prescrição
- **[E]** Receituário simples e de controle especial; regra de vias (mista → 1 via simples + 2 controladas)
- **[E]** Busca por produto / substância / texto livre; posologia, quantidade, uso contínuo
- **[E]** Assinatura digital ICP-Brasil; entrega por PDF + link + QR
- **[E]** Modelos salvos de prescrição e de pedido de exames
- **[I]** Envio por WhatsApp; separar medicamentos em folhas; configuração de impressão
- **[A]** LME (alto custo), notificações A/B/B2, integração SNCR

### Financeiro
- **[E]** Lançamento de receita a partir do atendimento (automático), formas de pagamento com taxa, recibo
- **[E]** Painel: receitas, despesas, pendências; fluxo de caixa
- **[I]** **Repasse médico** por percentual/procedimento — bloqueador de venda em clínica com 2+ médicos
- **[I]** Categorias, centro de custo, múltiplas contas bancárias, parcelamento
- **[A]** NF-e/NFS-e municipal, antecipação de recebíveis, link de pagamento/maquininha, conciliação

### Comunicação
- **[E]** Lembrete e confirmação de consulta (WhatsApp/SMS/e-mail) — reduz falta ~30%, é o ROI que o cliente enxerga
- **[I]** **Caixa bidirecional de WhatsApp com número próprio da clínica** — o líder só tem one-way em número compartilhado. Maior lacuna de UX do mercado.
- **[I]** NPS pós-atendimento (0-10, promotor/neutro/detrator)
- **[A]** Campanhas e sequências de e-mail com segmentação por dado clínico

### Convênio / TISS
- **[I]** Captura dos campos TISS no atendimento (barato agora, caríssimo depois)
- **[A]** Geração de XML de lote (guia de consulta), validação XSD, download para portal
- **[A]** SP/SADT + anexo de Outras Despesas
- **[A]** Leitura de demonstrativo de análise de conta + recurso de glosa ← **é aqui que está o dinheiro percebido**
- **[A]** Webservice SOAP por operadora

### Plataforma
- **[E]** Multi-tenant com isolamento no banco; perfis mínimos: admin, administrativo (sem dado clínico), profissional de saúde
- **[E]** Trilha de auditoria imutável; exportação integral do prontuário com recibo
- **[I]** RBAC granular por módulo (o líder só tem granularidade no financeiro — flanco aberto)
- **[I]** Múltiplas clínicas / unidades por conta
- **[A]** Teleconsulta com gravação opcional, portal logado do paciente, apps nativos, estoque com lote/validade, 10-12 relatórios gerenciais fixos

---

## 2. RESTRIÇÕES REGULATÓRIAS QUE MUDAM A ARQUITETURA

| # | Restrição | Norma | O que muda no código |
|---|---|---|---|
| 1 | **Registro clínico finalizado é append-only.** Correção gera nova versão + justificativa; versão anterior fica inativa mas acessível. Inativação nunca é DELETE; registros inativos aparecem tachados em tela e na exportação. | SBIS NGS1.12.01 / NGS1.12.03; prática CFM | Sem `UPDATE` destrutivo, sem `DELETE`. Event sourcing ou tabela de versões. **Impossível retrofitar.** |
| 2 | **Trilha de auditoria contínua, não desativável nem por admin, imutável, e SEM dado clínico ou identificador de paciente.** Campos: id único, timestamp, tipo de evento, IP/MAC, usuário, ID do registro afetado. Exportável em CSV/XML com nome do software, CNES e CNPJ. | SBIS NGS1.07.01-08 | Tabela separada, append-only, com REVOKE de update/delete. Grava *referência*, não conteúdo. |
| 3 | **Guarda mínima de 20 anos do último registro**, inclusive para prontuário nativo-digital. Conflito: CFM 1.821 art. 7º diz guarda permanente para arquivo eletrônico. | Lei 13.787/2018 art. 6º §5º; CFM 1.821/2007 | Retenção **configurável por tenant**, default indefinido, expurgo auditável com registro de destinação. Nunca hard-code 20 anos. Storage entra no unit economics. |
| 4 | **Assinatura digital ICP-Brasil (NGS2)** obrigatória para prescrição, atestado, laudo, relatório, pedido de exame e para qualquer telemedicina. Sem NGS2 não se pode eliminar o papel. | CFM 2.299/2021 art. 4º; CFM 2.314/2022 art. 3º §2º; CFM 1.821 arts. 3º/4º | Assinatura cobre o *objeto canônico serializado* do documento → define a serialização de tudo. Formatos CAdES/XAdES/PAdES, política AD-RB, validação de cadeia e revogação **no servidor**. |
| 5 | **Receita de controlado exige assinatura qualificada; receita comum aceita avançada.** Documento tem de ser **nato-digital** — PDF escaneado, foto e "assina o lote no fim do dia" são inválidos. | Lei 14.063/2020; Lei 5.991/73; RDC Anvisa 1.000/2025 | "Roteador de nível de assinatura": classifica o item prescrito **antes** de escolher o regime. Data da prescrição = instante da assinatura, não editável. |
| 6 | **Plataforma de prescrição eletrônica precisa estar inscrita no CRM da sede e nomear um Diretor Técnico médico.** | CFM 2.299/2021 art. 5º | Não é engenharia, é constituição societária e responsabilidade ética pessoal. **É o argumento nº 1 para integrar Memed/Mevo em vez de construir.** |
| 7 | **Base legal LGPD é "tutela da saúde", não consentimento.** Consentimento fica para uso secundário. Vedado compartilhar dado de saúde para vantagem econômica. | LGPD art. 11, II, "f"; §§4º/5º | Não bloqueie atendimento esperando aceite. Consentimento é **entidade separada** (tipo, status autorizado/negado/revogado, titular ou representante, auditado). |
| 8 | **Multi-tenant exige segregação total por organização no nível de dados** e identificador de pessoa único por organização (CPF), com impossibilidade de excluir usuário que já operou. | SBIS NGS1.06.04, NGS1.03.09/10 | RLS no Postgres. Filtro em application layer não sobrevive a auditoria. Anexos podem ficar fora do SGBD, mas nome de arquivo e diretório **não podem revelar conteúdo** → UUID opaco. |
| 9 | **Tempo é requisito.** Servidor com NTP, armazenamento UTC até milissegundo, exportação RFC 3339, exibição no fuso parametrizado da instituição. Nunca o relógio do cliente. | SBIS NGS1.09 | Pré-condição de assinatura válida (`signingTime`) e de encadeamento temporal. |
| 10 | **Exportação do prontuário é feature de primeira classe**, com um único comando: CPF do paciente e CNPJ/CNES em toda página, ordenação pela data do **evento** (não do registro), numeração x/y, anexos junto e referenciados, + **recibo indissociável com ~11 campos**. | SBIS ECF.18.04/18.05 | Se virar "gerar PDF" no fim do roadmap, reescreve-se a camada de leitura inteira. |
| 11 | **Uso de IA como apoio à decisão precisa ser registrado no prontuário**; paciente tem direito de saber e de recusar; sistema classificado por nível de risco. Vigência ~26/08/2026. | CFM 2.454/2026 | Campo estruturado vinculado ao registro clínico: modelo, versão, saída, se o médico aceitou/rejeitou + flag de recusa do paciente. Modelar agora custa nada; depois, sobre registros imutáveis, custa muito. |
| 12 | **Transferência internacional** exige Cláusulas-Padrão ANPD + evidência continuada desde 23/08/2025. | Res. CD/ANPD 19/2024 | Hospedar em região São Paulo elimina a obrigação **por arquitetura**, não por contrato. |
| 13 | **DPO e RIPD são inescapáveis**: dado sensível em larga escala = alto risco, o que afasta a dispensa de pequeno porte. Incidente: 3 dias úteis para ANPD e titulares. | LGPD arts. 38/41/48; Res. ANPD 2/2022 e 15/2024 | Detecção e classificação de incidente instrumentadas, não improvisadas. |

**Não regulatório mas decisivo:** a API de assinatura avançada **gov.br é proibida para empresa privada** — só órgão público. Seu caminho é ICP-Brasil via PSC em nuvem.

---

## 3. ARMADILHAS (o que parece simples e não é)

**1. TISS — "é só gerar um XML"** · esforço: **6-12 pessoa-mês para v1, depois custo fixo permanente**
São quatro subsistemas: (a) modelo das guias com condição Obrigatório/Condicionado/Opcional campo a campo; (b) catálogo TUSS com ~200 mil termos, versionado **por data de atendimento** e com churn bimestral (só em jul/2026 entraram 96.983 termos na tabela 19); (c) serialização com regras não-padrão — **ISO-8859-1**, **hash MD5 proprietário** que concatena só o conteúdo das tags ignorando as tags, XAdES enveloped com política AD-RB; (d) N integrações SOAP contra **665+ operadoras**, cada uma com endpoint, credencial, homologação e críticas próprias. A ANS publicou 4 competências só em 2026. Armadilha extra: desde 01/07/2026 **CNPJ é alfanumérico** (`[A-Z0-9]{12}[0-9]{2}`) — coluna numérica quebra.
*Mitigação:* API pronta a R$ 199-1.200/mês, ou hub de conectividade. E o Art. 15 §3º da RN 501/2022 dá ao **prestador** a prerrogativa de escolher entre webservice e portal — exportar XML para upload manual é 100% legal.

**2. Receita de controlado** · esforço: **3-6 pessoa-mês se construir, ~0 se integrar**
RDC 1.000/2025 vige desde 15/02/2026; SNCR com operação plena em 30/09/2026. Emissão eletrônica de controlado só em **serviço de prescrição integrado ao SNCR por API** — não integrado fica proibido. Modelos não customizáveis, QR obrigatório no formato da Anvisa, CPF do paciente obrigatório (com fluxo alternativo "não possui CPF" + justificativa de 10+ caracteres). Somado ao Diretor Técnico do art. 5º da CFM 2.299 → **não construa, integre.**

**3. Certificação SBIS** · esforço: **implementar requisitos 4-8 pessoa-mês; auditoria R$ 10.700 a R$ 64.600 por ciclo**
Voluntária (o art. 10 da CFM 1.821 foi revogado em 2018 e o selo não é mais "SBIS-CFM"), **mas os requisitos não são**: sem NGS2 o cliente não pode jogar o papel fora. Preço por perfil de faturamento; múltiplas categorias não somam (100% da maior + 10% das demais); auditoria em até 10 meses da inscrição; validade 2 anos ou 6 meses após nova versão de requisitos.
*Estratégia:* construir 100% aderente ao v5.2 desde o dia 1, certificar no Estágio 1 quando houver faturamento (Perfil 0 = R$ 10.700).

**4. Assinatura digital "é só um botão"** · esforço: **2-4 pessoa-mês**
Envolve PKI, validação de cadeia e revogação via LCR/OCSP no servidor, key usage, carimbo de tempo de ACT homologada, fila de pendências de assinatura, rodapé literal padronizado, e estado Válida/Inválida/Indeterminada exibido inclusive na impressão. *Alívio:* com PSC em nuvem (BirdID, VIDaaS, SafeID, RemoteID, VaultID, NeoID) você envia só o hash e recebe o PKCS#7 — **nunca toca na chave privada do médico**, o que remove um passivo enorme. Certificado custa ao médico R$ 99-250/ano, não R$ 500+.

**5. Integração Memed** · esforço: **1-2 semanas para o spike, 3-4 para produção**
Chaves de homologação estão publicadas na doc — dá para spike em horas. Mas: **não existe criar prescrição via API**, só o módulo JS dentro da sua tela (mata backend headless e app nativo puro; planeje WebView). O retorno vem por **eventos JS**, não webhook. Token do médico é **dinâmico** — cachear como fixo é o bug clássico. "Documentos estruturados" (CID, categoria) **não vem ligado por padrão**, precisa pedir ativação. Credenciais de produção saem por Google Form e podem ser revogadas em até 180 dias.

**6. Prontuário com schema fixo por especialidade** · esforço: **refazer o produto**
Se você não começar pelo motor de campos, vai precisar de N produtos para N especialidades.

**7. Permissões** · esforço: **3-4 semanas cedo, 3-4 meses tarde**
RBAC granular por módulo é barato no início e caríssimo depois — e é onde o líder é fraco.

**8. NFS-e municipal** · esforço: **imprevisível (5.570 municípios, layouts próprios)**
Não construa. Integre um gateway fiscal ou deixe fora do escopo.

**9. Migração de dados do sistema antigo** · esforço: **contínuo, subestimado sempre**
É o maior atrito de venda. O líder resolve com CSV + campo de conteúdo aceitando texto/HTML/RTF anexado ao prontuário. Copie: importador tolerante que agrupa linhas com mesma chave no mesmo atendimento.

---

## 4. RECOMENDAÇÃO DE ESCOPO PARA O MVP

### Entra
1. **Multi-tenant com RLS + trilha de auditoria imutável + tempo UTC/NTP** — não é feature, é o alicerce (§2, itens 1, 2, 8, 9)
2. **Cadastro de paciente** (4 campos obrigatórios, CPF como identificador, observação privada/pública, convênio, log)
3. **Agenda dia/semana** com procedimentos coloridos, status, **encaixe**, **lista de espera**, bloqueio, cadastro rápido pela recepção
4. **Prontuário com motor de Seções × Campos** (comece com ~8 tipos de campo: texto longo/curto, numérico, booleano, lista, múltipla escolha, data, IMC) + **CID-10 como entidade de primeira classe** + anexos + atendimento imutável com adendo
5. **Prescrição via Memed** (integração, não construção) + atestado e pedido de exame com assinatura ICP-Brasil via PSC em nuvem
6. **Lembrete e confirmação por WhatsApp**
7. **Financeiro mínimo**: lançamento automático do atendimento, formas de pagamento com taxa, recibo, painel de caixa
8. **Exportação integral do prontuário com recibo** (ECF.18) — parece fase 3, é fase 0
9. **RBAC com 3 perfis mínimos** + compartilhamento de prontuário paciente × profissional

### Fica para depois
- **TISS** → fase 2, e só como exportação de XML de guia de consulta para upload no portal. *Justificativa:* custo fixo permanente de engenharia, e o mercado migra devagar (em ago/2024 só ~72% das guias chegavam em 4.0+, com críticas flexibilizadas pela ANS). Não há corte seco iminente. Mas **capture os ~14 campos da guia de consulta no atendimento desde o MVP** — registroANS, numeroCarteira, atendimentoRN, CNES, conselho/número/UF/CBOS, indicacaoAcidente, regimeAtendimento, tipoConsulta, data, tabela+código+valor. Retrofitar isso em produção é caro; capturar agora é grátis.
- **Controlados / SNCR** → herde do parceiro de prescrição
- **Teleconsulta, estoque, marketing, campanhas, NPS, app nativo, portal do paciente** → fase 2-3
- **RNDS** → fase 2. Hoje a obrigatoriedade explícita para a rede privada é notificação laboratorial; a integração exige e-CNPJ, mTLS e homologação manual com o MS. **Mas use CPF como identificador de paciente desde o dia 1** (Decreto 12.560/2025)
- **Certificação SBIS** → construa aderente, certifique quando houver faturamento
- **Repasse médico** → fase 1.5, é bloqueador só em clínica com 2+ médicos

**Corte defensável em uma frase:** *consultório de 1 a 3 profissionais, particular/autopagante, com prontuário confiável e rápido, agenda que funciona como a recepção brasileira trabalha, prescrição integrada já no plano de entrada, e WhatsApp que responde.* O segmento 1-3 é apontado como mal atendido por um mercado de 30+ opções desenhadas para clínicas maiores, e a dor documentada contra o líder é **travamento, lentidão e suporte só por IA** — não falta de feature.

---

## 5. STACK RECOMENDADA

| Camada | Escolha | Justificativa |
|---|---|---|
| Banco | **PostgreSQL** com Row-Level Security | Isolamento vira invariante do banco; filtro na aplicação é opt-in e não sobrevive a auditoria |
| Hospedagem | **Região São Paulo (sa-east-1)** — Supabase ou AWS | Elimina transferência internacional por arquitetura, não por contrato |
| Modelagem | **Relacional normalizado, nomeado segundo BR-Core v1.0.0 (FHIR R4)** | FHIR nativo cobra caro exatamente nas telas que vendem — agenda, financeiro, glosa, repasse são queries com muitos joins, não FHIR-shaped |
| FHIR | **Camada de mapeamento na fronteira**, não no runtime | Escreve-se o Bundle quando a RNDS for obrigatória; hoje é só disciplina de naming |
| Backend | **Laravel ou Django** se o diferencial for cobertura funcional; **Node/TS** se for a UI | Laravel/Django dão auditoria, tenancy e billing de fábrica e economizam meses no que é regulado |
| Front | **Next.js/React** | O flanco aberto do líder é performance de interface; UI é o diferencial vendável |
| Prontuário | **Motor EAV de Seções × Campos** + tabelas de primeira classe para CID, medicamento, procedimento e sinais vitais | Um produto para 50+ especialidades sem perder relatório, faturamento e alerta clínico |
| Persistência clínica | **Append-only versionado** (registro finalizado → nova versão + justificativa) | Requisito NGS1.12; retrofit é reescrever a persistência |
| Auditoria | **Tabela append-only sem PII clínica**, permissões revogadas para update/delete | NGS1.07.06 proíbe dado clínico na trilha |
| Anexos | **Object storage com chave UUID opaca**, acesso só via aplicação | NGS1.06.01: nome de arquivo não pode revelar conteúdo |
| Assinatura | **PSC em nuvem via API (Certillion ou Lacuna Rest PKI)** | Você envia o hash, o HSM do provedor assina — zero chave privada de médico no seu sistema |
| Prescrição | **Memed** (grátis, 350+ parceiros) com camada de abstração própria | Transfere o ônus do art. 5º da CFM 2.299 e do SNCR; a abstração te deixa migrar para Mevo (que tem modo API real) |
| Mensageria | **WhatsApp Business API com número próprio da clínica** | O líder é one-way em número compartilhado — maior diferencial de UX disponível |
| TISS (quando vier) | **API de terceiro (R$ 199-1.200/mês)** | Manter equipe acompanhando release bimestral da ANS + homologação com dezenas de operadoras não se paga antes da escala |
| Tempo | **NTP no servidor, UTC com milissegundo, RFC 3339 na exportação** | Requisito regulatório e pré-condição de assinatura válida |

---

## 6. AS 3 DECISÕES QUE PRECISAM SER TOMADAS AGORA

### Decisão 1 — Modelo de persistência clínica: mutável vs. append-only versionado
**Opções:** (a) CRUD normal com `updated_at`, adicionar versionamento depois; (b) registro clínico finalizado imutável desde o dia 1, com adendo e nova-versão-com-justificativa.
**Trade-off real:** (a) é ~2 semanas mais rápido no MVP e permite iterar telas sem pensar. (b) custa 3-4 semanas a mais e obriga a resolver cedo perguntas chatas (o que é "finalizar"? quem pode adendar? como o adendo aparece na impressão?). Mas (a) **não é recuperável**: quando o primeiro cliente pedir NGS2, ou o primeiro processo judicial exigir provar que o registro não foi alterado, você reescreve a camada de persistência inteira e migra dados de produção sem histórico para reconstruir. Isto não é uma escolha de engenharia — é a única decisão do dossiê que é literalmente irreversível.
**Recomendação:** (b), sem hesitação. É a fundação de tudo em §2.

### Decisão 2 — Prescrição: integrar Memed, integrar Mevo, ou construir
**Opções:** (a) **Memed** — grátis, chaves de homologação públicas, spike em horas, 36 mil farmácias integradas; **mas o módulo JS dela ocupa a sua tela** (sem prescrição server-side, sem app nativo puro), você não controla a UX, e coloca um canal de mídia farmacêutica de terceiro dentro do seu produto cedendo o relacionamento do dado. (b) **Mevo** — tem modo API de verdade, você mantém a sua interface; mas documentação fechada, só por contato comercial, e custo provavelmente não-zero. (c) **Construir** — controle total, mas exige inscrever a plataforma no CRM da sede, nomear um Diretor Técnico médico que responde pessoalmente pelos aspectos éticos (CFM 2.299 art. 5º), integrar ao SNCR por API para controlados, e manter motor de assinatura ICP-Brasil.
**Trade-off real:** a escolha é entre **velocidade de mercado** (Memed) e **controle de UX + do dado** (Mevo/próprio). O ponto que muda a conversa: (c) não é um problema de engenharia, é constituição societária e responsabilidade profissional pessoal.
**Recomendação:** Memed no MVP, atrás de uma interface própria (`PrescriptionProvider`), persistindo do seu lado id, link digital, código de desbloqueio e URL do PDF desde a primeira prescrição. Isso destrava hoje e preserva a opção de migrar para Mevo quando a UX de prescrição virar diferencial. **Nunca fique sem cópia própria da prescrição — é o que impede virar refém.**

### Decisão 3 — Segmento: particular/autopagante ou convênio
**Opções:** (a) **particular puro** — TISS é escopo zero (a RN 501 só cobre a relação operadora-prestador; reembolso e ressarcimento SUS estão fora); o produto é prontuário + agenda + prescrição + recibo. (b) **convênio desde o MVP** — abre o mercado maior, mas puxa TUSS versionada por data, XML com hash proprietário e ISO-8859-1, assinatura XAdES, e homologação operadora a operadora.
**Trade-off real:** (a) reduz o escopo do MVP em talvez 40% e permite lançar em meses em vez de ano, mas te tira da mesa em qualquer clínica que fatura convênio — que é a maioria acima de 2 profissionais. (b) te dá o mercado inteiro mas transforma TISS no maior sumidouro de manutenção permanente do produto, contra concorrentes que já têm equipe para isso (e note: o líder está em TISS 3.03.03 enquanto a ANS opera 4.03.00 — o fosso está aberto, mas atravessá-lo é caro).
**Recomendação:** (a) no MVP, **com os campos TISS capturados no modelo de dados desde o dia 1**. Isso custa dias agora e evita meses depois. Entre em convênio na fase 2 e entre **pelo lado da glosa**, não pelo lado do XML: um módulo que lê o Demonstrativo de Análise de Conta, cruza com o lote, decodifica o motivo pela TUSS tabela 38 e monta o recurso entrega mais valor percebido que gerar o lote — e quase todo concorrente para na geração do lote.

---

### Três coisas que valem mais que qualquer feature nova
1. **Confiabilidade e velocidade da interface.** O líder tem 6,8/10 no Reclame Aqui com queixas de travamento e atendimento só por IA. Não há espaço para entrar cobrando mais que R$ 79-300/profissional/mês — a diferenciação é operacional.
2. **WhatsApp bidirecional com número da clínica.** A recepção brasileira vive dentro do WhatsApp e o líder oferece notificação one-way em número compartilhado.
3. **Suporte humano.** É o que o mercado inteiro parou de oferecer.

**Cuidado com fontes:** praticamente todo conteúdo de terceiros ainda afirma que "o iClinic integra com a Memed" — falso desde junho/2025, quando migraram para o AfyaRX próprio (com atrito público de usuários). Valide análise competitiva contra a documentação de suporte oficial, não contra agregadores.