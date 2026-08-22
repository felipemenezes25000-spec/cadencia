import {
  House, Calendar, ChatCircle, Users, ChartBar, Table, GearSix,
  Stethoscope, UserCircleGear, Pill, Package, ListChecks,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

export interface SubItemNav { readonly id: string; readonly rotulo: string; readonly href: string; readonly descricao?: string; }
export interface ItemNav {
  readonly id: string; readonly rotulo: string; readonly href: string; readonly icone: PhosphorIcon;
  readonly atalho?: string; readonly grupo: 'workspace' | 'gestao'; readonly disponivelNaFase: 1 | 2 | 3 | 4 | 5;
  readonly filhos?: readonly SubItemNav[];
}

export const ITENS_NAV: readonly ItemNav[] = [
  { id: 'hoje', rotulo: 'Hoje', href: '/hoje', icone: House, atalho: '1', grupo: 'workspace', disponivelNaFase: 1 },
  { id: 'agenda', rotulo: 'Agenda', href: '/agenda', icone: Calendar, atalho: '2', grupo: 'workspace', disponivelNaFase: 1, filhos: [
    { id: 'agenda-dia', rotulo: 'Agenda', href: '/agenda' }, { id: 'agenda-lista-espera', rotulo: 'Lista de espera', href: '/agenda/lista-espera' },
  ] },
  { id: 'regulacao', rotulo: 'Regulação', href: '/regulacao', icone: ListChecks, atalho: '3', grupo: 'workspace', disponivelNaFase: 1 },
  { id: 'conversas', rotulo: 'Conversas', href: '/conversas', icone: ChatCircle, grupo: 'workspace', disponivelNaFase: 2 },
  { id: 'pacientes', rotulo: 'Cidadãos', href: '/pacientes', icone: Users, atalho: '4', grupo: 'workspace', disponivelNaFase: 1 },
  { id: 'estoque', rotulo: 'Estoque', href: '/estoque', icone: Package, atalho: '5', grupo: 'gestao', disponivelNaFase: 2 },
  { id: 'desempenho', rotulo: 'Indicadores', href: '/desempenho', icone: ChartBar, atalho: '6', grupo: 'gestao', disponivelNaFase: 3 },
  { id: 'relatorios', rotulo: 'Relatórios', href: '/explorar', icone: Table, atalho: '7', grupo: 'gestao', disponivelNaFase: 3 },
];

export const CONFIG_NAV = {
  id: 'configuracoes', rotulo: 'Configurações', href: '/configuracoes', icone: GearSix,
  filhos: [
    { id: 'cfg-unidade', rotulo: 'Unidade de saúde', href: '/configuracoes', descricao: 'Dados da unidade e equipe' },
    { id: 'cfg-sus', rotulo: 'Identificação SUS', href: '/configuracoes/sus', descricao: 'Município, CNES e estabelecimento' },
    { id: 'cfg-permissoes', rotulo: 'Permissões', href: '/configuracoes/permissoes', descricao: 'Perfis e ações' },
    { id: 'cfg-procedimentos', rotulo: 'Procedimentos', href: '/configuracoes/procedimentos', descricao: 'Procedimentos da unidade' },
    { id: 'cfg-prontuario', rotulo: 'Prontuário', href: '/configuracoes/prontuario', descricao: 'Seções e campos do PEC' },
    { id: 'cfg-canais', rotulo: 'Canais', href: '/configuracoes/canais', descricao: 'WhatsApp, SMS e e-mail da unidade' },
    { id: 'cfg-auditoria', rotulo: 'Auditoria', href: '/configuracoes/auditoria', descricao: 'Trilha de auditoria do ente' },
    { id: 'cfg-catalogos', rotulo: 'Terminologias', href: '/catalogos', descricao: 'CID, CIAP-2 e SIGTAP' },
    { id: 'cfg-perfil', rotulo: 'Meu perfil', href: '/configuracoes/perfil', descricao: 'Seus dados e troca de unidade' },
  ],
} as const satisfies { readonly id: string; readonly rotulo: string; readonly href: string; readonly icone: PhosphorIcon; readonly filhos: readonly SubItemNav[]; };

const ROTAS_DE_CATALOGO: readonly SubItemNav[] = [
  { id: 'catalogo-cid10', rotulo: 'CID-10', href: '/catalogos/cid10' },
  { id: 'catalogo-cid11', rotulo: 'CID-11', href: '/catalogos/cid11' },
  { id: 'catalogo-ciap2', rotulo: 'CIAP-2', href: '/catalogos/ciap2' },
  { id: 'catalogo-sigtap', rotulo: 'SIGTAP', href: '/catalogos/sigtap' },
] as const;

export const FASE_ATUAL = 6 as const;
export interface ItemDoShell { readonly id: string; readonly rotulo: string; readonly href: string; readonly icone: PhosphorIcon; readonly prefixoAtivo?: string; readonly badge?: number; }
export const NAVEGACAO_SHELL: readonly { readonly rotulo: 'Principal' | 'Gestão' | 'Administração'; readonly itens: readonly ItemDoShell[]; }[] = [
  { rotulo: 'Principal', itens: [
    { id: 'hoje', rotulo: 'Hoje', href: '/hoje', icone: House },
    { id: 'agenda', rotulo: 'Agenda', href: '/agenda', icone: Calendar },
    { id: 'regulacao', rotulo: 'Regulação', href: '/regulacao', icone: ListChecks, prefixoAtivo: '/regulacao' },
    { id: 'atendimentos', rotulo: 'Atendimentos', href: '/hoje#fluxo-de-hoje', icone: Stethoscope, prefixoAtivo: '/atendimento' },
    { id: 'pacientes', rotulo: 'Cidadãos', href: '/pacientes', icone: Users, prefixoAtivo: '/pacientes' },
    { id: 'mensagens', rotulo: 'Mensagens', href: '/conversas', icone: ChatCircle, prefixoAtivo: '/conversas' },
    { id: 'bulario', rotulo: 'Bulário', href: '/bulas', icone: Pill, prefixoAtivo: '/bulas' },
  ] },
  { rotulo: 'Gestão', itens: [
    { id: 'estoque', rotulo: 'Estoque', href: '/estoque', icone: Package, prefixoAtivo: '/estoque' },
    { id: 'indicadores', rotulo: 'Indicadores', href: '/desempenho', icone: ChartBar, prefixoAtivo: '/desempenho' },
    { id: 'relatorios', rotulo: 'Relatórios', href: '/explorar', icone: Table, prefixoAtivo: '/explorar' },
  ] },
  { rotulo: 'Administração', itens: [
    { id: 'equipe', rotulo: 'Equipe', href: '/configuracoes/equipe', icone: UserCircleGear },
    { id: 'configuracoes', rotulo: 'Configurações', href: '/configuracoes', icone: GearSix, prefixoAtivo: '/configuracoes' },
  ] },
] as const;

export function indiceDeNavegacao(): readonly SubItemNav[] {
  const itens: SubItemNav[] = [];
  for (const item of ITENS_NAV.filter((i) => i.disponivelNaFase <= FASE_ATUAL)) {
    itens.push({ id: item.id, rotulo: item.rotulo, href: item.href });
    if (item.filhos) for (const filho of item.filhos) itens.push(filho);
  }
  itens.push({ id: CONFIG_NAV.id, rotulo: CONFIG_NAV.rotulo, href: CONFIG_NAV.href });
  for (const filho of CONFIG_NAV.filhos) itens.push(filho);
  for (const rota of ROTAS_DE_CATALOGO) itens.push(rota);
  return itens;
}
