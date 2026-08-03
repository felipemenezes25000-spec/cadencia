# Inventário de navegação real do iClinic

> Fonte: exploração direta do produto (trial), fornecida pelo usuário em 2026-08-03.
> Esta é a **referência canônica de paridade funcional**. Onde este documento
> divergir da pesquisa web, este vence — pesquisa de terceiros sobre o iClinic
> se mostrou desatualizada em vários pontos.

---

## Painel (Dashboard)

- Contadores: pacientes agendados / confirmados / atendidos / faltas
- Gráficos: pacientes, procedimentos, convênio, duração do atendimento,
  atendimentos no período, distribuição etária
- Aniversariantes do dia
- Botão `+` com atalhos: Novo Agendamento, Adicionar Paciente,
  Prof. de Saúde, Recepcionista

## Agenda

- Visões: **Dia** e **Semana**
- Busca de paciente
- **Novo Agendamento** — procedimentos, convênio, recorrência, link de pagamento
- **Lista de Espera**
- **Observações da agenda**
- **Imprimir Agenda**
- **Agendamento Online** — bloqueado no trial, leva à tela de planos
  (portanto: feature de plano superior)

## Prontuários

### Lista de pacientes
- Filtros: sexo, óbitos, ativos, inativos

### Cadastro de paciente — 3 abas
1. Dados pessoais
2. Dados complementares
3. Convênios

### Dentro do atendimento
- Histórico de Consulta
- Tabela de acompanhamento
- **Atendimento** — queixa, HMA, exame físico, cálculo de IMC,
  diagnóstico CID, condutas
- Exames e procedimentos
- **Prescrições** (iClinic Rx) — Medicamentos / Exames / Vacinas,
  com assinatura digital
- Documentos e atestados
- Imagens e anexos
- **Transcrição da Anamnese por IA**

## Gestão

### Finanças
resumo · fluxo de caixa · extrato · receitas · despesas · análises · configurações

### Painel Financeiro

### Relatórios
atendimentos realizados · pacientes para retorno · por período · por CID ·
por indicação · faltas · análises financeiras · repasse · fluxo de caixa ·
SMS enviados · aniversariantes

### Controle de Estoque
meu estoque · histórico

### TISS
guias de consulta · lotes · SP/SADT · outras despesas

### Satisfação do Paciente
NPS · envios

## Afya Pay

Página de habilitação: links de pagamento, maquininha, taxas.

## Outros

Bulas · Contatos · CID 10 · CID 11 · Logs do sistema (agendamentos e finanças)

## Configurações

### Da Conta
assinatura/planos · cobrança · usuários · clínicas · permissões de envio ·
SMS · teleconsultas · exportar e migrar dados

### Da Clínica
perfil · convênios · categorias financeiras · centro de custo ·
contas bancárias · equipe · permissões · regras de repasse

### De Profissionais
agenda · convênios · procedimentos · SMS · e-mail ·
e-mail de aniversariantes · impressões · **seções do prontuário** ·
modelos de exames e atestados · compartilhamento de dados ·
integrações com Google/Apple Calendar

### Meu Perfil

---

## Observações relevantes para o nosso projeto

1. **"Seções do prontuário" em Configurações de Profissionais** confirma o motor
   de campos configurável — o prontuário é montado por configuração, não
   hard-coded por especialidade.

2. **TISS aparece como módulo de primeira classe** com guias de consulta,
   lotes, SP/SADT e outras despesas. Confirma o escopo do Nível 1–2; não há
   evidência de webservice SOAP transparente na navegação.

3. **Agendamento Online é gated por plano.** Sinaliza onde o líder monetiza
   — útil para desenhar nosso próprio empacotamento.

4. **CID 10 e CID 11 coexistem** como tabelas de referência navegáveis.

5. **Logs do sistema são limitados** a agendamentos e finanças — não há trilha
   de auditoria clínica exposta ao usuário. É uma lacuna, dado que SBIS
   NGS1.07 exige trilha contínua e exportável.

6. **Afya Pay é adquirência própria** (links de pagamento + maquininha).
   Equivalente nosso seria integração com PSP, não construção.

7. **Repasse aparece em dois lugares** — relatório e "regras de repasse" nas
   configurações da clínica. Confirma que é feature estrutural, não acessório.
