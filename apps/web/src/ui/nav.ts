import {
  House,
  Calendar,
  ChatCircle,
  Users,
  Wallet,
  ChartBar,
  Receipt,
  Compass,
  Gear,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

export interface ItemNav {
  readonly id: string;
  readonly rotulo: string;
  readonly href: string;
  readonly icone: PhosphorIcon;
  readonly atalho: string;
  readonly disponivelNaFase: 1 | 2 | 3 | 4 | 5;
  readonly motivo?: string;
}

export const ITENS_NAV: readonly ItemNav[] = [
  { id: "hoje",       rotulo: "Hoje",       href: "/hoje",       icone: House,      atalho: "1", disponivelNaFase: 1 },
  { id: "agenda",     rotulo: "Agenda",     href: "/agenda",     icone: Calendar,   atalho: "2", disponivelNaFase: 1 },
  { id: "conversas",  rotulo: "Conversas",  href: "/conversas",  icone: ChatCircle, atalho: "3", disponivelNaFase: 2 },
  { id: "pacientes",  rotulo: "Pacientes",  href: "/pacientes",  icone: Users,      atalho: "4", disponivelNaFase: 1 },
  { id: "financeiro", rotulo: "Financeiro", href: "/financeiro", icone: Wallet,     atalho: "5", disponivelNaFase: 2 },
  { id: "convenios",  rotulo: "Convenios",  href: "/convenios",  icone: Receipt,    atalho: "6", disponivelNaFase: 5 },
  { id: "desempenho", rotulo: "Desempenho", href: "/desempenho", icone: ChartBar,   atalho: "7", disponivelNaFase: 3,
    motivo: "Desempenho e atribuicao de variacao chegam na Fase 3" },
  { id: "explorar",   rotulo: "Explorar",   href: "/explorar",   icone: Compass,    atalho: "8", disponivelNaFase: 3 },
  { id: "configuracoes", rotulo: "Configuracoes", href: "/configuracoes", icone: Gear, atalho: "9", disponivelNaFase: 1 },
];

/**
 * Os quatro ultimos entraram tarde, e a ausencia deles nao era decisao de
 * produto: `/convenios`, `/explorar` e `/configuracoes` existiam como paginas,
 * respondiam 200 e **nenhum link no sistema apontava para elas**. Sem item aqui,
 * o unico jeito de chegar era digitar a URL — o modulo inteiro de faturamento
 * TISS ficava invisivel para quem usa o produto.
 *
 * `ITENS_MOBILE_VISIVEIS` (5) cuida do excedente: no celular os demais vao para
 * o menu de overflow em vez de espremer a barra.
 */


export const FASE_ATUAL = 5 as const;
