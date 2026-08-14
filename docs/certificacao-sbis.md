# Certificação SBIS/CFM — estado real e o que falta

> Levantado em 2026-08-14 contra o código em `main`. As linhas marcadas
> **VERIFICAR** são as que eu não consegui confirmar lendo o repositório —
> dependem de processo, contrato ou decisão de negócio, não de código.

## Por que isto está no topo da lista

De doze concorrentes brasileiros pesquisados, **só a Feegow tem certificação
SBIS vigente** (NGS2, certificados #158–160, emitidos 29/01/2025, sob CNPJ da
Doctoralia Brasil). iClinic, Amplimed, Ninsaúde, Shosp, HiDoctor, ProntMed,
Clinicorp, Clínica nas Nuvens e Conexa **não constam** no registro oficial.

A certificação é voluntária desde que o art. 10 da CFM 1.821 foi revogado em
2018 — mas duas coisas seguem valendo:

1. **Sem NGS2 a clínica não pode legalmente eliminar o papel.** O que o
   cliente compra ao exigir certificação é o direito de parar de imprimir.
2. **A CFM 2.314/2022, art. 3º §2º, exige NGS2 para prontuário de
   telemedicina** — e teleconsulta já está no produto.

Ou seja: hoje vendemos telemedicina num sistema não certificado. Certificar é
simultaneamente destravar mercado, cumprir norma vigente e neutralizar a única
vantagem real que a Feegow tem sobre nós.

## O que já está construído

A arquitetura foi claramente escrita mirando os requisitos NGS2. Evidência no
repositório, não intenção:

| Requisito | Onde está | Confiança |
|---|---|---|
| Registro clínico append-only e versionado | `clin.encounter_version`, `finalize_encounter` (0037/0038), retificação por `supersedes` (0157) | Alta |
| Integridade da versão por hash canônico | `packages/emr/src/canonical-version.ts`, `verifyVersionHash` | Alta |
| Trilha de auditoria não desativável | trigger `audit.deny()` (0011) — dispara para qualquer papel, inclusive `BYPASSRLS` | Alta |
| Trilha sem dado clínico | CHECK `meta_sem_pii` + whitelist `audit.meta_keys_ok()` (0009) | Alta |
| Selagem periódica da trilha | `audit.seal` / `audit.seal_run` (0015) | Alta |
| Isolamento multi-tenant estrutural | RLS forçada + FK composta, 13 invariantes executáveis em `packages/db/src/invariants/` | Alta |
| Autenticação forte | sessão opaca (0017) + TOTP (0018) | Alta |
| Autorização granular | catálogo de 87 ações + overrides por clínica | Alta |
| Quebra de sigilo rastreada | `break_glass` (0044) | Alta |
| Assinatura digital ICP-Brasil | `clin.signature` (0052) + adaptador BirdID | Alta |
| Exportação íntegra com recibo | `clin.record_export` (0058/0059) | Alta |
| Expurgo legal com contexto | 8 migrations (0136–0143) | Alta |
| Tempo confiável | UTC no banco, lint proibindo relógio local em código de terminologia | Média |
| Consentimento e direitos do titular | `app.lgpd_consent`, `app.lgpd_data_request` (0181) | Alta |
| Registro de assistência por IA | `clin.ai_assistance` (0036/0145) — atende CFM 2.454/2026 | Alta |

**Sobre a CFM 2.454/2026:** entra em vigor em **26 de agosto de 2026** e exige
registrar no prontuário a ferramenta de IA usada, sua finalidade, a revisão
humana da sugestão e a recusa do paciente. `clin.ai_assistance` já carrega
`purpose`, `risk_class`, `provider`, `model_id`, `model_version`, `residency`,
`clinician_decision` e `patient_refused` — com trigger no banco, não só
validação no app. **Nenhum concorrente pesquisado tem equivalente.** Isso é
argumento de venda a partir de 26/08.

## O que falta — e não é código

Estes são os itens que decidem a certificação e que **nenhum commit resolve**:

1. **Escolher as categorias.** As bandas de preço são por perfil de
   faturamento (Perfil 0: até R$250k; Perfil 4: acima de R$5M). Cobra-se 100%
   da categoria mais cara e 10% de cada adicional. **Consultório Individual sai
   de graça** ao certificar Clínica/Ambulatório ou Teleconsulta.
   Recomendação: **PEP Clínica/Ambulatório + Telessaúde**, que é exatamente a
   combinação da Feegow.
2. **Orçar o ciclo.** Estimativa interna anterior: **R$10.700–R$64.600 por
   ciclo**, parcelável em 5x sem juros. Validade de 2 anos, ou 6 meses após
   uma nova versão dos requisitos. **VERIFICAR** — número de dossiê antigo,
   confirmar com a SBIS.
3. **Manual do usuário e documentação de processo.** O NGS2 audita
   documentação, não só software. Hoje existem `DESIGN_SYSTEM.md`,
   `QA_NOTES.md` e os specs — falta o manual do produto na forma que a
   auditoria espera. **É o maior item de esforço restante.**
4. **Política de segurança da informação formalizada** e responsável nomeado.
5. **Ambiente de homologação** para a auditoria exercitar os cenários.

## O que talvez falte em código — a verificar

Não consegui confirmar estes lendo o repositório. Cada um é uma pergunta para
a leitura do NGS2 v5.2, não uma afirmação de que falta:

- **Backup e restauração documentados e testados.** Existe rotina? Há teste de
  restauração? Não achei nada no repo. **VERIFICAR.**
- **Retenção de 20 anos** (CFM 1.821). O expurgo legal existe; o que não achei
  foi a regra que *impede* apagar antes do prazo. **VERIFICAR.**
- **Assinatura de TODO o conjunto do prontuário**, não só de documentos
  avulsos. Hoje `clin.signature` assina documento e prescrição. O NGS2 fala em
  assinar a versão do registro. **VERIFICAR se a versão canônica hasheada
  satisfaz, ou se precisa de assinatura ICP sobre ela.**
- **Termo de consentimento para telemedicina** especificamente — distinto do
  consentimento LGPD que já existe.

## Ordem sugerida

1. Ler o NGS2 v5.2 e fechar a lista **VERIFICAR** acima. Uma semana.
2. Decidir categorias e orçar com a SBIS.
3. Escrever o manual e a política — é o caminho crítico.
4. Fechar as lacunas de código que a leitura do item 1 revelar.
5. Agendar a auditoria.

O passo 1 é barato e elimina a maior parte da incerteza. Não faz sentido
escrever código "para certificação" antes dele.
