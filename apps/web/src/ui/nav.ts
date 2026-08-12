import {
  House,
  Calendar,
  ChatCircle,
  Users,
  Wallet,
  ShieldCheck,
  ChartBar,
  Table,
  GearSix,
  Stethoscope,
  UserCircleGear,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

export interface SubItemNav {
  readonly id: string;
  readonly rotulo: string;
  readonly href: string;
  readonly descricao?: string;
}

export interface ItemNav {
  readonly id: string;
  readonly rotulo: string;
  readonly href: string;
  readonly icone: PhosphorIcon;
  readonly atalho?: string;
  readonly grupo: 'workspace' | 'gestao';
  readonly disponivelNaFase: 1 | 2 | 3 | 4 | 5;
  readonly filhos?: readonly SubItemNav[];
}

export const ITENS_NAV: readonly ItemNav[] = [
  { id: 'hoje', rotulo: 'Hoje', href: '/hoje',
    icone: House, atalho: '1', grupo: 'workspace', disponivelNaFase: 1 },

  { id: 'agenda', rotulo: 'Agenda', href: '/agenda',
    icone: Calendar, atalho: '2', grupo: 'workspace', disponivelNaFase: 1,
    filhos: [
      { id: 'agenda-dia', rotulo: 'Agenda', href: '/agenda' },
      { id: 'agenda-lista-espera', rotulo: 'Lista de espera', href: '/agenda/lista-espera' },
    ] },

  { id: 'conversas', rotulo: 'Conversas', href: '/conversas',
    icone: ChatCircle, atalho: '3', grupo: 'workspace', disponivelNaFase: 2,
    filhos: [
      { id: 'conversas-caixa', rotulo: 'Caixa', href: '/conversas' },
      { id: 'conversas-automacoes', rotulo: 'Automações', href: '/conversas/automacoes' },
      { id: 'conversas-templates', rotulo: 'Templates', href: '/conversas/templates' },
    ] },

  { id: 'pacientes', rotulo: 'Pacientes', href: '/pacientes',
    icone: Users, atalho: '4', grupo: 'workspace', disponivelNaFase: 1 },

  { id: 'financeiro', rotulo: 'Financeiro', href: '/financeiro',
    icone: Wallet, atalho: '5', grupo: 'gestao', disponivelNaFase: 2,
    filhos: [
      { id: 'fin-visao', rotulo: 'Visão geral', href: '/financeiro' },
      { id: 'fin-caixa', rotulo: 'Caixa', href: '/financeiro/caixa' },
      { id: 'fin-a-receber', rotulo: 'A receber', href: '/financeiro/a-receber' },
      { id: 'fin-a-pagar', rotulo: 'A pagar', href: '/financeiro/a-pagar' },
      { id: 'fin-recebimentos', rotulo: 'Recebimentos', href: '/financeiro/recebimentos' },
      { id: 'fin-repasse', rotulo: 'Repasse', href: '/financeiro/repasse' },
      { id: 'fin-cadastros', rotulo: 'Cadastros', href: '/financeiro/cadastros' },
      { id: 'fin-estoque', rotulo: 'Estoque', href: '/financeiro/estoque' },
    ] },

  { id: 'convenios', rotulo: 'Convenios', href: '/convenios',
    icone: ShieldCheck, atalho: '6', grupo: 'gestao', disponivelNaFase: 4,
    filhos: [
      { id: 'conv-a-faturar', rotulo: 'A faturar', href: '/convenios' },
      { id: 'conv-lotes', rotulo: 'Lotes', href: '/convenios/lotes' },
      { id: 'conv-retornos', rotulo: 'Retornos', href: '/convenios/retornos' },
      { id: 'conv-glosas', rotulo: 'Glosas', href: '/convenios/glosas' },
      { id: 'conv-recursos', rotulo: 'Recursos', href: '/convenios/recursos' },
      { id: 'conv-operadoras', rotulo: 'Operadoras', href: '/convenios/operadoras' },
    ] },

  { id: 'desempenho', rotulo: 'Desempenho', href: '/desempenho',
    icone: ChartBar, atalho: '7', grupo: 'gestao', disponivelNaFase: 3,
    filhos: [
      { id: 'desemp-indicadores', rotulo: 'Indicadores', href: '/desempenho' },
      { id: 'desemp-nps', rotulo: 'NPS', href: '/desempenho/nps' },
    ] },

  { id: 'relatorios', rotulo: 'Relatorios', href: '/explorar',
    icone: Table, atalho: '8', grupo: 'gestao', disponivelNaFase: 3 },
];

export const CONFIG_NAV = {
  id: 'configuracoes',
  rotulo: 'Configuracoes',
  href: '/configuracoes',
  icone: GearSix,
  filhos: [
    { id: 'cfg-clinica', rotulo: 'Clínica', href: '/configuracoes',
      descricao: 'Dados da unidade e equipe' },
    { id: 'cfg-permissoes', rotulo: 'Permissões', href: '/configuracoes/permissoes',
      descricao: 'Matriz papel × ação' },
    { id: 'cfg-procedimentos', rotulo: 'Procedimentos', href: '/configuracoes/procedimentos',
      descricao: 'Procedimentos cadastrados na unidade' },
    { id: 'cfg-prontuario', rotulo: 'Prontuário', href: '/configuracoes/prontuario',
      descricao: 'Seções e campos do prontuário' },
    { id: 'cfg-auditoria', rotulo: 'Auditoria', href: '/configuracoes/auditoria',
      descricao: 'Trilha de auditoria do tenant' },
    { id: 'cfg-catalogos', rotulo: 'Catálogos', href: '/catalogos',
      descricao: 'CID-10, CID-11, TUSS' },
    { id: 'cfg-perfil', rotulo: 'Meu perfil', href: '/configuracoes/perfil',
      descricao: 'Seus dados e troca de unidade' },
  ],
} as const satisfies {
  readonly id: string;
  readonly rotulo: string;
  readonly href: string;
  readonly icone: PhosphorIcon;
  readonly filhos: readonly SubItemNav[];
};

const ROTAS_DE_CATALOGO: readonly SubItemNav[] = [
  { id: 'catalogo-cid10', rotulo: 'Catálogo CID-10', href: '/catalogos/cid10',
    descricao: 'Pesquisar diagnósticos na CID-10' },
  { id: 'catalogo-cid11', rotulo: 'Catálogo CID-11', href: '/catalogos/cid11',
    descricao: 'Pesquisar diagnósticos na CID-11' },
  { id: 'catalogo-tuss', rotulo: 'Catálogo TUSS', href: '/catalogos/tuss',
    descricao: 'Pesquisar procedimentos TUSS' },
] as const;

export const FASE_ATUAL = 6 as const;

export interface ItemDoShell {
  readonly id: string;
  readonly rotulo: string;
  readonly href: string;
  readonly icone: PhosphorIcon;
  readonly prefixoAtivo?: string;
  readonly badge?: number;
}

/**
 * Navegacao estrutural compartilhada pelo shell. URLs de registros nunca usam
 * IDs demonstrativos: itens sem pagina-index levam ao cockpit operacional.
 */
export const NAVEGACAO_SHELL: readonly {
  readonly rotulo: 'Principal' | 'Gestão' | 'Administração';
  readonly itens: readonly ItemDoShell[];
}[] = [
  {
    rotulo: 'Principal',
    itens: [
      { id: 'hoje', rotulo: 'Hoje', href: '/hoje', icone: House },
      { id: 'agenda', rotulo: 'Agenda', href: '/agenda', icone: Calendar },
      { id: 'atendimentos', rotulo: 'Atendimentos', href: '/hoje#fluxo-de-hoje', icone: Stethoscope, prefixoAtivo: '/atendimento' },
      { id: 'pacientes', rotulo: 'Pacientes', href: '/pacientes', icone: Users, prefixoAtivo: '/pacientes' },
      { id: 'mensagens', rotulo: 'Mensagens', href: '/conversas', icone: ChatCircle, prefixoAtivo: '/conversas' },
    ],
  },
  {
    rotulo: 'Gestão',
    itens: [
      { id: 'financeiro', rotulo: 'Financeiro', href: '/financeiro', icone: Wallet, prefixoAtivo: '/financeiro' },
      { id: 'indicadores', rotulo: 'Indicadores', href: '/desempenho', icone: ChartBar, prefixoAtivo: '/desempenho' },
    ],
  },
  {
    rotulo: 'Administração',
    itens: [
      { id: 'equipe', rotulo: 'Equipe', href: '/configuracoes/equipe', icone: UserCircleGear },
      { id: 'convenios', rotulo: 'Convênios', href: '/convenios', icone: ShieldCheck, prefixoAtivo: '/convenios' },
      { id: 'configuracoes', rotulo: 'Configurações', href: '/configuracoes', icone: GearSix, prefixoAtivo: '/configuracoes' },
    ],
  },
] as const;

export function indiceDeNavegacao(): readonly SubItemNav[] {
  const itens: SubItemNav[] = [];

  for (const item of ITENS_NAV.filter((i) => i.disponivelNaFase <= FASE_ATUAL)) {
    itens.push({ id: item.id, rotulo: item.rotulo, href: item.href });
    if (item.filhos) {
      for (const filho of item.filhos) {
        itens.push(filho);
      }
    }
  }

  itens.push({ id: CONFIG_NAV.id, rotulo: CONFIG_NAV.rotulo, href: CONFIG_NAV.href });
  for (const filho of CONFIG_NAV.filhos) {
    itens.push(filho);
  }
  for (const rota of ROTAS_DE_CATALOGO) {
    itens.push(rota);
  }

  return itens;
}
