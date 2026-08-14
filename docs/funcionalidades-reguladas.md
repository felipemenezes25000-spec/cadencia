# Funcionalidades reguladas — o que dá para construir e o que não dá

> Levantado em 2026-08-14. Duas funcionalidades pedidas caem em regime
> regulatório. Este documento separa o que é engenharia do que é decisão
> jurídica, para ninguém construir a versão que não pode ser publicada.

## 1. Checagem de interação medicamentosa

### Por que não é um sprint

A **RDC 657/2022 da ANVISA** enquadra como *Software as a Medical Device*
qualquer software que faça suporte à decisão clínica, algoritmo diagnóstico,
análise de imagem ou triagem. **O enquadramento segue o uso pretendido
declarado, não a tecnologia empregada.** Classe I–II resolvem por notificação
simplificada (~30–120 dias); Classe III–IV exigem registro completo
(12–36 meses).

Um alerta do tipo *"este paciente usa varfarina e você está prescrevendo
AAS"* é suporte à decisão clínica sobre um paciente específico. Isso é
dispositivo médico. Não é uma tarefa de backlog — é um processo regulatório
com prazo, custo e responsável técnico.

### O que dá para construir sem entrar no regime

Existe um recorte defensável: **exibir a monografia licenciada como material
de referência, atribuída à fonte, sem gerar alerta nem recomendação
específica para aquele paciente.**

A diferença prática:

| Fora do regime (referência) | Dentro do regime (SaMD) |
|---|---|
| "Varfarina — interações conhecidas: AAS, …" exibido ao consultar o fármaco | "⚠ Este paciente usa varfarina" ao prescrever AAS |
| O profissional busca e lê | O sistema cruza a prescrição com a lista do paciente e avisa |
| Conteúdo idêntico para todos | Conteúdo derivado do prontuário daquele paciente |

O produto já tem `drug.medicamento` e `drug.bula`. Uma tabela de interações
exibida **na consulta ao fármaco** — nunca disparada pela prescrição — fica do
lado esquerdo da tabela.

**Essa distinção é fina e a decisão não é minha.** Antes de qualquer linha de
código, o recorte precisa ser validado por assessoria regulatória, porque quem
responde pelo enquadramento é a empresa, não o desenvolvedor.

### Pendência que independe disso

`clin.ai_assistance` já carrega `purpose` com valores `sugestao_cid` e
`sugestao_conduta`, e um `risk_class` de I a III. Ou seja: **o modelo de risco
de SaMD já foi antecipado na modelagem.** Vale confirmar se houve notificação
à ANVISA para a funcionalidade de sugestão que já está no ar. Se não houve,
isso é anterior a qualquer feature nova. **VERIFICAR.**

### Fontes de dados, se o recorte for aprovado

PharmaDB (192 mil interações em pt-BR) e Brasilfarma (84 mil). Ambas
licenciadas — o custo é contrato, não desenvolvimento.

---

## 2. Multa por falta (no-show)

### O que a norma diz

**Código de Ética Médica, art. 59: é vedado cobrar por consulta não
realizada.** Não há exceção por acordo prévio.

O que a doutrina admite é diferente: cobrar pela **reserva de horário** — não
pela consulta. E só se sustenta com três condições simultâneas:

1. **Aceite prévio, explícito e comprovável** do paciente à política;
2. **Valor estritamente inferior** ao da consulta;
3. **Discricionariedade para ausência justificada.**

### A ordem certa de construir

O artefato de consentimento vem **antes** do mecanismo de cobrança. Um sistema
que cobra primeiro e registra o aceite depois não tem como provar a condição
(1) — e é exatamente isso que decide a representação no CRM.

Proposta, na ordem:

1. **Política por clínica**: texto, valor (validado contra o valor da
   consulta), prazo de cancelamento sem multa.
2. **Aceite do paciente** como registro de primeira classe: quem aceitou,
   quando, de qual IP/dispositivo, qual versão do texto. Versionado — mudar a
   política não pode retroagir sobre quem aceitou a anterior.
3. **Só então** a cobrança, e sempre com: verificação de que existe aceite
   vigente, valor abaixo do teto, e uma etapa de confirmação humana com opção
   de dispensa.

**O que NÃO construir em nenhuma hipótese:** cobrança automática que dispara
sem registro de aceite vigente. Isso transforma uma funcionalidade em risco
ético para o cliente — que é quem responde no conselho, não nós.

### Infraestrutura já existente

`app.lgpd_consent` (migration 0181) modela consentimento versionado com IP e
autor. O aceite de política de no-show é a mesma forma, com outra finalidade —
mas **não deve ser enfiado na mesma tabela**: consentimento LGPD é base legal
de tratamento de dados; aceite de política é cláusula contratual. Misturar os
dois faz a revogação de um afetar o outro.

Tokenização de cartão via Asaas já é suportada pelo provedor; hoje o adaptador
chama apenas `POST /payments`.

---

## Resumo da decisão pendente

| Item | Bloqueado por | Quem decide |
|---|---|---|
| Interação medicamentosa — recorte de referência | Validação do enquadramento RDC 657 | Assessoria regulatória |
| Interação medicamentosa — alerta na prescrição | Notificação/registro ANVISA | Assessoria regulatória |
| Notificação da sugestão de IA já no ar | **VERIFICAR** se existe | Empresa |
| Política e aceite de no-show | Nada — pode começar | Produto |
| Cobrança de no-show | Aceite existir primeiro | Produto, depois jurídico |

Só a linha "política e aceite" está livre para começar hoje.
