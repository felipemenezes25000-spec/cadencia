/**
 * FONTE UNICA do catalogo de acoes. Este arquivo e o unico lugar onde uma acao
 * nasce. O comando `pnpm authz:seed` regenera a tabela ref.action e o arquivo
 * packages/authz/actions.lock.json a partir daqui -- nunca o contrario.
 *
 * O que este catalogo NAO faz: filtrar linha. Isso e do RLS (§3.3). Aqui so se
 * decide o que a ROTA permite, olhando papel no vinculo.
 */
export const ROLES = [
  'admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro',
] as const;
export type Role = (typeof ROLES)[number];

export interface ActionDef {
  readonly key: string;
  readonly description: string;
  readonly roles: readonly Role[];
  readonly requiresMfa?: boolean;
}

export const ACTIONS = [
  { key: 'patient.read', description: 'Ler cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'patient.write', description: 'Criar ou editar cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'clinic.read', description: 'Ler dados da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'clinic.write', description: 'Editar dados da unidade',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.read', description: 'Listar vinculos da unidade',
    roles: ['admin_clinico', 'diretor_tecnico'] },
  { key: 'membership.grant', description: 'Conceder vinculo a um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.revoke', description: 'Revogar vinculo de um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'catalog.read', description: 'Consultar terminologia (CID-10, TUSS)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'audit.read', description: 'Ler a trilha de auditoria do tenant',
    roles: ['admin_clinico', 'diretor_tecnico'], requiresMfa: true },
  // ── Fase 1 · Agenda ──────────────────────────────────────────────────────
  { key: 'appointment.read', description: 'Ler a agenda da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.write', description: 'Agendar, mover e cancelar',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.checkin', description: 'Fazer check-in do paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'waitlist.write', description: 'Gerir a lista de espera',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  // ── Fase 1 · Prontuario ──────────────────────────────────────────────────
  { key: 'encounter.read', description: 'Ler prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.write', description: 'Escrever rascunho de atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.finalize', description: 'Finalizar atendimento',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'encounter.amend', description: 'Retificar, adendar, transferir ou anular',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'record.template.write', description: 'Configurar secoes e campos do prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'record.export', description: 'Exportar prontuario integral (ECF.18)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.break_glass', description: 'Quebra-vidro assistencial',
    roles: ['diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.share', description: 'Compartilhar prontuario com outro profissional',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  // ── Fase 1 · Documentos e prescricao ─────────────────────────────────────
  { key: 'document.issue', description: 'Emitir atestado, pedido, relatorio ou declaracao',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'prescription.write', description: 'Prescrever',
    roles: ['diretor_tecnico', 'profissional'] },
  // ── Fase 2 · Mensageria ──────────────────────────────────────────────────
  { key: 'messaging.conversation.read', description: 'Ler conversas do tenant',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.read', description: 'Ler mensagens de uma conversa',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.write', description: 'Enviar mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.read', description: 'Listar templates de mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.write', description: 'Criar ou editar templates',
    roles: ['admin_clinico'] },
  { key: 'messaging.automation.write', description: 'Configurar regras de automacao',
    roles: ['admin_clinico'] },
  // ── Fase 2 · Pagamento ───────────────────────────────────────────────────
  { key: 'payment.read', description: 'Listar pagamentos',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.write', description: 'Registrar pagamento no atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.refund', description: 'Estornar pagamento',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'payment.link.write', description: 'Criar link de pagamento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  // ── Fase 3 · Contas bancarias e transferencias (Bloco 03) ────────────────
  { key: 'bank_account.read', description: 'Listar contas bancarias',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'bank_account.write', description: 'Criar ou editar contas bancarias',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'payment.transfer', description: 'Criar transferencia entre contas',
    roles: ['admin_clinico', 'financeiro'] },
  // ── Fase 3 · Financeiro completo (Bloco 09) ────────────────────────────
  { key: 'finance.settings', description: 'Configurar contas bancarias, centros de custo, regras de split e recorrencia',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.write', description: 'Lancar despesa e cadastrar fornecedor',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.repasse', description: 'Gerar, visualizar e pagar repasse a profissionais',
    roles: ['admin_clinico', 'financeiro'], requiresMfa: true },
  // ── Fase 3 · Estoque (Bloco 09) ────────────────────────────────────────
  { key: 'inventory.read', description: 'Consultar produtos e alertas de estoque',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'inventory.write', description: 'Cadastrar produto e registrar movimentacao',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'inventory.adjust', description: 'Ajustar estoque manualmente',
    roles: ['admin_clinico', 'financeiro'] },
  // ── Fase 3 · Relatorios (Bloco 09) ─────────────────────────────────────
  { key: 'report.read', description: 'Acessar painel de desempenho e exportar relatorios',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
  { key: 'report.view.write', description: 'Salvar visao customizada de relatorio',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
  // -- Fase 3 . Desempenho ────────────────────────────────────────────────
  { key: 'report.variation.read', description: 'Consultar decomposicao de variacao de receita',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
  // ── Fase 4 · Convenios (TISS) ──────────────────────────────────────────
  { key: 'tiss.operadora.read', description: 'Listar operadoras de convenio',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro', 'recepcao'] },
  { key: 'tiss.operadora.write', description: 'Criar ou editar operadora de convenio',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.contrato.read', description: 'Listar contratos com operadoras',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
  { key: 'tiss.contrato.write', description: 'Criar ou editar contrato com operadora',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.paciente_convenio.read', description: 'Listar convenios do paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'tiss.paciente_convenio.write', description: 'Vincular paciente a convenio',
    roles: ['admin_clinico', 'recepcao'] },
  // -- Fase 4 . TISS — Guias e Lotes ─────────────────────────────────────
  { key: 'tiss.guia.read', description: 'Visualizar guias TISS pendentes e enviadas',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'tiss.guia.adjust', description: 'Ajustar codigo de procedimento na guia para faturamento',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.lote.manage', description: 'Criar, montar e cancelar lotes TISS',
    roles: ['admin_clinico', 'recepcao', 'financeiro'] },
  { key: 'tiss.lote.send', description: 'Enviar lote TISS para operadora (gera XML)',
    roles: ['admin_clinico', 'financeiro'] },
  // ── Fase 5 · Demonstrativo, glosa e recurso ──────────────────────────
  { key: 'tiss.demonstrativo.import', description: 'Importar demonstrativo XML da operadora',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.demonstrativo.read', description: 'Listar e visualizar demonstrativos de retorno',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro', 'recepcao'] },
  { key: 'tiss.glosa.read', description: 'Listar e visualizar glosas',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro', 'recepcao'] },
  { key: 'tiss.glosa.manage', description: 'Aceitar glosa individual',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.recurso.manage', description: 'Criar, montar e gerenciar recursos de glosa',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.recurso.send', description: 'Enviar recurso de glosa para operadora',
    roles: ['admin_clinico', 'financeiro'] },
] as const satisfies readonly ActionDef[];

export type ActionKey = (typeof ACTIONS)[number]['key'];

export const ACTION_BY_KEY: ReadonlyMap<string, ActionDef> =
  new Map(ACTIONS.map((a) => [a.key, a as ActionDef] as const));
